import type { Env } from "../types";
import { DatabaseService } from "./database";
import { EmailService } from "./email";
import { createSystemConfigManager, type SystemConfigManager } from "../utils/systemConfig";
import { getLogger, type Logger } from "../utils/logger";
import { ensureNumber, ensureString, getChanges, toRunResult } from "../utils/d1";
import { getUtc8Timestamp } from "../utils/crypto";

type MessageChannel = "email" | "bark" | "telegram";

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

type AnnouncementQueueInput = {
  announcementId: number;
  channels: string[];
  minClass: number;
  title: string;
  content: string;
  contentHtml: string;
  type: string;
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

const SUPPORTED_CHANNELS: MessageChannel[] = ["email", "bark", "telegram"];
const STATUS_PENDING = 0;
const STATUS_PROCESSING = 1;
const STATUS_SENT = 2;
const STATUS_FAILED = 3;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_ATTEMPTS = 3;

export class MessageQueueService {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly logger: Logger;
  private readonly configManager: SystemConfigManager;
  private readonly emailService: EmailService;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.logger = getLogger(env);
    this.configManager = createSystemConfigManager(env);
    this.emailService = new EmailService(env);
  }

  normalizeChannels(channels: unknown): MessageChannel[] {
    const source = this.extractChannelList(channels);
    if (source.length === 0) return [];
    const normalized = source
      .map((item) => ensureString(item).trim().toLowerCase())
      .filter((item): item is MessageChannel =>
        (SUPPORTED_CHANNELS as string[]).includes(item)
      );
    return Array.from(new Set(normalized));
  }

  private extractChannelList(channels: unknown): string[] {
    if (Array.isArray(channels)) {
      return channels.map((item) => ensureString(item));
    }
    if (typeof channels === "string") {
      const trimmed = channels.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => ensureString(item));
          }
        } catch (_error) {
          // ignore json parse error and fallback to split
        }
      }
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return [];
  }

  async enqueueAnnouncementNotifications(input: AnnouncementQueueInput) {
    const channels = this.normalizeChannels(input.channels);
    if (channels.includes("telegram")) {
      await this.db.ensureUsersTelegramColumns();
    }
    if (channels.length === 0) {
      return {
        success: true,
        queued_count: 0,
        channels: [],
        min_class: Math.max(0, ensureNumber(input.minClass)),
        channel_stats: {} as Record<string, number>
      };
    }

    const minClass = Math.max(0, ensureNumber(input.minClass));

    const now = getUtc8Timestamp();
    const siteName =
      (await this.configManager.getSystemConfig(
        "site_name",
        ensureString(this.env.SITE_NAME, "Soga Panel")
      )) || "Soga Panel";
    const siteUrl = await this.configManager.getSystemConfig(
      "site_url",
      ensureString(this.env.SITE_URL, "")
    );

    const payload: QueuePayload = {
      type: "announcement",
      site_name: siteName,
      site_url: siteUrl,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            DEFAULT_MAX_ATTEMPTS,
            now,
            now,
            now
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
    const now = getUtc8Timestamp();
    const pageSize = await this.getQueuePageSize();
    await this.releaseStaleProcessingMessages(now);

    const result = await this.db.db
      .prepare(
        `
        SELECT id, announcement_id, user_id, channel, recipient, payload, attempt_count, max_attempts
        FROM message_queue
        WHERE status = ? AND scheduled_at <= ?
        ORDER BY id ASC
        LIMIT ?
      `
      )
      .bind(STATUS_PENDING, now, pageSize)
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
      const locked = await this.lockMessage(row.id, now);
      if (!locked) {
        skipped++;
        continue;
      }

      try {
        await this.dispatchMessage(row);
        await this.markSent(row.id, now, ensureNumber(row.attempt_count) + 1);
        sent++;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const outcome = await this.markFailedOrRetry(row, err, now);
        if (outcome === "retry") {
          retrying++;
        } else {
          failed++;
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

  private async getQueuePageSize() {
    const raw = await this.configManager.getSystemConfig(
      "message_queue_page_size",
      String(DEFAULT_PAGE_SIZE)
    );
    const size = Number.parseInt(raw || String(DEFAULT_PAGE_SIZE), 10);
    if (!Number.isFinite(size) || size <= 0) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.min(size, MAX_PAGE_SIZE);
  }

  private async releaseStaleProcessingMessages(now: number) {
    const staleBefore = now - 10 * 60;
    await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, updated_at = ?, last_error = COALESCE(last_error, 'processing timeout')
        WHERE status = ? AND updated_at <= ?
      `
      )
      .bind(STATUS_PENDING, now, STATUS_PROCESSING, staleBefore)
      .run();
  }

  private async getRecipientsByChannel(channel: MessageChannel, minClass: number): Promise<RecipientRow[]> {
    const safeMinClass = Math.max(0, ensureNumber(minClass));

    if (channel === "email") {
      const result = await this.db.db
        .prepare(
          `
          SELECT id as user_id, email as recipient
          FROM users
          WHERE status = 1
            AND email IS NOT NULL
            AND email != ''
            AND (? <= 0 OR class >= ?)
        `
        )
        .bind(safeMinClass, safeMinClass)
        .all<RecipientRow>();
      return (result.results ?? []).filter(
        (row) => ensureString(row.recipient).length > 0 && ensureNumber(row.user_id) > 0
      );
    }

    if (channel === "telegram") {
      const result = await this.db.db
        .prepare(
          `
          SELECT id as user_id, telegram_id as recipient
          FROM users
          WHERE status = 1
            AND telegram_enabled = 1
            AND telegram_id IS NOT NULL
            AND CAST(telegram_id AS TEXT) != ''
            AND (? <= 0 OR class >= ?)
        `
        )
        .bind(safeMinClass, safeMinClass)
        .all<RecipientRow>();
      return (result.results ?? []).filter(
        (row) => ensureString(row.recipient).length > 0 && ensureNumber(row.user_id) > 0
      );
    }

    const result = await this.db.db
      .prepare(
        `
        SELECT id as user_id, bark_key as recipient
        FROM users
        WHERE status = 1
          AND bark_enabled = 1
          AND NOT (
            telegram_enabled = 1
            AND telegram_id IS NOT NULL
            AND CAST(telegram_id AS TEXT) != ''
          )
          AND bark_key IS NOT NULL
          AND bark_key != ''
          AND (? <= 0 OR class >= ?)
      `
      )
      .bind(safeMinClass, safeMinClass)
      .all<RecipientRow>();
    return (result.results ?? []).filter(
      (row) => ensureString(row.recipient).length > 0 && ensureNumber(row.user_id) > 0
    );
  }

  private async lockMessage(id: number, now: number) {
    const result = toRunResult(
      await this.db.db
        .prepare(
          `
          UPDATE message_queue
          SET status = ?, updated_at = ?
          WHERE id = ? AND status = ? AND scheduled_at <= ?
        `
        )
        .bind(STATUS_PROCESSING, now, id, STATUS_PENDING, now)
        .run()
    );
    return getChanges(result) > 0;
  }

  private async dispatchMessage(row: QueueMessageRow) {
    const payload = this.parsePayload(row.payload);
    const channel = ensureString(row.channel).toLowerCase();

    if (channel === "email") {
      await this.sendEmailNotification(row, payload);
      return;
    }

    if (channel === "bark") {
      await this.sendBarkNotification(row, payload);
      return;
    }

    if (channel === "telegram") {
      await this.sendTelegramNotification(row, payload);
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

    await this.emailService.sendEmail({
      to: ensureString(row.recipient),
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
    const markdown = this.buildBarkMarkdown(content);
    const preview = this.truncate(content.replace(/\s+/g, " ").trim(), 180);

    let endpoint = "https://api.day.app";
    let keyPath = ensureString(row.recipient);

    if (keyPath.startsWith("http://") || keyPath.startsWith("https://")) {
      const url = new URL(keyPath);
      endpoint = `${url.protocol}//${url.host}`;
      keyPath = url.pathname.replace(/^\//, "") || "push";
    }

    const response = await fetch(`${endpoint}/${keyPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Soga-Panel/1.0"
      },
      body: JSON.stringify({
        title,
        body: preview || "您有一条新的公告，请登录面板查看。",
        markdown,
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
    } catch (_error) {
      result = null;
    }

    if (result && typeof result.code === "number" && result.code !== 200) {
      throw new Error(`Bark 返回错误: ${result.message || `code=${result.code}`}`);
    }
  }

  private async sendTelegramNotification(row: QueueMessageRow, payload: QueuePayload) {
    const token =
      (
        await this.configManager.getSystemConfig(
          "telegram_bot_token",
          ensureString(this.env.TELEGRAM_BOT_TOKEN, "")
        )
      )?.trim() || "";
    if (!token) {
      throw new Error("未配置 telegram_bot_token");
    }

    const apiBase =
      (
        await this.configManager.getSystemConfig(
          "telegram_bot_api_base",
          "https://api.telegram.org"
        )
      )?.trim() || "https://api.telegram.org";

    const siteName = payload.site_name || "Soga Panel";
    const siteUrl = payload.site_url || "";
    const title = payload.announcement?.title || "系统公告";
    const content = payload.announcement?.content || "";
    const titleMarkdown = `*${this.escapeTelegramMarkdownV2(`【${siteName}】${title}`)}*`;
    const bodyMarkdown = this.buildTelegramMarkdownV2(content);
    const urlPart = siteUrl
      ? `\n\n[打开面板](${this.escapeTelegramMarkdownV2Url(siteUrl.trim())})`
      : "";
    const text = bodyMarkdown
      ? `${titleMarkdown}\n\n${bodyMarkdown}${urlPart}`
      : `${titleMarkdown}\n\n您有一条新的公告，请登录面板查看。${urlPart}`;

    const chatId = ensureString(row.recipient).trim();
    if (!chatId) {
      throw new Error("缺少 Telegram chat_id");
    }

    const endpoint = `${apiBase.replace(/\/+$/, "")}/bot${token}/sendMessage`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Soga-Panel/1.0"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true
      })
    });

    let result:
      | {
          ok?: boolean;
          description?: string;
          error_code?: number;
        }
      | null = null;
    try {
      result = (await response.json()) as {
        ok?: boolean;
        description?: string;
        error_code?: number;
      };
    } catch (_error) {
      result = null;
    }

    const description = ensureString(result?.description, "");
    if ((!response.ok || result?.ok === false) && this.isTelegramParseError(description)) {
      const fallbackText = this.buildTelegramPlainText(siteName, title, content, siteUrl);
      const fallbackResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "Soga-Panel/1.0"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: fallbackText,
          disable_web_page_preview: true
        })
      });

      let fallbackResult:
        | {
            ok?: boolean;
            description?: string;
            error_code?: number;
          }
        | null = null;
      try {
        fallbackResult = (await fallbackResponse.json()) as {
          ok?: boolean;
          description?: string;
          error_code?: number;
        };
      } catch (_error) {
        fallbackResult = null;
      }

      if (fallbackResponse.ok && fallbackResult?.ok !== false) {
        return;
      }

      throw new Error(
        `Telegram MarkdownV2与纯文本均发送失败: ${
          fallbackResult?.description || description || `HTTP ${fallbackResponse.status}`
        }`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Telegram 请求失败: HTTP ${response.status}${
          result?.description ? ` - ${result.description}` : ""
        }`
      );
    }

    if (result && result.ok === false) {
      throw new Error(
        `Telegram 返回错误: ${result.description || `code=${result.error_code ?? "unknown"}`}`
      );
    }
  }

  private async markSent(id: number, now: number, attempts: number) {
    await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, sent_at = ?, attempt_count = ?, updated_at = ?, last_error = NULL
        WHERE id = ?
      `
      )
      .bind(STATUS_SENT, now, attempts, now, id)
      .run();
  }

  private async markFailedOrRetry(
    row: QueueMessageRow,
    error: Error,
    now: number
  ): Promise<"retry" | "failed"> {
    const attempts = ensureNumber(row.attempt_count) + 1;
    const maxAttempts = Math.max(1, ensureNumber(row.max_attempts, DEFAULT_MAX_ATTEMPTS));
    const finalFailed = attempts >= maxAttempts;
    const nextSchedule = now + this.getRetryDelaySeconds(attempts);
    const errorMessage = this.truncate(error.message || "发送失败", 500);

    if (finalFailed) {
      await this.db.db
        .prepare(
          `
          UPDATE message_queue
          SET status = ?, attempt_count = ?, last_error = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .bind(STATUS_FAILED, attempts, errorMessage, now, row.id)
        .run();

      this.logger.error("消息队列发送失败（达到最大重试次数）", error, {
        queue_id: row.id,
        channel: row.channel,
        user_id: row.user_id,
        recipient: row.recipient,
        attempts,
        max_attempts: maxAttempts
      });
      return "failed";
    }

    await this.db.db
      .prepare(
        `
        UPDATE message_queue
        SET status = ?, attempt_count = ?, last_error = ?, scheduled_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .bind(STATUS_PENDING, attempts, errorMessage, nextSchedule, now, row.id)
      .run();

    return "retry";
  }

  private getRetryDelaySeconds(attempts: number) {
    return Math.min(600, Math.max(60, attempts * 60));
  }

  private parsePayload(raw: string): QueuePayload {
    try {
      const parsed = JSON.parse(raw) as QueuePayload;
      if (!parsed || parsed.type !== "announcement") {
        throw new Error("payload type mismatch");
      }
      return parsed;
    } catch (error) {
      throw new Error(
        `消息内容解析失败: ${error instanceof Error ? error.message : String(error)}`
      );
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

  private buildTelegramMarkdownV2(content: string) {
    const normalized = ensureString(content, "").replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const out: string[] = [];
    let inCodeBlock = false;

    for (const line of normalized.split("\n")) {
      const trimmed = line.trim();
      const fenceMatch = /^```([a-zA-Z0-9_+-]*)\s*$/.exec(trimmed);
      if (fenceMatch) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          const lang = ensureString(fenceMatch[1], "");
          out.push(`\`\`\`${lang}`);
        } else {
          inCodeBlock = false;
          out.push("```");
        }
        continue;
      }

      if (inCodeBlock) {
        out.push(this.escapeTelegramCode(line));
        continue;
      }

      if (!trimmed) {
        out.push("");
        continue;
      }

      if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
        out.push("────────");
        continue;
      }

      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (headingMatch) {
        out.push(`*${this.renderTelegramInlineMarkdownV2(headingMatch[2])}*`);
        continue;
      }

      const quoteMatch = /^>\s?(.*)$/.exec(trimmed);
      if (quoteMatch) {
        out.push(`❝ ${this.renderTelegramInlineMarkdownV2(quoteMatch[1])}`);
        continue;
      }

      const unorderedMatch = /^[-+*]\s+(.+)$/.exec(trimmed);
      if (unorderedMatch) {
        out.push(`• ${this.renderTelegramInlineMarkdownV2(unorderedMatch[1])}`);
        continue;
      }

      const orderedMatch = /^(\d+)\.\s+(.+)$/.exec(trimmed);
      if (orderedMatch) {
        out.push(`${orderedMatch[1]}\\. ${this.renderTelegramInlineMarkdownV2(orderedMatch[2])}`);
        continue;
      }

      out.push(this.renderTelegramInlineMarkdownV2(line.trimEnd()));
    }

    if (inCodeBlock) {
      out.push("```");
    }

    return this.collapseBlankLines(out.join("\n"));
  }

  private renderTelegramInlineMarkdownV2(input: string) {
    if (!input) return "";

    const tokens: string[] = [];
    const stash = (value: string) => {
      const index = tokens.length;
      tokens.push(value);
      return `\u0000${index}\u0000`;
    };

    let text = input;

    text = text.replace(/`([^`\n]+)`/g, (_match, code: string) =>
      stash(`\`${this.escapeTelegramCode(code)}\``)
    );

    text = text.replace(
      /\[([^\]\n]+)\]\(([^)\n]+)\)/g,
      (_match, label: string, url: string) =>
        stash(
          `[${this.escapeTelegramMarkdownV2(label)}](${this.escapeTelegramMarkdownV2Url(url.trim())})`
        )
    );

    text = text.replace(
      /\*\*([^\n*]+)\*\*/g,
      (_match, value: string) => stash(`*${this.escapeTelegramMarkdownV2(value)}*`)
    );
    text = text.replace(
      /__([^\n_]+)__/g,
      (_match, value: string) => stash(`*${this.escapeTelegramMarkdownV2(value)}*`)
    );
    text = text.replace(
      /~~([^\n~]+)~~/g,
      (_match, value: string) => stash(`~${this.escapeTelegramMarkdownV2(value)}~`)
    );
    text = text.replace(
      /\*([^\n*]+)\*/g,
      (_match, value: string) => stash(`_${this.escapeTelegramMarkdownV2(value)}_`)
    );
    text = text.replace(
      /_([^\n_]+)_/g,
      (_match, value: string) => stash(`_${this.escapeTelegramMarkdownV2(value)}_`)
    );

    text = this.escapeTelegramMarkdownV2(text);

    return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
      return tokens[Number(index)] || "";
    });
  }

  private escapeTelegramMarkdownV2(value: string) {
    return ensureString(value, "").replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
  }

  private escapeTelegramMarkdownV2Url(value: string) {
    return ensureString(value, "").replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
  }

  private escapeTelegramCode(value: string) {
    return ensureString(value, "").replace(/\\/g, "\\\\").replace(/`/g, "\\`");
  }

  private collapseBlankLines(value: string) {
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  private isTelegramParseError(description: string) {
    const message = ensureString(description, "").toLowerCase();
    return (
      message.includes("can't parse entities") ||
      message.includes("unsupported start tag") ||
      message.includes("unsupported end tag") ||
      message.includes("can't find end tag") ||
      message.includes("entity is not closed")
    );
  }

  private buildTelegramPlainText(siteName: string, title: string, content: string, siteUrl: string) {
    const preview = this.truncate((content || "").trim(), 3200);
    return preview
      ? `【${siteName}】${title}\n\n${preview}${siteUrl ? `\n\n${siteUrl}` : ""}`
      : `【${siteName}】${title}\n\n您有一条新的公告，请登录面板查看。${siteUrl ? `\n${siteUrl}` : ""}`;
  }

  private truncate(value: string, maxLength: number) {
    if (!value) return "";
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
  }

  private buildBarkMarkdown(content: string) {
    const normalized = ensureString(content, "").replace(/\r\n/g, "\n").trim();
    return normalized || "您有一条新的公告，请登录面板查看。";
  }
}
