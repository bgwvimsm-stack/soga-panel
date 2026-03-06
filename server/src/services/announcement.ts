import { DatabaseService } from "./database";
import { ensureNumber, ensureString, getLastRowId, toRunResult } from "../utils/d1";
import { getUtc8Timestamp } from "../utils/time";
import type { AppEnv } from "../config/env";
import { MessageQueueService } from "./messageQueue";

export class AnnouncementService {
  private readonly db: DatabaseService;
  private readonly messageQueueService: MessageQueueService;

  constructor(db: DatabaseService, env: AppEnv) {
    this.db = db;
    this.messageQueueService = new MessageQueueService(db, env);
  }

  // 简易 Markdown -> HTML，用于公告展示
  private markdownToHtml(markdown: string | undefined): string {
    if (!markdown) return "";
    let html = markdown
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*)\*\*/gim, "<strong>$1</strong>")
      .replace(/\*(.*)\*/gim, "<em>$1</em>")
      .replace(/^\- (.*$)/gim, "<li>$1</li>")
      .replace(/\n\n/gim, "</p><p>")
      .replace(/\n/gim, "<br/>");
    html = "<p>" + html + "</p>";
    html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
    return html;
  }

  async listPublic(limit = 10, offset = 0) {
    const now = getUtc8Timestamp();
    const result = await this.db.db
      .prepare(
        `
        SELECT id, title, content, content_html, type, is_pinned, priority, created_at, expires_at
        FROM announcements 
        WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY is_pinned DESC, priority DESC, created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(now, limit, offset)
      .all();

    const announcements = result.results || [];
    return announcements.map((ann: any) => {
      const createdAt = ensureNumber(ann.created_at);
      const expiresAt = ann.expires_at !== null ? ensureNumber(ann.expires_at) : null;
      return {
        id: ann.id,
        title: ensureString(ann.title),
        content: ensureString(ann.content),
        content_html: ann.content_html ?? "",
        type: ensureString(ann.type),
        is_pinned: !!ann.is_pinned,
        priority: ensureNumber(ann.priority),
        created_at: createdAt,
        expires_at: expiresAt,
        is_expired: expiresAt !== null ? expiresAt < now : false
      };
    });
  }

  async listAdmin(page = 1, limit = 20) {
    const safeLimit = limit > 0 ? limit : 20;
    const offset = (page - 1) * safeLimit;
    const rows = await this.db.db
      .prepare(
        `
        SELECT a.*, u.username as created_by_name
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(safeLimit, offset)
      .all();

    const count = await this.db.db
      .prepare("SELECT COUNT(*) as total FROM announcements")
      .first<{ total?: number }>();

    return {
      data: (rows.results || []).map((ann: any) => ({
        ...ann,
        status: ensureNumber(ann.is_active),
        created_at: new Date(ensureNumber(ann.created_at) * 1000).toISOString()
      })),
      total: ensureNumber(count?.total),
      page,
      limit: safeLimit
    };
  }

  async create(data: {
    title: string;
    content: string;
    type?: string;
    status?: number;
    is_pinned?: boolean;
    priority?: number;
    notification_channels?: unknown;
    notification_min_class?: unknown;
    created_by: number;
  }) {
    const now = getUtc8Timestamp();
    const notificationChannels = this.messageQueueService.normalizeChannels(
      data.notification_channels
    );
    const notificationMinClass = this.parseNotificationMinClass(
      data.notification_min_class
    );
    if (
      this.hasNotificationChannelInput(data.notification_channels) &&
      notificationChannels.length === 0
    ) {
      throw new Error("通知方式无效");
    }
    if (notificationMinClass === null) {
      throw new Error("VIP等级无效");
    }

    const contentHtml = this.markdownToHtml(data.content);
    const result = toRunResult(
      await this.db.db
        .prepare(
          `
        INSERT INTO announcements (title, content, content_html, type, is_active, is_pinned, priority, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .bind(
          ensureString(data.title),
          ensureString(data.content),
          contentHtml,
          ensureString(data.type ?? "notice"),
          Number(data.status ?? 1),
          data.is_pinned ? 1 : 0,
          Number(data.priority ?? 0),
          data.created_by,
          now,
          now
        )
        .run()
    );

    const newId = getLastRowId(result);
    if (!newId || newId <= 0) {
      throw new Error("创建公告失败：无法获取公告ID");
    }
    const created = await this.db.db
      .prepare("SELECT * FROM announcements WHERE id = ?")
      .bind(newId)
      .first();

    let queueResult: Record<string, unknown> = {
      queued_count: 0,
      channels: []
    };
    if (notificationChannels.length > 0) {
      queueResult = await this.messageQueueService.enqueueAnnouncementNotifications({
        announcementId: newId,
        channels: notificationChannels,
        minClass: notificationMinClass,
        title: ensureString(data.title),
        content: ensureString(data.content),
        contentHtml,
        type: ensureString(data.type ?? "notice")
      });
    }

    return {
      ...(created || {}),
      notification_queue: queueResult
    };
  }

  async update(id: number, payload: Partial<{ title: string; content: string; type: string; status: number; is_pinned: boolean; priority: number }>) {
    const fields: string[] = [];
    const values: any[] = [];
    if (payload.title !== undefined) {
      fields.push("title = ?");
      values.push(payload.title);
    }
    if (payload.content !== undefined) {
      fields.push("content = ?");
      values.push(payload.content);
      fields.push("content_html = ?");
      values.push(this.markdownToHtml(payload.content));
    }
    if (payload.type !== undefined) {
      fields.push("type = ?");
      values.push(payload.type);
    }
    if (payload.status !== undefined) {
      fields.push("is_active = ?");
      values.push(payload.status);
    }
    if (payload.is_pinned !== undefined) {
      fields.push("is_pinned = ?");
      values.push(payload.is_pinned ? 1 : 0);
    }
    if (payload.priority !== undefined) {
      fields.push("priority = ?");
      values.push(payload.priority);
    }

    if (!fields.length) return null;

    values.push(getUtc8Timestamp(), id);
    await this.db.db
      .prepare(
        `
        UPDATE announcements
        SET ${fields.join(", ")}, updated_at = ?
        WHERE id = ?
      `
      )
      .bind(...values)
      .run();

    return await this.db.db.prepare("SELECT * FROM announcements WHERE id = ?").bind(id).first();
  }

  async delete(id: number) {
    await this.db.db.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
  }

  private hasNotificationChannelInput(channels: unknown) {
    if (Array.isArray(channels)) return channels.length > 0;
    if (typeof channels === "string") return channels.trim().length > 0;
    return channels !== undefined && channels !== null;
  }

  private parseNotificationMinClass(value: unknown) {
    if (value === undefined || value === null || value === "") return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.floor(parsed));
  }
}
