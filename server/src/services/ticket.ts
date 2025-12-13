import { DatabaseService } from "./database";
import { ensureNumber, ensureString, getLastRowId, toRunResult } from "../utils/d1";

const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 8000;

export class TicketService {
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  private buildTicketResponse(row: any, includeContent = false, includeUser = false) {
    const contentValue = includeContent ? String(row.content ?? "") : undefined;
    const base: any = {
      id: row.id,
      title: row.title,
      status: row.status,
      last_reply_at: row.last_reply_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    if (includeUser && row.user_id !== undefined) {
      base.user = {
        id: row.user_id,
        username: row.user_name ?? row.username ?? null,
        email: row.user_email ?? row.email ?? null
      };
    }
    if (includeContent) {
      return { ...base, content: contentValue };
    }
    return base;
  }

  async getUserTicketDetailWithReplies(ticketId: number, userId: number) {
    const ticket = await this.db.db
      .prepare(
        `
        SELECT id, user_id, title, content, status, last_reply_at, created_at, updated_at
        FROM tickets
        WHERE id = ? AND user_id = ?
      `
      )
      .bind(ticketId, userId)
      .first();
    if (!ticket) return null;
    const replies = await this.listReplies(ticketId);
    return { ticket: this.buildTicketResponse(ticket, true), replies };
  }

  async getAdminTicketDetailWithReplies(ticketId: number) {
    const ticket = await this.db.db
      .prepare(
        `
        SELECT t.*, u.username AS user_name, u.email AS user_email
        FROM tickets t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.id = ?
      `
      )
      .bind(ticketId)
      .first();
    if (!ticket) return null;
    const replies = await this.listReplies(ticketId);
    return { ticket: this.buildTicketResponse(ticket, true, true), replies };
  }

  async createTicket(userId: number, title: string, content: string) {
    const safeTitle = sanitizeText(title, MAX_TITLE_LENGTH);
    const safeContent = sanitizeText(content, MAX_CONTENT_LENGTH);
    if (!safeTitle || !safeContent) {
      throw new Error("标题和内容不能为空");
    }

    const result = toRunResult(
      await this.db.db
        .prepare(
      `
        INSERT INTO tickets (user_id, title, content, status, created_at, updated_at)
        VALUES (?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
        )
        .bind(userId, safeTitle, safeContent)
        .run()
    );
    const id = getLastRowId(result);
    const ticket = id ? await this.getTicketDetail(id) : null;
    if (ticket) return this.buildTicketResponse(ticket, true);
    const now = new Date().toISOString();
    return this.buildTicketResponse(
      {
        id,
        title: safeTitle,
        content: safeContent,
        status: "open",
        last_reply_at: null,
        created_at: now,
        updated_at: now
      },
      true
    );
  }

  async listUserTickets(userId: number, page = 1, pageSize = 10, status?: string) {
    const offset = (page - 1) * pageSize;
    const filters = ["user_id = ?"];
    const values: any[] = [userId];
    if (status && ["open", "answered", "closed"].includes(status)) {
      filters.push("status = ?");
      values.push(status);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.db.db
      .prepare(
        `
        SELECT * FROM tickets
        ${where}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();
    const total = await this.db.db
      .prepare(`SELECT COUNT(*) as total FROM tickets ${where}`)
      .bind(...values)
      .first<{ total?: number }>();
    const items = (rows.results || []).map((row) => this.buildTicketResponse(row));
    return {
      items,
      pagination: {
        page,
        pageSize,
        total: ensureNumber(total?.total)
      }
    };
  }

  async getTicketDetail(id: number) {
    return await this.db.db.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first();
  }

  async getTicketForUser(ticketId: number, userId: number) {
    const ticket = await this.db.db
      .prepare(
        `
        SELECT id, user_id, title, content, status, last_reply_at, created_at, updated_at
        FROM tickets
        WHERE id = ? AND user_id = ?
      `
      )
      .bind(ticketId, userId)
      .first();
    return ticket ? this.buildTicketResponse(ticket, true) : null;
  }

  async getAdminTicketDetail(ticketId: number) {
    const ticket = await this.db.db
      .prepare(
        `
        SELECT t.id,
               t.user_id,
               t.title,
               t.content,
               t.status,
               t.last_reply_at,
               t.created_at,
               t.updated_at,
               u.username AS user_name,
               u.email AS user_email
        FROM tickets t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.id = ?
      `
      )
      .bind(ticketId)
      .first();
    return ticket ? this.buildTicketResponse(ticket, true, true) : null;
  }

  async closeTicketByUser(ticketId: number, userId: number) {
    const ticket = await this.db.db
      .prepare("SELECT id, user_id, status FROM tickets WHERE id = ?")
      .bind(ticketId)
      .first<{ id: number; user_id: number; status: "open" | "answered" | "closed" } | null>();
    if (!ticket || Number(ticket.user_id) !== Number(userId)) {
      return { success: false, message: "工单不存在或无权操作" };
    }
    if (ticket.status === "closed") {
      return { success: true, status: "closed" };
    }
    await this.db.db
      .prepare(
        `
        UPDATE tickets 
        SET status = 'closed', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(ticketId)
      .run();
    return { success: true, status: "closed" };
  }

  async replyTicket(
    ticketId: number,
    authorId: number,
    role: "user" | "admin",
    content: string,
    statusOverride?: "open" | "answered" | "closed"
  ) {
    const safeContent = sanitizeText(content, MAX_CONTENT_LENGTH);
    if (!safeContent) throw new Error("回复内容不能为空");
    const nextStatus = statusOverride ?? (role === "admin" ? "answered" : "open");
    await this.db.db
      .prepare(
        `
        INSERT INTO ticket_replies (ticket_id, author_id, author_role, content, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
      )
      .bind(ticketId, authorId, role, safeContent)
      .run();

    await this.db.db
      .prepare(
        `
        UPDATE tickets 
        SET status = ?, last_reply_by_admin_id = ?, last_reply_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(nextStatus, role === "admin" ? authorId : null, ticketId)
      .run();
    const replies = await this.listReplies(ticketId);
    return { status: nextStatus, replies };
  }

  async listReplies(ticketId: number) {
    const replyResult = await this.db.db
      .prepare(
        `
          SELECT tr.id, tr.ticket_id, tr.author_id, tr.author_role, tr.content, tr.created_at,
                 u.username AS author_username, u.email AS author_email
          FROM ticket_replies tr
          LEFT JOIN users u ON tr.author_id = u.id
          WHERE tr.ticket_id = ?
          ORDER BY tr.created_at ASC
        `
      )
      .bind(ticketId)
      .all<{
        id: number;
        ticket_id: number;
        author_id: number;
        author_role: "user" | "admin";
        content: string;
        created_at: string;
        author_username?: string | null;
        author_email?: string | null;
      }>();

    const replies = replyResult.results ?? [];
    return replies.map((reply) => ({
      id: reply.id,
      content: String(reply.content ?? ""),
      created_at: reply.created_at,
      author: {
        id: reply.author_id,
        role: reply.author_role,
        username: reply.author_username,
        email: reply.author_email
      }
    }));
  }

  async listAdminTickets(page = 1, pageSize = 20, status?: string) {
    const offset = (page - 1) * pageSize;
    const filters: string[] = [];
    const values: any[] = [];
    if (status && ["open", "answered", "closed"].includes(status)) {
      filters.push("t.status = ?");
      values.push(status);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.db.db
      .prepare(
        `
        SELECT t.*, u.username AS user_name, u.email AS user_email
        FROM tickets t
        LEFT JOIN users u ON t.user_id = u.id
        ${where}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();
    const count = await this.db.db
      .prepare(`SELECT COUNT(*) as total FROM tickets t ${where}`)
      .bind(...values)
      .first<{ total?: number }>();
    const items = (rows.results || []).map((row) => this.buildTicketResponse(row, false, true));
    return {
      items,
      pagination: {
        page,
        pageSize,
        total: ensureNumber(count?.total)
      }
    };
  }

  async updateStatus(ticketId: number, status: "open" | "answered" | "closed") {
    await this.db.db
      .prepare(
        `
        UPDATE tickets 
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(status, ticketId)
      .run();
  }

  async countUserUnread(userId: number) {
    const row = await this.db.db
      .prepare(
        `
        SELECT COUNT(*) as total 
        FROM tickets 
        WHERE user_id = ? 
          AND status = 'answered'
          AND updated_at > COALESCE(
            (SELECT MAX(created_at) FROM ticket_replies WHERE ticket_id = tickets.id AND author_role = 'user'),
            '1970-01-01'
          )
      `
      )
      .bind(userId)
      .first<{ total?: number }>();
    return ensureNumber(row?.total, 0);
  }

  async countAdminPending() {
    const row = await this.db.db
      .prepare("SELECT COUNT(*) as total FROM tickets WHERE status = 'open'")
      .first<{ total?: number }>();
    return ensureNumber(row?.total, 0);
  }
}

function sanitizeText(input: unknown, maxLength: number) {
  if (!input || typeof input !== "string") return "";
  return input.trim().slice(0, maxLength);
}
