import type { AppEnv } from "../config/env";
import { DatabaseService } from "./database";
import { EmailService } from "./email";

type MessageChannel = "email" | "bark";

type QueueMessageRow = {
  id: number;
  announcement_id: number;
  user_id: number;
  channel: string;
  recipient: string;
  payload: string;
  attempt_count: number;
  max_attempts: number;
};

type RecipientRow = {
  user_id: number;
  recipient: string;
};

type QueuePayload = {
  type: "announcement";
  site_name?: string;
  site_url?: string;
  announcement: {
    id: number;
    title: string;
    content: string;
    content_html: string;
    announcement_type: string;
  };
};

type EnqueueInput = {
  announcementId: number;
  channels: string[];
  minClass: number;
  title: string;
  content: string;
  contentHtml: string;
  type: string;
};

const SUPPORTED_CHANNELS: MessageChannel[] = ["email", "bark"];
const STATUS_PENDING = 0;
const STATUS_PROCESSING = 1;
const STATUS_SENT = 2;
const STATUS_FAILED = 3;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_ATTEMPTS = 3;

export class MessageQueueService {
  private readonly db: DatabaseService;
  private readonly env: AppEnv;
  private readonly emailService: EmailService;

  constructor(db: DatabaseService, env: AppEnv) {
    this.db = db;
    this.env = env;
    this.emailService = new EmailService(env);
  }

  normalizeChannels(channels: unknown): MessageChannel[] {
    const source = this.extractChannelList(channels);
    if (source.length === 0) return [];
    const normalized = source
      .map((item) => String(item ?? "").trim().toLowerCase())
      .filter((item): item is MessageChannel =>
        (SUPPORTED_CHANNELS as string[]).includes(item)
      );
    return Array.from(new Set(normalized));
  }

  private extractChannelList(channels: unknown): string[] {
    if (Array.isArray(channels)) {
      return channels.map((item) => String(item ?? ""));
    }

    if (typeof channels === "string") {
      const trimmed = channels.trim();
      if (!trimmed) return [];

      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? ""));
          }
        } catch {
          // ignore parse error and fallback to comma split
        }
      }

      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    return [];
  }

  async enqueueAnnouncementNotifications(input: EnqueueInput) {
    const channels = this.normalizeChannels(input.channels);
    if (channels.length === 0) {
      return {
        success: true,
        queued_count: 0,
        channels: [],
        min_class: Math.max(0, Number(input.minClass || 0)),
        channel_stats: {} as Record<string, number>
      };
    }
    const minClass = Math.max(0, Number(input.minClass || 0));

    const siteConfigs = await this.loadSiteConfigs();
    const payload: QueuePayload = {
      type: "announcement",
      site_name: siteConfigs.site_name,
      site_url: siteConfigs.site_url,
      announcement: {
        id: input.announcementId,
        title: input.title,
        content: input.content,
        content_html: input.contentHtml,
        announcement_type: input.type
      }
    };
    const payloadJson = JSON.stringify(payload);

    const insertStmt = this.db.db.prepare(`
      INSERT INTO message_queue (
        announcement_id, user_id, channel, recipient, payload,
        status, attempt_count, max_attempts, scheduled_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    let queuedCount = 0;
    const channelStats: Record<string, number> = {};

    for (const channel of channels) {
      const recipients = await this.getRecipientsByChannel(channel, minClass);
      channelStats[channel] = recipients.length;
      for (const recipient of recipients) {
        await insertStmt
          .bind(
            input.announcementId,
            recipient.user_id,
            channel,
            recipient.recipient,
            payloadJson,
            STATUS_PENDING,
            0,
            DEFAULT_MAX_ATTEMPTS
          )
          .run();
      }
      queuedCount += recipients.length;
    }

    return {
      success: true,
      queued_count: queuedCount,
      channels,
      min_class: minClass,
      channel_stats: channelStats
    };
  }

  async processPendingMessages() {
    await this.releaseStaleProcessingMessages();

    const pageSize = await this.getQueuePageSize();
    const result = await this.db.db
      .prepare(
        `
        SELECT id, announcement_id, user_id, channel, recipient, payload, attempt_count, max_attempts
        FROM message_queue
        WHERE status = ? AND scheduled_at <= CURRENT_TIMESTAMP
        ORDER BY id ASC
        LIMIT ?
      `
      )
      .bind(STATUS_PENDING, pageSize)
      .all<QueueMessageRow>();

    const messages = result.results ?? [];
    if (messages.length === 0) {
      return {
        success: true,
        message: "消息队列无待发送消息",
        page_size: pageSize,
        fetched: 0,
        sent: 0,
        retrying: 0,
        failed: 0
      };
    }

    let sent = 0;
    let retrying = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of messages) {
      const locked = await this.lockMessage(row.id);
      if (!locked) {
        skipped += 1;
        continue;
      }

      try {
        await this.dispatchMessage(row);
        await this.markSent(row.id, Number(row.attempt_count || 0) + 1);
        sent += 1;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const outcome = await this.markFailedOrRetry(row, err);
        if (outcome === "retry") {
          retrying += 1;
        } else {
          failed += 1;
        }
      }
    }

    return {
      success: true,
      message: `消息发送完成，成功 ${sent}，重试中 ${retrying}，失败 ${failed}`,
      page_size: pageSize,
      fetched: messages.length,
      processed: sent + retrying + failed,
      sent,
      retrying,
      failed,
      skipped
    };
  }

  private async loadSiteConfigs() {
    const defaults = {
      site_name: this.env.SITE_NAME || "Soga Panel",
      site_url: this.env.SITE_URL || ""
    };
    try {
      const map = await this.db.listSystemConfigsMap();
      return {
        site_name: map["site_name"] || defaults.site_name,
        site_url: map["site_url"] || defaults.site_url
      };
    } catch {
      return defaults;
    }
  }

  private async getQueuePageSize() {
    try {
      const map = await this.db.listSystemConfigsMap();
      const value = Number.parseInt(
        map["message_queue_page_size"] ?? String(DEFAULT_PAGE_SIZE),
        10
      );
      if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE_SIZE;
      return Math.min(value, MAX_PAGE_SIZE);
    } catch {
      return DEFAULT_PAGE_SIZE;
    }
  }

  private async releaseStaleProcessingMessages() {
    await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, updated_at = CURRENT_TIMESTAMP, last_error = IFNULL(last_error, 'processing timeout')
        WHERE status = ? AND updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)
      `
      )
      .bind(STATUS_PENDING, STATUS_PROCESSING)
      .run();
  }

  private async getRecipientsByChannel(channel: MessageChannel, minClass: number): Promise<RecipientRow[]> {
    const safeMinClass = Math.max(0, Number(minClass || 0));
    if (channel === "email") {
      const result = await this.db.db
        .prepare(
          `
          SELECT id AS user_id, email AS recipient
          FROM users
          WHERE status = 1
            AND email IS NOT NULL
            AND email != ''
            AND (? <= 0 OR class >= ?)
        `
        )
        .bind(safeMinClass, safeMinClass)
        .all<RecipientRow>();
      return result.results ?? [];
    }

    const result = await this.db.db
      .prepare(
        `
        SELECT id AS user_id, bark_key AS recipient
        FROM users
        WHERE status = 1
          AND bark_enabled = 1
          AND bark_key IS NOT NULL
          AND bark_key != ''
          AND (? <= 0 OR class >= ?)
      `
      )
      .bind(safeMinClass, safeMinClass)
      .all<RecipientRow>();
    return result.results ?? [];
  }

  private async lockMessage(id: number) {
    const result = await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = ? AND scheduled_at <= CURRENT_TIMESTAMP
      `
      )
      .bind(STATUS_PROCESSING, id, STATUS_PENDING)
      .run();
    return Number(result.changes ?? 0) > 0;
  }

  private async dispatchMessage(row: QueueMessageRow) {
    const payload = this.parsePayload(row.payload);
    const channel = String(row.channel || "").toLowerCase();
    if (channel === "email") {
      await this.sendEmailNotification(row, payload);
      return;
    }
    if (channel === "bark") {
      await this.sendBarkNotification(row, payload);
      return;
    }
    throw new Error(`不支持的通知通道: ${channel}`);
  }

  private async sendEmailNotification(row: QueueMessageRow, payload: QueuePayload) {
    const siteName = payload.site_name || "Soga Panel";
    const title = payload.announcement?.title || "系统公告";
    const content = payload.announcement?.content || "";
    const contentHtml = payload.announcement?.content_html || "";

    const htmlBody = contentHtml || this.escapeHtml(content).replace(/\n/g, "<br/>");
    const html = `
      <h2>${this.escapeHtml(title)}</h2>
      <div>${htmlBody}</div>
      <hr/>
      <p style="color:#666;font-size:12px;">此邮件由 ${this.escapeHtml(siteName)} 自动发送</p>
    `;
    const text = `${title}\n\n${content}\n\n${siteName}`;

    await this.emailService.sendMail({
      to: String(row.recipient || ""),
      subject: `[${siteName}] ${title}`,
      html,
      text
    });
  }

  private async sendBarkNotification(row: QueueMessageRow, payload: QueuePayload) {
    const siteName = payload.site_name || "Soga Panel";
    const siteUrl = payload.site_url || "";
    const title = payload.announcement?.title || "系统公告";
    const content = payload.announcement?.content || "";
    const preview = this.truncate(content.replace(/\s+/g, " ").trim(), 180);

    let endpoint = "https://api.day.app";
    let keyPath = String(row.recipient || "");

    if (keyPath.startsWith("http://") || keyPath.startsWith("https://")) {
      const url = new URL(keyPath);
      endpoint = `${url.protocol}//${url.host}`;
      keyPath = url.pathname.replace(/^\//, "") || "push";
    }

    const response = await fetch(`${endpoint}/${keyPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Soga-Panel-Server/1.0"
      },
      body: JSON.stringify({
        title,
        body: preview || "您有一条新的公告，请登录面板查看。",
        group: siteName,
        icon: siteUrl ? `${siteUrl.replace(/\/?$/, "")}/favicon.ico` : undefined,
        url: siteUrl || undefined
      })
    });

    if (!response.ok) {
      throw new Error(`Bark 请求失败: HTTP ${response.status}`);
    }

    let result: { code?: number; message?: string } | null = null;
    try {
      result = (await response.json()) as { code?: number; message?: string };
    } catch {
      result = null;
    }

    if (result && typeof result.code === "number" && result.code !== 200) {
      throw new Error(`Bark 返回错误: ${result.message || `code=${result.code}`}`);
    }
  }

  private async markSent(id: number, attempts: number) {
    await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, sent_at = CURRENT_TIMESTAMP, attempt_count = ?, updated_at = CURRENT_TIMESTAMP, last_error = NULL
        WHERE id = ?
      `
      )
      .bind(STATUS_SENT, attempts, id)
      .run();
  }

  private async markFailedOrRetry(
    row: QueueMessageRow,
    error: Error
  ): Promise<"retry" | "failed"> {
    const attempts = Number(row.attempt_count || 0) + 1;
    const maxAttempts = Math.max(1, Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS));
    const finalFailed = attempts >= maxAttempts;
    const errorMessage = this.truncate(error.message || "发送失败", 500);

    if (finalFailed) {
      await this.db.db
        .prepare(
          `
          UPDATE message_queue
          SET status = ?, attempt_count = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(STATUS_FAILED, attempts, errorMessage, row.id)
        .run();
      return "failed";
    }

    const retryDelaySeconds = this.getRetryDelaySeconds(attempts);
    await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, attempt_count = ?, last_error = ?,
            scheduled_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(STATUS_PENDING, attempts, errorMessage, retryDelaySeconds, row.id)
      .run();
    return "retry";
  }

  private getRetryDelaySeconds(attempts: number) {
    return Math.min(600, Math.max(60, attempts * 60));
  }

  private parsePayload(raw: string): QueuePayload {
    try {
      const payload = JSON.parse(raw) as QueuePayload;
      if (!payload || payload.type !== "announcement") {
        throw new Error("payload type mismatch");
      }
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`消息内容解析失败: ${message}`);
    }
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private truncate(value: string, maxLength: number) {
    if (!value) return "";
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
  }
}
