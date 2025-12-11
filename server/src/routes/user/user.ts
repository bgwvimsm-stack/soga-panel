import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { generateRandomString } from "../../utils/crypto";
import { hashPassword, verifyPassword } from "../../utils/crypto";
import { ReferralService } from "../../services/referral";
import { TrafficService } from "../../services/traffic";
import { TicketService } from "../../services/ticket";
import { UserAuditService } from "../../services/userAudit";
import { TwoFactorService } from "../../services/twoFactor";
import { ensureString } from "../../utils/d1";

export function createUserRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const referralService = new ReferralService(ctx.dbService);
  const trafficService = new TrafficService(ctx.dbService);
  const ticketService = new TicketService(ctx.dbService);
  const auditService = new UserAuditService(ctx.dbService);
  const twoFactorService = new TwoFactorService(ctx.env);

  const verifyUserTwoFactorCode = async (userRow: any, code: string) => {
    if (!code) return { success: false, usedBackup: false };
    const trimmed = code.trim();
    const secret = await twoFactorService.decryptSecret(userRow.two_factor_secret);
    if (secret) {
      const ok = await twoFactorService.verifyTotp(secret, trimmed);
      if (ok) return { success: true, usedBackup: false };
    }
    const normalized = twoFactorService.normalizeBackupCodeInput(trimmed);
    if (!normalized || normalized.length < 6) return { success: false, usedBackup: false };
    const hashedInput = await twoFactorService.hashBackupCode(normalized);
    const stored = twoFactorService.parseBackupCodes(userRow.two_factor_backup_codes);
    const idx = stored.findIndex((h) => h === hashedInput);
    if (idx === -1) return { success: false, usedBackup: false };
    stored.splice(idx, 1);
    await ctx.dbService.db
      .prepare("UPDATE users SET two_factor_backup_codes = ? WHERE id = ?")
      .bind(JSON.stringify(stored), userRow.id)
      .run();
    userRow.two_factor_backup_codes = JSON.stringify(stored);
    return { success: true, usedBackup: true };
  };

  router.get("/profile", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) {
      return errorResponse(res, "未登录", 401);
    }
    const dbUser = await ctx.dbService.getUserById(Number(user.id));
    if (!dbUser) {
      return errorResponse(res, "用户不存在", 404);
    }

    const transferEnable = Number(dbUser.transfer_enable ?? 0);
    const transferUsed = Number(dbUser.transfer_total ?? 0);
    const transferRemain = Math.max(0, transferEnable - transferUsed);
    const trafficPercentage = transferEnable > 0 ? Math.round((transferUsed / transferEnable) * 100) : 0;
    const isExpired = dbUser.expire_time ? new Date(dbUser.expire_time).getTime() < Date.now() : false;
    const daysRemaining =
      dbUser.expire_time && !Number.isNaN(new Date(dbUser.expire_time).getTime())
        ? Math.max(0, Math.ceil((new Date(dbUser.expire_time).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;

    const configs = await ctx.dbService.listSystemConfigsMap();
    const trafficResetDay = Number(configs["traffic_reset_day"] ?? 0);
    let subscriptionUrl = configs["subscription_url"] || configs["site_url"] || ctx.env.SITE_URL || "";

    // 补全订阅 URL
    if (!subscriptionUrl && ctx.env.SITE_URL) {
      subscriptionUrl = ctx.env.SITE_URL;
    }

    return successResponse(res, {
      id: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
      uuid: dbUser.uuid,
      passwd: dbUser.passwd,
      token: dbUser.token,
      is_admin: Boolean(dbUser.is_admin),
      class: dbUser.class,
      class_expire_time: dbUser.class_expire_time,
      expire_time: dbUser.expire_time,
      is_expired: isExpired,
      days_remaining: daysRemaining,
      speed_limit: dbUser.speed_limit,
      device_limit: dbUser.device_limit,
      tcp_limit: dbUser.tcp_limit,
      upload_traffic: Number(dbUser.upload_traffic ?? 0),
      download_traffic: Number(dbUser.download_traffic ?? 0),
      upload_today: Number(dbUser.upload_today ?? 0),
      download_today: Number(dbUser.download_today ?? 0),
      transfer_total: transferUsed,
      transfer_enable: transferEnable,
      transfer_remain: transferRemain,
      traffic_percentage: trafficPercentage,
      reg_date: dbUser.reg_date,
      last_login_time: dbUser.last_login_time,
      last_login_ip: dbUser.last_login_ip,
      status: dbUser.status,
      traffic_reset_day: trafficResetDay,
      subscription_url: subscriptionUrl,
      two_factor_enabled: Number(dbUser.two_factor_enabled) === 1,
      has_two_factor_backup_codes: Boolean(dbUser.two_factor_backup_codes)
    });
  });

  router.put("/profile", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { username } = req.body || {};
    if (!username) return errorResponse(res, "用户名不能为空", 400);
    const exists = await ctx.dbService.getUserByUsername(username);
    if (exists && Number(exists.id) !== Number(user.id)) {
      return errorResponse(res, "用户名已被占用", 400);
    }
    await ctx.dbService.updateUserProfile(Number(user.id), { username });
    return successResponse(res, null, "资料已更新");
  });

  router.get("/nodes", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 200);
    const typeFilter = typeof req.query.type === "string" ? req.query.type.toLowerCase() : "";
    const statusFilterRaw = req.query.status;
    const statusFilter =
      statusFilterRaw === undefined || statusFilterRaw === null || statusFilterRaw === ""
        ? null
        : String(statusFilterRaw) === "1";

    const userRow = await ctx.dbService.getUserById(Number(user.id));
    if (!userRow) return errorResponse(res, "用户不存在", 404);
    const userClass = Number(userRow?.class ?? 0);

    const filters: string[] = ["status = 1", "node_class <= ?"];
    const values: any[] = [userClass];
    if (typeFilter) {
      filters.push("LOWER(type) = ?");
      values.push(typeFilter);
    }
    const where = `WHERE ${filters.join(" AND ")}`;
    const offset = (page - 1) * limit;

    const totalRow = await ctx.db
      .prepare(`SELECT COUNT(*) as total FROM nodes ${where}`)
      .bind(...values)
      .first<{ total?: number }>();

    const rows = await ctx.db
      .prepare(
        `
        SELECT * FROM nodes
        ${where}
        ORDER BY node_class ASC, id ASC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, limit, offset)
      .all();

    const parseNodeConfig = (raw: any) => {
      try {
        return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
      } catch (error) {
        console.warn("parse node_config failed", error);
        return {};
      }
    };

    const nodes =
      (rows.results || []).map((node: any) => {
        const parsed = parseNodeConfig(node.node_config);
        const cfg = (parsed as any)?.config || parsed || {};
        const client = (parsed as any)?.client || {};
        const server = client.server || "";
        const port = Number(client.port || cfg.port || 0) || 0;
        const tlsHost = client.tls_host || cfg.host || server;
        return {
          ...node,
          server,
          server_port: port || 443,
          tls_host: tlsHost,
          config: parsed
        };
      }) || [];

    // 填充在线状态与用户在节点的流量
    const enriched = await Promise.all(
      nodes.map(async (node: any) => {
        const traffic = await ctx.db
          .prepare(
            `
            SELECT 
              COALESCE(SUM(upload_traffic), 0) as upload_traffic,
              COALESCE(SUM(download_traffic), 0) as download_traffic,
              COALESCE(SUM(upload_traffic + download_traffic), 0) as total_traffic,
              COALESCE(SUM(actual_upload_traffic), 0) as actual_upload_traffic,
              COALESCE(SUM(actual_download_traffic), 0) as actual_download_traffic,
              COALESCE(SUM(actual_traffic), 0) as actual_total_traffic
            FROM traffic_logs
            WHERE user_id = ? AND node_id = ?
          `
          )
          .bind(user.id, node.id)
          .first<{
            upload_traffic?: number;
            download_traffic?: number;
            total_traffic?: number;
            actual_upload_traffic?: number;
            actual_download_traffic?: number;
            actual_total_traffic?: number;
          }>();

        const onlineRow = await ctx.db
          .prepare(
            `
            SELECT COUNT(*) as total FROM node_status 
            WHERE node_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
          `
          )
          .bind(node.id)
          .first<{ total?: number }>();

        return {
          ...node,
          user_upload_traffic: Number(traffic?.upload_traffic ?? 0),
          user_download_traffic: Number(traffic?.download_traffic ?? 0),
          user_total_traffic: Number(traffic?.actual_total_traffic ?? traffic?.total_traffic ?? 0),
          user_raw_total_traffic: Number(traffic?.total_traffic ?? 0),
          user_actual_upload_traffic: Number(traffic?.actual_upload_traffic ?? 0),
          user_actual_download_traffic: Number(traffic?.actual_download_traffic ?? 0),
          user_actual_total_traffic: Number(traffic?.actual_total_traffic ?? 0),
          tags: ["等级" + node.node_class],
          is_online: Number(onlineRow?.total ?? 0) > 0
        };
      })
    );

    let filtered = enriched;
    if (statusFilter !== null) {
      filtered = filtered.filter((n) => (statusFilter ? n.is_online : !n.is_online));
    }

    const baseTotal = Number(totalRow?.total ?? 0);
    const onlineCount = filtered.filter((n) => n.is_online).length;
    const offlineCount = filtered.length - onlineCount;
    const total = statusFilter !== null ? filtered.length : baseTotal;
    return successResponse(res, {
      nodes: filtered,
      statistics: {
        total,
        online: onlineCount,
        offline: offlineCount,
        accessible: filtered.length
      },
      pagination: {
        total,
        page,
        limit
      }
    });
  });

  router.post("/reset-subscription-token", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const newToken = generateRandomString(32);
    await ctx.dbService.resetSubscriptionToken(Number(user.id), newToken);
    return successResponse(res, { token: newToken }, "订阅 Token 已重置");
  });

  router.get("/login-logs", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const limit = Number(req.query.limit ?? 20) || 20;
    const logs = await ctx.dbService.listLoginLogs(Number(user.id), Math.min(limit, 100));
    return successResponse(res, logs);
  });

  router.post("/change-password", async (req: Request, res: Response) => {
    const user = (req as any).user;
    // 前端传 current_password/new_password
    const { old_password, new_password, current_password } = req.body || {};
    const current = old_password || current_password;
    if (!current || !new_password) return errorResponse(res, "参数缺失", 400);

    const dbUser = await ctx.dbService.getUserById(Number(user.id));
    if (!dbUser) return errorResponse(res, "用户不存在", 404);

    const ok = verifyPassword(current, String(dbUser.password_hash || ""));
    if (!ok) return errorResponse(res, "原密码错误", 400);

    await ctx.dbService.updateUserPassword(Number(user.id), hashPassword(new_password));
    return successResponse(res, null, "密码已更新");
  });

  // 2FA: 获取密钥/二维码
  router.post("/two-factor/setup", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userRow = await ctx.dbService.getUserById(Number(user.id));
    if (!userRow) return errorResponse(res, "用户不存在", 404);
    if (Number(userRow.two_factor_enabled) === 1 && userRow.two_factor_secret) {
      return errorResponse(res, "二步验证已启用", 400);
    }

    const secret = twoFactorService.generateSecret(32);
    const encryptedSecret = await twoFactorService.encryptSecret(secret);
    await ctx.dbService.db
      .prepare("UPDATE users SET two_factor_temp_secret = ? WHERE id = ?")
      .bind(encryptedSecret, userRow.id)
      .run();

    const account = ensureString(userRow.email) || ensureString(userRow.username) || `user_${userRow.id}`;
    const issuer = ctx.env.SITE_NAME || "Soga Panel";
    const otpAuthUrl = twoFactorService.createOtpAuthUrl(secret, account, issuer);
    return successResponse(res, {
      secret,
      otp_auth_url: otpAuthUrl,
      provisioning_uri: otpAuthUrl
    });
  });

  // 2FA: 启用
  router.post("/two-factor/enable", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { code } = req.body || {};
    if (!code) return errorResponse(res, "请输入验证码", 400);

    const userRow = await ctx.dbService.getUserById(Number(user.id));
    if (!userRow) return errorResponse(res, "用户不存在", 404);
    if (!userRow.two_factor_temp_secret) return errorResponse(res, "请先获取新的密钥", 400);

    const tempSecret = await twoFactorService.decryptSecret(userRow.two_factor_temp_secret);
    if (!tempSecret) return errorResponse(res, "临时密钥无效，请重新生成", 400);

    const ok = await twoFactorService.verifyTotp(tempSecret, String(code));
    if (!ok) return errorResponse(res, "验证码无效，请重试", 401);

    const backupCodes = twoFactorService.generateBackupCodes();
    const hashed = await twoFactorService.hashBackupCodes(backupCodes);

    await ctx.dbService.db
      .prepare(
        `
        UPDATE users
        SET two_factor_enabled = 1,
            two_factor_secret = two_factor_temp_secret,
            two_factor_backup_codes = ?,
            two_factor_temp_secret = NULL,
            two_factor_confirmed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(JSON.stringify(hashed), user.id)
      .run();

    return successResponse(res, { backup_codes: backupCodes }, "二步验证已启用");
  });

  // 2FA: 重新生成备用码
  router.post("/two-factor/backup-codes", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { code } = req.body || {};
    if (!code) return errorResponse(res, "请输入验证码", 400);
    const userRow = await ctx.dbService.getUserById(Number(user.id));
    if (!userRow || Number(userRow.two_factor_enabled) !== 1) {
      return errorResponse(res, "尚未启用二步验证", 400);
    }
    const verification = await verifyUserTwoFactorCode(userRow, String(code));
    if (!verification.success) return errorResponse(res, "验证码无效，请重试", 401);

    const backupCodes = twoFactorService.generateBackupCodes();
    const hashed = await twoFactorService.hashBackupCodes(backupCodes);
    await ctx.dbService.db
      .prepare("UPDATE users SET two_factor_backup_codes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(hashed), user.id)
      .run();

    return successResponse(res, { backup_codes: backupCodes }, "已生成新的备用验证码");
  });

  // 2FA: 关闭
  router.post("/two-factor/disable", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { password, code } = req.body || {};
    if (!password || !code) return errorResponse(res, "请输入密码和验证码", 400);

    const userRow = await ctx.dbService.getUserById(Number(user.id));
    if (!userRow || Number(userRow.two_factor_enabled) !== 1) {
      return errorResponse(res, "尚未启用二步验证", 400);
    }
    const passwordOk = verifyPassword(String(password), String(userRow.password_hash || ""));
    if (!passwordOk) return errorResponse(res, "密码错误", 401);

    const verification = await verifyUserTwoFactorCode(userRow, String(code));
    if (!verification.success) return errorResponse(res, "验证码无效，请重试", 401);

    await ctx.dbService.db
      .prepare(
        `
        UPDATE users
        SET two_factor_enabled = 0,
            two_factor_secret = NULL,
            two_factor_backup_codes = NULL,
            two_factor_temp_secret = NULL,
            two_factor_confirmed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(user.id)
      .run();

    return successResponse(res, null, "二步验证已关闭");
  });

  router.get("/subscription-logs", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const offset = (page - 1) * limit;
    const filters: string[] = ["user_id = ?"];
    const values: any[] = [user.id];
    if (type) {
      filters.push("type = ?");
      values.push(type);
    }
    const where = `WHERE ${filters.join(" AND ")}`;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT id, user_id, type, request_ip, request_time, request_user_agent
        FROM subscriptions
        ${where}
        ORDER BY request_time DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, limit, offset)
      .all();
    const totalRow = await ctx.dbService.db
      .prepare(`SELECT COUNT(*) as total FROM subscriptions ${where}`)
      .bind(...values)
      .first<{ total?: number }>();
    const total = Number(totalRow?.total ?? 0);
    return successResponse(res, {
      data: rows.results || [],
      total,
      page,
      limit,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  });

  router.get("/traffic-records", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const limit = Number(req.query.limit ?? 50) || 50;
    const logs = await ctx.dbService.listTrafficLogs(Number(user.id), Math.min(limit, 200));
    return successResponse(res, logs);
  });

  router.get("/online-ips", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const limit = Number(req.query.limit ?? 50) || 50;
    const rows = await ctx.dbService.listOnlineIps(Number(user.id), Math.min(limit, 200));
    return successResponse(res, rows);
  });

  // 兼容前端个人资料页所需的详情格式
  router.get("/online-ips-detail", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const rows = await ctx.dbService.listOnlineIps(Number(user.id), limit);
    const data =
      rows?.map((row: any) => ({
        id: row.id,
        node_id: row.node_id,
        node_name: row.node_name,
        ip: row.ip,
        last_seen: row.last_seen
      })) || [];
    return successResponse(res, data);
  });

  router.get("/online-devices", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const rows = await ctx.dbService.listOnlineDevices(Number(user.id));
    return successResponse(res, rows);
  });

  router.get("/bark-settings", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const dbUser = await ctx.dbService.getUserById(Number(user.id));
    if (!dbUser) return errorResponse(res, "用户不存在", 404);
    return successResponse(res, {
      bark_key: dbUser.bark_key || "",
      bark_enabled: Number(dbUser.bark_enabled) === 1
    });
  });

  router.put("/bark-settings", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { bark_key, bark_enabled } = req.body || {};
    await ctx.dbService.updateUserBarkSettings(Number(user.id), bark_key ?? null, Boolean(bark_enabled));
    return successResponse(res, null, "Bark 设置已更新");
  });

  router.get("/invite", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const stats = await ctx.dbService.getUserInviteStats(Number(user.id));
    const code =
      stats.invite_code ||
      (await ctx.dbService.ensureUserInviteCode(Number(user.id), () => referralService.normalizeInviteCode(generateRandomString(8))));
    const base = ctx.env.SITE_URL || "";
    const link = base ? `${base.replace(/\/$/, "")}/register?invite=${code}` : null;
    const configMap = await ctx.dbService.listSystemConfigsMap();
    const rebateRate = Number(configMap["rebate_rate"] ?? 0);
    const rebateMode = (configMap["rebate_mode"] ?? "every_order").toString();
    const inviteLimitDefault = Number(configMap["invite_default_limit"] ?? stats.invite_limit ?? 0);
    return successResponse(res, {
      invite_code: code,
      invite_link: link,
      invited_by: stats.invited_by,
      invite_used: stats.invite_used,
      invite_limit: stats.invite_limit,
      total_invitees: stats.total_invitees,
      confirmed_invitees: stats.confirmed_invitees,
      rebate_available: stats.rebate_available,
      rebate_total: stats.rebate_total,
      rebate_rate: rebateRate,
      rebate_mode: rebateMode,
      invite_default_limit: inviteLimitDefault
    });
  });

  router.post("/invite/regenerate", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const code = await referralService.regenerateInviteCode(Number(user.id));
    const base = ctx.env.SITE_URL || "";
    const link = base ? `${base.replace(/\/$/, "")}/register?invite=${code}` : null;
    return successResponse(res, { invite_code: code, invite_link: link }, "邀请码已重置");
  });

  router.get("/invite/referrals", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const data = await ctx.dbService.listReferrals(Number(user.id), page, pageSize);
    return successResponse(res, data);
  });

  // 邀请/返利概览（对齐 Worker）
  router.get("/referrals", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 200);
    const offsetPageSize = limit;
    const referrals = await ctx.dbService.listReferrals(Number(user.id), page, offsetPageSize);
    const statsRow = await ctx.dbService.db
      .prepare(
        `
        SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_total
        FROM referral_relations
        WHERE inviter_id = ?
      `
      )
      .bind(user.id)
      .first<{ total?: number; active_total?: number }>();
    const userRow = await ctx.dbService.db
      .prepare(
        `
        SELECT invite_code, invited_by, rebate_available, rebate_total, invite_limit, invite_used
        FROM users WHERE id = ?
      `
      )
      .bind(user.id)
      .first<{
        invite_code?: string;
        invited_by?: number;
        rebate_available?: number;
        rebate_total?: number;
        invite_limit?: number;
        invite_used?: number;
      }>();
    const configs = await ctx.dbService.listSystemConfigsMap();
    const inviteBaseUrl = configs["site_url"] || ctx.env.SITE_URL || "";
    const rebateSettings = {
      mode: configs["rebate_mode"] || "every_order",
      rate: Number(configs["rebate_rate"] ?? 0)
    };
    const withdrawSettings = {
      feeRate: Number(configs["rebate_withdraw_fee_rate"] ?? 0.05),
      minAmount: Number(configs["rebate_withdraw_min_amount"] ?? 200)
    };
    return successResponse(res, {
      inviteCode: userRow?.invite_code || null,
      invitedBy: userRow?.invited_by ?? null,
      rebateAvailable: Number(userRow?.rebate_available ?? 0),
      rebateTotal: Number(userRow?.rebate_total ?? 0),
      inviteLimit: Number(userRow?.invite_limit ?? 0),
      inviteUsed: Number(userRow?.invite_used ?? 0),
      stats: {
        totalInvited: Number(statsRow?.total ?? 0),
        activeInvited: Number(statsRow?.active_total ?? 0)
      },
      referrals: (referrals.data || []).map((row: any) => ({
        id: row.id,
        inviteeId: row.invitee_id,
        email: row.invitee_email,
        username: row.invitee_username,
        status: row.status,
        registeredAt: row.created_at,
        firstPaidAt: row.first_paid_at,
        totalRebate: Number(row.total_rebate ?? 0)
      })),
      pagination: {
        page,
        limit,
        total: referrals.total,
        totalPages: Math.max(1, Math.ceil(referrals.total / limit))
      },
      rebateSettings,
      withdrawSettings,
      inviteBaseUrl
    });
  });

  router.get("/tickets/unread-count", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const unread = await ticketService.countUserUnread(Number(user.id));
    return successResponse(res, { count: unread });
  });

  // 工单列表
  router.get("/tickets", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Number(req.query.pageSize ?? 10) || 10;
    const status = typeof req.query.status === "string" ? (req.query.status as any) : undefined;
    const data = await ticketService.listUserTickets(Number(user.id), page, Math.min(pageSize, 50), status);
    return successResponse(res, data);
  });

  // 创建工单
  router.post("/tickets", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { title, content } = req.body || {};
    if (!title || !content) return errorResponse(res, "标题和内容不能为空", 400);
    const ticket = await ticketService.createTicket(Number(user.id), title, content);
    return successResponse(res, ticket, "工单已提交");
  });

  // 工单详情
  router.get("/tickets/:id", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const ticket = await ticketService.getTicketForUser(id, Number(user.id));
    if (!ticket) return errorResponse(res, "未找到工单", 404);
    const replies = await ticketService.listReplies(id);
    return successResponse(res, { ticket, replies });
  });

  // 工单回复
  router.post("/tickets/:id/replies", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { content } = req.body || {};
    if (!content) return errorResponse(res, "回复内容不能为空", 400);
    const ticket = await ticketService.getTicketDetail(id);
    if (!ticket || Number(ticket.user_id) !== Number(user.id)) return errorResponse(res, "未找到工单", 404);
    const status = await ticketService.replyTicket(id, Number(user.id), "user", content);
    const replies = await ticketService.listReplies(id);
    return successResponse(res, { replies, status }, "回复成功");
  });

  // 关闭工单
  router.post("/tickets/:id/close", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const result = await ticketService.closeTicketByUser(id, Number(user.id));
    if (!result.success) return errorResponse(res, result.message || "关闭失败", 400);
    return successResponse(res, { status: result.status }, "工单已关闭");
  });

  // 用户流量趋势
  router.get("/traffic/trends", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const period = (req.query.period as string) || "";
    const daysParam = Number(req.query.days ?? 7) || 7;
    const days = period === "today" ? 1 : Math.min(daysParam, 90);
    const data = await trafficService.getUserTrafficTrends(Number(user.id), days);
    return successResponse(res, data);
  });

  // 用户流量汇总
  router.get("/traffic/summary", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const data = await trafficService.getUserTrafficSummary(Number(user.id));
    return successResponse(res, data);
  });

  // 用户流量统计（兼容旧版 API）
  router.get("/traffic-stats", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const days = Number(req.query.days ?? 30) || 30;
    const data = await trafficService.getUserTrafficStats(Number(user.id), Math.min(days, 180));
    if (!data) return errorResponse(res, "用户不存在", 404);
    return successResponse(res, data);
  });

  // 手动触发流量更新（占位实现）
  router.post("/traffic/manual-update", async (req: Request, res: Response) => {
    const user = (req as any).user;
    // 此处可对接实时统计逻辑，当前返回占位成功
    return successResponse(res, { user_id: user.id, updated: true }, "已触发手动同步");
  });

  // 审计：规则列表
  router.get("/audit-rules", async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Number(req.query.limit ?? 20) || 20;
    const data = await auditService.listRules(page, Math.min(limit, 100));
    return successResponse(res, data);
  });

  // 审计：日志列表
  router.get("/audit-logs", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Number(req.query.limit ?? 20) || 20;
    const data = await auditService.listLogs(Number(user.id), page, Math.min(limit, 100));
    return successResponse(res, data);
  });

  // 审计：概览
  router.get("/audit-overview", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const data = await auditService.overview(Number(user.id));
    return successResponse(res, data);
  });

  // 用户共享账号（苹果账号等）
  router.get("/shared-ids", async (_req: Request, res: Response) => {
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT id, name, fetch_url, remote_account_id, status
        FROM shared_ids
        WHERE status = 1
        ORDER BY id DESC
      `
      )
      .all();
    const now = new Date().toISOString();
    const items =
      rows.results?.map((row: any) => {
        const enabled = Number(row.status ?? 0) === 1;
        const hasUrl = Boolean(row.fetch_url);
        const status: "ok" | "missing" | "error" = enabled ? (hasUrl ? "ok" : "missing") : "error";
        return {
          id: row.id,
          name: row.name,
          remote_account_id: row.remote_account_id,
          status,
          account: null,
          fetched_at: now,
          message: hasUrl ? undefined : "未配置拉取地址",
          error: enabled ? undefined : "账号已禁用"
        };
      }) ?? [];
    return successResponse(res, { items, count: items.length });
  });

  return router;
}
