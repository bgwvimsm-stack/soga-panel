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
import { generateBase64Random, generateRandomString, generateUUID } from "../../utils/crypto";
import { getSchedulerStatus } from "../../scheduler";
import { ensureNumber, ensureString, getChanges, toRunResult } from "../../utils/d1";
import { fixMoneyPrecision } from "../../utils/money";

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

  const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/\"/g, '\"\"')}"`;

  const sendCsv = (res: Response, filename: string, csv: string) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.status(200).send(csv);
  };

  const parseIdsFromQuery = (value: unknown): number[] => {
    if (Array.isArray(value)) {
      return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    }
    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return [];
      return raw
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isFinite(n));
    }
    return [];
  };

  const listRedisKeys = async (maxKeys = 2000): Promise<string[]> => {
    if (!ctx.redis || ctx.redis.status !== "ready") return [];
    const keys: string[] = [];
    let cursor = "0";
    try {
      do {
        const [next, batch] = await ctx.redis.scan(cursor, "MATCH", "*", "COUNT", 200);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0" && keys.length < maxKeys);
    } catch {
      return [];
    }
    return keys.slice(0, maxKeys);
  };

  // 调度器状态
  router.get("/scheduler-status", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const status = getSchedulerStatus();
    return successResponse(res, status);
  });

  // 手动执行每日定时任务（重置今日流量）
  router.post("/trigger-traffic-reset", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.dbService.resetTodayBandwidth();
    return successResponse(res, { success: true, message: "已触发每日流量重置" }, "已触发每日流量重置");
  });

  // 兼容 Worker：POST /api/admin/reset-daily-traffic
  router.post("/reset-daily-traffic", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.dbService.resetTodayBandwidth();
    const row = await ctx.db.db
      .prepare("SELECT COUNT(*) as total FROM users WHERE status = 1")
      .first<{ total?: number | string | null }>();
    const count = ensureNumber(row?.total ?? 0);
    return successResponse(res, { message: "已重置所有用户今日流量", count }, "已重置所有用户今日流量");
  });

  // 手动触发节点状态与在线 IP 清理（与定时任务逻辑一致）
  router.post("/trigger-node-status-cleanup", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ctx.db
        .prepare("DELETE FROM node_status WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
        .run();
      await ctx.db
        .prepare("DELETE FROM online_ips WHERE last_seen < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
        .run();
      return successResponse(res, null, "节点状态和在线 IP 已清理");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  // 手动触发节点流量重置（根据 bandwidthlimit_resetday）
  router.post("/trigger-node-traffic-reset", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const currentDay = now.getDate();
      const nodesResult = await ctx.db.db
        .prepare(
          `
          SELECT id, name
          FROM nodes
          WHERE bandwidthlimit_resetday = ? AND status = 1
        `
        )
        .bind(currentDay)
        .all<{ id: number; name: string }>();
      const nodes = nodesResult.results || [];
      if (!nodes.length) {
        return successResponse(
          res,
          { reset_count: 0, current_day: currentDay },
          "没有节点需要重置流量"
        );
      }
      const ids = nodes.map((n) => n.id);
      const placeholders = ids.map(() => "?").join(",");
      await ctx.db.db
        .prepare(
          `
          UPDATE nodes
          SET node_bandwidth = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${placeholders})
        `
        )
        .bind(...ids)
        .run();

      return successResponse(
        res,
        {
          reset_count: ids.length,
          processed_ids: ids,
          current_day: currentDay
        },
        `已重置 ${ids.length} 个节点流量`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  // 重置所有用户 UUID 和节点密码
  router.post("/reset-all-passwords", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const users = await ctx.db.prepare("SELECT id FROM users WHERE status = 1").all<{ id: number }>();
    let count = 0;
    for (const row of users.results || []) {
      const uuid = generateUUID();
      const passwd = generateBase64Random(32);
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

  // 兼容 Worker：POST /api/admin/generate-traffic-test-data
  router.post("/generate-traffic-test-data", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const userId = Number(req.body?.user_id ?? 1);
    const daysRaw = Number(req.body?.days ?? 30);
    const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 30, 1), 365);
    if (!Number.isFinite(userId) || userId <= 0) return errorResponse(res, "user_id 无效", 400);

    const nodesResult = await ctx.db.db.prepare("SELECT id FROM nodes ORDER BY id ASC LIMIT 10").all<{ id: number }>();
    const nodeIds = (nodesResult.results || []).map((n) => Number(n.id)).filter((n) => Number.isFinite(n) && n > 0);
    if (!nodeIds.length) return errorResponse(res, "请先创建至少一个节点", 400);

    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const startDate = start.toISOString().slice(0, 10);

    await ctx.db.db
      .prepare("DELETE FROM traffic_logs WHERE user_id = ? AND date >= ?")
      .bind(userId, startDate)
      .run();
    await ctx.db.db
      .prepare("DELETE FROM daily_traffic WHERE user_id = ? AND record_date >= ?")
      .bind(userId, startDate)
      .run();

    for (let i = 0; i < days; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateString = date.toISOString().slice(0, 10);

      const nodesForDay = Math.min(3, Math.floor(Math.random() * 3) + 1);
      let dailyUpload = 0;
      let dailyDownload = 0;
      const nodeUsage: Array<{ node_id: number; upload: number; download: number; total: number }> = [];

      for (let idx = 0; idx < nodesForDay; idx += 1) {
        const nodeId = nodeIds[(idx + i) % nodeIds.length];
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const baseMultiplier = isWeekend ? 0.7 : 1.0;
        const upload = Math.floor((50 + Math.random() * 450) * 1024 * 1024 * baseMultiplier);
        const download = Math.floor((200 + Math.random() * 1800) * 1024 * 1024 * baseMultiplier);
        dailyUpload += upload;
        dailyDownload += download;
        nodeUsage.push({ node_id: nodeId, upload, download, total: upload + download });

        await ctx.db.db
          .prepare(
            `
            INSERT INTO traffic_logs (
              user_id, node_id, upload_traffic, download_traffic,
              actual_upload_traffic, actual_download_traffic, actual_traffic,
              deduction_multiplier, date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `
          )
          .bind(userId, nodeId, upload, download, upload, download, upload + download, 1, dateString)
          .run();
      }

      await ctx.db.db
        .prepare(
          `
          INSERT INTO daily_traffic (user_id, record_date, upload_traffic, download_traffic, total_traffic, node_usage, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `
        )
        .bind(userId, dateString, dailyUpload, dailyDownload, dailyUpload + dailyDownload, JSON.stringify({ nodes: nodeUsage }))
        .run();
    }

    const totalStats = await ctx.db.db
      .prepare(
        `
        SELECT 
          COALESCE(SUM(upload_traffic), 0) as total_upload,
          COALESCE(SUM(download_traffic), 0) as total_download
        FROM daily_traffic
        WHERE user_id = ? AND record_date >= ?
      `
      )
      .bind(userId, startDate)
      .first<{ total_upload?: number | string; total_download?: number | string }>();

    const totalUpload = ensureNumber(totalStats?.total_upload ?? 0);
    const totalDownload = ensureNumber(totalStats?.total_download ?? 0);
    const totalTraffic = totalUpload + totalDownload;

    const today = new Date().toISOString().slice(0, 10);
    const todayStats = await ctx.db.db
      .prepare(
        `
        SELECT upload_traffic, download_traffic
        FROM daily_traffic
        WHERE user_id = ? AND record_date = ?
      `
      )
      .bind(userId, today)
      .first<{ upload_traffic?: number | string; download_traffic?: number | string }>();
    const uploadToday = ensureNumber(todayStats?.upload_traffic ?? 0);
    const downloadToday = ensureNumber(todayStats?.download_traffic ?? 0);

    await ctx.db.db
      .prepare(
        `
        UPDATE users
        SET upload_traffic = ?, download_traffic = ?, transfer_total = ?, upload_today = ?, download_today = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(totalUpload, totalDownload, totalTraffic, uploadToday, downloadToday, userId)
      .run();

    return successResponse(
      res,
      {
        message: "测试流量数据生成完成",
        user_id: userId,
        days,
        total_upload: totalUpload,
        total_download: totalDownload,
        total_traffic: totalTraffic
      },
      "测试流量数据生成完成"
    );
  });

  // 清理缓存占位实现
  router.post("/clear-cache/audit-rules", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.cache.deleteByPrefix("audit_rules");
    return successResponse(res, { message: "审计规则缓存已清除", cleared_at: new Date().toISOString() }, "审计规则缓存已清除");
  });

  router.post("/clear-cache/whitelist", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.cache.deleteByPrefix("white_list");
    await ctx.cache.deleteByPrefix("whitelist");
    return successResponse(res, { message: "白名单缓存已清除", cleared_at: new Date().toISOString() }, "白名单缓存已清除");
  });

  // 兼容 Worker：GET /api/admin/cache-status
  router.get("/cache-status", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const cacheKeys = await listRedisKeys();
    const categories = {
      node_config: cacheKeys.filter((k) => k.startsWith("node_config_")).length,
      node_users: cacheKeys.filter((k) => k.startsWith("node_users_") || k.startsWith("node_users")).length,
      audit_rules: cacheKeys.filter((k) => k === "audit_rules" || k.startsWith("audit_rules")).length,
      white_list: cacheKeys.filter((k) => k === "white_list" || k.startsWith("white_list") || k.startsWith("whitelist")).length,
      others: cacheKeys.filter(
        (k) =>
          !k.startsWith("node_config_") &&
          !k.startsWith("node_users_") &&
          !k.startsWith("node_users") &&
          !(k === "audit_rules" || k.startsWith("audit_rules")) &&
          !(k === "white_list" || k.startsWith("white_list") || k.startsWith("whitelist"))
      ).length
    };
    return successResponse(res, {
      cache_status: {
        total_keys: cacheKeys.length,
        categories,
        cache_keys: cacheKeys
      },
      timestamp: new Date().toISOString()
    });
  });

  // 兼容 Worker：POST /api/admin/clear-cache/all
  router.post("/clear-cache/all", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.cache.deleteByPrefix("node_config_");
    await ctx.cache.deleteByPrefix("node_users_");
    await ctx.cache.deleteByPrefix("audit_rules");
    await ctx.cache.deleteByPrefix("white_list");
    await ctx.cache.deleteByPrefix("whitelist");
    await ctx.cache.deleteByPrefix("system_config");
    await ctx.cache.deleteByPrefix("site_config");
    await ctx.db.db.prepare("UPDATE nodes SET updated_at = CURRENT_TIMESTAMP WHERE status = 1").run();
    return successResponse(res, {
      message: "所有缓存已清除",
      cleared_at: new Date().toISOString(),
      cleared_types: ["节点相关", "审计规则", "白名单", "系统配置"]
    });
  });

  // 兼容 Worker：POST /api/admin/clear-cache/nodes
  router.post("/clear-cache/nodes", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    await ctx.cache.deleteByPrefix("node_config_");
    await ctx.cache.deleteByPrefix("node_users_");
    await ctx.db.db.prepare("UPDATE nodes SET updated_at = CURRENT_TIMESTAMP WHERE status = 1").run();
    return successResponse(res, {
      message: "节点相关缓存已清除",
      cleared_at: new Date().toISOString(),
      cleared_types: ["节点配置", "节点用户"]
    });
  });

  // 兼容 Worker：GET /api/admin/node-stats
  router.get("/node-stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const stats = await ctx.db.db
      .prepare(
        `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 1 THEN 1 END) as online,
          COUNT(CASE WHEN status = 0 THEN 1 END) as offline,
          COUNT(CASE WHEN status = 1 AND (node_bandwidth_limit = 0 OR node_bandwidth < node_bandwidth_limit) THEN 1 END) as available,
          COALESCE(SUM(node_bandwidth_limit), 0) as totalBandwidth,
          COALESCE(SUM(node_bandwidth), 0) as usedBandwidth
        FROM nodes
      `
      )
      .first();
    return successResponse(res, stats ?? {});
  });

  // 兼容 Worker：GET /api/admin/system-health
  router.get("/system-health", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    let dbOk = true;
    try {
      await ctx.db.db.prepare("SELECT 1").first();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());
    return successResponse(res, {
      status: dbOk ? "healthy" : "error",
      timestamp: new Date().toISOString(),
      database: { connected: dbOk },
      memory_usage: mem.rss,
      cpu_usage: 0,
      uptime: `${uptimeSeconds}s`,
      last_restart: null
    });
  });

  // 兼容 Worker：GET /api/admin/statistics
  router.get("/statistics", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const stats = await ctx.db.db
      .prepare(
        `
        SELECT 
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE status = 1) as active_users,
          (SELECT COUNT(*) FROM users WHERE is_admin = 1) as admin_users,
          (SELECT COUNT(*) FROM nodes) as total_nodes,
          (SELECT COUNT(*) FROM nodes WHERE status = 1) as active_nodes,
          (SELECT COALESCE(SUM(transfer_total), 0) FROM users) as total_traffic,
          (SELECT COUNT(*) FROM users WHERE expire_time IS NOT NULL AND expire_time < CURRENT_TIMESTAMP) as expired_users,
          (SELECT COUNT(*) FROM users WHERE transfer_total >= transfer_enable) as exhausted_users,
          (SELECT COUNT(*) FROM users WHERE class_expire_time IS NOT NULL AND class_expire_time < CURRENT_TIMESTAMP AND class > 0) as expired_level_users
      `
      )
      .first();
    return successResponse(res, stats ?? {});
  });

  // 兼容 Worker：GET /api/admin/statistics/export
  router.get("/statistics/export", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const [systemStats, nodeStats] = await Promise.all([
      ctx.db.db
        .prepare(
          `
          SELECT 
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(*) FROM users WHERE status = 1) as active_users,
            (SELECT COUNT(*) FROM users WHERE is_admin = 1) as admin_users,
            (SELECT COUNT(*) FROM nodes) as total_nodes,
            (SELECT COUNT(*) FROM nodes WHERE status = 1) as active_nodes,
            (SELECT COALESCE(SUM(transfer_total), 0) FROM users) as total_traffic,
            (SELECT COUNT(*) FROM users WHERE expire_time IS NOT NULL AND expire_time < CURRENT_TIMESTAMP) as expired_users,
            (SELECT COUNT(*) FROM users WHERE transfer_total >= transfer_enable) as exhausted_users,
            (SELECT COUNT(*) FROM users WHERE class_expire_time IS NOT NULL AND class_expire_time < CURRENT_TIMESTAMP AND class > 0) as expired_level_users
        `
        )
        .first(),
      ctx.db.db
        .prepare(
          `
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 1 THEN 1 END) as online,
            COUNT(CASE WHEN status = 0 THEN 1 END) as offline,
            COUNT(CASE WHEN status = 1 AND (node_bandwidth_limit = 0 OR node_bandwidth < node_bandwidth_limit) THEN 1 END) as available,
            COALESCE(SUM(node_bandwidth_limit), 0) as totalBandwidth,
            COALESCE(SUM(node_bandwidth), 0) as usedBandwidth
          FROM nodes
        `
        )
        .first()
    ]);

    const report = {
      generated_at: new Date().toISOString(),
      system_stats: systemStats ?? {},
      node_stats: nodeStats ?? {},
      export_info: {
        version: ctx.env.SITE_NAME || "soga-panel-server",
        format: "json"
      }
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=system-stats-${new Date().toISOString().slice(0, 10)}.json`
    );
    res.status(200).send(JSON.stringify(report, null, 2));
  });

  // 兼容 Worker：GET /api/admin/expired-users
  router.get("/expired-users", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    const offset = (page - 1) * limit;

    const totalRow = await ctx.db.db
      .prepare(
        `
        SELECT COUNT(*) as total
        FROM users
        WHERE class_expire_time IS NOT NULL
          AND class_expire_time < CURRENT_TIMESTAMP
          AND class > 0
          AND status = 1
      `
      )
      .first<{ total?: number | string | null }>();
    const total = ensureNumber(totalRow?.total ?? 0);

    const usersResult = await ctx.db.db
      .prepare(
        `
        SELECT 
          id, email, username, class, class_expire_time,
          upload_traffic, download_traffic, (upload_today + download_today) as transfer_today,
          transfer_total, transfer_enable, reg_date, last_login_time,
          TIMESTAMPDIFF(DAY, class_expire_time, CURRENT_TIMESTAMP) as days_expired
        FROM users
        WHERE class_expire_time IS NOT NULL
          AND class_expire_time < CURRENT_TIMESTAMP
          AND class > 0
          AND status = 1
        ORDER BY class_expire_time DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(limit, offset)
      .all();

    return successResponse(res, {
      expired_users: usersResult.results || [],
      pagination: {
        total,
        page,
        limit,
        pages: total > 0 ? Math.ceil(total / Math.max(limit, 1)) : 0
      }
    });
  });

  router.get("/system-stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const stats = await ctx.dbService.getSystemStats();
    return successResponse(res, stats);
  });

  router.get("/users", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 100);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const classParam = typeof req.query.class === "string" ? req.query.class.trim() : req.query.class;
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : req.query.status;

    const classFilter =
      classParam === undefined || classParam === null || classParam === ""
        ? undefined
        : Number(classParam);
    const statusFilter =
      statusParam === undefined || statusParam === null || statusParam === ""
        ? undefined
        : Number(statusParam);

    const result = await ctx.dbService.listUsers({
      page,
      pageSize,
      search: search || undefined,
      class: Number.isFinite(classFilter as number) ? (classFilter as number) : undefined,
      status: Number.isFinite(statusFilter as number) ? (statusFilter as number) : undefined
    });

    const total = result.total ?? 0;
    return successResponse(res, {
      users: result.data ?? [],
      total,
      pagination: {
        total,
        page,
        limit: pageSize,
        pages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  // 兼容 Worker：POST /api/admin/users/:id/traffic
  router.post("/users/:id/traffic", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    await ctx.db.db
      .prepare(
        `
        UPDATE users 
        SET upload_traffic = 0, download_traffic = 0, upload_today = 0, download_today = 0, transfer_total = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(id)
      .run();
    await ctx.db.db.prepare("DELETE FROM traffic_logs WHERE user_id = ?").bind(id).run();
    await ctx.db.db.prepare("DELETE FROM daily_traffic WHERE user_id = ?").bind(id).run();
    await ctx.cache.deleteByPrefix(`user_${id}`);

    return successResponse(res, { message: "User traffic reset successfully" });
  });

  // 兼容 Worker：GET /api/admin/users/export
  router.get("/users/export", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ids = parseIdsFromQuery(req.query.ids);
    const where = ids.length > 0 ? `WHERE id IN (${ids.map(() => "?").join(",")})` : "";
    const usersResult = await ctx.db.db
      .prepare(
        `
        SELECT email, username, class, status,
               upload_traffic, download_traffic, (upload_today + download_today) as transfer_today, transfer_total, transfer_enable,
               reg_date, last_login_time, expire_time, class_expire_time
        FROM users
        ${where}
        ORDER BY id DESC
      `
      )
      .bind(...ids)
      .all();

    const headers = [
      "Email",
      "Username",
      "Class",
      "Status",
      "Upload Traffic",
      "Download Traffic",
      "Today Traffic",
      "Total Traffic",
      "Transfer Limit",
      "Register Date",
      "Last Login",
      "Expire Time",
      "Class Expire Time"
    ];

    let csv = `${headers.join(",")}\n`;
    for (const user of usersResult.results || []) {
      const row = [
        ensureString((user as any).email),
        ensureString((user as any).username),
        ensureNumber((user as any).class),
        ensureNumber((user as any).status) === 1 ? "Active" : "Inactive",
        ensureNumber((user as any).upload_traffic),
        ensureNumber((user as any).download_traffic),
        ensureNumber((user as any).transfer_today),
        ensureNumber((user as any).transfer_total),
        ensureNumber((user as any).transfer_enable),
        ensureString((user as any).reg_date),
        ensureString((user as any).last_login_time),
        ensureString((user as any).expire_time),
        ensureString((user as any).class_expire_time)
      ];
      csv += `${row.map(escapeCsv).join(",")}\n`;
    }

    sendCsv(res, `users-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  });

  router.post("/users", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { email, username, password, class: level, expire_time, class_expire_time, transfer_enable } = req.body || {};
    if (!email || !username || !password) return errorResponse(res, "缺少必要参数", 400);
    const hash = require("../../utils/crypto").hashPassword(password);
    const uuid = require("../../utils/crypto").generateUUID();
    const passwd = require("../../utils/crypto").generateBase64Random(32);
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

  // 管理员：充值记录列表
  router.get("/recharge-records", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const userIdParam = typeof req.query.user_id === "string" ? req.query.user_id.trim() : "";

    const conditions: string[] = [];
    const values: any[] = [];
    if (statusParam !== "") {
      conditions.push("rr.status = ?");
      values.push(Number(statusParam));
    }
    if (userIdParam) {
      conditions.push("rr.user_id = ?");
      values.push(Number(userIdParam));
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;

    const totalRow = await ctx.dbService.db
      .prepare(
        `
        SELECT COUNT(*) as total
        FROM recharge_records rr
        ${where}
      `
      )
      .bind(...values)
      .first<{ total?: number | string | null } | null>();
    const total = ensureNumber(totalRow?.total, 0);

    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT
          rr.id,
          rr.user_id,
          rr.amount,
          rr.payment_method,
          rr.trade_no,
          rr.status,
          rr.created_at,
          rr.paid_at,
          u.email,
          u.username,
          gcr.code AS gift_card_code
        FROM recharge_records rr
        LEFT JOIN users u ON rr.user_id = u.id
        LEFT JOIN gift_card_redemptions gcr ON gcr.recharge_record_id = rr.id
        ${where}
        ORDER BY rr.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();

    const statusMap: Record<number, string> = {
      0: "待支付",
      1: "已支付",
      2: "已取消",
      3: "支付失败"
    };

    const records =
      (rows.results || []).map((row: any) => {
        const status = ensureNumber(row.status, 0);
        const amountRaw =
          typeof row.amount === "string" ? Number(row.amount) : ensureNumber(row.amount, 0);
        let tradeNo = ensureString(row.trade_no, "");
        const paymentMethod = ensureString(row.payment_method, "");
        if (paymentMethod === "gift_card") {
          const giftCardCode = row.gift_card_code ? ensureString(row.gift_card_code, "") : "";
          if (giftCardCode) {
            tradeNo = giftCardCode;
          } else if (tradeNo.includes("-")) {
            tradeNo = tradeNo.split("-")[0] || tradeNo;
          }
        }
        return {
          id: ensureNumber(row.id, 0),
          user_id: ensureNumber(row.user_id, 0),
          email: ensureString(row.email ?? "", ""),
          username: ensureString(row.username ?? "", ""),
          amount: fixMoneyPrecision(amountRaw),
          payment_method: paymentMethod,
          trade_no: tradeNo,
          status,
          status_text: statusMap[status] ?? "未知状态",
          created_at: row.created_at,
          paid_at: row.paid_at
        };
      }) || [];

    return successResponse(res, {
      records,
      pagination: {
        total,
        page,
        limit: pageSize,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  // 管理员：套餐购买记录列表
  router.get("/purchase-records", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const userIdParam = typeof req.query.user_id === "string" ? req.query.user_id.trim() : "";
    const packageIdParam =
      typeof req.query.package_id === "string" ? req.query.package_id.trim() : "";

    const conditions: string[] = [];
    const values: any[] = [];
    if (statusParam !== "") {
      conditions.push("ppr.status = ?");
      values.push(Number(statusParam));
    }
    if (userIdParam) {
      conditions.push("ppr.user_id = ?");
      values.push(Number(userIdParam));
    }
    if (packageIdParam) {
      conditions.push("ppr.package_id = ?");
      values.push(Number(packageIdParam));
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;

    const totalRow = await ctx.dbService.db
      .prepare(
        `
        SELECT COUNT(*) as total
        FROM package_purchase_records ppr
        ${where}
      `
      )
      .bind(...values)
      .first<{ total?: number | string | null } | null>();
    const total = ensureNumber(totalRow?.total, 0);

    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT
          ppr.id,
          ppr.user_id,
          ppr.package_id,
          ppr.price,
          ppr.package_price,
          ppr.discount_amount,
          ppr.coupon_code,
          ppr.purchase_type,
          ppr.trade_no,
          ppr.status,
          ppr.created_at,
          ppr.paid_at,
          ppr.expires_at,
          u.email,
          u.username,
          p.name AS package_name,
          p.traffic_quota,
          p.validity_days,
          gcr.code AS gift_card_code
        FROM package_purchase_records ppr
        LEFT JOIN users u ON ppr.user_id = u.id
        LEFT JOIN packages p ON ppr.package_id = p.id
        LEFT JOIN gift_card_redemptions gcr ON gcr.purchase_record_id = ppr.id
        ${where}
        ORDER BY ppr.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();

    const statusMap: Record<number, string> = {
      0: "待支付",
      1: "已支付",
      2: "已取消",
      3: "支付失败"
    };

    const normalizePurchaseTypeText = (type: unknown) => {
      if (!type) return "未知";
      const normalized = String(type).toLowerCase();
      if (normalized === "balance") return "余额支付";
      if (normalized === "smart_topup" || normalized.startsWith("balance_")) return "混合支付";
      if (normalized === "alipay" || normalized.endsWith("alipay")) return "支付宝";
      if (normalized === "wechat" || normalized === "wxpay" || normalized.endsWith("wxpay")) return "微信";
      if (normalized === "qqpay" || normalized.endsWith("qqpay")) return "QQ支付";
      if (normalized === "gift_card") return "礼品卡";
      if (normalized === "direct") return "在线支付";
      return String(type);
    };

    const records =
      (rows.results || []).map((row: any) => {
        const status = ensureNumber(row.status, 0);
        const priceRaw =
          typeof row.price === "string" ? Number(row.price) : ensureNumber(row.price, 0);
        const packagePriceRaw = row.package_price;
        const packagePrice =
          packagePriceRaw !== undefined && packagePriceRaw !== null
            ? typeof packagePriceRaw === "string"
              ? Number(packagePriceRaw)
              : ensureNumber(packagePriceRaw, 0)
            : null;
        const discountAmount =
          row.discount_amount !== undefined && row.discount_amount !== null
            ? ensureNumber(row.discount_amount, 0)
            : 0;
        const finalPrice =
          packagePrice !== null
            ? fixMoneyPrecision(Math.max(packagePrice - discountAmount, 0))
            : fixMoneyPrecision(priceRaw);
        const purchaseTypeRaw = ensureString(row.purchase_type ?? "", "");
        const tradeNoRaw = ensureString(row.trade_no ?? "", "");
        let tradeNo = tradeNoRaw;
        if (purchaseTypeRaw === "gift_card") {
          const giftCardCode = row.gift_card_code ? ensureString(row.gift_card_code, "") : "";
          if (giftCardCode) {
            tradeNo = giftCardCode;
          } else if (tradeNo.includes("-")) {
            tradeNo = tradeNo.split("-")[0] || tradeNo;
          }
        }

        return {
          id: ensureNumber(row.id, 0),
          user_id: ensureNumber(row.user_id, 0),
          email: ensureString(row.email ?? "", ""),
          username: ensureString(row.username ?? "", ""),
          package_id: ensureNumber(row.package_id, 0),
          package_name: ensureString(row.package_name ?? "", ""),
          price: fixMoneyPrecision(priceRaw),
          package_price: packagePrice,
          discount_amount: discountAmount,
          coupon_code: row.coupon_code ?? null,
          purchase_type: purchaseTypeRaw,
          purchase_type_text: normalizePurchaseTypeText(purchaseTypeRaw),
          trade_no: tradeNo,
          status,
          status_text: statusMap[status] ?? "未知状态",
          traffic_quota: row.traffic_quota ?? null,
          validity_days: row.validity_days ?? null,
          created_at: row.created_at,
          paid_at: row.paid_at,
          expires_at: row.expires_at,
          final_price: finalPrice
        };
      }) || [];

    return successResponse(res, {
      records,
      pagination: {
        total,
        page,
        limit: pageSize,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  router.get("/login-logs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllLoginLogs(page, pageSize);
    return successResponse(res, data);
  });

  // 兼容 Worker：DELETE /api/admin/login-logs/:id
  router.delete("/login-logs/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.db.db.prepare("DELETE FROM login_logs WHERE id = ?").bind(id).run();
    return successResponse(res, { message: "登录日志删除成功" });
  });

  // 兼容 Worker：POST /api/admin/login-logs/batch-delete
  router.post("/login-logs/batch-delete", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, "请提供要删除的记录ID数组", 400);
    }
    const parsed = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
    if (!parsed.length) return errorResponse(res, "请提供要删除的记录ID数组", 400);
    await ctx.db.db
      .prepare(`DELETE FROM login_logs WHERE id IN (${parsed.map(() => "?").join(",")})`)
      .bind(...parsed)
      .run();
    return successResponse(res, { message: `成功删除 ${parsed.length} 条登录日志`, deleted_count: parsed.length });
  });

  // 兼容 Worker：POST /api/admin/login-logs/export-csv
  router.post("/login-logs/export-csv", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const parsed = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
    const where = parsed.length ? `WHERE ll.id IN (${parsed.map(() => "?").join(",")})` : "";

    const logsResult = await ctx.db.db
      .prepare(
        `
        SELECT 
          u.email as user_email,
          ll.login_ip,
          ll.user_agent as login_ua,
          ll.login_time,
          CASE 
            WHEN ll.login_status = 1 THEN '成功'
            WHEN ll.login_status = 0 THEN '失败'
            ELSE '未知'
          END as login_status
        FROM login_logs ll
        LEFT JOIN users u ON ll.user_id = u.id
        ${where}
        ORDER BY ll.login_time DESC
        ${parsed.length ? "" : "LIMIT 100"}
      `
      )
      .bind(...parsed)
      .all();

    const csvHeaders = ["用户邮箱", "登录IP", "登录UA", "登录时间", "登录状态"];
    let csv = `${csvHeaders.map(escapeCsv).join(",")}\n`;
    for (const row of logsResult.results || []) {
      const line = [
        (row as any).user_email || "",
        (row as any).login_ip || "",
        (row as any).login_ua || "",
        (row as any).login_time || "",
        (row as any).login_status || ""
      ];
      csv += `${line.map(escapeCsv).join(",")}\n`;
    }
    sendCsv(res, "login_logs.csv", csv);
  });

  router.get("/subscription-logs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllSubscriptionLogs(page, pageSize);
    return successResponse(res, data);
  });

  // 兼容 Worker：DELETE /api/admin/subscription-logs/:id
  router.delete("/subscription-logs/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.db.db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
    return successResponse(res, { message: "订阅日志删除成功" });
  });

  // 兼容 Worker：POST /api/admin/subscription-logs/batch-delete
  router.post("/subscription-logs/batch-delete", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, "请提供要删除的记录ID数组", 400);
    }
    const parsed = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
    if (!parsed.length) return errorResponse(res, "请提供要删除的记录ID数组", 400);
    await ctx.db.db
      .prepare(`DELETE FROM subscriptions WHERE id IN (${parsed.map(() => "?").join(",")})`)
      .bind(...parsed)
      .run();
    return successResponse(res, { message: `成功删除 ${parsed.length} 条订阅日志`, deleted_count: parsed.length });
  });

  // 兼容 Worker：POST /api/admin/subscription-logs/export-csv
  router.post("/subscription-logs/export-csv", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const parsed = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
    const where = parsed.length ? `WHERE s.id IN (${parsed.map(() => "?").join(",")})` : "";

    const logsResult = await ctx.db.db
      .prepare(
        `
        SELECT 
          u.email as user_email,
          s.type as subscription_type,
          s.request_ip as access_ip,
          s.request_user_agent as client_ua,
          s.request_time as access_time
        FROM subscriptions s
        LEFT JOIN users u ON s.user_id = u.id
        ${where}
        ORDER BY s.request_time DESC
        ${parsed.length ? "" : "LIMIT 100"}
      `
      )
      .bind(...parsed)
      .all();

    const csvHeaders = ["用户邮箱", "订阅类型", "访问IP", "客户端UA", "访问时间"];
    let csv = `${csvHeaders.map(escapeCsv).join(",")}\n`;
    for (const row of logsResult.results || []) {
      const line = [
        (row as any).user_email || "",
        (row as any).subscription_type || "",
        (row as any).access_ip || "",
        (row as any).client_ua || "",
        (row as any).access_time || ""
      ];
      csv += `${line.map(escapeCsv).join(",")}\n`;
    }
    sendCsv(res, "subscription_logs.csv", csv);
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

  // 在线 IP 管理
  router.get("/online-ips", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const nodeIdParam = typeof req.query.node_id === "string" ? req.query.node_id.trim() : "";
    const userSearch =
      (typeof req.query.user_email === "string" && req.query.user_email.trim()) ||
      (typeof (req.query as any).user_search === "string" && (req.query as any).user_search.trim()) ||
      "";
    const nodeSearch =
      (typeof (req.query as any).node_search === "string" && (req.query as any).node_search.trim()) ||
      (typeof (req.query as any).node_name === "string" && (req.query as any).node_name.trim()) ||
      "";
    const ipSearch =
      (typeof req.query.ip === "string" && req.query.ip.trim()) ||
      (typeof (req.query as any).ip_search === "string" && (req.query as any).ip_search.trim()) ||
      "";
    const sortByRaw = typeof req.query.sort_by === "string" ? req.query.sort_by.trim() : "last_seen";
    const sortBy = sortByRaw === "connect_time" ? "connect_time" : "last_seen";

    const conditions: string[] = [];
    const values: any[] = [];

    // 仅显示最近 5 分钟在线的 IP
    conditions.push("oi.last_seen > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)");

    if (nodeIdParam) {
      conditions.push("oi.node_id = ?");
      values.push(Number(nodeIdParam));
    }

    if (userSearch) {
      const parsedId = Number.parseInt(userSearch, 10);
      conditions.push("(u.email LIKE ? OR u.username LIKE ? OR u.id = ?)");
      values.push(`%${userSearch}%`, `%${userSearch}%`, Number.isNaN(parsedId) ? -1 : parsedId);
    }

    if (nodeSearch) {
      conditions.push("n.name LIKE ?");
      values.push(`%${nodeSearch}%`);
    }

    if (ipSearch) {
      conditions.push("oi.ip LIKE ?");
      values.push(`%${ipSearch}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;

    const totalRow = await ctx.dbService.db
      .prepare(
        `
        SELECT COUNT(*) as total
        FROM online_ips oi
        LEFT JOIN users u ON oi.user_id = u.id
        LEFT JOIN nodes n ON oi.node_id = n.id
        ${where}
      `
      )
      .bind(...values)
      .first<{ total?: number | string | null } | null>();
    const total = ensureNumber(totalRow?.total, 0);

    const sortColumn = sortBy === "connect_time" ? "oi.last_seen" : "oi.last_seen";

    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT 
          oi.id,
          oi.user_id,
          u.username,
          u.email AS user_email,
          u.class AS user_class,
          oi.node_id,
          n.name AS node_name,
          n.type AS node_type,
          oi.ip AS ip_address,
          oi.last_seen AS connect_time,
          oi.last_seen AS last_seen
        FROM online_ips oi
        LEFT JOIN users u ON oi.user_id = u.id
        LEFT JOIN nodes n ON oi.node_id = n.id
        ${where}
        ORDER BY ${sortColumn} DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();

    return successResponse(res, {
      data: rows.results || [],
      total,
      pagination: {
        total,
        page,
        limit: pageSize,
        pages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  // 兼容 Worker：POST /api/admin/online-ips/export-csv
  router.post("/online-ips/export-csv", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const parsed = ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
    const where = parsed.length ? `WHERE oi.id IN (${parsed.map(() => "?").join(",")})` : "";

    const result = await ctx.dbService.db
      .prepare(
        `
        SELECT 
          u.email as user_email,
          oi.ip as ip_address,
          n.name as node_name,
          oi.last_seen as connect_time
        FROM online_ips oi
        LEFT JOIN users u ON oi.user_id = u.id
        LEFT JOIN nodes n ON oi.node_id = n.id
        ${where}
        ORDER BY oi.last_seen DESC
        ${parsed.length ? "" : "LIMIT 100"}
      `
      )
      .bind(...parsed)
      .all();

    const csvHeaders = ["用户邮箱", "IP地址", "连接节点名称", "连接时间"];
    let csv = `${csvHeaders.map(escapeCsv).join(",")}\n`;
    for (const row of result.results || []) {
      const line = [
        (row as any).user_email || "",
        (row as any).ip_address || "",
        (row as any).node_name || "",
        (row as any).connect_time || ""
      ];
      csv += `${line.map(escapeCsv).join(",")}\n`;
    }
    sendCsv(res, "online_ips.csv", csv);
  });

  // 兼容 Worker：POST /api/admin/kick-ip（body: { ip_id }）
  router.post("/kick-ip", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const ipId = Number(req.body?.ip_id);
    if (!ipId) return errorResponse(res, "ip_id 必填", 400);
    await ctx.dbService.db.prepare("DELETE FROM online_ips WHERE id = ?").bind(ipId).run();
    return successResponse(res, { message: "IP踢出成功" });
  });

  router.post("/online-ips/:id/kick", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.dbService.db.prepare("DELETE FROM online_ips WHERE id = ?").bind(id).run();
    return successResponse(res, null, "已踢出该 IP");
  });

  router.delete("/online-ips/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.dbService.db.prepare("DELETE FROM online_ips WHERE id = ?").bind(id).run();
    return successResponse(res, null, "在线 IP 记录已删除");
  });

  router.post("/online-ips/batch-delete", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, "请提供要删除的记录 ID 数组", 400);
    }
    const placeholders = ids.map(() => "?").join(",");
    const result = toRunResult(
      await ctx.dbService.db.prepare(`DELETE FROM online_ips WHERE id IN (${placeholders})`).bind(...ids).run()
    );
    const deleted = getChanges(result);
    return successResponse(res, { deleted_count: deleted }, `成功删除 ${deleted} 条在线 IP 记录`);
  });

  // 占位实现：封禁 IP
  router.post("/block-ip", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { ip } = req.body || {};
    if (!ip || typeof ip !== "string") {
      return errorResponse(res, "IP 地址无效", 400);
    }
    return successResponse(res, { message: "IP 封禁功能待实现", ip });
  });

  // 审计规则管理
  router.get("/audit-rules", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: any[] = [];
    if (search) {
      conditions.push("(name LIKE ? OR description LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await ctx.dbService.db
      .prepare(`SELECT COUNT(*) as total FROM audit_rules ${where}`)
      .bind(...values)
      .first<{ total?: number | string | null } | null>();
    const total = ensureNumber(totalRow?.total, 0);

    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT id, name, description, rule, enabled, created_at, updated_at
        FROM audit_rules
        ${where}
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();

    return successResponse(res, {
      data: rows.results || [],
      total,
      pagination: {
        total,
        page,
        limit: pageSize,
        pages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  router.post("/audit-rules", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { name, description, rule, enabled } = req.body || {};
    if (!name || !rule) return errorResponse(res, "缺少必要字段", 400);

    const result = toRunResult(
      await ctx.dbService.db
        .prepare(
          `
          INSERT INTO audit_rules (name, description, rule, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `
        )
        .bind(name, description || "", rule, enabled !== undefined ? Number(enabled) : 1)
        .run()
    );
    if (getChanges(result) <= 0) {
      return errorResponse(res, "创建失败", 500);
    }

    const rows = await ctx.dbService.db
      .prepare("SELECT * FROM audit_rules ORDER BY id DESC LIMIT 1")
      .all();
    const created = (rows.results || [])[0] || null;
    await ctx.cache.deleteByPrefix("audit_rules");
    return successResponse(res, created, "创建成功");
  });

  router.put("/audit-rules/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    const { name, description, rule, enabled } = req.body || {};
    if (!name || !rule) return errorResponse(res, "缺少必要字段", 400);

    await ctx.dbService.db
      .prepare(
        `
        UPDATE audit_rules
        SET name = ?, description = ?, rule = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(name, description || "", rule, enabled !== undefined ? Number(enabled) : 1, id)
      .run();

    const updated = await ctx.dbService.db
      .prepare("SELECT * FROM audit_rules WHERE id = ?")
      .bind(id)
      .first();
    await ctx.cache.deleteByPrefix("audit_rules");
    return successResponse(res, updated, "更新成功");
  });

  router.delete("/audit-rules/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.dbService.db.prepare("DELETE FROM audit_rules WHERE id = ?").bind(id).run();
    await ctx.cache.deleteByPrefix("audit_rules");
    return successResponse(res, null, "删除成功");
  });

  // 审计白名单管理
  router.get("/whitelist", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: any[] = [];
    if (search) {
      conditions.push("(rule LIKE ? OR description LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }
    if (statusParam !== "") {
      conditions.push("status = ?");
      values.push(Number(statusParam));
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await ctx.dbService.db
      .prepare(`SELECT COUNT(*) as total FROM white_list ${where}`)
      .bind(...values)
      .first<{ total?: number | string | null } | null>();
    const total = ensureNumber(totalRow?.total, 0);

    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT id, rule, description, status, created_at
        FROM white_list
        ${where}
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();

    return successResponse(res, {
      data: rows.results || [],
      total,
      pagination: {
        total,
        page,
        limit: pageSize,
        pages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  router.post("/whitelist", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { rule, description, status } = req.body || {};
    if (!rule) return errorResponse(res, "规则内容不能为空", 400);

    const result = toRunResult(
      await ctx.dbService.db
        .prepare(
          `
          INSERT INTO white_list (rule, description, status, created_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `
        )
        .bind(rule, description || "", status !== undefined ? Number(status) : 1)
        .run()
    );
    if (getChanges(result) <= 0) {
      return errorResponse(res, "创建失败", 500);
    }

    const rows = await ctx.dbService.db
      .prepare("SELECT * FROM white_list ORDER BY id DESC LIMIT 1")
      .all();
    const created = (rows.results || [])[0] || null;
    await ctx.cache.deleteByPrefix("whitelist");
    return successResponse(res, created, "创建成功");
  });

  router.put("/whitelist/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    const { rule, description, status } = req.body || {};
    if (!rule) return errorResponse(res, "规则内容不能为空", 400);

    await ctx.dbService.db
      .prepare(
        `
        UPDATE white_list
        SET rule = ?, description = ?, status = ?
        WHERE id = ?
      `
      )
      .bind(rule, description || "", status !== undefined ? Number(status) : 1, id)
      .run();

    const updated = await ctx.dbService.db
      .prepare("SELECT * FROM white_list WHERE id = ?")
      .bind(id)
      .first();
    await ctx.cache.deleteByPrefix("whitelist");
    return successResponse(res, updated, "更新成功");
  });

  router.delete("/whitelist/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.dbService.db.prepare("DELETE FROM white_list WHERE id = ?").bind(id).run();
    await ctx.cache.deleteByPrefix("whitelist");
    return successResponse(res, null, "删除成功");
  });

  router.post("/whitelist/batch", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { action, ids } = req.body || {};
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, "无效的操作参数", 400);
    }

    let query = "";
    let message = "";
    if (action === "enable") {
      query = `UPDATE white_list SET status = 1 WHERE id IN (${ids.map(() => "?").join(",")})`;
      message = `已启用 ${ids.length} 个白名单规则`;
    } else if (action === "disable") {
      query = `UPDATE white_list SET status = 0 WHERE id IN (${ids.map(() => "?").join(",")})`;
      message = `已禁用 ${ids.length} 个白名单规则`;
    } else if (action === "delete") {
      query = `DELETE FROM white_list WHERE id IN (${ids.map(() => "?").join(",")})`;
      message = `已删除 ${ids.length} 个白名单规则`;
    } else {
      return errorResponse(res, "不支持的操作类型", 400);
    }

    const result = toRunResult(await ctx.dbService.db.prepare(query).bind(...ids).run());
    const affected = getChanges(result);
    await ctx.cache.deleteByPrefix("whitelist");

    return successResponse(res, { affected_count: affected, message }, "操作成功");
  });

  // 审计日志
  router.get("/audit-logs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const userSearch = typeof req.query.user_id === "string" ? req.query.user_id.trim() : "";
    const startDate =
      typeof (req.query as any).start_date === "string" ? (req.query as any).start_date : undefined;
    const endDate =
      typeof (req.query as any).end_date === "string" ? (req.query as any).end_date : undefined;
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: any[] = [];

    if (userSearch) {
      const parsedId = Number.parseInt(userSearch, 10);
      conditions.push("(u.email LIKE ? OR al.user_id = ?)");
      values.push(`%${userSearch}%`, Number.isNaN(parsedId) ? -1 : parsedId);
    }

    const normalizeDateTime = (value?: string): string | null => {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toISOString().replace("T", " ").slice(0, 19);
    };

    const start = normalizeDateTime(startDate);
    if (start) {
      conditions.push("al.created_at >= ?");
      values.push(start);
    }

    const end = normalizeDateTime(endDate);
    if (end) {
      conditions.push("al.created_at <= ?");
      values.push(end);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await ctx.dbService.db
      .prepare(
        `
        SELECT COUNT(*) as total
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${where}
      `
      )
      .bind(...values)
      .first<{ total?: number | string | null } | null>();
    const total = ensureNumber(totalRow?.total, 0);

    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT 
          al.id,
          al.user_id,
          u.username,
          u.email AS user_email,
          al.node_id,
          n.name AS node_name,
          al.audit_rule_id,
          ar.name AS rule_name,
          ar.rule AS rule_content,
          al.ip_address,
          al.created_at
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        LEFT JOIN nodes n ON al.node_id = n.id
        LEFT JOIN audit_rules ar ON al.audit_rule_id = ar.id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, pageSize, offset)
      .all();

    return successResponse(res, {
      data: rows.results || [],
      total,
      pagination: {
        total,
        page,
        limit: pageSize,
        pages: total > 0 ? Math.ceil(total / pageSize) : 0
      }
    });
  });

  router.delete("/audit-logs/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    await ctx.dbService.db.prepare("DELETE FROM audit_logs WHERE id = ?").bind(id).run();
    return successResponse(res, null, "审计记录已删除");
  });

  router.post("/audit-logs/batch-delete", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse(res, "请提供要删除的记录 ID 数组", 400);
    }
    const placeholders = ids.map(() => "?").join(",");
    const result = toRunResult(
      await ctx.dbService.db.prepare(`DELETE FROM audit_logs WHERE id IN (${placeholders})`).bind(...ids).run()
    );
    const deleted = getChanges(result);
    return successResponse(res, { deleted_count: deleted }, `成功删除 ${deleted} 条审计记录`);
  });

  return router;
}
