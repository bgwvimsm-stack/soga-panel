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
import { generateRandomString, generateUUID } from "../../utils/crypto";

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

  // 手动执行每日定时任务（重置今日流量）
  router.post("/trigger-traffic-reset", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.dbService.resetTodayBandwidth();
    return successResponse(res, { success: true, message: "已触发每日流量重置" }, "已触发每日流量重置");
  });

  // 重置所有用户 UUID 和节点密码
  router.post("/reset-all-passwords", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const users = await ctx.db.prepare("SELECT id FROM users WHERE status = 1").all<{ id: number }>();
    let count = 0;
    for (const row of users.results || []) {
      const uuid = generateUUID();
      const passwd = generateRandomString(16);
      await ctx.db
        .prepare(
          `
          UPDATE users 
          SET uuid = ?, passwd = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(uuid, passwd, row.id)
        .run();
      count += 1;
    }
    return successResponse(res, { count, message: `已重置 ${count} 个用户的 UUID/节点密码` }, "已重置所有用户 UUID/密码");
  });

  // 重置所有用户订阅令牌
  router.post("/reset-all-subscriptions", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const users = await ctx.db.prepare("SELECT id FROM users WHERE status = 1").all<{ id: number }>();
    let count = 0;
    for (const row of users.results || []) {
      const token = generateRandomString(32);
      await ctx.db
        .prepare("UPDATE users SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(token, row.id)
        .run();
      count += 1;
    }
    return successResponse(res, { count, message: `已重置 ${count} 个用户的订阅链接` }, "已重置所有用户订阅链接");
  });

  // 重置全部用户邀请码
  router.post("/invite-codes/reset", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const users = await ctx.db.prepare("SELECT id FROM users WHERE status = 1").all<{ id: number }>();
    let count = 0;
    for (const row of users.results || []) {
      await ctx.dbService.ensureUserInviteCode(row.id, () => generateRandomString(8));
      count += 1;
    }
    return successResponse(res, { count, message: `已重置 ${count} 个用户的邀请码` }, "已重置所有邀请码");
  });

  // 删除待支付记录（充值/购买）
  router.delete("/pending-records", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.db.prepare("DELETE FROM recharge_records WHERE status = 0").run();
    await ctx.db.prepare("DELETE FROM package_purchase_records WHERE status = 0").run();
    return successResponse(res, { message: "已清理待支付记录" }, "已清理待支付记录");
  });

  // 清理缓存占位实现
  router.post("/clear-cache/audit-rules", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.cache.deleteByPrefix("audit_rules");
    return successResponse(res, { message: "已清理审计规则缓存" }, "已清理审计规则缓存");
  });

  router.post("/clear-cache/whitelist", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.cache.deleteByPrefix("whitelist");
    return successResponse(res, { message: "已清理白名单缓存" }, "已清理白名单缓存");
  });

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
