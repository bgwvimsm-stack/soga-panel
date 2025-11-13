import type { Env } from "../types";
import { DatabaseService } from "../services/database";
import { validateUserAuth, validateAdminAuth } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";

type AuthSuccess = {
  success: true;
  user: { id: number; username?: string; email?: string; is_admin?: boolean };
};

type AuthFailure = { success: false; message: string };

type AuthResult = AuthSuccess | AuthFailure;

type TicketStatus = "open" | "answered" | "closed";

type TicketRow = {
  id: number;
  user_id: number;
  title: string;
  content: string;
  status: TicketStatus;
  last_reply_by_admin_id?: number | null;
  last_reply_at?: string | null;
  created_at: string;
  updated_at: string;
};

type TicketReplyRow = {
  id: number;
  ticket_id: number;
  author_id: number;
  author_role: "user" | "admin";
  content: string;
  created_at: string;
  author_username?: string | null;
  author_email?: string | null;
};

const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 8000;
const TICKET_STATUSES: TicketStatus[] = ["open", "answered", "closed"];

const isAuthFailure = (result: AuthResult): result is AuthFailure => result.success === false;

export class TicketAPI {
  private readonly db: DatabaseService;
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
  }

  private async requireUser(request: Request): Promise<AuthResult> {
    return (await validateUserAuth(request, this.env)) as AuthResult;
  }

  private async requireAdmin(request: Request): Promise<AuthResult> {
    return (await validateAdminAuth(request, this.env)) as AuthResult;
  }

  private parseStatus(input: unknown): TicketStatus | null {
    if (!input || typeof input !== "string") {
      return null;
    }
    const normalized = input.trim().toLowerCase();
    return TICKET_STATUSES.includes(normalized as TicketStatus)
      ? (normalized as TicketStatus)
      : null;
  }

  private getPagination(url: URL) {
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(
      50,
      Math.max(5, Number.parseInt(url.searchParams.get("pageSize") || "10", 10) || 10)
    );
    const offset = (page - 1) * pageSize;
    return { page, pageSize, offset };
  }

  private extractTicketId(request: Request): number | null {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/tickets\/(\d+)/);
    if (!match) {
      return null;
    }
    const ticketId = Number.parseInt(match[1], 10);
    return Number.isNaN(ticketId) ? null : ticketId;
  }

  private sanitizeText(input: unknown, maxLength: number) {
    if (!input || typeof input !== "string") {
      return "";
    }
    return input.trim().slice(0, maxLength);
  }

  private async getReplies(ticketId: number) {
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
      .all<TicketReplyRow>();

    const replies = replyResult.results ?? [];
    return replies.map((reply) => ({
      id: reply.id,
      content: reply.content,
      created_at: reply.created_at,
      author: {
        id: reply.author_id,
        role: reply.author_role,
        username: reply.author_username,
        email: reply.author_email,
      },
    }));
  }

  private buildTicketResponse(row: TicketRow, includeContent = false) {
    const base = {
      id: row.id,
      title: row.title,
      status: row.status,
      last_reply_at: row.last_reply_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    if (includeContent) {
      return { ...base, content: row.content };
    }
    return base;
  }

  async createTicket(request: Request) {
    try {
      const auth = await this.requireUser(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const title = this.sanitizeText(payload.title, MAX_TITLE_LENGTH);
      const content = this.sanitizeText(payload.content, MAX_CONTENT_LENGTH);

      if (!title) {
        return errorResponse("请填写工单标题", 400);
      }

      if (!content) {
        return errorResponse("请填写工单内容", 400);
      }

      const stmt = this.db.db.prepare(
        `
          INSERT INTO tickets (user_id, title, content, status, created_at, updated_at)
          VALUES (?, ?, ?, 'open', datetime('now', '+8 hours'), datetime('now', '+8 hours'))
        `
      );
      const result = await stmt.bind(auth.user.id, title, content).run();

      const ticket = await this.db.db
        .prepare(
          `
            SELECT id, user_id, title, content, status, last_reply_at, created_at, updated_at
            FROM tickets
            WHERE id = ?
          `
        )
        .bind(result.meta.last_row_id)
        .first<TicketRow | null>();

      const fallbackNow = new Date().toISOString();
      const responseTicket = ticket
        ? this.buildTicketResponse(ticket, true)
        : {
            id: Number(result.meta.last_row_id),
            title,
            content,
            status: "open" as TicketStatus,
            last_reply_at: null,
            created_at: fallbackNow,
            updated_at: fallbackNow,
          };

      return successResponse(responseTicket, "工单创建成功");
    } catch (error: unknown) {
      console.error("createTicket error", error);
      return errorResponse("创建工单失败", 500);
    }
  }

  async listUserTickets(request: Request) {
    try {
      const auth = await this.requireUser(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const url = new URL(request.url);
      const { page, pageSize, offset } = this.getPagination(url);
      const filters = ["user_id = ?"];
      const bindings: Array<string | number> = [auth.user.id];

      const statusParam = this.parseStatus(url.searchParams.get("status"));
      if (statusParam) {
        filters.push("status = ?");
        bindings.push(statusParam);
      }

      const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(1) AS total FROM tickets ${whereClause}`)
        .bind(...bindings)
        .first<{ total: number } | null>();

      const listResult = await this.db.db
        .prepare(
          `
            SELECT id, user_id, title, content, status, last_reply_at, created_at, updated_at
            FROM tickets
            ${whereClause}
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
          `
        )
        .bind(...bindings, pageSize, offset)
        .all<TicketRow>();

      const items = (listResult.results ?? []).map((row) => this.buildTicketResponse(row));

      return successResponse({
        items,
        pagination: {
          page,
          pageSize,
          total: totalRow?.total ?? 0,
        },
      });
    } catch (error: unknown) {
      console.error("listUserTickets error", error);
      return errorResponse("获取工单列表失败", 500);
    }
  }

  async getUserTicketDetail(request: Request) {
    try {
      const auth = await this.requireUser(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const ticketId = this.extractTicketId(request);
      if (!ticketId) {
        return errorResponse("无效的工单ID", 400);
      }

      const ticket = await this.db.db
        .prepare(
          `
            SELECT id, user_id, title, content, status, last_reply_at, created_at, updated_at
            FROM tickets
            WHERE id = ? AND user_id = ?
          `
        )
        .bind(ticketId, auth.user.id)
        .first<TicketRow | null>();

      if (!ticket) {
        return errorResponse("工单不存在或已删除", 404);
      }

      const replies = await this.getReplies(ticketId);
      return successResponse({
        ticket: this.buildTicketResponse(ticket, true),
        replies,
      });
    } catch (error: unknown) {
      console.error("getUserTicketDetail error", error);
      return errorResponse("获取工单详情失败", 500);
    }
  }

  async listAdminTickets(request: Request) {
    try {
      const auth = await this.requireAdmin(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const url = new URL(request.url);
      const { page, pageSize, offset } = this.getPagination(url);
      const filters: string[] = [];
      const bindings: Array<string | number> = [];

      const statusParam = this.parseStatus(url.searchParams.get("status"));
      if (statusParam) {
        filters.push("t.status = ?");
        bindings.push(statusParam);
      }

      const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(1) AS total FROM tickets t ${whereClause}`)
        .bind(...bindings)
        .first<{ total: number } | null>();

      const listResult = await this.db.db
        .prepare(
          `
            SELECT t.id, t.user_id, t.title, t.content, t.status, t.last_reply_at,
                   t.created_at, t.updated_at, u.username, u.email
            FROM tickets t
            LEFT JOIN users u ON t.user_id = u.id
            ${whereClause}
            ORDER BY t.updated_at DESC
            LIMIT ? OFFSET ?
          `
        )
        .bind(...bindings, pageSize, offset)
        .all<TicketRow & { username?: string | null; email?: string | null }>();

      const items =
        listResult.results?.map((row) => ({
          ...this.buildTicketResponse(row),
          user: {
            id: row.user_id,
            username: row.username,
            email: row.email,
          },
        })) ?? [];

      return successResponse({
        items,
        pagination: {
          page,
          pageSize,
          total: totalRow?.total ?? 0,
        },
      });
    } catch (error: unknown) {
      console.error("listAdminTickets error", error);
      return errorResponse("获取工单列表失败", 500);
    }
  }

  async getAdminTicketDetail(request: Request) {
    try {
      const auth = await this.requireAdmin(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const ticketId = this.extractTicketId(request);
      if (!ticketId) {
        return errorResponse("无效的工单ID", 400);
      }

      const ticket = await this.db.db
        .prepare(
          `
            SELECT t.id, t.user_id, t.title, t.content, t.status, t.last_reply_at,
                   t.created_at, t.updated_at, u.username, u.email
            FROM tickets t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = ?
          `
        )
        .bind(ticketId)
        .first<(TicketRow & { username?: string | null; email?: string | null }) | null>();

      if (!ticket) {
        return errorResponse("工单不存在或已删除", 404);
      }

      const replies = await this.getReplies(ticketId);
      return successResponse({
        ticket: {
          ...this.buildTicketResponse(ticket, true),
          user: {
            id: ticket.user_id,
            username: ticket.username,
            email: ticket.email,
          },
        },
        replies,
      });
    } catch (error: unknown) {
      console.error("getAdminTicketDetail error", error);
      return errorResponse("获取工单详情失败", 500);
    }
  }

  async replyTicketAsAdmin(request: Request) {
    try {
      const auth = await this.requireAdmin(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const ticketId = this.extractTicketId(request);
      if (!ticketId) {
        return errorResponse("无效的工单ID", 400);
      }

      const ticket = await this.db.db
        .prepare("SELECT id FROM tickets WHERE id = ?")
        .bind(ticketId)
        .first<{ id: number } | null>();

      if (!ticket) {
        return errorResponse("工单不存在或已删除", 404);
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const content = this.sanitizeText(payload.content, MAX_CONTENT_LENGTH);
      if (!content) {
        return errorResponse("请填写回复内容", 400);
      }

      const nextStatus = this.parseStatus(payload.status) ?? "answered";

      await this.db.db
        .prepare(
          `
            INSERT INTO ticket_replies (ticket_id, author_id, author_role, content, created_at)
            VALUES (?, ?, 'admin', ?, datetime('now', '+8 hours'))
          `
        )
        .bind(ticketId, auth.user.id, content)
        .run();

      await this.db.db
        .prepare(
          `
            UPDATE tickets
            SET status = ?, last_reply_by_admin_id = ?, last_reply_at = datetime('now', '+8 hours'),
                updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `
        )
        .bind(nextStatus, auth.user.id, ticketId)
        .run();

      const replies = await this.getReplies(ticketId);
      return successResponse(
        {
          replies,
          status: nextStatus,
        },
        "回复已发送"
      );
    } catch (error: unknown) {
      console.error("replyTicket error", error);
      return errorResponse("回复工单失败", 500);
    }
  }

  async replyTicketAsUser(request: Request) {
    try {
      const auth = await this.requireUser(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const ticketId = this.extractTicketId(request);
      if (!ticketId) {
        return errorResponse("无效的工单ID", 400);
      }

      const ticket = await this.db.db
        .prepare("SELECT id, user_id, status FROM tickets WHERE id = ?")
        .bind(ticketId)
        .first<{ id: number; user_id: number; status: TicketStatus } | null>();

      if (!ticket || ticket.user_id !== auth.user.id) {
        return errorResponse("工单不存在或无权访问", 404);
      }

      if (ticket.status === "closed") {
        return errorResponse("工单已关闭，无法继续回复", 400);
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const content = this.sanitizeText(payload.content, MAX_CONTENT_LENGTH);
      if (!content) {
        return errorResponse("请填写回复内容", 400);
      }

      await this.db.db
        .prepare(
          `
            INSERT INTO ticket_replies (ticket_id, author_id, author_role, content, created_at)
            VALUES (?, ?, 'user', ?, datetime('now', '+8 hours'))
          `
        )
        .bind(ticketId, auth.user.id, content)
        .run();

      await this.db.db
        .prepare(
          `
            UPDATE tickets
            SET status = 'open',
                updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `
        )
        .bind(ticketId)
        .run();

      const replies = await this.getReplies(ticketId);
      return successResponse({ replies, status: "open" as TicketStatus }, "回复已发送");
    } catch (error: unknown) {
      console.error("replyTicketAsUser error", error);
      return errorResponse("回复工单失败", 500);
    }
  }

  async updateTicketStatus(request: Request) {
    try {
      const auth = await this.requireAdmin(request);
      if (isAuthFailure(auth)) {
        return errorResponse(auth.message, 401);
      }

      const ticketId = this.extractTicketId(request);
      if (!ticketId) {
        return errorResponse("无效的工单ID", 400);
      }

      const ticket = await this.db.db
        .prepare("SELECT id FROM tickets WHERE id = ?")
        .bind(ticketId)
        .first<{ id: number } | null>();

      if (!ticket) {
        return errorResponse("工单不存在或已删除", 404);
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const status = this.parseStatus(payload.status);
      if (!status) {
        return errorResponse("状态不合法", 400);
      }

      await this.db.db
        .prepare(
          `
            UPDATE tickets
            SET status = ?, updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `
        )
        .bind(status, ticketId)
        .run();

      return successResponse({ status }, "工单状态已更新");
    } catch (error: unknown) {
      console.error("updateTicketStatus error", error);
      return errorResponse("更新工单状态失败", 500);
    }
  }
}
