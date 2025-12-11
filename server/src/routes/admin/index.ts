import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { createAdminGiftCardRouter } from "./admin-giftcard";
import { createConfigRouter } from "./config";
import { createAdminNodeRouter } from "./admin-node";
import { createAdminTrafficRouter } from "./admin-traffic";
import { createAdminRebateRouter } from "./admin-rebate";
import { createAdminSharedIdRouter } from "./admin-sharedid";
import { createAdminExportRouter } from "./admin-export";

export function createAdminRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  const requireAdmin = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) {
      errorResponse(res, "需要管理员权限", 403);
      return null;
    }
    return user;
  };

  router.get("/system-stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const stats = await ctx.dbService.getSystemStats();
    return successResponse(res, stats);
  });

  router.get("/users", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 100);
    const result = await ctx.dbService.listUsers({ page, pageSize });
    return successResponse(res, result);
  });

  router.post("/users", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { email, username, password, class: level, expire_time, class_expire_time, transfer_enable } = req.body || {};
    if (!email || !username || !password) return errorResponse(res, "缺少必要参数", 400);
    const hash = require("../../utils/crypto").hashPassword(password);
    const uuid = require("../../utils/crypto").generateUUID();
    const passwd = require("../../utils/crypto").generateRandomString(12);
    const token = require("../../utils/crypto").generateRandomString(32);
    await ctx.dbService.createUser({
      email,
      username,
      password_hash: hash,
      uuid,
      passwd,
      token,
      invited_by: 0,
      invite_limit: 0
    });
    if (level || expire_time || class_expire_time || transfer_enable) {
      const fields: string[] = [];
      const values: any[] = [];
      if (level !== undefined) {
        fields.push("class = ?");
        values.push(Number(level));
      }
      if (expire_time) {
        fields.push("expire_time = ?");
        values.push(new Date(expire_time));
      }
      if (class_expire_time) {
        fields.push("class_expire_time = ?");
        values.push(new Date(class_expire_time));
      }
      if (transfer_enable) {
        fields.push("transfer_enable = ?");
        values.push(Number(transfer_enable));
      }
      if (fields.length) {
        const sql = `UPDATE users SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE email = ?`;
        values.push(email);
        await ctx.dbService.db.prepare(sql).bind(...values).run();
      }
    }
    return successResponse(res, null, "用户已创建");
  });

  router.put("/users/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "id 无效", 400);
    const { email, username, status, class: level, expire_time, class_expire_time, transfer_enable } = req.body || {};
    await ctx.dbService.updateUserProfile(id, { username, email });
    const fields: string[] = [];
    const values: any[] = [];
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(Number(status));
    }
    if (level !== undefined) {
      fields.push("class = ?");
      values.push(Number(level));
    }
    if (expire_time) {
      fields.push("expire_time = ?");
      values.push(new Date(expire_time));
    }
    if (class_expire_time) {
      fields.push("class_expire_time = ?");
      values.push(new Date(class_expire_time));
    }
    if (transfer_enable !== undefined) {
      fields.push("transfer_enable = ?");
      values.push(Number(transfer_enable));
    }
    if (fields.length) {
      values.push(id);
      await ctx.dbService.db
        .prepare(`UPDATE users SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values)
        .run();
    }
    return successResponse(res, null, "用户已更新");
  });

  router.delete("/users/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "id 无效", 400);
    await ctx.dbService.deleteUser(id);
    return successResponse(res, null, "用户已删除");
  });

  router.get("/user-stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const active = await ctx.dbService.db.prepare("SELECT COUNT(*) as total FROM users WHERE status = 1").first<{ total?: number }>();
    const expired = await ctx.dbService.db
      .prepare("SELECT COUNT(*) as total FROM users WHERE expire_time IS NOT NULL AND expire_time < CURRENT_TIMESTAMP")
      .first<{ total?: number }>();
    const soonExpire = await ctx.dbService.db
      .prepare("SELECT COUNT(*) as total FROM users WHERE expire_time BETWEEN CURRENT_TIMESTAMP AND DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
      .first<{ total?: number }>();
    return successResponse(res, {
      active_users: Number(active?.total ?? 0),
      expired_users: Number(expired?.total ?? 0),
      expire_in_7_days: Number(soonExpire?.total ?? 0)
    });
  });

  router.get("/level-stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT class, COUNT(*) as total
        FROM users
        GROUP BY class
        ORDER BY class ASC
      `
      )
      .all();
    const expiring = await ctx.dbService.db
      .prepare(
        `
        SELECT id, email, username, class, class_expire_time
        FROM users
        WHERE class_expire_time BETWEEN CURRENT_TIMESTAMP AND DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY)
        ORDER BY class_expire_time ASC
      `
      )
      .all();
    return successResponse(res, { levels: rows.results || [], expiring: expiring.results || [] });
  });

  router.post("/check-expired-levels", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const expired = await ctx.dbService.getExpiredLevelUsers();
    const ids = expired.map((u) => u.id);
    await ctx.dbService.resetExpiredUsersLevel(ids);
    return successResponse(res, { reset: ids.length });
  });

  router.post("/set-level-expiry", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { ids, class_expire_time } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return errorResponse(res, "缺少用户", 400);
    const time = class_expire_time ? new Date(class_expire_time) : null;
    if (!time) return errorResponse(res, "时间无效", 400);
    const placeholders = ids.map(() => "?").join(",");
    await ctx.dbService.db
      .prepare(`UPDATE users SET class_expire_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`)
      .bind(time, ...ids)
      .run();
    return successResponse(res, null, "已更新");
  });

  router.get("/login-logs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllLoginLogs(page, pageSize);
    return successResponse(res, data);
  });

  router.get("/subscription-logs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllSubscriptionLogs(page, pageSize);
    return successResponse(res, data);
  });

  router.post("/users/:id/status", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (![0, 1].includes(Number(status))) return errorResponse(res, "状态无效", 400);
    await ctx.dbService.updateUserStatus(id, Number(status));
    return successResponse(res, null, "状态已更新");
  });

  router.post("/cache/clear", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { prefix } = req.body || {};
    if (!prefix || typeof prefix !== "string") return errorResponse(res, "前缀必填", 400);
    await ctx.cache.deleteByPrefix(prefix);
    return successResponse(res, null, "缓存已清理");
  });

  // 子路由：礼品卡管理
  router.use("/gift-cards", createAdminGiftCardRouter(ctx));
  router.use("/config", createConfigRouter(ctx));
  router.use("/nodes", createAdminNodeRouter(ctx));
  router.use("/traffic", createAdminTrafficRouter(ctx));
  router.use("/rebate", createAdminRebateRouter(ctx));
  router.use("/shared-ids", createAdminSharedIdRouter(ctx));
  router.use("/export", createAdminExportRouter(ctx));

  router.get("/audit-logs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAuditLogs(page, pageSize);
    return successResponse(res, data);
  });

  return router;
}
