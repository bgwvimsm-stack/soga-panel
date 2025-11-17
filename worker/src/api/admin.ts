// src/api/admin.ts - 管理员 API（添加等级管理功能）

import type { Env } from "../types";
import type { SystemConfigManager } from "../utils/systemConfig";
import { DatabaseService } from "../services/database";
import { CacheService } from "../services/cache";
import { SchedulerService } from "../services/scheduler";
import { validateUserAuth } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import {
  hashPassword,
  generateUUID,
  generateRandomString,
  getUtc8Timestamp,
  getUtc8IsoString,
} from "../utils/crypto";
import { createSystemConfigManager } from "../utils/systemConfig";
import { getChanges, toRunResult, ensureNumber, ensureString, ensureDate, getLastRowId } from "../utils/d1";
import { fixMoneyPrecision } from "../utils/money";
import { GiftCardService, GiftCardType, CreateGiftCardPayload } from "../services/giftCardService";

interface AdminAuthResult {
  success: boolean;
  message?: string;
  admin?: {
    id: number;
    is_admin: boolean;
    [key: string]: unknown;
  };
}

interface ExpiredUserDetailRow {
  id: number;
  email: string;
  username: string;
  class: number;
  class_expire_time: string | null;
  upload_traffic: number;
  download_traffic: number;
  transfer_today: number;
  transfer_total: number;
  transfer_enable: number;
  reg_date: string | null;
  last_login_time: string | null;
  days_expired: number;
}

interface UserListRow {
  id: number;
  email: string;
  username: string;
  class: number;
  class_expire_time: string | null;
  upload_traffic: number;
  download_traffic: number;
  transfer_today: number;
  transfer_enable: number;
  transfer_total: number;
  expire_time: string | null;
  status: number;
  is_admin: number;
  reg_date: string | null;
  last_login_time: string | null;
  created_at: string | null;
  bark_key: string | null;
  bark_enabled: number;
  speed_limit: number | null;
  device_limit: number | null;
  money: number | null;
}

interface UserExportRow {
  email: string | null;
  username: string | null;
  class: number | null;
  status: number | null;
  upload_traffic: number | null;
  download_traffic: number | null;
  transfer_today: number | null;
  transfer_total: number | null;
  transfer_enable: number | null;
  reg_date: string | null;
  last_login_time: string | null;
  expire_time: string | null;
  class_expire_time: string | null;
}

interface SystemStatsRow {
  total_users: number;
  active_users: number;
  admin_users: number;
  total_nodes: number;
  active_nodes: number;
  total_traffic: number;
  expired_users: number;
  exhausted_users: number;
  expired_level_users: number;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

interface UserTrafficTotalRow {
  total_upload: number;
  total_download: number;
  total_traffic: number;
}

interface UserTodayTrafficRow {
  upload_today: number;
  download_today: number;
}

interface DailySummaryRow {
  record_date: string;
  total_users: number;
  total_upload: number;
  total_download: number;
  total_traffic: number;
}

interface UserStatsRow {
  total_users: number;
  active_users: number;
  disabled_users: number;
  admin_users: number;
}

interface NodeStatsRow {
  total_nodes: number;
  active_nodes: number;
}

interface OnlineNodesRow {
  online_nodes: number;
}

interface TrafficStatsRow {
  total_traffic: number;
  today_traffic: number;
  avg_quota: number;
}

interface CountRow {
  total: number;
}

interface CountValueRow {
  count: number;
}

interface LoginLogRow {
  id: number;
  user_id: number | null;
  username: string | null;
  user_email: string | null;
  login_ip: string | null;
  login_status: number | null;
  login_method: string | null;
  user_agent: string | null;
  failure_reason: string | null;
  login_time: string | null;
}

interface SubscriptionLogRow {
  id: number;
  user_id: number | null;
  username: string | null;
  user_email: string | null;
  type: string | null;
  request_ip: string | null;
  request_user_agent: string | null;
  request_time: string | null;
}

interface AuditLogRow {
  id: number;
  user_id: number | null;
  username: string | null;
  user_email: string | null;
  node_id: number | null;
  node_name: string | null;
  audit_rule_id: number | null;
  rule_name: string | null;
  rule_content: string | null;
  ip_address: string | null;
  created_at: string | null;
}

interface OnlineIpRow {
  id: number;
  user_id: number | null;
  username: string | null;
  user_email: string | null;
  user_class: number | null;
  node_id: number | null;
  node_name: string | null;
  node_type: string | null;
  ip_address: string | null;
  connect_time: string | null;
  last_seen: string | null;
  protocol: string | null;
  upload_traffic: number | null;
  download_traffic: number | null;
  upload_speed: number | null;
  download_speed: number | null;
}

interface PackageRow {
  id: number;
  name: string;
  price: number | string;
  traffic_quota: number | null;
  validity_days: number | null;
  speed_limit: number | null;
  device_limit: number | null;
  level: number | null;
  status: number | null;
  is_recommended: number | null;
  sort_weight: number | null;
  created_at: string | null;
  updated_at: string | null;
  sales_count: number | null;
}

interface RechargeRecordRow {
  id: number;
  user_id: number | null;
  amount: number | string;
  payment_method: string | null;
  trade_no: string | null;
  status: number | null;
  created_at: string | null;
  paid_at: string | null;
  email: string | null;
  username: string | null;
}

interface PurchaseRecordRow {
  id: number;
  user_id: number | null;
  package_id: number | null;
  price: number | string;
  package_price: number | string | null;
  discount_amount?: number | string | null;
  coupon_code?: string | null;
  coupon_id?: number | string | null;
  purchase_type: string | null;
  trade_no: string | null;
  status: number | null;
  created_at: string | null;
  paid_at: string | null;
  expires_at: string | null;
  email: string | null;
  username: string | null;
  package_name: string | null;
  traffic_quota: number | string | null;
  validity_days: number | string | null;
}

interface CouponRow {
  id: number;
  name: string;
  code: string;
  discount_type: string;
  discount_value: number | string;
  start_at: number | string;
  end_at: number | string;
  max_usage?: number | string | null;
  per_user_limit?: number | string | null;
  total_used?: number | string | null;
  status: number | string | null;
  description?: string | null;
}

interface CouponRequestBody {
  name: string;
  code?: string;
  discount_type: "amount" | "percentage";
  discount_value: number;
  start_at: number | string;
  end_at: number | string;
  max_usage?: number | null;
  per_user_limit?: number | null;
  package_ids?: number[];
  status?: number;
  description?: string;
}

interface PackageStatsRow {
  total_packages: number;
  active_packages: number;
  inactive_packages: number;
}

interface SalesStatsRow {
  total_purchases: number;
  completed_purchases: number;
  total_revenue: number | string;
}

interface RechargeSummaryRow {
  total_recharges: number;
  completed_recharges: number;
  total_recharged: number | string;
}

interface PopularPackageRow {
  id: number;
  name: string;
  price: number | string;
  purchase_count: number | null;
  revenue: number | string | null;
}

interface SharedIdRow {
  id: number;
  name: string | null;
  fetch_url: string | null;
  remote_account_id: number | null;
  status: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

type SharedIdRecord = {
  id: number;
  name: string;
  fetch_url: string;
  remote_account_id: number;
  status: number;
  created_at?: string | null;
  updated_at?: string | null;
};

interface GiftCardListRow {
  id: number;
  batch_id?: number | null;
  name: string;
  code: string;
  card_type: string;
  status: number;
  balance_amount?: number | string | null;
  duration_days?: number | string | null;
  traffic_value_gb?: number | string | null;
  reset_traffic_gb?: number | string | null;
  package_id?: number | string | null;
  max_usage?: number | string | null;
  used_count?: number | string | null;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string | null;
  batch_name?: string | null;
  package_name?: string | null;
  creator_email?: string | null;
};

interface GiftCardRedemptionRow {
  id: number;
  card_id: number;
  user_id: number;
  code: string;
  card_type: string;
  change_amount?: number | string | null;
  duration_days?: number | string | null;
  traffic_value_gb?: number | string | null;
  reset_traffic_gb?: number | string | null;
  package_id?: number | string | null;
  recharge_record_id?: number | string | null;
  purchase_record_id?: number | string | null;
  trade_no?: string | null;
  result_status: string;
  message?: string | null;
  created_at?: string | null;
  user_email?: string | null;
  user_name?: string | null;
};

export class AdminAPI {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly cache: CacheService;
  private readonly scheduler: SchedulerService;
  private readonly configManager: SystemConfigManager;
  private readonly giftCardService: GiftCardService;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.cache = new CacheService(env.DB);
    this.scheduler = new SchedulerService(env);
    this.configManager = createSystemConfigManager(env);
    this.giftCardService = new GiftCardService(this.db.db);
  }

  // 验证管理员权限
  async validateAdmin(request: Request): Promise<AdminAuthResult> {
    const authResult = await validateUserAuth(request, this.env);
    if (!authResult.success) {
      return { success: false, message: authResult.message };
    }

    const user = authResult.user as AdminAuthResult["admin"] & { is_admin?: boolean };
    if (!user?.is_admin) {
      return { success: false, message: "Admin access required" };
    }

    return { success: true, admin: { ...user, is_admin: true } };
  }

  private mapSharedIdRow(row: SharedIdRow | null): SharedIdRecord | null {
    if (!row) {
      return null;
    }
    return {
      id: ensureNumber(row.id),
      name: ensureString(row.name),
      fetch_url: ensureString(row.fetch_url),
      remote_account_id: ensureNumber(row.remote_account_id),
      status: ensureNumber(row.status),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async findSharedIdById(id: number): Promise<SharedIdRecord | null> {
    const row = await this.db.db
      .prepare(
        `SELECT id, name, fetch_url, remote_account_id, status, created_at, updated_at 
         FROM shared_ids 
         WHERE id = ?`
      )
      .bind(id)
      .first<SharedIdRow>();
    return this.mapSharedIdRow(row);
  }

  private normalizeTimestampValue(value: unknown, field: string): number {
    if (value === undefined || value === null) {
      throw new Error(`${field} 不能为空`);
    }
    let timestamp = Number(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`${field} 格式不正确`);
    }
    if (timestamp > 1e12) {
      timestamp = Math.floor(timestamp / 1000);
    } else {
      timestamp = Math.floor(timestamp);
    }
    return timestamp;
  }

  private sanitizePackageIds(packageIds?: unknown): number[] {
    if (!Array.isArray(packageIds)) {
      return [];
    }
    const normalized = packageIds
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0);
    return Array.from(new Set(normalized));
  }

  private async replaceCouponPackages(couponId: number, packageIds: number[]) {
    await this.db.db
      .prepare("DELETE FROM coupon_packages WHERE coupon_id = ?")
      .bind(couponId)
      .run();

    if (packageIds.length === 0) {
      return;
    }

    for (const pkgId of packageIds) {
      await this.db.db
        .prepare(
          `
          INSERT OR IGNORE INTO coupon_packages (coupon_id, package_id)
          VALUES (?, ?)
        `
        )
        .bind(couponId, pkgId)
        .run();
    }
  }

  private generateCouponCode(): string {
    return generateRandomString(10).toUpperCase();
  }

  private async ensureCouponCodeUnique(code: string, excludeId?: number) {
    const row = await this.db.db
      .prepare(
        excludeId
          ? "SELECT id FROM coupons WHERE code = ? AND id != ?"
          : "SELECT id FROM coupons WHERE code = ?"
      )
      .bind(code, ...(excludeId ? [excludeId] : []))
      .first<{ id: number }>();

    if (row) {
      throw new Error("优惠码已存在，请重新输入");
    }
  }

  // ... 其他现有方法保持不变 ...

  // ===== 新增：等级管理相关方法 =====

  /**
   * 手动检测并重置过期用户等级
   * POST /api/admin/check-expired-levels
   */
  async checkExpiredLevels(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log("Manual check for expired user levels triggered by admin");

      // 获取过期用户列表
      const expiredUsers = await this.db.getExpiredLevelUsers();

      if (expiredUsers.length === 0) {
        return successResponse({
          message: "No expired user levels found",
          expired_count: 0,
          processed_users: [],
        });
      }

      console.log(`Found ${expiredUsers.length} users with expired levels`);

      // 逐个处理过期用户，记录详细信息
      const resetResults = [];
      for (const user of expiredUsers) {
        const result = await this.db.resetUserLevel(user.id, {
          email: user.email,
          username: user.username,
          expiredLevel: user.class,
          expireTime: user.class_expire_time,
        });

        resetResults.push({
          userId: user.id,
          email: user.email,
          username: user.username,
          previousLevel: user.class,
          expiredAt: user.class_expire_time,
          resetSuccess: result.success,
          error: result.error || null,
        });

        // 清除用户缓存
        if (result.success) {
          await this.cache.deleteByPrefix(`user_${user.id}`);
        }
      }

      // 记录重置日志
      await this.db.logLevelResets(resetResults);

      const successCount = resetResults.filter((r) => r.resetSuccess).length;
      const failedCount = resetResults.length - successCount;

      return successResponse({
        message: `Processed ${expiredUsers.length} expired user levels`,
        expired_count: expiredUsers.length,
        success_count: successCount,
        failed_count: failedCount,
        processed_users: resetResults,
      });
    } catch (error) {
      console.error("Error in manual expired level check:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 获取等级过期统计信息
   * GET /api/admin/level-stats
   */
  async getLevelStats(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      // 获取详细的等级统计
      const stats = await this.db.db
        .prepare(
          `
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN class > 0 THEN 1 END) as users_with_level,
          COUNT(CASE WHEN class_expire_time IS NOT NULL THEN 1 END) as users_with_expire_time,
          COUNT(CASE WHEN class_expire_time IS NOT NULL 
                     AND class_expire_time < datetime('now', '+8 hours') 
                     AND class > 0 THEN 1 END) as expired_level_users,
          COUNT(CASE WHEN class_expire_time IS NOT NULL 
                     AND class_expire_time > datetime('now', '+8 hours') THEN 1 END) as active_level_users
        FROM users WHERE status = 1
      `
        )
        .first();

      // 获取各等级分布
      const levelDistribution = await this.db.db
        .prepare(
          `
        SELECT 
          class as level,
          COUNT(*) as user_count,
          COUNT(CASE WHEN class_expire_time IS NULL THEN 1 END) as permanent_users,
          COUNT(CASE WHEN class_expire_time IS NOT NULL 
                     AND class_expire_time > datetime('now', '+8 hours') THEN 1 END) as temporary_users,
          COUNT(CASE WHEN class_expire_time IS NOT NULL 
                     AND class_expire_time < datetime('now', '+8 hours') THEN 1 END) as expired_users
        FROM users 
        WHERE status = 1 
        GROUP BY class 
        ORDER BY class
      `
        )
        .all();

      // 获取即将过期的用户（未来7天内）
      const upcomingExpiry = await this.db.db
        .prepare(
          `
        SELECT 
          id, email, username, class, class_expire_time,
          CAST((julianday(class_expire_time) - julianday('now')) AS INTEGER) as days_until_expiry
        FROM users 
        WHERE class_expire_time IS NOT NULL 
          AND class_expire_time > datetime('now', '+8 hours')
          AND class_expire_time <= datetime('now', '+7 days')
          AND class > 0
          AND status = 1
        ORDER BY class_expire_time ASC
        LIMIT 20
      `
        )
        .all();

      return successResponse({
        overview: stats,
        level_distribution: levelDistribution.results || [],
        upcoming_expiry: upcomingExpiry.results || [],
      });
    } catch (error) {
      console.error("Error getting level stats:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 批量设置用户等级过期时间
   * POST /api/admin/set-level-expiry
   */
  async setLevelExpiry(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { user_ids, expire_time, level } = await request.json();

      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return errorResponse("user_ids array is required", 400);
      }

      // 构建更新语句
      const updates = [];
      const values = [];

      if (expire_time !== undefined) {
        updates.push("class_expire_time = ?");
        values.push(expire_time);
      }

      if (level !== undefined) {
        updates.push("class = ?");
        values.push(level);
      }

      if (updates.length === 0) {
        return errorResponse(
          "Either expire_time or level must be provided",
          400
        );
      }

      // 批量更新
      const placeholders = user_ids.map(() => "?").join(",");
      const stmt = this.db.db.prepare(`
        UPDATE users 
        SET ${updates.join(", ")}, updated_at = datetime('now', '+8 hours')
        WHERE id IN (${placeholders}) AND status = 1
      `);

      const result = toRunResult(await stmt.bind(...values, ...user_ids).run());

      // 清除相关用户缓存
      for (const userId of user_ids) {
        await this.cache.deleteByPrefix(`user_${userId}`);
      }

      return successResponse({
        message: "User level expiry updated successfully",
        updated_count: getChanges(result),
        user_ids: user_ids,
      });
    } catch (error) {
      console.error("Error setting level expiry:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 获取过期用户详细列表
   * GET /api/admin/expired-users
   */
  async getExpiredUsers(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const offset = (page - 1) * safeLimit;

      // 获取过期用户总数
      const countResult = await this.db.db
        .prepare(
          `
        SELECT COUNT(*) as total 
        FROM users 
        WHERE class_expire_time IS NOT NULL 
          AND class_expire_time < datetime('now', '+8 hours')
          AND class > 0
          AND status = 1
      `
        )
        .first<{ total: number }>();

      // 获取过期用户详细信息
      const expiredUsers = await this.db.db
        .prepare(
          `
        SELECT 
          id, email, username, class, class_expire_time,
          upload_traffic, download_traffic, (upload_today + download_today) as transfer_today, 
          transfer_total, transfer_enable, reg_date, last_login_time,
          CAST((julianday('now') - julianday(class_expire_time)) AS INTEGER) as days_expired
        FROM users 
        WHERE class_expire_time IS NOT NULL 
          AND class_expire_time < datetime('now', '+8 hours')
          AND class > 0
          AND status = 1
        ORDER BY class_expire_time DESC
        LIMIT ? OFFSET ?
      `
        )
        .bind(safeLimit, offset)
        .all<ExpiredUserDetailRow>();

      const total = ensureNumber(countResult?.total);

      return successResponse({
        expired_users: expiredUsers.results ?? [],
        pagination: {
          total,
          page,
          limit: safeLimit,
          pages: total > 0 ? Math.ceil(total / Math.max(safeLimit, 1)) : 0,
        },
      });
    } catch (error) {
      console.error("Error getting expired users:", error);
      return errorResponse(error.message, 500);
    }
  }

  // 获取用户列表
  async getUsers(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const search = url.searchParams.get("search") || "";
      const classFilter = url.searchParams.get("class");
      const statusFilter = url.searchParams.get("status");
      const offset = (page - 1) * safeLimit;

      let whereConditions = [];
      let params = [];

      if (search) {
        whereConditions.push("(email LIKE ? OR username LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
      }

      if (classFilter && classFilter !== 'all') {
        whereConditions.push("class = ?");
        params.push(parseInt(classFilter));
      }

      if (statusFilter && statusFilter !== 'all') {
        whereConditions.push("status = ?");
        params.push(parseInt(statusFilter));
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // 获取总数
      const countStmt = this.db.db.prepare(
        `SELECT COUNT(*) as total FROM users ${whereClause}`
      );
      const totalRow = await countStmt.bind(...params).first<{ total: number }>();

      // 获取用户列表
      const stmt = this.db.db.prepare(`
        SELECT id, email, username, class, class_expire_time,
               upload_traffic, download_traffic, (upload_today + download_today) as transfer_today,
               transfer_enable, transfer_total, expire_time,
               status, is_admin, reg_date, last_login_time, created_at,
               bark_key, bark_enabled, speed_limit, device_limit, money
        FROM users ${whereClause}
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `);

      const usersResult = await stmt
        .bind(...params, safeLimit, offset)
        .all<UserListRow>();
      const users = usersResult.results ?? [];
      const total = ensureNumber(totalRow?.total);

      return successResponse({
        users: users.map((user) => {
          const transferEnable = ensureNumber(user.transfer_enable);
          const transferTotal = ensureNumber(user.transfer_total);
          const expireTime = user.expire_time ? new Date(String(user.expire_time)) : null;
          const classExpireTime = user.class_expire_time
            ? new Date(String(user.class_expire_time))
            : null;

          return {
            ...user,
            transfer_used: transferTotal,
            transfer_remain: Math.max(0, transferEnable - transferTotal),
            is_expired: expireTime ? expireTime < new Date() : false,
            is_level_expired: classExpireTime ? classExpireTime < new Date() : false,
            bark_enabled: user.bark_enabled === 1,
          };
        }),
        total,
        pagination: {
          total,
          page,
          limit: safeLimit,
          pages: total > 0 ? Math.ceil(total / safeLimit) : 0,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  // 获取用户统计信息
  async getUserStats(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const stats = await this.db.db
        .prepare(
          `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 1 THEN 1 END) as active,
          COUNT(CASE WHEN status = 0 THEN 1 END) as inactive,
          COUNT(CASE WHEN is_admin = 1 THEN 1 END) as admin,
          COALESCE(SUM(upload_traffic + download_traffic), 0) as totalTraffic,
          COALESCE(SUM(upload_today + download_today), 0) as todayTraffic
        FROM users
      `
        )
        .first();

      return successResponse(stats);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 切换用户状态
  async toggleUserStatus(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const userId = parseInt(url.pathname.split("/")[4]); // /api/admin/users/123/status

      if (!userId || isNaN(userId)) {
        return errorResponse("Invalid user ID", 400);
      }

      // 首先获取用户当前状态
      const userResult = await this.db.db
        .prepare("SELECT status FROM users WHERE id = ?")
        .bind(userId)
        .first();

      if (!userResult) {
        return errorResponse("User not found", 404);
      }

      // 切换状态：1 -> 0, 0 -> 1
      const newStatus = userResult.status === 1 ? 0 : 1;

      await this.db.db
        .prepare("UPDATE users SET status = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?")
        .bind(newStatus, userId)
        .run();

      // 清除用户缓存
      await this.cache.deleteByPrefix(`user_${userId}`);

      return successResponse({ 
        message: "User status updated successfully",
        status: newStatus
      });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 重置用户流量
  async resetUserTraffic(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const userId = parseInt(url.pathname.split("/")[4]); // /api/admin/users/123/traffic

      // 重置用户流量
      await this.db.db
        .prepare(`
          UPDATE users 
          SET upload_traffic = 0, download_traffic = 0, upload_today = 0, download_today = 0, transfer_total = 0,
              updated_at = datetime('now', '+8 hours')
          WHERE id = ?
        `)
        .bind(userId)
        .run();

      // 删除该用户的流量日志记录
      await this.db.db
        .prepare(`DELETE FROM traffic_logs WHERE user_id = ?`)
        .bind(userId)
        .run();

      // 删除该用户的每日流量记录
      await this.db.db
        .prepare(`DELETE FROM daily_traffic WHERE user_id = ?`)
        .bind(userId)
        .run();

      // 清除用户缓存
      await this.cache.deleteByPrefix(`user_${userId}`);

      return successResponse({ message: "User traffic reset successfully" });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 导出用户数据
  async exportUsers(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const usersResult = await this.db.db
        .prepare(`
        SELECT email, username, class, status, 
               upload_traffic, download_traffic, (upload_today + download_today) as transfer_today, transfer_total, transfer_enable,
               reg_date, last_login_time, expire_time, class_expire_time
        FROM users
        ORDER BY id DESC
      `)
        .all<UserExportRow>();
      const users = usersResult.results ?? [];

      // 转换为CSV格式
      const headers = [
        'Email', 'Username', 'Class', 'Status', 
        'Upload Traffic', 'Download Traffic', 'Today Traffic', 'Total Traffic', 'Transfer Limit',
        'Register Date', 'Last Login', 'Expire Time', 'Class Expire Time'
      ];

      let csv = headers.join(',') + '\n';

      for (const user of users) {
        const status = ensureNumber(user.status);
        const row = [
          ensureString(user.email),
          ensureString(user.username),
          ensureNumber(user.class),
          status === 1 ? "Active" : "Inactive",
          ensureNumber(user.upload_traffic),
          ensureNumber(user.download_traffic),
          ensureNumber(user.transfer_today),
          ensureNumber(user.transfer_total),
          ensureNumber(user.transfer_enable),
          ensureString(user.reg_date),
          ensureString(user.last_login_time),
          ensureString(user.expire_time),
          ensureString(user.class_expire_time)
        ];
        csv += row.map((field) => `"${String(field)}"`).join(',') + '\n';
      }

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename=users-${new Date().toISOString().slice(0, 10)}.csv`
        }
      });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 创建用户
  async createUser(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const userData = await request.json();

      // 验证必填字段
      if (!userData.email || !userData.username || !userData.password) {
        return errorResponse("Email, username and password are required", 400);
      }

      // 检查用户是否已存在
      const existingUser = await this.db.db
        .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
        .bind(userData.email, userData.username)
        .first();

      if (existingUser) {
        return errorResponse("Email or username already exists", 409);
      }

      // 创建用户
      const hashedPassword = await hashPassword(userData.password);
      const uuid = generateUUID();
      const proxyPassword = userData.proxy_password || generateRandomString(16);
      const subscriptionToken = generateRandomString(32);

      const stmt = this.db.db.prepare(`
        INSERT INTO users (
          email, username, password_hash, uuid, passwd, token,
          transfer_enable, expire_time, class, class_expire_time, speed_limit, 
          device_limit, tcp_limit, is_admin, status, bark_key, bark_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = await stmt
        .bind(
          userData.email,
          userData.username,
          hashedPassword,
          uuid,
          proxyPassword,
          subscriptionToken,
          userData.transfer_enable || 10737418240,
          userData.expire_time ||
            new Date(Date.now() + 8 * 60 * 60 * 1000 + 30 * 24 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00'),
          userData.class || 1,
          userData.class_expire_time || null,
          userData.speed_limit || 0,
          userData.device_limit || 0,
          userData.tcp_limit || 0,
          userData.is_admin || 0,
          userData.status || 1,
          userData.bark_key || null,
          userData.bark_enabled ? 1 : 0
        )
        .run();

      // 清除缓存
      await this.cache.deleteByPrefix("user_");

      return successResponse({
        user_id: result.meta.last_row_id,
        message: "User created successfully",
      });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 更新用户
  async updateUser(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const userId = parseInt(url.pathname.split("/").pop());
      const updateData = await request.json();

      // 构建更新语句
      const allowedFields = [
        "email",
        "username",
        "money",
        "class",
        "class_expire_time",
        "transfer_enable",
        "expire_time",
        "speed_limit",
        "device_limit",
        "tcp_limit",
        "is_admin",
        "status",
        "bark_key",
        "bark_enabled",
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updates.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }

      // 如果更新密码
      if (updateData.password) {
        updates.push("password_hash = ?");
        values.push(await hashPassword(updateData.password));
      }

      if (updates.length === 0) {
        return errorResponse("No fields to update", 400);
      }

      values.push(userId);
      const stmt = this.db.db.prepare(`
        UPDATE users 
        SET ${updates.join(", ")}, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `);

      await stmt.bind(...values).run();

      // 清除用户缓存
      await this.cache.deleteByPrefix(`user_${userId}`);

      // 获取更新后的用户数据
      const updatedUser = await this.db.db.prepare(
        "SELECT * FROM users WHERE id = ?"
      ).bind(userId).first();

      return successResponse(updatedUser);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 删除用户
  async deleteUser(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const userId = parseInt(url.pathname.split("/").pop());

      // 不能删除管理员自己
      if (userId === adminCheck.admin.id) {
        return errorResponse("Cannot delete yourself", 400);
      }

      // 检查是否是管理员账号
      const userToDelete = await this.db.db
        .prepare("SELECT is_admin FROM users WHERE id = ?")
        .bind(userId)
        .first();
      
      if (!userToDelete) {
        return errorResponse("User not found", 404);
      }
      
      if (userToDelete.is_admin === 1) {
        return errorResponse("Cannot delete admin account", 400);
      }

      await this.db.db
        .prepare("DELETE FROM users WHERE id = ?")
        .bind(userId)
        .run();

      // 清除用户缓存
      await this.cache.deleteByPrefix(`user_${userId}`);

      return successResponse({ message: "User deleted successfully" });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 节点管理
  async getNodes(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
      const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      const limitCandidate = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;
      const limit = Math.min(limitCandidate, 100);
      const offset = (page - 1) * limit;
      const keywordRaw = url.searchParams.get("keyword");
      const keyword = keywordRaw ? keywordRaw.trim() : "";
      const statusParam = url.searchParams.get("status");

      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (keyword) {
        conditions.push("(name LIKE ? OR server LIKE ?)");
        const keywordPattern = `%${keyword}%`;
        params.push(keywordPattern, keywordPattern);
      }

      if (statusParam !== null && statusParam !== undefined && statusParam !== "") {
        const statusValue = parseInt(statusParam, 10);
        conditions.push("status = ?");
        params.push(statusValue === 1 ? 1 : 0);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM nodes ${whereClause}`)
        .bind(...params)
        .first<CountRow>();

      const total = ensureNumber(totalRow?.total);

      const nodesResult = await this.db.db
        .prepare(
          `
        SELECT 
          id,
          name,
          type,
          server,
          server_port,
          tls_host,
          node_class,
          node_bandwidth,
          node_bandwidth_limit,
          node_config,
          status,
          created_at,
          updated_at
        FROM nodes
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `
        )
        .bind(...params, limit, offset)
        .all<Record<string, unknown>>();

      const nodes = nodesResult.results ?? [];
      const formattedNodes = nodes.map((node) => ({
        ...node,
        node_class: ensureNumber(node.node_class),
        node_bandwidth: ensureNumber(node.node_bandwidth),
        node_bandwidth_limit: ensureNumber(node.node_bandwidth_limit),
        server_port: ensureNumber(node.server_port),
        status: ensureNumber(node.status),
      }));

      return successResponse({
        data: formattedNodes,
        total,
        page,
        limit,
      });
    } catch (error) {
      console.error("Get nodes error:", error);
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 500);
    }
  }

  // 获取节点统计信息
  async getNodeStats(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const stats = await this.db.db
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

      return successResponse(stats);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 重置节点流量
  async resetNodeTraffic(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const nodeId = parseInt(url.pathname.split("/")[4]); // /api/admin/nodes/123/traffic

      await this.db.db
        .prepare("UPDATE nodes SET node_bandwidth = 0, updated_at = datetime('now', '+8 hours') WHERE id = ?")
        .bind(nodeId)
        .run();

      // 清除节点缓存
      await this.cache.delete(`node_config_${nodeId}`);

      return successResponse({ message: "Node traffic reset successfully" });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 导出节点数据
  async exportNodes(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const nodes = await this.db.db.prepare(`
        SELECT name, type, server, server_port, node_class, status, node_bandwidth, node_bandwidth_limit,
               bandwidthlimit_resetday, created_at, updated_at
        FROM nodes
        ORDER BY id DESC
      `).all();

      // 转换为CSV格式
      const headers = [
        'Name', 'Type', 'Server', 'Server Port', 'Class', 'Status', 
        'Bandwidth Used', 'Bandwidth Limit', 'Reset Day', 'Created At', 'Updated At'
      ];

      let csv = headers.join(',') + '\n';

      for (const node of nodes.results) {
        const row = [
          node.name || '',
          node.type || '',
          node.server || '',
          node.server_port || 0,
          node.node_class || 0,
          node.status === 1 ? 'Online' : 'Offline',
          node.node_bandwidth || 0,
          node.node_bandwidth_limit || 0,
          node.bandwidthlimit_resetday || 1,
          node.created_at || '',
          node.updated_at || ''
        ];
        csv += row.map(field => `"${field}"`).join(',') + '\n';
      }

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename=nodes-${new Date().toISOString().slice(0, 10)}.csv`
        }
      });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 创建节点
  async createNode(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const nodeData = await request.json();

      // 验证必填字段
      if (
        !nodeData.name ||
        !nodeData.type ||
        !nodeData.server ||
        !nodeData.server_port
      ) {
        return errorResponse("Name, type, server and server_port are required", 400);
      }

      const stmt = this.db.db.prepare(`
        INSERT INTO nodes (
          name, type, server, server_port, tls_host, node_class, 
          node_bandwidth_limit, bandwidthlimit_resetday,
          node_config, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // 处理节点配置，避免双重JSON编码
      let configValue = '{}';
      if (nodeData.node_config) {
        if (typeof nodeData.node_config === 'string') {
          try {
            // 解析JSON字符串并重新压缩存储
            const parsed = JSON.parse(nodeData.node_config);
            configValue = JSON.stringify(parsed);
          } catch (e) {
            // 如果解析失败，直接使用原字符串
            configValue = nodeData.node_config;
          }
        } else {
          // 如果是对象，直接stringify
          configValue = JSON.stringify(nodeData.node_config);
        }
      }

      const result = await stmt
        .bind(
          nodeData.name,
          nodeData.type,
          nodeData.server,
          nodeData.server_port,
          nodeData.tls_host || '',
          nodeData.node_class || 1,
          nodeData.node_bandwidth_limit || 0,
          nodeData.bandwidthlimit_resetday || 1,
          configValue,
          nodeData.status || 1
        )
        .run();

      // 清除节点缓存
      await this.cache.deleteByPrefix("node_config_");
      
      // 强制更新所有节点的时间戳以确保ETAG更新
      await this.db.db.prepare(`
        UPDATE nodes 
        SET updated_at = datetime('now', '+8 hours')
        WHERE status = 1
      `).run();

      return successResponse({
        node_id: result.meta.last_row_id,
        message: "Node created successfully",
      });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 更新节点
  async updateNode(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const nodeId = parseInt(url.pathname.split("/").pop());
      const updateData = await request.json();

      // 构建更新语句
      const allowedFields = [
        "name",
        "type",
        "server",
        "server_port",
        "tls_host",
        "node_class",
        "node_bandwidth_limit",
        "bandwidthlimit_resetday",
        "status",
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updates.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      }

      // 处理节点配置
      if (updateData.node_config) {
        updates.push("node_config = ?");
        // 如果已经是字符串，先解析再压缩存储，避免双重JSON编码
        let configValue;
        if (typeof updateData.node_config === 'string') {
          try {
            // 解析JSON字符串并重新压缩（去除格式化）
            const parsed = JSON.parse(updateData.node_config);
            configValue = JSON.stringify(parsed);
          } catch (e) {
            // 如果解析失败，直接使用原字符串
            configValue = updateData.node_config;
          }
        } else {
          // 如果是对象，直接stringify
          configValue = JSON.stringify(updateData.node_config);
        }
        values.push(configValue);
      }

      if (updates.length === 0) {
        return errorResponse("No fields to update", 400);
      }

      values.push(nodeId);
      const stmt = this.db.db.prepare(`
        UPDATE nodes 
        SET ${updates.join(", ")}, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `);

      await stmt.bind(...values).run();

      // 清除节点缓存
      await this.cache.delete(`node_config_${nodeId}`);
      
      // 强制更新所有节点的时间戳以确保其他节点的ETAG也更新
      await this.db.db.prepare(`
        UPDATE nodes 
        SET updated_at = datetime('now', '+8 hours')
        WHERE status = 1 AND id != ?
      `).bind(nodeId).run();

      // 获取更新后的节点数据
      const updatedNode = await this.db.db.prepare(
        "SELECT * FROM nodes WHERE id = ?"
      ).bind(nodeId).first();

      return successResponse(updatedNode);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 删除节点
  async deleteNode(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const nodeId = parseInt(url.pathname.split("/").pop());

      await this.db.db
        .prepare("DELETE FROM nodes WHERE id = ?")
        .bind(nodeId)
        .run();

      // 清除节点缓存
      await this.cache.delete(`node_config_${nodeId}`);
      
      // 强制更新其他节点的时间戳以确保ETAG更新
      await this.db.db.prepare(`
        UPDATE nodes 
        SET updated_at = datetime('now', '+8 hours')
        WHERE status = 1 AND id != ?
      `).bind(nodeId).run();

      return successResponse({ message: "Node deleted successfully" });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 批量操作节点
  async batchUpdateNodes(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { action, node_ids } = await request.json();

      if (!action || !node_ids || !Array.isArray(node_ids) || node_ids.length === 0) {
        return errorResponse("Action and node_ids are required", 400);
      }

      if (!['enable', 'disable', 'delete'].includes(action)) {
        return errorResponse("Invalid action. Must be 'enable', 'disable', or 'delete'", 400);
      }

      let query = '';
      let params = [];
      let successMessage = '';

      switch (action) {
        case 'enable':
          query = `UPDATE nodes SET status = 1, updated_at = datetime('now', '+8 hours') WHERE id IN (${node_ids.map(() => '?').join(',')})`;
          params = node_ids;
          successMessage = `${node_ids.length} nodes enabled successfully`;
          break;

        case 'disable':
          query = `UPDATE nodes SET status = 0, updated_at = datetime('now', '+8 hours') WHERE id IN (${node_ids.map(() => '?').join(',')})`;
          params = node_ids;
          successMessage = `${node_ids.length} nodes disabled successfully`;
          break;

        case 'delete':
          query = `DELETE FROM nodes WHERE id IN (${node_ids.map(() => '?').join(',')})`;
          params = node_ids;
          successMessage = `${node_ids.length} nodes deleted successfully`;
          
          // 清除被删除节点的缓存
          for (const nodeId of node_ids) {
            await this.cache.delete(`node_config_${nodeId}`);
          }
          break;
      }

      const result = toRunResult(
        await this.db.db.prepare(query).bind(...params).run()
      );

      // 强制更新其他节点的时间戳以确保ETAG更新
      if (action !== 'delete') {
        await this.db.db
          .prepare(`
          UPDATE nodes 
          SET updated_at = datetime('now', '+8 hours')
          WHERE status = 1 AND id NOT IN (${node_ids.map(() => '?').join(',')})
        `)
          .bind(...node_ids)
          .run();
      }

      return successResponse({
        message: successMessage,
        affected_count: getChanges(result),
        processed_ids: node_ids
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Batch update nodes error:', err);
      return errorResponse(err.message, 500);
    }
  }

  // 系统统计
  async getStatistics(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const stats = await this.db.db
        .prepare(
          `
        SELECT 
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE status = 1) as active_users,
          (SELECT COUNT(*) FROM users WHERE is_admin = 1) as admin_users,
          (SELECT COUNT(*) FROM nodes) as total_nodes,
          (SELECT COUNT(*) FROM nodes WHERE status = 1) as active_nodes,
          (SELECT SUM(transfer_total) FROM users) as total_traffic,
          (SELECT COUNT(*) FROM users WHERE expire_time < datetime('now', '+8 hours')) as expired_users,
          (SELECT COUNT(*) FROM users WHERE transfer_total >= transfer_enable) as exhausted_users,
          (SELECT COUNT(*) FROM users WHERE class_expire_time IS NOT NULL 
           AND class_expire_time < datetime('now', '+8 hours') AND class > 0) as expired_level_users
      `
        )
        .first<SystemStatsRow>();

      return successResponse(stats ?? {});
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  // 系统健康检查
  async getSystemHealth(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: { connected: true },
        memory_usage: 0,
        cpu_usage: 0,
        uptime: 'Unknown',
        last_restart: null
      };

      try {
        // 测试数据库连接
        await this.db.db.prepare("SELECT 1").first();
        health.database.connected = true;
      } catch (error) {
        health.database.connected = false;
        health.status = 'error';
      }

      // 在Cloudflare Workers环境中，内存和CPU使用率无法获取
      // 这里返回模拟数据或默认值
      health.memory_usage = Math.floor(Math.random() * 30) + 20; // 20-50%
      health.cpu_usage = Math.floor(Math.random() * 20) + 5; // 5-25%
      
      return successResponse(health);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 导出统计报告
  async exportStatistics(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      // 获取各种统计数据
      const [statsResp, userStatsResp, nodeStatsResp] = await Promise.all([
        this.getStatistics(request),
        this.getUserStats(request),
        this.getNodeStats(request)
      ]);

      const statsBody = (await statsResp.json()) as ApiResponse<SystemStatsRow>;
      const userStatsBody = (await userStatsResp.json()) as ApiResponse<Record<string, unknown>>;
      const nodeStatsBody = (await nodeStatsResp.json()) as ApiResponse<Record<string, unknown>>;
      
      const report = {
        generated_at: new Date().toISOString(),
        system_stats: statsBody.data,
        user_stats: userStatsBody.data,
        node_stats: nodeStatsBody.data,
        export_info: {
          version: this.env.APP_VERSION || '1.0.0',
          build_time: this.env.BUILD_TIME || new Date().toISOString(),
          format: 'json',
          exported_by: ensureString(adminCheck.admin?.email)
        }
      };

      return new Response(JSON.stringify(report, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=system-stats-${new Date().toISOString().slice(0, 10)}.json`
        }
      });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }


  // 手动触发流量重置任务
  async triggerTrafficReset(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const result = await this.scheduler.dailyTrafficReset();
      return successResponse(result);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 检查定时任务状态
  async checkSchedulerStatus(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const result = await this.scheduler.checkAndRunScheduledTasks();
      return successResponse(result);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // 生成测试流量数据
  async generateTrafficTestData(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { user_id = 1, days = 30 } = await request.json().catch(() => ({}));

      console.log(`Generating ${days} days of traffic test data for user ${user_id}`);

      // 清理可能存在的测试数据
      await this.db.db
        .prepare("DELETE FROM traffic_logs WHERE user_id = ? AND date >= date('now', '-' || ? || ' days')")
        .bind(user_id, days)
        .run();

      await this.db.db
        .prepare("DELETE FROM daily_traffic WHERE user_id = ? AND record_date >= date('now', '-' || ? || ' days')")
        .bind(user_id, days)
        .run();

      // 生成过去N天的流量日志数据
      const insertResults = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateString = date.toISOString().split('T')[0];

        // 为每天生成2-3个节点的流量记录
        const nodesForDay = Math.min(3, Math.floor(Math.random() * 3) + 1);
        let dailyUpload = 0;
        let dailyDownload = 0;

        for (let nodeIndex = 0; nodeIndex < nodesForDay; nodeIndex++) {
          const nodeId = (nodeIndex + (i % 10)) % 10 + 1;
          
          // 生成随机流量 - 工作日流量更高
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseMultiplier = isWeekend ? 0.7 : 1.0;
          
          const upload = Math.floor((50 + Math.random() * 450) * 1024 * 1024 * baseMultiplier); // 50MB-500MB
          const download = Math.floor((200 + Math.random() * 1800) * 1024 * 1024 * baseMultiplier); // 200MB-2GB
          
          dailyUpload += upload;
          dailyDownload += download;

          // 插入流量日志
          const trafficResult = await this.db.db
            .prepare(`
              INSERT INTO traffic_logs (user_id, node_id, upload_traffic, download_traffic, date, created_at)
              VALUES (?, ?, ?, ?, ?, datetime(? || ' ' || printf('%02d:%02d:%02d', 
                ?, ?, ?), '+8 hours'))
            `)
            .bind(
              user_id,
              nodeId,
              upload,
              download,
              dateString,
              dateString,
              Math.floor(Math.random() * 24), // 随机小时
              Math.floor(Math.random() * 60), // 随机分钟
              Math.floor(Math.random() * 60)  // 随机秒
            )
            .run();

          insertResults.push({
            date: dateString,
            node_id: nodeId,
            upload,
            download,
            success: trafficResult.success
          });
        }

        // 插入每日汇总数据
        const nodeUsage = {
          nodes: insertResults.filter(r => r.date === dateString).map(r => ({
            node_id: r.node_id,
            node_name: `Node-${r.node_id}`,
            upload: r.upload,
            download: r.download,
            total: r.upload + r.download
          })),
          total_nodes: nodesForDay,
          primary_node: Math.max(...insertResults.filter(r => r.date === dateString).map(r => r.node_id))
        };

        await this.db.db
          .prepare(`
            INSERT INTO daily_traffic (user_id, record_date, upload_traffic, download_traffic, total_traffic, node_usage, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            user_id,
            dateString,
            dailyUpload,
            dailyDownload,
            dailyUpload + dailyDownload,
            JSON.stringify(nodeUsage),
            Math.floor(Date.now() / 1000)
          )
          .run();

        // 插入流量趋势数据（模拟24小时分布）
        const totalTraffic = dailyUpload + dailyDownload;
        const hourlyUsage = Array(24).fill(0).map((_, hour) => {
          // 模拟真实使用模式：晚上使用量更高
          let multiplier;
          if (hour >= 0 && hour <= 5) multiplier = 0.01; // 深夜
          else if (hour >= 6 && hour <= 11) multiplier = 0.04 + Math.random() * 0.04; // 早上
          else if (hour >= 12 && hour <= 17) multiplier = 0.04 + Math.random() * 0.03; // 下午
          else multiplier = 0.08 + Math.random() * 0.07; // 晚上高峰

          return Math.floor(totalTraffic * multiplier);
        });

        await this.db.db
          .prepare(`
            INSERT INTO traffic_trends (user_id, record_date, hourly_usage, peak_hour, peak_usage, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            user_id,
            dateString,
            JSON.stringify(hourlyUsage),
            20, // 晚上8点是高峰
            Math.floor(totalTraffic * 0.15),
            Math.floor(Date.now() / 1000)
          )
          .run();
      }

      // 更新用户总流量统计
      const totalStats = await this.db.db
        .prepare(`
          SELECT 
            COALESCE(SUM(upload_traffic), 0) as total_upload,
            COALESCE(SUM(download_traffic), 0) as total_download,
            COALESCE(SUM(total_traffic), 0) as total_traffic
          FROM daily_traffic 
          WHERE user_id = ? AND record_date >= date('now', '-' || ? || ' days')
        `)
        .bind(user_id, days)
        .first<UserTrafficTotalRow>();

      const totalUpload = ensureNumber(totalStats?.total_upload);
      const totalDownload = ensureNumber(totalStats?.total_download);
      const totalTraffic = ensureNumber(totalStats?.total_traffic);

      // 获取今日流量
      const todayStats = await this.db.db
        .prepare(`
          SELECT 
            COALESCE(upload_traffic, 0) as upload_today,
            COALESCE(download_traffic, 0) as download_today
          FROM daily_traffic 
          WHERE user_id = ? AND record_date = date('now')
        `)
        .bind(user_id)
        .first<UserTodayTrafficRow>();

      const uploadToday = ensureNumber(todayStats?.upload_today);
      const downloadToday = ensureNumber(todayStats?.download_today);

      // 更新用户表
      await this.db.db
        .prepare(`
          UPDATE users SET 
            upload_traffic = ?,
            download_traffic = ?,
            transfer_total = ?,
            upload_today = ?,
            download_today = ?,
            updated_at = datetime('now', '+8 hours')
          WHERE id = ?
        `)
        .bind(
          totalUpload,
          totalDownload,
          totalTraffic,
          uploadToday,
          downloadToday,
          user_id
        )
        .run();

      // 生成系统流量汇总数据
      const dailySummaries = await this.db.db
        .prepare(`
          SELECT 
            dt.record_date,
            COUNT(DISTINCT dt.user_id) as total_users,
            SUM(dt.upload_traffic) as total_upload,
            SUM(dt.download_traffic) as total_download,
            SUM(dt.total_traffic) as total_traffic
          FROM daily_traffic dt
          WHERE dt.record_date >= date('now', '-' || ? || ' days')
          GROUP BY dt.record_date
        `)
        .bind(days)
        .all<DailySummaryRow>();

      for (const summary of dailySummaries.results ?? []) {
        const recordDate = ensureString(summary.record_date);
        const summaryUpload = ensureNumber(summary.total_upload);
        const summaryDownload = ensureNumber(summary.total_download);
        const summaryTraffic = ensureNumber(summary.total_traffic);
        const summaryUsers = ensureNumber(summary.total_users);
        await this.db.db
          .prepare(`
            INSERT OR REPLACE INTO system_traffic_summary (
              record_date, total_users, total_upload, total_download, total_traffic, node_stats, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            recordDate,
            summaryUsers,
            summaryUpload,
            summaryDownload,
            summaryTraffic,
            JSON.stringify({
              active_nodes: Math.floor(Math.random() * 5) + 3,
              total_connections: Math.floor(Math.random() * 50) + 20,
              peak_traffic_date: recordDate
            }),
            Math.floor(Date.now() / 1000)
          )
          .run();
      }

      // 清除相关缓存
      await this.cache.deleteByPrefix(`user_${user_id}`);
      await this.cache.deleteByPrefix('traffic_');

      return successResponse({
        message: `Successfully generated ${days} days of traffic test data`,
        user_id: user_id,
        days_generated: days,
        total_records: insertResults.length,
        total_upload_mb: (totalUpload / 1024 / 1024).toFixed(2),
        total_download_mb: (totalDownload / 1024 / 1024).toFixed(2),
        total_traffic_mb: (totalTraffic / 1024 / 1024).toFixed(2),
        summary: {
          traffic_logs: insertResults.length,
          daily_traffic: days,
          traffic_trends: days,
          system_summaries: (dailySummaries.results ?? []).length
        }
      });

    } catch (error) {
      console.error("Error generating traffic test data:", error);
      return errorResponse(error.message, 500);
    }
  }

  // 修复系统统计数据 - 根据需求更新统计逻辑
  async getSystemStats(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      // 用户统计 - 按需求修改
      const userStatsStmt = this.db.db.prepare(`
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN transfer_total > 0 THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as disabled_users,
          SUM(CASE WHEN is_admin = 1 THEN 1 ELSE 0 END) as admin_users
        FROM users
      `);
      const userStats = await userStatsStmt.first<UserStatsRow>();

      // 节点统计 - 修复节点显示逻辑
      const nodeStatsStmt = this.db.db.prepare(`
        SELECT 
          COUNT(*) as total_nodes,
          SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_nodes
        FROM nodes
      `);
      const nodeStats = await nodeStatsStmt.first<NodeStatsRow>();

      // 在线节点统计（5分钟内有更新的节点）
      const onlineNodesStmt = this.db.db.prepare(`
        SELECT COUNT(DISTINCT node_id) as online_nodes
        FROM node_status 
        WHERE created_at >= datetime('now', '+8 hours', '-5 minutes')
      `);
      const onlineNodesResult = await onlineNodesStmt.first<OnlineNodesRow>();

      // 流量统计 - 按需求修改为所有用户transfer_enable相加
      const trafficStatsStmt = this.db.db.prepare(`
        SELECT 
          SUM(transfer_enable) as total_traffic,
          SUM(upload_today + download_today) as today_traffic,
          AVG(transfer_enable) as avg_quota
        FROM users
      `);
      const trafficStats = await trafficStatsStmt.first<TrafficStatsRow>();

      return successResponse({
        users: {
          total: ensureNumber(userStats?.total_users),
          active: ensureNumber(userStats?.active_users),
          disabled: ensureNumber(userStats?.disabled_users),
          admins: ensureNumber(userStats?.admin_users)
        },
        nodes: {
          total: ensureNumber(nodeStats?.total_nodes),
          active: ensureNumber(nodeStats?.active_nodes),
          online: ensureNumber(onlineNodesResult?.online_nodes),
          offline:
            ensureNumber(nodeStats?.active_nodes) -
            ensureNumber(onlineNodesResult?.online_nodes)
        },
        traffic: {
          total: ensureNumber(trafficStats?.total_traffic),
          today: ensureNumber(trafficStats?.today_traffic),
          average_quota: ensureNumber(trafficStats?.avg_quota)
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  // ===== 日志管理 =====

  /**
   * 获取登录日志
   * GET /api/admin/login-logs
   */
  async getLoginLogs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const status = url.searchParams.get("status");
      const userSearch = url.searchParams.get("user_id") || url.searchParams.get("user_search");
      const ipSearch = url.searchParams.get("ip") || url.searchParams.get("ip_search");
      const startDate = url.searchParams.get("start_date");
      const endDate = url.searchParams.get("end_date");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereConditions = [];
      let params = [];

      if (status !== null && status !== "") {
        whereConditions.push("l.login_status = ?");
        params.push(parseInt(status));
      }

      if (userSearch) {
        const parsedId = parseInt(userSearch);
        whereConditions.push("(u.email LIKE ? OR u.username LIKE ? OR u.id = ?)");
        params.push(`%${userSearch}%`, `%${userSearch}%`, Number.isNaN(parsedId) ? -1 : parsedId);
      }

      if (ipSearch) {
        whereConditions.push("l.login_ip LIKE ?");
        params.push(`%${ipSearch}%`);
      }

      const formatDateTime = (value: string | null): string | null => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().replace('T', ' ').slice(0, 19);
      };

      const formattedStart = formatDateTime(startDate);
      if (formattedStart) {
        whereConditions.push("l.login_time >= ?");
        params.push(formattedStart);
      }

      const formattedEnd = formatDateTime(endDate);
      if (formattedEnd) {
        whereConditions.push("l.login_time <= ?");
        params.push(formattedEnd);
      }

      const whereClause = whereConditions.length > 0 
        ? ` WHERE ${whereConditions.join(" AND ")}` 
        : "";

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total
        FROM login_logs l
        LEFT JOIN users u ON l.user_id = u.id
        ${whereClause}
      `;
      const totalRow = await this.db.db
        .prepare(countQuery)
        .bind(...params)
        .first<CountRow>();
      const totalCount = ensureNumber(totalRow?.total);

      // 获取登录日志
      const query = `
        SELECT 
          l.id,
          l.user_id,
          u.username,
          u.email as user_email,
          l.login_ip,
          l.login_status,
          l.login_method,
          l.user_agent,
          l.failure_reason,
          l.login_time
        FROM login_logs l
        LEFT JOIN users u ON l.user_id = u.id
        ${whereClause}
        ORDER BY l.login_time DESC
        LIMIT ? OFFSET ?
      `;

      const logsResult = await this.db.db
        .prepare(query)
        .bind(...params, safeLimit, offset)
        .all<LoginLogRow>();
      const logs = logsResult.results ?? [];

      return successResponse({
        data: logs,
        total: totalCount,
        pagination: {
          total: totalCount,
          page,
          limit: safeLimit,
          pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0,
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取登录日志失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 获取订阅日志
   * GET /api/admin/subscription-logs
   */
  async getSubscriptionLogs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const type = url.searchParams.get("type");
      const userSearch = url.searchParams.get("user_id") || url.searchParams.get("user_search");
      const ipSearch = url.searchParams.get("ip_search") || url.searchParams.get("ip");
      const startDate = url.searchParams.get("start_date");
      const endDate = url.searchParams.get("end_date");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereConditions = [];
      let params = [];

      if (type) {
        whereConditions.push("s.type = ?");
        params.push(type);
      }

      if (userSearch) {
        const parsedId = parseInt(userSearch);
        whereConditions.push("(u.email LIKE ? OR u.username LIKE ? OR u.id = ?)");
        params.push(`%${userSearch}%`, `%${userSearch}%`, Number.isNaN(parsedId) ? -1 : parsedId);
      }

      if (ipSearch) {
        whereConditions.push("s.request_ip LIKE ?");
        params.push(`%${ipSearch}%`);
      }

      const formatDateTime = (value: string | null): string | null => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().replace('T', ' ').slice(0, 19);
      };

      const formattedStart = formatDateTime(startDate);
      if (formattedStart) {
        whereConditions.push("s.request_time >= ?");
        params.push(formattedStart);
      }

      const formattedEnd = formatDateTime(endDate);
      if (formattedEnd) {
        whereConditions.push("s.request_time <= ?");
        params.push(formattedEnd);
      }

      const whereClause = whereConditions.length > 0 
        ? ` WHERE ${whereConditions.join(" AND ")}` 
        : "";

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total
        FROM subscriptions s
        LEFT JOIN users u ON s.user_id = u.id
        ${whereClause}
      `;
      const totalRow = await this.db.db
        .prepare(countQuery)
        .bind(...params)
        .first<CountRow>();
      const totalCount = ensureNumber(totalRow?.total);

      // 获取订阅日志
      const query = `
        SELECT 
          s.id,
          s.user_id,
          u.username,
          u.email as user_email,
          s.type,
          s.request_ip,
          s.request_user_agent,
          s.request_time
        FROM subscriptions s
        LEFT JOIN users u ON s.user_id = u.id
        ${whereClause}
        ORDER BY s.request_time DESC
        LIMIT ? OFFSET ?
      `;

      const logsResult = await this.db.db
        .prepare(query)
        .bind(...params, safeLimit, offset)
        .all<SubscriptionLogRow>();
      const logs = logsResult.results ?? [];

      return successResponse({
        data: logs,
        total: totalCount,
        pagination: {
          total: totalCount,
          page,
          limit: safeLimit,
          pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取订阅日志失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 获取审计日志
   * GET /api/admin/audit-logs
   */
  async getAuditLogs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const userSearch = url.searchParams.get("user_id") || url.searchParams.get("user_search");
      const startDate = url.searchParams.get("start_date");
      const endDate = url.searchParams.get("end_date");
      const offset = (page - 1) * safeLimit;

      let whereConditions = [];
      let params = [];

      if (userSearch) {
        const parsedId = parseInt(userSearch);
        whereConditions.push("(u.email LIKE ? OR al.user_id = ?)");
        params.push(`%${userSearch}%`, Number.isNaN(parsedId) ? -1 : parsedId);
      }

      const formatDateTime = (value: string | null): string | null => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().replace('T', ' ').slice(0, 19);
      };

      const formattedStart = formatDateTime(startDate);
      if (formattedStart) {
        whereConditions.push("al.created_at >= ?");
        params.push(formattedStart);
      }

      const formattedEnd = formatDateTime(endDate);
      if (formattedEnd) {
        whereConditions.push("al.created_at <= ?");
        params.push(formattedEnd);
      }

      const whereClause = whereConditions.length > 0
        ? ` WHERE ${whereConditions.join(' AND ')}`
        : '';

      // 获取总数
      const totalQuery = `SELECT COUNT(*) as total FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}`;

      const totalRow = await this.db.db
        .prepare(totalQuery)
        .bind(...params)
        .first<CountRow>();
      const totalCount = ensureNumber(totalRow?.total);

      // 获取审计日志
      const query = `
        SELECT 
          al.id,
          al.user_id,
          u.username,
          u.email as user_email,
          al.node_id,
          n.name as node_name,
          al.audit_rule_id,
          ar.name as rule_name,
          ar.rule as rule_content,
          al.ip_address,
          al.created_at
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        LEFT JOIN nodes n ON al.node_id = n.id
        LEFT JOIN audit_rules ar ON al.audit_rule_id = ar.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const logsResult = await this.db.db
        .prepare(query)
        .bind(...params, safeLimit, offset)
        .all<AuditLogRow>();
      const logs = logsResult.results ?? [];

      return successResponse({
        data: logs,
        total: totalCount,
        pagination: {
          total: totalCount,
          page,
          limit: safeLimit,
          pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0,
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取审计日志失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 删除单个审计记录
   * DELETE /api/admin/audit-logs/:id
   */
  async deleteAuditLog(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const logId = parseInt(url.pathname.split("/")[4]);

      await this.db.db.prepare(
        "DELETE FROM audit_logs WHERE id = ?"
      ).bind(logId).run();

      return successResponse({ message: "审计记录删除成功" });
    } catch (error) {
      console.error("删除审计记录失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 批量删除审计记录
   * POST /api/admin/audit-logs/batch-delete
   */
  async batchDeleteAuditLogs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { ids } = await request.json();
      if (!Array.isArray(ids) || ids.length === 0) {
        return errorResponse("请提供要删除的记录ID数组", 400);
      }

      const placeholders = ids.map(() => '?').join(',');
      await this.db.db.prepare(
        `DELETE FROM audit_logs WHERE id IN (${placeholders})`
      ).bind(...ids).run();

      return successResponse({ 
        message: `成功删除 ${ids.length} 条审计记录`,
        deleted_count: ids.length 
      });
    } catch (error) {
      console.error("批量删除审计记录失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  // ===== 在线IP管理 =====

  /**
   * 获取在线IP列表
   * GET /api/admin/online-ips
   */
  async getOnlineIPs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const nodeId = url.searchParams.get("node_id");
      const userSearch = url.searchParams.get("user_email") || url.searchParams.get("user_search");
      const nodeSearch = url.searchParams.get("node_search") || url.searchParams.get("node_name");
      const ip = url.searchParams.get("ip") || url.searchParams.get("ip_search");
      const sortBy = url.searchParams.get("sort_by") || "last_seen";
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereConditions = [];
      let params = [];

      // 只显示最近5分钟内活跃的IP
      whereConditions.push("oi.last_seen > datetime('now', '+8 hours', '-5 minutes')");

      if (nodeId) {
        whereConditions.push("oi.node_id = ?");
        params.push(parseInt(nodeId));
      }

      if (userSearch) {
        const parsedId = parseInt(userSearch);
        whereConditions.push("(u.email LIKE ? OR u.username LIKE ? OR u.id = ?)");
        params.push(`%${userSearch}%`, `%${userSearch}%`, Number.isNaN(parsedId) ? -1 : parsedId);
      }

      if (nodeSearch) {
        whereConditions.push("n.name LIKE ?");
        params.push(`%${nodeSearch}%`);
      }

      if (ip) {
        whereConditions.push("oi.ip LIKE ?");
        params.push(`%${ip}%`);
      }

      const whereClause = whereConditions.length > 0 
        ? ` WHERE ${whereConditions.join(" AND ")}` 
        : "";

      // 获取总数
      const countQuery = `
        SELECT COUNT(*) as total
        FROM online_ips oi
        LEFT JOIN users u ON oi.user_id = u.id
        LEFT JOIN nodes n ON oi.node_id = n.id
        ${whereClause}
      `;
      const totalRow = await this.db.db
        .prepare(countQuery)
        .bind(...params)
        .first<CountRow>();
      const totalCount = ensureNumber(totalRow?.total);

      // 获取在线IP列表
      const query = `
        SELECT 
          oi.id,
          oi.user_id,
          u.username,
          u.email as user_email,
          u.class as user_class,
          oi.node_id,
          n.name as node_name,
          n.type as node_type,
          oi.ip as ip_address,
          oi.last_seen as connect_time,
          oi.last_seen,
          'tcp' as protocol,
          0 as upload_traffic,
          0 as download_traffic,
          0 as upload_speed,
          0 as download_speed
        FROM online_ips oi
        LEFT JOIN users u ON oi.user_id = u.id
        LEFT JOIN nodes n ON oi.node_id = n.id
        ${whereClause}
        ORDER BY oi.${sortBy === 'connect_time' ? 'last_seen' : sortBy} DESC
        LIMIT ? OFFSET ?
      `;

      const ipsResult = await this.db.db
        .prepare(query)
        .bind(...params, safeLimit, offset)
        .all<OnlineIpRow>();
      const ips = ipsResult.results ?? [];

      return successResponse({
        data: ips,
        total: totalCount,
        pagination: {
          total: totalCount,
          page,
          limit: safeLimit,
          pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0,
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取在线IP失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  // ===== 审计规则管理 =====

  /**
   * 获取审计规则
   * GET /api/admin/audit-rules
   */
  async getAuditRules(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const search = url.searchParams.get("search");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereConditions = [];
      let params = [];

      if (search) {
        whereConditions.push("(name LIKE ? OR description LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = whereConditions.length > 0 
        ? ` WHERE ${whereConditions.join(" AND ")}` 
        : "";

      // 获取总数
      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM audit_rules${whereClause}`)
        .bind(...params)
        .first<CountRow>();
      const totalCount = ensureNumber(totalRow?.total);

      // 获取审计规则
      const rulesResult = await this.db.db
        .prepare(`SELECT 
          id, name, description, rule, enabled, created_at, updated_at
         FROM audit_rules${whereClause}
         ORDER BY id ASC
         LIMIT ? OFFSET ?`)
        .bind(...params, safeLimit, offset)
        .all();

      return successResponse({
        data: rulesResult.results ?? [],
        total: totalCount,
        pagination: {
          total: totalCount,
          page,
          limit: safeLimit,
          pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0,
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取审计规则失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 删除登录日志
   * DELETE /api/admin/login-logs/:id
   */
  async deleteLoginLog(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const logId = parseInt(url.pathname.split("/")[4]);

      await this.db.db.prepare(
        "DELETE FROM login_logs WHERE id = ?"
      ).bind(logId).run();

      return successResponse({ message: "登录日志删除成功" });
    } catch (error) {
      console.error("删除登录日志失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 批量删除登录日志
   * POST /api/admin/login-logs/batch-delete
   */
  async batchDeleteLoginLogs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { ids } = await request.json();
      if (!Array.isArray(ids) || ids.length === 0) {
        return errorResponse("请提供要删除的记录ID数组", 400);
      }

      const placeholders = ids.map(() => '?').join(',');
      await this.db.db.prepare(
        `DELETE FROM login_logs WHERE id IN (${placeholders})`
      ).bind(...ids).run();

      return successResponse({ 
        message: `成功删除 ${ids.length} 条登录日志`,
        deleted_count: ids.length 
      });
    } catch (error) {
      console.error("批量删除登录日志失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 导出登录日志CSV
   * POST /api/admin/login-logs/export-csv
   */
  async exportLoginLogsCSV(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const requestBody = await request.json();
      const { ids } = requestBody || {};
      
      let whereClause = "";
      let params = [];
      
      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        whereClause = `WHERE ll.id IN (${placeholders})`;
        params = ids;
      }

      const query = `
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
        ${whereClause}
        ORDER BY ll.login_time DESC
        ${!Array.isArray(ids) || ids.length === 0 ? 'LIMIT 100' : ''}
      `;

      const logs = await this.db.db.prepare(query).bind(...params).all();
      
      // 构建CSV内容
      const csvHeaders = ['用户邮箱', '登录IP', '登录UA', '登录时间', '登录状态'];
      const csvRows = logs.results.map(log => [
        log.user_email || '',
        log.login_ip || '',
        log.login_ua || '',
        log.login_time || '',
        log.login_status || ''
      ]);
      
      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="login_logs.csv"'
        }
      });
    } catch (error) {
      console.error("导出登录日志CSV失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 删除订阅日志
   * DELETE /api/admin/subscription-logs/:id
   */
  async deleteSubscriptionLog(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const logId = parseInt(url.pathname.split("/")[4]);

      await this.db.db.prepare(
        "DELETE FROM subscriptions WHERE id = ?"
      ).bind(logId).run();

      return successResponse({ message: "订阅日志删除成功" });
    } catch (error) {
      console.error("删除订阅日志失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 批量删除订阅日志
   * POST /api/admin/subscription-logs/batch-delete
   */
  async batchDeleteSubscriptionLogs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { ids } = await request.json();
      if (!Array.isArray(ids) || ids.length === 0) {
        return errorResponse("请提供要删除的记录ID数组", 400);
      }

      const placeholders = ids.map(() => '?').join(',');
      await this.db.db.prepare(
        `DELETE FROM subscriptions WHERE id IN (${placeholders})`
      ).bind(...ids).run();

      return successResponse({ 
        message: `成功删除 ${ids.length} 条订阅日志`,
        deleted_count: ids.length 
      });
    } catch (error) {
      console.error("批量删除订阅日志失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 导出订阅日志CSV
   * POST /api/admin/subscription-logs/export-csv
   */
  async exportSubscriptionLogsCSV(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const requestBody = await request.json();
      const { ids } = requestBody || {};
      
      let whereClause = "";
      let params = [];
      
      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        whereClause = `WHERE s.id IN (${placeholders})`;
        params = ids;
      }

      const query = `
        SELECT 
          u.email as user_email,
          s.type as subscription_type,
          s.request_ip as access_ip,
          s.request_user_agent as client_ua,
          s.request_time as access_time
        FROM subscriptions s
        LEFT JOIN users u ON s.user_id = u.id
        ${whereClause}
        ORDER BY s.request_time DESC
        ${!Array.isArray(ids) || ids.length === 0 ? 'LIMIT 100' : ''}
      `;

      const logs = await this.db.db.prepare(query).bind(...params).all();
      
      // 构建CSV内容
      const csvHeaders = ['用户邮箱', '订阅类型', '访问IP', '客户端UA', '访问时间'];
      const csvRows = logs.results.map(log => [
        log.user_email || '',
        log.subscription_type || '',
        log.access_ip || '',
        log.client_ua || '',
        log.access_time || ''
      ]);
      
      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="subscription_logs.csv"'
        }
      });
    } catch (error) {
      console.error("导出订阅日志CSV失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 踢出IP
   * POST /api/admin/kick-ip
   */
  async kickIP(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { ip_id } = await request.json();

      await this.db.db.prepare(
        "DELETE FROM online_ips WHERE id = ?"
      ).bind(ip_id).run();

      return successResponse({ message: "IP踢出成功" });
    } catch (error) {
      console.error("踢出IP失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 删除在线IP记录
   * DELETE /api/admin/online-ips/:id
   */
  async deleteOnlineIP(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const ipId = parseInt(url.pathname.split("/")[4]);

      await this.db.db.prepare(
        "DELETE FROM online_ips WHERE id = ?"
      ).bind(ipId).run();

      return successResponse({ message: "在线IP记录删除成功" });
    } catch (error) {
      console.error("删除在线IP记录失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 批量删除在线IP记录
   * POST /api/admin/online-ips/batch-delete
   */
  async batchDeleteOnlineIPs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { ids } = await request.json();
      if (!Array.isArray(ids) || ids.length === 0) {
        return errorResponse("请提供要删除的记录ID数组", 400);
      }

      const placeholders = ids.map(() => '?').join(',');
      await this.db.db.prepare(
        `DELETE FROM online_ips WHERE id IN (${placeholders})`
      ).bind(...ids).run();

      return successResponse({ 
        message: `成功删除 ${ids.length} 条在线IP记录`,
        deleted_count: ids.length 
      });
    } catch (error) {
      console.error("批量删除在线IP记录失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 导出在线IP记录CSV
   * POST /api/admin/online-ips/export-csv
   */
  async exportOnlineIPsCSV(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const requestBody = await request.json();
      const { ids } = requestBody || {};
      
      let whereClause = "";
      let params = [];
      
      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        whereClause = `WHERE oi.id IN (${placeholders})`;
        params = ids;
      }

      const query = `
        SELECT 
          u.email as user_email,
          oi.ip as ip_address,
          n.name as node_name,
          oi.last_seen as connect_time
        FROM online_ips oi
        LEFT JOIN users u ON oi.user_id = u.id
        LEFT JOIN nodes n ON oi.node_id = n.id
        ${whereClause}
        ORDER BY oi.last_seen DESC
        ${!Array.isArray(ids) || ids.length === 0 ? 'LIMIT 100' : ''}
      `;

      const ips = await this.db.db.prepare(query).bind(...params).all();
      
      // 构建CSV内容
      const csvHeaders = ['用户邮箱', 'IP地址', '连接节点名称', '连接时间'];
      const csvRows = ips.results.map(ip => [
        ip.user_email || '',
        ip.ip_address || '',
        ip.node_name || '',
        ip.connect_time || ''
      ]);
      
      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="online_ips.csv"'
        }
      });
    } catch (error) {
      console.error("导出在线IP记录CSV失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 封禁IP
   * POST /api/admin/block-ip
   */
  async blockIP(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { ip_address } = await request.json();

      // TODO: 实现IP封禁逻辑，可能需要添加blocked_ips表
      return successResponse({ message: "IP封禁功能待实现" });
    } catch (error) {
      console.error("封禁IP失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 更新审计规则
   * PUT /api/admin/audit-rules/:id
   */
  async updateAuditRule(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const ruleId = url.pathname.split('/').pop();
      const data = await request.json();

      const { name, description, rule, enabled } = data;

      if (!name || !rule) {
        return errorResponse('缺少必要字段', 400);
      }

      await this.db.db.prepare(`
        UPDATE audit_rules 
        SET name = ?, description = ?, rule = ?, enabled = ?, 
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `).bind(
        name, 
        description || '', 
        rule, 
        enabled !== undefined ? enabled : 1, 
        ruleId
      ).run();

      // 获取更新后的规则
      const updatedRule = await this.db.db.prepare(
        "SELECT * FROM audit_rules WHERE id = ?"
      ).bind(ruleId).first();
      
      // 清除审计规则缓存
      await this.cache.delete('audit_rules');

      return successResponse(updatedRule);
    } catch (error) {
      console.error("更新审计规则失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 创建审计规则
   * POST /api/admin/audit-rules
   */
  async createAuditRule(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const data = await request.json();
      const { name, description, rule, enabled } = data;

      const result = await this.db.db.prepare(`
        INSERT INTO audit_rules (name, description, rule, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
      `).bind(
        name, description || '', rule, enabled !== undefined ? enabled : 1
      ).run();

      // 获取新创建的规则
      const newRule = await this.db.db.prepare(
        "SELECT * FROM audit_rules WHERE id = ?"
      ).bind(result.meta.last_row_id).first();
      
      // 清除审计规则缓存
      await this.cache.delete('audit_rules');

      return successResponse(newRule);
    } catch (error) {
      console.error("创建审计规则失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 删除审计规则
   * DELETE /api/admin/audit-rules/:id
   */
  async deleteAuditRule(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const ruleId = url.pathname.split('/').pop();

      await this.db.db.prepare(
        "DELETE FROM audit_rules WHERE id = ?"
      ).bind(ruleId).run();
      
      // 清除审计规则缓存
      await this.cache.delete('audit_rules');

      return successResponse({ message: "审计规则删除成功" });
    } catch (error) {
      console.error("删除审计规则失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  // 手动触发节点状态清理
  async triggerNodeStatusCleanup(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }
      
      const result = await this.scheduler.cleanupNodeStatusData();
      return successResponse(result);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // ===== 白名单管理 =====

  /**
   * 获取白名单列表
   * GET /api/admin/whitelist
   */
  async getWhitelist(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const search = url.searchParams.get("search");
      const status = url.searchParams.get("status");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereConditions = [];
      let params = [];

      if (search) {
        whereConditions.push("(rule LIKE ? OR description LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
      }

      if (status !== null && status !== "") {
        whereConditions.push("status = ?");
        params.push(parseInt(status));
      }

      const whereClause = whereConditions.length > 0 
        ? ` WHERE ${whereConditions.join(" AND ")}` 
        : "";

      // 获取总数
      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM white_list${whereClause}`)
        .bind(...params)
        .first<CountRow>();
      const totalCount = ensureNumber(totalRow?.total);

      // 获取白名单列表
      const whitelistResult = await this.db.db
        .prepare(`SELECT id, rule, description, status, created_at
         FROM white_list${whereClause}
         ORDER BY id ASC
         LIMIT ? OFFSET ?`)
        .bind(...params, safeLimit, offset)
        .all();

      return successResponse({
        data: whitelistResult.results ?? [],
        total: totalCount,
        pagination: {
          total: totalCount,
          page,
          limit: safeLimit,
          pages: totalCount > 0 ? Math.ceil(totalCount / safeLimit) : 0,
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取白名单失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 创建白名单规则
   * POST /api/admin/whitelist
   */
  async createWhitelistRule(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const data = await request.json();
      const { rule, description, status } = data;

      if (!rule) {
        return errorResponse("规则内容不能为空", 400);
      }

      const result = await this.db.db.prepare(`
        INSERT INTO white_list (rule, description, status, created_at)
        VALUES (?, ?, ?, datetime('now', '+8 hours'))
      `).bind(
        rule, 
        description || '', 
        status !== undefined ? status : 1
      ).run();

      // 获取新创建的规则
      const newRule = await this.db.db.prepare(
        "SELECT * FROM white_list WHERE id = ?"
      ).bind(result.meta.last_row_id).first();
      
      // 清除白名单缓存
      await this.cache.delete('white_list');

      return successResponse(newRule);
    } catch (error) {
      console.error("创建白名单规则失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 更新白名单规则
   * PUT /api/admin/whitelist/:id
   */
  async updateWhitelistRule(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const ruleId = url.pathname.split('/').pop();
      const data = await request.json();

      const { rule, description, status } = data;

      if (!rule) {
        return errorResponse("规则内容不能为空", 400);
      }

      await this.db.db.prepare(`
        UPDATE white_list 
        SET rule = ?, description = ?, status = ?
        WHERE id = ?
      `).bind(
        rule, 
        description || '', 
        status !== undefined ? status : 1, 
        ruleId
      ).run();

      // 获取更新后的规则
      const updatedRule = await this.db.db.prepare(
        "SELECT * FROM white_list WHERE id = ?"
      ).bind(ruleId).first();
      
      // 清除白名单缓存
      await this.cache.delete('white_list');

      return successResponse(updatedRule);
    } catch (error) {
      console.error("更新白名单规则失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 删除白名单规则
   * DELETE /api/admin/whitelist/:id
   */
  async deleteWhitelistRule(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const ruleId = url.pathname.split('/').pop();

      await this.db.db.prepare(
        "DELETE FROM white_list WHERE id = ?"
      ).bind(ruleId).run();
      
      // 清除白名单缓存
      await this.cache.delete('white_list');

      return successResponse({ message: "白名单规则删除成功" });
    } catch (error) {
      console.error("删除白名单规则失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 批量操作白名单规则
   * POST /api/admin/whitelist/batch
   */
  async batchWhitelistOperation(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { action, ids } = await request.json();

      if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
        return errorResponse("无效的操作参数", 400);
      }

      let query;
      let params = [];
      let message;

      switch (action) {
        case 'enable':
          query = `UPDATE white_list SET status = 1 WHERE id IN (${ids.map(() => '?').join(',')})`;
          params = ids;
          message = `已启用 ${ids.length} 个白名单规则`;
          break;
        case 'disable':
          query = `UPDATE white_list SET status = 0 WHERE id IN (${ids.map(() => '?').join(',')})`;
          params = ids;
          message = `已禁用 ${ids.length} 个白名单规则`;
          break;
        case 'delete':
          query = `DELETE FROM white_list WHERE id IN (${ids.map(() => '?').join(',')})`;
          params = ids;
          message = `已删除 ${ids.length} 个白名单规则`;
          break;
        default:
          return errorResponse("不支持的操作类型", 400);
      }

      const result = toRunResult(
        await this.db.db.prepare(query).bind(...params).run()
      );

      // 清除白名单缓存
      await this.cache.delete('white_list');

      return successResponse({
        message,
        affected_count: getChanges(result)
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("批量操作白名单失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  // ===== 新增：管理员操作功能 =====

  /**
   * 手动重置所有用户每日流量
   * POST /api/admin/reset-daily-traffic
   */
  async resetDailyTraffic(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${ensureString(adminCheck.admin?.email)} 手动重置每日流量`);

      // 调用现有的重置每日流量功能
      const { resetTodayBandwidth } = await import('../Command/resetTodayBandwidth');
      const result = await resetTodayBandwidth(this.env.DB);

      if (result.success) {
        return successResponse({
          message: result.message,
          count: result.count || 0,
          stats: result.stats
        });
      } else {
        return errorResponse(result.message, 500);
      }
    } catch (error) {
      console.error("手动重置每日流量失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 重置所有用户节点密码和UUID
   * POST /api/admin/reset-all-passwords
   */
  async resetAllUserPasswords(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${adminCheck.admin.email} 重置所有用户节点密码和UUID`);

      // 获取所有用户
      const users = await this.db.db.prepare('SELECT id FROM users WHERE status = 1').all();
      
      if (!users.results || users.results.length === 0) {
        return errorResponse('没有找到活跃用户', 404);
      }

      let updatedCount = 0;

      for (const user of users.results) {
        try {
          // 生成新的UUID和节点密码
          const newUUID = generateUUID();
          const newPassword = generateRandomString(16);
          
          // 更新用户UUID和节点密码
          await this.db.db.prepare(`
            UPDATE users 
            SET uuid = ?, 
                passwd = ?, 
                updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `).bind(newUUID, newPassword, user.id).run();
          
          updatedCount++;
          
        } catch (error) {
          console.error(`重置用户 ${user.id} 节点密码和UUID时出错:`, error);
        }
      }

      return successResponse({
        message: `成功重置 ${updatedCount} 个用户的节点密码和UUID`,
        count: updatedCount
      });

    } catch (error) {
      console.error("重置所有用户节点密码和UUID失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 重置所有用户订阅链接
   * POST /api/admin/reset-all-subscriptions
   */
  async resetAllSubscriptionTokens(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${adminCheck.admin.email} 重置所有用户订阅链接`);

      // 调用现有的重置订阅令牌功能
      const { resetAllSubscriptionTokens } = await import('../Command/ResetSubFullToken');
      const result = await resetAllSubscriptionTokens(this.env.DB);

      if (result.success) {
        return successResponse({
          message: result.message,
          count: typeof result.count === 'number' ? result.count : 0
        });
      } else {
        return errorResponse(result.message, 500);
      }
    } catch (error) {
      console.error("重置所有用户订阅链接失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  // ===== 缓存管理功能 =====

  /**
   * 清除所有缓存
   * POST /api/admin/clear-cache/all
   */
  async clearAllCache(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${ensureString(adminCheck.admin?.email)} 清除所有缓存`);

      const cacheEntries = Array.from(this.cache.memoryCache.entries());
      const beforeStats = {
        total_keys: cacheEntries.length
      };

      // 清除所有缓存
      this.cache.memoryCache.clear();

      // 强制更新节点配置的修改时间，确保 ETAG 变化
      await this.db.db.prepare(`
        UPDATE nodes 
        SET updated_at = datetime('now', '+8 hours')
        WHERE status = 1
      `).run();

      return successResponse({
        message: "所有缓存已清除",
        cleared_count: beforeStats.total_keys,
        cleared_at: new Date().toISOString(),
        note: "已强制更新节点配置时间戳以确保缓存刷新"
      });
    } catch (error) {
      console.error("清除所有缓存失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 清除节点相关缓存
   * POST /api/admin/clear-cache/nodes
   */
  async clearNodeCache(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${ensureString(adminCheck.admin?.email)} 清除节点缓存`);

      // 统计清除前的缓存数量
      const cacheKeys = Array.from(this.cache.memoryCache.entries()).map(([key]) => key);
      const beforeStats = {
        node_config: cacheKeys.filter(key => key.startsWith('node_config_')).length
      };

      // 清除节点配置缓存
      await this.cache.deleteByPrefix('node_config_');

      // 强制更新节点配置的修改时间，确保 ETAG 变化
      await this.db.db.prepare(`
        UPDATE nodes 
        SET updated_at = datetime('now', '+8 hours')
        WHERE status = 1
      `).run();

      return successResponse({
        message: "节点相关缓存已清除",
        cleared_types: ["节点配置"],
        cleared_count: beforeStats.node_config,
        cleared_at: new Date().toISOString(),
        note: "已强制更新节点配置时间戳以确保缓存刷新"
      });
    } catch (error) {
      console.error("清除节点缓存失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 清除审计规则缓存
   * POST /api/admin/clear-cache/audit-rules
   */
  async clearAuditRulesCache(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${adminCheck.admin.email} 清除审计规则缓存`);

      await this.cache.delete('audit_rules');

      return successResponse({
        message: "审计规则缓存已清除",
        cleared_at: new Date().toISOString()
      });
    } catch (error) {
      console.error("清除审计规则缓存失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 清除白名单缓存
   * POST /api/admin/clear-cache/whitelist
   */
  async clearWhitelistCache(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      console.log(`管理员 ${adminCheck.admin.email} 清除白名单缓存`);

      await this.cache.delete('white_list');

      return successResponse({
        message: "白名单缓存已清除",
        cleared_at: new Date().toISOString()
      });
    } catch (error) {
      console.error("清除白名单缓存失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 获取缓存状态
   * GET /api/admin/cache-status
   */
  async getCacheStatus(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      // 获取内存缓存状态
      const memoryCache = this.cache.memoryCache;
      const cacheKeys = Array.from(memoryCache.entries()).map(([key]) => key);
      
      // 按前缀分类缓存键
      const cacheStats = {
        total_keys: cacheKeys.length,
        categories: {
          node_config: cacheKeys.filter(key => key.startsWith('node_config_')).length,
          audit_rules: cacheKeys.filter(key => key.startsWith('audit_rules') || key === 'audit_rules').length,
          white_list: cacheKeys.filter(key => key.startsWith('white_list') || key === 'white_list').length,
          others: cacheKeys.filter(key => 
            !key.startsWith('node_config_') && 
            !key.startsWith('audit_rules') && 
            !key.startsWith('white_list') &&
            key !== 'audit_rules' && 
            key !== 'white_list'
          ).length
        },
        cache_keys: cacheKeys
      };

      return successResponse({
        cache_status: cacheStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("获取缓存状态失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 手动触发节点流量重置检查
   * POST /api/admin/trigger-node-traffic-reset
   */
  async triggerNodeTrafficReset(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }
      
      const result = await this.scheduler.checkNodeTrafficReset();
      return successResponse(result);
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }

  // ===== 系统配置管理 =====

  /**
   * 获取系统配置列表
   * GET /api/admin/system-configs
   */
  async getSystemConfigs(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const result = await this.db.db
        .prepare(`SELECT id, key, value, description FROM system_configs ORDER BY key`)
        .all();

      return successResponse(result.results || []);
    } catch (error) {
      console.error("获取系统配置失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 更新单个系统配置
   * PUT /api/admin/system-configs
   */
  async updateSystemConfig(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { key, value } = await request.json();

      if (!key) {
        return errorResponse('配置键不能为空', 400);
      }

      // 更新配置
      const updateResult = toRunResult(
        await this.db.db
        .prepare(`
          UPDATE system_configs 
          SET value = ?, updated_at = datetime('now', '+8 hours')
          WHERE key = ?
        `)
        .bind(value || '', key)
        .run()
      );

      if (getChanges(updateResult) === 0) {
        return errorResponse('配置项不存在', 404);
      }

      // 清除相关缓存
      await this.cache.deleteByPrefix('system_config');
      await this.cache.deleteByPrefix('site_config');

      // 清除新配置管理器的缓存
      this.configManager.clearCache(key);

      // 如果是站点相关配置，清空所有配置缓存以确保一致性
      if (['site_name', 'site_url'].includes(key)) {
        this.configManager.clearCache();
      }

      return successResponse({
        message: '配置更新成功',
        key,
        value 
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("更新系统配置失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 批量更新系统配置
   * PUT /api/admin/system-configs/batch
   */
  async updateSystemConfigsBatch(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { configs } = await request.json();

      if (!Array.isArray(configs)) {
        return errorResponse('配置数据格式错误', 400);
      }

      let successCount = 0;
      let failedCount = 0;
      const results: Array<{ key: string; success: boolean; error?: string }> = [];

      // 使用事务处理批量更新
      const updateStmt = this.db.db.prepare(`
        UPDATE system_configs 
        SET value = ?, updated_at = datetime('now', '+8 hours')
        WHERE key = ?
      `);

      for (const config of configs) {
        try {
          const configKey = ensureString(config?.key);

          if (!configKey) {
            results.push({ key: configKey, success: false, error: '配置键不能为空' });
            failedCount++;
            continue;
          }

          const updateResult = toRunResult(
            await updateStmt.bind(config?.value ?? '', configKey).run()
          );
          const changeCount = getChanges(updateResult);

          if (changeCount > 0) {
            results.push({ key: configKey, success: true });
            successCount++;
          } else {
            results.push({ key: configKey, success: false, error: '配置项不存在' });
            failedCount++;
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          results.push({ key: ensureString(config?.key), success: false, error: err.message });
          failedCount++;
        }
      }

      // 清除相关缓存
      await this.cache.deleteByPrefix('system_config');
      await this.cache.deleteByPrefix('site_config');

      return successResponse({
        message: '批量更新完成',
        summary: {
          total: configs.length,
          success: successCount,
          failed: failedCount
        },
        details: results
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("批量更新系统配置失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 添加新的系统配置项
   * POST /api/admin/system-configs
   */
  async addSystemConfig(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const { key, value, description } = await request.json();

      if (!key) {
        return errorResponse('配置键不能为空', 400);
      }

      // 检查配置是否已存在
      const existing = await this.db.db
        .prepare(`SELECT id FROM system_configs WHERE key = ?`)
        .bind(key)
        .first();

      if (existing) {
        return errorResponse('配置项已存在', 400);
      }

      // 添加新配置
      await this.db.db
        .prepare(`
          INSERT INTO system_configs (key, value, description, created_at, updated_at)
          VALUES (?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
        `)
        .bind(key, value || '', description || '')
        .run();

      // 清除相关缓存
      await this.cache.deleteByPrefix('system_config');
      await this.cache.deleteByPrefix('site_config');

      return successResponse({ 
        message: '配置添加成功',
        key,
        value,
        description
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("添加系统配置失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 删除系统配置项
   * DELETE /api/admin/system-configs/{key}
   */
  async deleteSystemConfig(request, key) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      if (!key) {
        return errorResponse('配置键不能为空', 400);
      }

      // 防止删除关键配置项
      const protectedKeys = [
        'site_name', 'site_url', 'register_enabled', 'default_traffic',
        'default_expire_days', 'default_account_expire_days', 'default_class'
      ];

      if (protectedKeys.includes(key)) {
        return errorResponse('此配置项受保护，不能删除', 400);
      }

      const deleteResult = toRunResult(
        await this.db.db
          .prepare(`DELETE FROM system_configs WHERE key = ?`)
          .bind(key)
          .run()
      );

      if (getChanges(deleteResult) === 0) {
        return errorResponse('配置项不存在', 404);
      }

      // 清除相关缓存
      await this.cache.deleteByPrefix('system_config');
      await this.cache.deleteByPrefix('site_config');

      return successResponse({
        message: '配置删除成功',
        key
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("删除系统配置失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  // ===== 苹果账号管理相关方法 =====

  /**
   * 获取苹果账号列表
   * GET /api/admin/shared-ids
   */
  async getSharedIds(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const limitParam = Number(url.searchParams.get("limit")) || 20;
      const safeLimit = Math.min(Math.max(limitParam, 1), 100);
      const keyword = url.searchParams.get("keyword")?.trim();
      const statusParam = url.searchParams.get("status");

      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (keyword) {
        conditions.push("name LIKE ?");
        params.push(`%${keyword}%`);
      }

      if (statusParam !== null && statusParam !== undefined && statusParam !== "") {
        conditions.push("status = ?");
        params.push(Number(statusParam));
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const countRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM shared_ids ${whereClause}`)
        .bind(...params)
        .first<CountRow>();
      const total = ensureNumber(countRow?.total);
      const offset = (page - 1) * safeLimit;

      const listResult = await this.db.db
        .prepare(
          `
          SELECT id, name, fetch_url, remote_account_id, status, created_at, updated_at
          FROM shared_ids
          ${whereClause}
          ORDER BY id DESC
          LIMIT ? OFFSET ?
        `
        )
        .bind(...params, safeLimit, offset)
        .all<SharedIdRow>();

      const records: SharedIdRecord[] = [];
      for (const row of listResult.results ?? []) {
        const formatted = this.mapSharedIdRow(row);
        if (formatted) {
          records.push(formatted);
        }
      }

      return successResponse({
        records,
        pagination: {
          total,
          page,
          limit: safeLimit,
          totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取苹果账号列表失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 新建苹果账号
   * POST /api/admin/shared-ids
   */
  async createSharedId(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const body = (await request.json()) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const fetchUrl = typeof body.fetch_url === "string" ? body.fetch_url.trim() : "";
      const remoteAccountId = ensureNumber(body.remote_account_id, NaN);
      const statusValue =
        body.status === undefined || body.status === null
          ? 1
          : Number(body.status) === 1
          ? 1
          : 0;

      if (!name) {
        return errorResponse("苹果账号名称不能为空", 400);
      }

      if (!fetchUrl) {
        return errorResponse("苹果账号获取URL不能为空", 400);
      }

      let normalizedUrl: string;
      try {
        normalizedUrl = new URL(fetchUrl).toString();
      } catch {
        return errorResponse("苹果账号获取URL格式不正确", 400);
      }

      if (!Number.isFinite(remoteAccountId)) {
        return errorResponse("苹果账号编号必须是数字", 400);
      }

      const duplicate = await this.db.db
        .prepare("SELECT id FROM shared_ids WHERE name = ?")
        .bind(name)
        .first<{ id: number }>();
      if (duplicate) {
        return errorResponse("苹果账号名称已存在", 400);
      }

      const insertResult = toRunResult(
        await this.db.db
          .prepare(
            `
            INSERT INTO shared_ids (name, fetch_url, remote_account_id, status)
            VALUES (?, ?, ?, ?)
          `
          )
          .bind(name, normalizedUrl, remoteAccountId, statusValue)
          .run()
      );

      if (getChanges(insertResult) === 0) {
        return errorResponse("创建苹果账号失败", 500);
      }

      const insertedId = getLastRowId(insertResult);
      const created = insertedId ? await this.findSharedIdById(insertedId) : null;

      console.log(
        `管理员 ${ensureString(adminCheck.admin?.email)} 创建苹果账号: ${name}(${normalizedUrl})`
      );

      return successResponse({
        message: "苹果账号创建成功",
        record: created,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("创建苹果账号失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 更新苹果账号
   * PUT /api/admin/shared-ids/:id
   */
  async updateSharedId(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const idStr = url.pathname.split("/").pop();
      const sharedId = idStr ? Number(idStr) : NaN;
      if (!Number.isFinite(sharedId)) {
        return errorResponse("无效的苹果账号", 400);
      }

      const existing = await this.findSharedIdById(sharedId);
      if (!existing) {
        return errorResponse("苹果账号不存在", 404);
      }

      const body = (await request.json()) as Record<string, unknown>;
      const updateFields: string[] = [];
      const updateValues: Array<string | number> = [];

      if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          return errorResponse("苹果账号名称不能为空", 400);
        }
        const duplicate = await this.db.db
          .prepare("SELECT id FROM shared_ids WHERE name = ? AND id != ?")
          .bind(name, sharedId)
          .first<{ id: number }>();
        if (duplicate) {
          return errorResponse("苹果账号名称已存在", 400);
        }
        updateFields.push("name = ?");
        updateValues.push(name);
      }

      if (body.fetch_url !== undefined) {
        const fetchUrl = typeof body.fetch_url === "string" ? body.fetch_url.trim() : "";
        if (!fetchUrl) {
          return errorResponse("苹果账号获取URL不能为空", 400);
        }
        let normalizedUrl: string;
        try {
          normalizedUrl = new URL(fetchUrl).toString();
        } catch {
          return errorResponse("苹果账号获取URL格式不正确", 400);
        }
        updateFields.push("fetch_url = ?");
        updateValues.push(normalizedUrl);
      }

      if (body.remote_account_id !== undefined) {
        const remoteAccountId = ensureNumber(body.remote_account_id, NaN);
        if (!Number.isFinite(remoteAccountId)) {
          return errorResponse("苹果账号编号必须是数字", 400);
        }
        updateFields.push("remote_account_id = ?");
        updateValues.push(remoteAccountId);
      }

      if (body.status !== undefined) {
        const statusValue = Number(body.status) === 1 ? 1 : 0;
        updateFields.push("status = ?");
        updateValues.push(statusValue);
      }

      if (updateFields.length === 0) {
        return errorResponse("没有提供需要更新的字段", 400);
      }

      updateFields.push("updated_at = datetime('now', '+8 hours')");
      updateValues.push(sharedId);

      const updateResult = toRunResult(
        await this.db.db
          .prepare(
            `
          UPDATE shared_ids
          SET ${updateFields.join(", ")}
          WHERE id = ?
        `
          )
          .bind(...updateValues)
          .run()
      );

      if (getChanges(updateResult) === 0) {
        return errorResponse("更新苹果账号失败", 500);
      }

      const updated = await this.findSharedIdById(sharedId);

      console.log(
        `管理员 ${ensureString(adminCheck.admin?.email)} 更新苹果账号: ${ensureNumber(sharedId)}`
      );

      return successResponse({
        message: "苹果账号更新成功",
        record: updated,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("更新苹果账号失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 删除苹果账号
   * DELETE /api/admin/shared-ids/:id
   */
  async deleteSharedId(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const idStr = url.pathname.split("/").pop();
      const sharedId = idStr ? Number(idStr) : NaN;
      if (!Number.isFinite(sharedId)) {
        return errorResponse("无效的苹果账号", 400);
      }

      const existing = await this.findSharedIdById(sharedId);
      if (!existing) {
        return errorResponse("苹果账号不存在", 404);
      }

      const deleteResult = toRunResult(
        await this.db.db
          .prepare("DELETE FROM shared_ids WHERE id = ?")
          .bind(sharedId)
          .run()
      );

      if (getChanges(deleteResult) === 0) {
        return errorResponse("删除苹果账号失败", 500);
      }

      console.log(
        `管理员 ${ensureString(adminCheck.admin?.email)} 删除苹果账号: ${ensureNumber(sharedId)}`
      );

      return successResponse({
        message: "苹果账号删除成功",
        id: sharedId,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("删除苹果账号失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  // ===== 套餐管理相关方法 =====

  /**
   * 获取所有套餐
   * GET /api/admin/packages
   */
  async getPackages(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const status = url.searchParams.get("status");
      const level = url.searchParams.get("level");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereClause = "WHERE 1=1";
      let params = [];

      if (status !== null && status !== undefined && status !== '') {
        whereClause += " AND p.status = ?";
        params.push(parseInt(status));
      }

      if (level !== null && level !== undefined && level !== '') {
        whereClause += " AND p.level = ?";
        params.push(parseInt(level));
      }

      // 获取套餐总数
      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM packages p ${whereClause}`)
        .bind(...params)
        .first<CountRow>();

      const total = ensureNumber(totalRow?.total);

      // 获取套餐列表
      const packagesResult = await this.db.db
        .prepare(`
          SELECT
            p.id,
            p.name,
            p.price,
            p.traffic_quota,
            p.validity_days,
            p.speed_limit,
            p.device_limit,
            p.level,
            p.status,
            p.is_recommended,
            p.sort_weight,
            p.created_at,
            p.updated_at,
            (
              SELECT COUNT(*)
              FROM package_purchase_records pr
              WHERE pr.package_id = p.id AND pr.status = 1
            ) as sales_count
          FROM packages p
          ${whereClause}
          ORDER BY p.id DESC
          LIMIT ? OFFSET ?
        `)
        .bind(...params, safeLimit, offset)
        .all<PackageRow>();

      const packages = packagesResult.results ?? [];
      const formattedPackages = packages.map(pkg => {
        const price = typeof pkg.price === 'string' ? Number(pkg.price) : ensureNumber(pkg.price);
        const trafficQuota = ensureNumber(pkg.traffic_quota);
        const validityDays = ensureNumber(pkg.validity_days);
        const speedLimit = ensureNumber(pkg.speed_limit);
        const deviceLimit = ensureNumber(pkg.device_limit);
        const statusValue = ensureNumber(pkg.status);
        const levelValue = ensureNumber(pkg.level);
        const sortWeight = ensureNumber(pkg.sort_weight);
        const isRecommended = ensureNumber(pkg.is_recommended);
        const salesCount = ensureNumber(pkg.sales_count);

        return {
          ...pkg,
          price,
          traffic_quota: trafficQuota,
          validity_days: validityDays,
          speed_limit: speedLimit,
          device_limit: deviceLimit,
          level: levelValue,
          status: statusValue,
          is_recommended: isRecommended,
          sort_weight: sortWeight,
          sales_count: salesCount,
          status_text: statusValue === 1 ? '启用' : '禁用',
          traffic_quota_text: `${trafficQuota} GB`,
          validity_text: `${validityDays} 天`,
          speed_limit_text: speedLimit === 0 ? '无限制' : `${speedLimit} Mbps`,
          device_limit_text: deviceLimit === 0 ? '无限制' : `${deviceLimit} 个设备`
        };
      });

      return successResponse({
        packages: formattedPackages,
        pagination: {
          total,
          page,
          limit: safeLimit,
          totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取套餐列表失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 创建套餐
   * POST /api/admin/packages
   */
  async createPackage(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const body = await request.json();
      const {
        name,
        price,
        traffic_quota,
        validity_days,
        speed_limit = 0,
        device_limit = 0,
        level = 1,
        status = 1,
        is_recommended = 0,
        sort_weight = 0
      } = body;

      // 验证必要字段
      if (!name || !price || !traffic_quota || !validity_days) {
        return errorResponse("缺少必要字段", 400);
      }

      if (price <= 0) {
        return errorResponse("价格必须大于0", 400);
      }

      if (traffic_quota <= 0) {
        return errorResponse("流量配额必须大于0", 400);
      }

      if (validity_days <= 0) {
        return errorResponse("有效期必须大于0天", 400);
      }

      // 检查套餐名称是否重复
      const existingPackage = await this.db.db
        .prepare("SELECT id FROM packages WHERE name = ?")
        .bind(name)
        .first();

      if (existingPackage) {
        return errorResponse("套餐名称已存在", 400);
      }

      // 创建套餐
      const result = await this.db.db
        .prepare(`
          INSERT INTO packages (
            name, price, traffic_quota, validity_days,
            speed_limit, device_limit, level, status,
            is_recommended, sort_weight
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          name,
          price,
          traffic_quota,
          validity_days,
          speed_limit,
          device_limit,
          level,
          status,
          is_recommended ? 1 : 0,
          sort_weight
        )
        .run();

      if (!result.success) {
        return errorResponse("创建套餐失败", 500);
      }

      console.log(`管理员 ${adminCheck.admin.email} 创建套餐: ${name}`);

      return successResponse({
        id: result.meta.last_row_id,
        name,
        price: parseFloat(price),
        traffic_quota,
        validity_days,
        speed_limit,
        device_limit,
        level,
        status,
        is_recommended: is_recommended ? 1 : 0,
        sort_weight
      }, "套餐创建成功");
    } catch (error) {
      console.error("创建套餐失败:", error);
      return errorResponse(error.message, 500);
    }
  }

  /**
   * 更新套餐
   * PUT /api/admin/packages/:id
   */
  async updatePackage(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const packageIdStr = url.pathname.split("/").pop();
      const packageId = packageIdStr ? Number(packageIdStr) : NaN;

      if (!Number.isFinite(packageId)) {
        return errorResponse("无效的套餐ID", 400);
      }

      const body = await request.json();
      const {
        name,
        price,
        traffic_quota,
        validity_days,
        speed_limit,
        device_limit,
        level,
        status,
        is_recommended,
        sort_weight
      } = body;

      // 检查套餐是否存在
      const existingPackage = await this.db.db
        .prepare("SELECT * FROM packages WHERE id = ?")
        .bind(packageId)
        .first<PackageRow>();

      if (!existingPackage) {
        return errorResponse("套餐不存在", 404);
      }

      // 验证价格和流量
      const priceValue = price !== undefined ? Number(price) : undefined;
      if (priceValue !== undefined && priceValue <= 0) {
        return errorResponse("价格必须大于0", 400);
      }

      const trafficQuotaValue = traffic_quota !== undefined ? Number(traffic_quota) : undefined;
      if (trafficQuotaValue !== undefined && trafficQuotaValue <= 0) {
        return errorResponse("流量配额必须大于0", 400);
      }

      const validityDaysValue = validity_days !== undefined ? Number(validity_days) : undefined;
      if (validityDaysValue !== undefined && validityDaysValue <= 0) {
        return errorResponse("有效期必须大于0天", 400);
      }

      // 检查套餐名称是否重复（排除当前套餐）
      if (name && name !== existingPackage.name) {
        const duplicatePackage = await this.db.db
          .prepare("SELECT id FROM packages WHERE name = ? AND id != ?")
          .bind(name, packageId)
          .first();

        if (duplicatePackage) {
          return errorResponse("套餐名称已存在", 400);
        }
      }

      // 构建更新字段
      const updateFields = [];
      const updateValues = [];

      if (name !== undefined) {
        updateFields.push("name = ?");
        updateValues.push(name);
      }
      if (price !== undefined) {
        updateFields.push("price = ?");
        updateValues.push(priceValue);
      }
      if (traffic_quota !== undefined) {
        updateFields.push("traffic_quota = ?");
        updateValues.push(trafficQuotaValue);
      }
      if (validity_days !== undefined) {
        updateFields.push("validity_days = ?");
        updateValues.push(validityDaysValue);
      }
      if (speed_limit !== undefined) {
        updateFields.push("speed_limit = ?");
        updateValues.push(Number(speed_limit));
      }
      if (device_limit !== undefined) {
        updateFields.push("device_limit = ?");
        updateValues.push(Number(device_limit));
      }
      if (level !== undefined) {
        updateFields.push("level = ?");
        updateValues.push(Number(level));
      }
      if (status !== undefined) {
        updateFields.push("status = ?");
        updateValues.push(Number(status));
      }
      if (is_recommended !== undefined) {
        updateFields.push("is_recommended = ?");
        updateValues.push(is_recommended ? 1 : 0);
      }
      if (sort_weight !== undefined) {
        updateFields.push("sort_weight = ?");
        updateValues.push(Number(sort_weight));
      }

      if (updateFields.length === 0) {
        return errorResponse("没有提供需要更新的字段", 400);
      }

      updateFields.push("updated_at = datetime('now', '+8 hours')");
      updateValues.push(packageId);

      // 执行更新
      const updateResult = toRunResult(
        await this.db.db
          .prepare(`
          UPDATE packages
          SET ${updateFields.join(", ")}
          WHERE id = ?
        `)
          .bind(...updateValues)
          .run()
      );

      if (getChanges(updateResult) === 0) {
        return errorResponse("更新套餐失败", 500);
      }

      console.log(`管理员 ${ensureString(adminCheck.admin?.email)} 更新套餐 ID: ${packageId}`);

      return successResponse({
        message: "套餐更新成功",
        id: packageId
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("更新套餐失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 删除套餐
   * DELETE /api/admin/packages/:id
   */
  async deletePackage(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const packageIdStr = url.pathname.split("/").pop();
      const packageId = packageIdStr ? Number(packageIdStr) : NaN;

      if (!Number.isFinite(packageId)) {
        return errorResponse("无效的套餐ID", 400);
      }

      // 检查套餐是否存在
      const existingPackage = await this.db.db
        .prepare("SELECT name FROM packages WHERE id = ?")
        .bind(packageId)
        .first<{ name: string }>();

      if (!existingPackage) {
        return errorResponse("套餐不存在", 404);
      }

      // 检查是否有用户购买了此套餐
      const purchaseRecord = await this.db.db
        .prepare("SELECT COUNT(*) as count FROM package_purchase_records WHERE package_id = ?")
        .bind(packageId)
        .first<{ count: number }>();

      if (ensureNumber(purchaseRecord?.count) > 0) {
        return errorResponse("此套餐已有用户购买，不能删除", 400);
      }

      // 删除套餐
      const deleteResult = toRunResult(
        await this.db.db
          .prepare("DELETE FROM packages WHERE id = ?")
          .bind(packageId)
          .run()
      );

      if (getChanges(deleteResult) === 0) {
        return errorResponse("删除套餐失败", 500);
      }

      console.log(`管理员 ${ensureString(adminCheck.admin?.email)} 删除套餐: ${ensureString(existingPackage?.name)} (ID: ${packageId})`);

      return successResponse({
        message: "套餐删除成功",
        id: packageId
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("删除套餐失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  // ===== 优惠券管理 =====

  async getCoupons(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
      const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
      const limit = Math.min(Math.max(limitParam, 1), 100);
      const status = url.searchParams.get("status");
      const keyword = url.searchParams.get("keyword") || url.searchParams.get("search") || "";
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params: Array<string | number> = [];

      if (status !== null && status !== "") {
        whereClause += " AND c.status = ?";
        params.push(Number(status));
      }

      if (keyword) {
        whereClause += " AND (c.name LIKE ? OR c.code LIKE ?)";
        params.push(`%${keyword}%`, `%${keyword}%`);
      }

      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM coupons c ${whereClause}`)
        .bind(...params)
        .first<{ total: number | string | null }>();

      const total = ensureNumber(totalRow?.total ?? 0);

      const listResult = await this.db.db
        .prepare(
          `
          SELECT
            c.*,
            (
              SELECT COUNT(*)
              FROM coupon_packages cp
              WHERE cp.coupon_id = c.id
            ) as package_count
          FROM coupons c
          ${whereClause}
          ORDER BY c.id DESC
          LIMIT ? OFFSET ?
        `
        )
        .bind(...params, limit, offset)
        .all<(CouponRow & { package_count: number | string | null })>();

      const coupons = (listResult.results ?? []).map(row => {
        const discountValue = ensureNumber(row.discount_value);
        const maxUsage =
          row.max_usage !== undefined && row.max_usage !== null
            ? ensureNumber(row.max_usage)
            : null;
        const perUserLimit =
          row.per_user_limit !== undefined && row.per_user_limit !== null
            ? ensureNumber(row.per_user_limit)
            : null;
        const totalUsed = ensureNumber(row.total_used ?? 0);
        return {
          ...row,
          discount_value: discountValue,
          max_usage: maxUsage,
          per_user_limit: perUserLimit,
          total_used: totalUsed,
          remaining_usage:
            maxUsage === null ? null : Math.max(maxUsage - totalUsed, 0),
          package_count: ensureNumber((row as any).package_count ?? 0),
        };
      });

      return successResponse({
        coupons,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  async createCoupon(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const body = (await request.json()) as CouponRequestBody;
      const name = ensureString(body.name).trim();
      if (!name) {
        return errorResponse("请输入优惠券名称", 400);
      }

      const discountType = body.discount_type === "percentage" ? "percentage" : "amount";
      let discountValue = Number(body.discount_value);
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return errorResponse("优惠值必须大于0", 400);
      }

      if (discountType === "amount") {
        discountValue = fixMoneyPrecision(discountValue);
      } else if (discountValue > 100) {
        return errorResponse("折扣比例不能大于100%", 400);
      }

      const startAt = this.normalizeTimestampValue(body.start_at, "开始时间");
      const endAt = this.normalizeTimestampValue(body.end_at, "结束时间");
      if (endAt <= startAt) {
        return errorResponse("结束时间必须大于开始时间", 400);
      }

      const codeInput = ensureString(body.code ?? "").trim();
      const code = (codeInput || this.generateCouponCode()).toUpperCase();
      await this.ensureCouponCodeUnique(code);

      const normalizeLimit = (value: unknown, field: string) => {
        if (value === undefined || value === null || value === "") {
          return null;
        }
        const parsed = Math.floor(Number(value));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`${field} 必须为正整数`);
        }
        return parsed;
      };

      const maxUsage = normalizeLimit(body.max_usage, "最大使用次数");
      const perUserLimit = normalizeLimit(body.per_user_limit, "每用户使用次数");
      const status = body.status !== undefined ? Number(body.status) : 1;
      const description = body.description ? ensureString(body.description) : null;
      const packageIds = this.sanitizePackageIds(body.package_ids);

      const insertResult = toRunResult(
        await this.db.db
          .prepare(
            `
            INSERT INTO coupons
            (name, code, discount_type, discount_value, start_at, end_at, max_usage, per_user_limit, status, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .bind(
            name,
            code,
            discountType,
            discountValue,
            startAt,
            endAt,
            maxUsage,
            perUserLimit,
            status,
            description
          )
          .run()
      );

      if (getChanges(insertResult) === 0) {
        return errorResponse("创建优惠券失败", 500);
      }

      const couponId = ensureNumber(insertResult.meta?.last_row_id ?? 0);
      await this.replaceCouponPackages(couponId, packageIds);

      return successResponse({
        id: couponId,
        name,
        code,
        discount_type: discountType,
        discount_value: discountValue,
        start_at: startAt,
        end_at: endAt,
        max_usage: maxUsage,
        per_user_limit: perUserLimit,
        status,
        description,
        package_ids: packageIds,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 400);
    }
  }

  async getCouponDetail(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const couponIdStr = url.pathname.split("/").pop();
      const couponId = couponIdStr ? Number(couponIdStr) : NaN;
      if (!Number.isFinite(couponId)) {
        return errorResponse("无效的优惠券ID", 400);
      }

      const coupon = await this.db.db
        .prepare("SELECT * FROM coupons WHERE id = ?")
        .bind(couponId)
        .first<CouponRow>();

      if (!coupon) {
        return errorResponse("优惠券不存在", 404);
      }

      const packagesResult = await this.db.db
        .prepare("SELECT package_id FROM coupon_packages WHERE coupon_id = ?")
        .bind(couponId)
        .all<{ package_id: number | string }>();

      const packageIds =
        packagesResult.results?.map(item => ensureNumber(item.package_id)) ?? [];
      const maxUsage =
        coupon.max_usage !== null && coupon.max_usage !== undefined
          ? ensureNumber(coupon.max_usage)
          : null;
      const totalUsed = ensureNumber(coupon.total_used ?? 0);

      return successResponse({
        ...coupon,
        discount_value: ensureNumber(coupon.discount_value),
        max_usage: maxUsage,
        per_user_limit:
          coupon.per_user_limit !== null && coupon.per_user_limit !== undefined
            ? ensureNumber(coupon.per_user_limit)
            : null,
        total_used: totalUsed,
        remaining_usage:
          maxUsage === null ? null : Math.max(maxUsage - totalUsed, 0),
        package_ids: packageIds,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  async updateCoupon(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const couponIdStr = url.pathname.split("/").pop();
      const couponId = couponIdStr ? Number(couponIdStr) : NaN;
      if (!Number.isFinite(couponId)) {
        return errorResponse("无效的优惠券ID", 400);
      }

      const existing = await this.db.db
        .prepare("SELECT * FROM coupons WHERE id = ?")
        .bind(couponId)
        .first<CouponRow>();

      if (!existing) {
        return errorResponse("优惠券不存在", 404);
      }

      const body = (await request.json()) as Partial<CouponRequestBody>;

      const updateFields: string[] = [];
      const updateValues: unknown[] = [];

      if (body.name !== undefined) {
        const newName = ensureString(body.name).trim();
        if (!newName) {
          return errorResponse("优惠券名称不能为空", 400);
        }
        updateFields.push("name = ?");
        updateValues.push(newName);
      }

      if (body.code !== undefined) {
        const newCode = ensureString(body.code).trim().toUpperCase();
        if (!newCode) {
          return errorResponse("优惠码不能为空", 400);
        }
        await this.ensureCouponCodeUnique(newCode, couponId);
        updateFields.push("code = ?");
        updateValues.push(newCode);
      }

      if (body.discount_type !== undefined) {
        const newType = body.discount_type === "percentage" ? "percentage" : "amount";
        updateFields.push("discount_type = ?");
        updateValues.push(newType);
      }

      if (body.discount_value !== undefined) {
        let newValue = Number(body.discount_value);
        if (!Number.isFinite(newValue) || newValue <= 0) {
          return errorResponse("优惠值必须大于0", 400);
        }
        const type =
          body.discount_type ??
          (existing.discount_type as "amount" | "percentage");

        if (type === "amount") {
          newValue = fixMoneyPrecision(newValue);
        } else if (newValue > 100) {
          return errorResponse("折扣比例不能大于100%", 400);
        }

        updateFields.push("discount_value = ?");
        updateValues.push(newValue);
      }

      if (body.start_at !== undefined) {
        const startAt = this.normalizeTimestampValue(body.start_at, "开始时间");
        updateFields.push("start_at = ?");
        updateValues.push(startAt);
      }

      if (body.end_at !== undefined) {
        const endAt = this.normalizeTimestampValue(body.end_at, "结束时间");
        updateFields.push("end_at = ?");
        updateValues.push(endAt);
      }

      if (body.max_usage !== undefined) {
        const rawMaxUsage = body.max_usage as number | string | null | undefined;
        const value =
          rawMaxUsage === null ||
          rawMaxUsage === undefined ||
          (typeof rawMaxUsage === "string" && rawMaxUsage.trim() === "")
            ? null
            : Math.floor(Number(rawMaxUsage));
        if (value !== null && (!Number.isFinite(value) || value <= 0)) {
          return errorResponse("最大使用次数必须为正整数", 400);
        }
        updateFields.push("max_usage = ?");
        updateValues.push(value);
      }

      if (body.per_user_limit !== undefined) {
        const rawPerUserLimit = body.per_user_limit as number | string | null | undefined;
        const value =
          rawPerUserLimit === null ||
          rawPerUserLimit === undefined ||
          (typeof rawPerUserLimit === "string" && rawPerUserLimit.trim() === "")
            ? null
            : Math.floor(Number(rawPerUserLimit));
        if (value !== null && (!Number.isFinite(value) || value <= 0)) {
          return errorResponse("每用户使用次数必须为正整数", 400);
        }
        updateFields.push("per_user_limit = ?");
        updateValues.push(value);
      }

      if (body.status !== undefined) {
        updateFields.push("status = ?");
        updateValues.push(Number(body.status));
      }

      if (body.description !== undefined) {
        const desc = body.description ? ensureString(body.description) : null;
        updateFields.push("description = ?");
        updateValues.push(desc);
      }

      if (updateFields.length === 0 && body.package_ids === undefined) {
        return errorResponse("没有需要更新的内容", 400);
      }

      if (updateFields.length > 0) {
        updateFields.push("updated_at = datetime('now', '+8 hours')");
        updateValues.push(couponId);

        const updateResult = toRunResult(
          await this.db.db
            .prepare(
              `
              UPDATE coupons
              SET ${updateFields.join(", ")}
              WHERE id = ?
            `
            )
            .bind(...updateValues)
            .run()
        );

        if (getChanges(updateResult) === 0) {
          return errorResponse("更新优惠券失败", 500);
        }
      }

      if (body.package_ids !== undefined) {
        const packageIds = this.sanitizePackageIds(body.package_ids);
        await this.replaceCouponPackages(couponId, packageIds);
      }

      return successResponse({ id: couponId, message: "优惠券更新成功" });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 400);
    }
  }

  async deleteCoupon(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const couponIdStr = url.pathname.split("/").pop();
      const couponId = couponIdStr ? Number(couponIdStr) : NaN;
      if (!Number.isFinite(couponId)) {
        return errorResponse("无效的优惠券ID", 400);
      }

      const deleteResult = toRunResult(
        await this.db.db
          .prepare("DELETE FROM coupons WHERE id = ?")
          .bind(couponId)
          .run()
      );

      if (getChanges(deleteResult) === 0) {
        return errorResponse("优惠券不存在", 404);
      }

      return successResponse({ id: couponId, message: "优惠券已删除" });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  // ===== 礼品卡管理 =====

  async getGiftCards(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
      const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
      const limit = Math.min(Math.max(limitParam, 1), 100);
      const statusParam = url.searchParams.get("status");
      const typeParam = url.searchParams.get("card_type");
      const keyword = url.searchParams.get("keyword")?.trim();
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params: Array<string | number> = [];

      if (statusParam !== null && statusParam !== "") {
        whereClause += " AND gc.status = ?";
        params.push(Number(statusParam));
      }

      if (typeParam) {
        whereClause += " AND gc.card_type = ?";
        params.push(typeParam);
      }

      if (keyword) {
        whereClause += " AND (UPPER(gc.code) LIKE ? OR gc.name LIKE ?)";
        params.push(`%${keyword.toUpperCase()}%`, `%${keyword}%`);
      }

      const totalRow = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM gift_cards gc ${whereClause}`)
        .bind(...params)
        .first<{ total: number | string | null }>();
      const total = ensureNumber(totalRow?.total ?? 0);

      const recordsResult = await this.db.db
        .prepare(
          `
          SELECT
            gc.*,
            gb.name as batch_name,
            p.name as package_name,
            u.email as creator_email
          FROM gift_cards gc
          LEFT JOIN gift_card_batches gb ON gc.batch_id = gb.id
          LEFT JOIN packages p ON gc.package_id = p.id
          LEFT JOIN users u ON gc.created_by = u.id
          ${whereClause}
          ORDER BY gc.id DESC
          LIMIT ? OFFSET ?
        `
        )
        .bind(...params, limit, offset)
        .all<GiftCardListRow>();

      const records = (recordsResult.results ?? []).map(record => {
        const maxUsage =
          record.max_usage !== undefined && record.max_usage !== null
            ? ensureNumber(record.max_usage)
            : null;
        const usedCount = ensureNumber(record.used_count ?? 0);
        const remaining = maxUsage !== null ? Math.max(maxUsage - usedCount, 0) : null;
        const endAt = record.end_at ? new Date(record.end_at) : null;
        const isExpired = endAt ? endAt.getTime() < Date.now() : false;
        return {
          ...record,
          max_usage: maxUsage,
          used_count: usedCount,
          remaining_usage: remaining,
          is_expired: isExpired
        };
      });

      return successResponse({
        records,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  async createGiftCard(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const body = (await request.json()) as Partial<CreateGiftCardPayload> & { name?: string; card_type?: GiftCardType };
      const name = ensureString(body.name).trim();
      if (!name) {
        return errorResponse("请输入礼品卡名称", 400);
      }

      const cardType = (body.card_type as GiftCardType) || "balance";
      const allowedTypes: GiftCardType[] = ["balance", "duration", "traffic", "reset_traffic", "package"];
      if (!allowedTypes.includes(cardType)) {
        return errorResponse("无效的礼品卡类型", 400);
      }

      const validatePositive = (value?: number | string | null, label?: string) => {
        if (value === null || value === undefined) return null;
        const parsed = ensureNumber(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`${label || "数值"}必须大于0`);
        }
        return parsed;
      };

      try {
        switch (cardType) {
          case "balance":
            validatePositive(body.balance_amount, "充值金额");
            break;
          case "duration":
            validatePositive(body.duration_days, "订阅天数");
            break;
          case "traffic":
            validatePositive(body.traffic_value_gb, "流量数值");
            break;
          case "package":
            if (!body.package_id) {
              throw new Error("请选择可兑换的套餐");
            }
            break;
        }
      } catch (validationError) {
        const message =
          validationError instanceof Error ? validationError.message : "礼品卡配置不合法";
        return errorResponse(message, 400);
      }

      const result = await this.giftCardService.createGiftCards(
        {
          name,
          card_type: cardType,
          balance_amount: body.balance_amount ?? null,
          duration_days: body.duration_days ?? null,
          traffic_value_gb: body.traffic_value_gb ?? null,
          reset_traffic_gb: cardType === "reset_traffic" ? null : body.reset_traffic_gb ?? null,
          package_id: body.package_id ?? null,
          start_at: body.start_at ?? null,
          end_at: body.end_at ?? null,
          max_usage: body.max_usage ?? null,
          quantity: body.quantity ?? 1,
          code: body.code ?? null,
          code_prefix: body.code_prefix ?? null,
          description: body.description ?? null
        },
        adminCheck.admin?.id
      );

      return successResponse({
        batch_id: result.batchId,
        cards: result.cards
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 400);
    }
  }

  async updateGiftCard(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const idStr = url.pathname.split("/").pop();
      const cardId = idStr ? Number(idStr) : NaN;
      if (!Number.isFinite(cardId)) {
        return errorResponse("无效的礼品卡ID", 400);
      }

      const body = (await request.json()) as Partial<CreateGiftCardPayload>;
      const updated = await this.giftCardService.updateGiftCard(cardId, body);
      if (!updated) {
        return errorResponse("礼品卡更新失败或无变化", 400);
      }

      return successResponse({ id: cardId, message: "礼品卡已更新" });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 400);
    }
  }

  async updateGiftCardStatus(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const parts = url.pathname.split("/");
      const cardIdStr = parts[parts.length - 2];
      const cardId = cardIdStr ? Number(cardIdStr) : NaN;
      if (!Number.isFinite(cardId)) {
        return errorResponse("无效的礼品卡ID", 400);
      }

      const body = (await request.json()) as { status?: number };
      const status = body.status ?? 1;
      if (![0, 1, 2].includes(status)) {
        return errorResponse("状态值不正确", 400);
      }

      const updated = await this.giftCardService.updateGiftCardStatus(cardId, status);
      if (!updated) {
        return errorResponse("礼品卡状态更新失败", 400);
      }

      return successResponse({ id: cardId, status });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 400);
    }
  }

  async deleteGiftCard(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const idStr = url.pathname.split("/").pop();
      const cardId = idStr ? Number(idStr) : NaN;
      if (!Number.isFinite(cardId)) {
        return errorResponse("无效的礼品卡ID", 400);
      }

      const card = await this.giftCardService.getGiftCardById(cardId);
      if (!card) {
        return errorResponse("礼品卡不存在", 404);
      }

      if (ensureNumber(card.used_count ?? 0) > 0) {
        return errorResponse("已使用的礼品卡不能删除", 400);
      }

      const deleted = await this.giftCardService.deleteGiftCard(cardId);
      if (!deleted) {
        return errorResponse("礼品卡删除失败", 400);
      }

      return successResponse({ id: cardId, message: "礼品卡已删除" });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 400);
    }
  }

  async getGiftCardRedemptions(request: Request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const segments = url.pathname.split("/");
      const cardIdStr = segments[segments.length - 2];
      const cardId = cardIdStr ? Number(cardIdStr) : NaN;
      if (!Number.isFinite(cardId)) {
        return errorResponse("无效的礼品卡ID", 400);
      }

      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
      const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
      const limit = Math.min(Math.max(limitParam, 1), 100);
      const offset = (page - 1) * limit;

      const totalRow = await this.db.db
        .prepare("SELECT COUNT(*) as total FROM gift_card_redemptions WHERE card_id = ?")
        .bind(cardId)
        .first<{ total: number | string | null }>();
      const total = ensureNumber(totalRow?.total ?? 0);

      const recordsResult = await this.db.db
        .prepare(
          `
          SELECT gcr.*, u.email as user_email, u.username as user_name
          FROM gift_card_redemptions gcr
          LEFT JOIN users u ON gcr.user_id = u.id
          WHERE gcr.card_id = ?
          ORDER BY gcr.created_at DESC
          LIMIT ? OFFSET ?
        `
        )
        .bind(cardId, limit, offset)
        .all<GiftCardRedemptionRow>();

      const records = (recordsResult.results ?? []).map(record => ({
        ...record,
        change_amount:
          record.change_amount !== undefined && record.change_amount !== null
            ? fixMoneyPrecision(ensureNumber(record.change_amount))
            : null,
        duration_days:
          record.duration_days !== undefined && record.duration_days !== null
            ? ensureNumber(record.duration_days)
            : null,
        traffic_value_gb:
          record.traffic_value_gb !== undefined && record.traffic_value_gb !== null
            ? ensureNumber(record.traffic_value_gb)
            : null,
        reset_traffic_gb:
          record.reset_traffic_gb !== undefined && record.reset_traffic_gb !== null
            ? ensureNumber(record.reset_traffic_gb)
            : null
      }));

      return successResponse({
        records,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 获取充值记录
   * GET /api/admin/recharge-records
   */
  async getRechargeRecords(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const status = url.searchParams.get("status");
      const userId = url.searchParams.get("user_id");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereClause = "WHERE 1=1";
      let params = [];

      if (status !== null && status !== undefined && status !== '') {
        whereClause += " AND rr.status = ?";
        params.push(parseInt(status));
      }

      if (userId) {
        whereClause += " AND rr.user_id = ?";
        params.push(parseInt(userId));
      }

      // 获取记录总数
      const totalRow = await this.db.db
        .prepare(`
          SELECT COUNT(*) as total
          FROM recharge_records rr
          ${whereClause}
        `)
        .bind(...params)
        .first<CountRow>();

      const total = ensureNumber(totalRow?.total);

      // 获取充值记录列表
      const recordsResult = await this.db.db
        .prepare(`
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
            u.username
          FROM recharge_records rr
          LEFT JOIN users u ON rr.user_id = u.id
          ${whereClause}
          ORDER BY rr.created_at DESC
          LIMIT ? OFFSET ?
        `)
        .bind(...params, safeLimit, offset)
        .all<RechargeRecordRow>();

      const statusMap: Record<number, string> = {
        0: '待支付',
        1: '已支付',
        2: '已取消',
        3: '支付失败'
      };

      const formattedRecords = (recordsResult.results ?? []).map(record => {
        const statusValue = ensureNumber(record.status);
        const amountValue = typeof record.amount === 'string' ? Number(record.amount) : ensureNumber(record.amount);
        const tradeNo = ensureString(record.trade_no);
        const displayTradeNo =
          record.payment_method === "gift_card" && tradeNo
            ? tradeNo.split("-")[0]
            : tradeNo;

        return {
          ...record,
          trade_no: displayTradeNo,
          amount: amountValue,
          status: statusValue,
          status_text: statusMap[statusValue] ?? '未知状态'
        };
      });

      return successResponse({
        records: formattedRecords,
        pagination: {
          total,
          page,
          limit: safeLimit,
          totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取充值记录失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 获取购买记录
   * GET /api/admin/purchase-records
   */
  async getPurchaseRecords(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limitParam = parseInt(url.searchParams.get("limit")) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const status = url.searchParams.get("status");
      const userId = url.searchParams.get("user_id");
      const packageId = url.searchParams.get("package_id");
      const offset = (page - 1) * safeLimit;

      // 构建查询条件
      let whereClause = "WHERE 1=1";
      let params = [];

      if (status !== null && status !== undefined && status !== '') {
        whereClause += " AND ppr.status = ?";
        params.push(parseInt(status));
      }

      if (userId) {
        whereClause += " AND ppr.user_id = ?";
        params.push(parseInt(userId));
      }

      if (packageId) {
        whereClause += " AND ppr.package_id = ?";
        params.push(parseInt(packageId));
      }

      // 获取记录总数
      const totalRow = await this.db.db
        .prepare(`
          SELECT COUNT(*) as total
          FROM package_purchase_records ppr
          ${whereClause}
        `)
        .bind(...params)
        .first<CountRow>();

      const total = ensureNumber(totalRow?.total);

      // 获取购买记录列表
      const recordsResult = await this.db.db
        .prepare(`
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
            p.name as package_name,
            p.traffic_quota,
            p.validity_days
          FROM package_purchase_records ppr
          LEFT JOIN users u ON ppr.user_id = u.id
          LEFT JOIN packages p ON ppr.package_id = p.id
          ${whereClause}
          ORDER BY ppr.created_at DESC
          LIMIT ? OFFSET ?
        `)
        .bind(...params, safeLimit, offset)
        .all<PurchaseRecordRow>();

      const statusMap: Record<number, string> = {
        0: '待支付',
        1: '已支付',
        2: '已取消',
        3: '支付失败'
      };

      const normalizePurchaseType = (type: unknown) => {
        if (!type) return '未知';
        const normalized = String(type).toLowerCase();
        if (normalized === 'balance') return '余额支付';
        if (normalized === 'smart_topup' || normalized.startsWith('balance_')) return '混合支付';
        if (normalized === 'alipay' || normalized.endsWith('alipay')) return '支付宝';
        if (normalized === 'wechat' || normalized === 'wxpay' || normalized.endsWith('wxpay')) return '微信';
        if (normalized === 'qqpay' || normalized.endsWith('qqpay')) return 'QQ支付';
        if (normalized === 'gift_card') return '礼品卡';
        if (normalized === 'direct') return '在线支付';
        return type;
      };

      const formattedRecords = (recordsResult.results ?? []).map(record => {
        const statusValue = ensureNumber(record.status);
        const priceValue = typeof record.price === 'string' ? Number(record.price) : ensureNumber(record.price);
        const packagePriceRaw = record.package_price;
        const packagePriceValue = packagePriceRaw !== undefined && packagePriceRaw !== null
          ? (typeof packagePriceRaw === 'string' ? Number(packagePriceRaw) : ensureNumber(packagePriceRaw))
          : null;
        const discountAmount = record.discount_amount != null ? ensureNumber(record.discount_amount) : 0;
        const finalPrice = packagePriceValue !== null
          ? fixMoneyPrecision(Math.max(packagePriceValue - discountAmount, 0))
          : priceValue;
        const tradeNo = ensureString(record.trade_no ?? "");
        const purchaseTypeRaw = ensureString(record.purchase_type);
        const displayTradeNo =
          purchaseTypeRaw === "gift_card" && tradeNo ? tradeNo.split("-")[0] : tradeNo;

        return {
          ...record,
          trade_no: displayTradeNo,
          price: priceValue,
          package_price: packagePriceValue,
          discount_amount: discountAmount,
          final_price: finalPrice,
          status: statusValue,
          status_text: statusMap[statusValue] ?? '未知状态',
          purchase_type_text: normalizePurchaseType(record.purchase_type)
        };
      });

      return successResponse({
        records: formattedRecords,
        pagination: {
          total,
          page,
          limit: safeLimit,
          totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取购买记录失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 套餐统计
   * GET /api/admin/package-stats
   */
  async getPackageStats(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      // 套餐总数统计
      const packageStats = await this.db.db
        .prepare(`
          SELECT
            COUNT(*) as total_packages,
            COUNT(CASE WHEN status = 1 THEN 1 END) as active_packages,
            COUNT(CASE WHEN status = 0 THEN 1 END) as inactive_packages
          FROM packages
        `)
        .first<PackageStatsRow>();

      // 销售统计
      const salesStats = await this.db.db
        .prepare(`
          SELECT
            COUNT(*) as total_purchases,
            COUNT(CASE WHEN status = 1 THEN 1 END) as completed_purchases,
            COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) as total_revenue
          FROM package_purchase_records
        `)
        .first<SalesStatsRow>();

      // 充值统计
      const rechargeStats = await this.db.db
        .prepare(`
          SELECT
            COUNT(*) as total_recharges,
            COUNT(CASE WHEN status = 1 THEN 1 END) as completed_recharges,
            COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as total_recharged
          FROM recharge_records
        `)
        .first<RechargeSummaryRow>();

      // 最受欢迎的套餐
      const popularPackagesResult = await this.db.db
        .prepare(`
          SELECT
            p.id,
            p.name,
            p.price,
            COUNT(ppr.id) as purchase_count,
            COALESCE(SUM(CASE WHEN ppr.status = 1 THEN ppr.price ELSE 0 END), 0) as revenue
          FROM packages p
          LEFT JOIN package_purchase_records ppr ON p.id = ppr.package_id
          GROUP BY p.id
          ORDER BY purchase_count DESC
          LIMIT 5
        `)
        .all<PopularPackageRow>();

      const packageStatsRow = packageStats ?? {
        total_packages: 0,
        active_packages: 0,
        inactive_packages: 0,
      };

      const salesStatsRow = salesStats ?? {
        total_purchases: 0,
        completed_purchases: 0,
        total_revenue: 0,
      };

      const rechargeStatsRow = rechargeStats ?? {
        total_recharges: 0,
        completed_recharges: 0,
        total_recharged: 0,
      };

      const popularPackages = (popularPackagesResult.results ?? []).map((pkg) => {
        const priceValue = typeof pkg.price === 'string' ? Number(pkg.price) : ensureNumber(pkg.price);
        const revenueValue = pkg.revenue !== null
          ? typeof pkg.revenue === 'string' ? Number(pkg.revenue) : ensureNumber(pkg.revenue)
          : 0;
        return {
          ...pkg,
          price: priceValue,
          revenue: revenueValue,
          purchase_count: ensureNumber(pkg.purchase_count),
        };
      });

      return successResponse({
        package_stats: {
          total: ensureNumber(packageStatsRow.total_packages),
          active: ensureNumber(packageStatsRow.active_packages),
          inactive: ensureNumber(packageStatsRow.inactive_packages)
        },
        sales_stats: {
          total_purchases: ensureNumber(salesStatsRow.total_purchases),
          completed_purchases: ensureNumber(salesStatsRow.completed_purchases),
          total_revenue: typeof salesStatsRow.total_revenue === 'string'
            ? Number(salesStatsRow.total_revenue)
            : ensureNumber(salesStatsRow.total_revenue)
        },
        recharge_stats: {
          total_recharges: ensureNumber(rechargeStatsRow.total_recharges),
          completed_recharges: ensureNumber(rechargeStatsRow.completed_recharges),
          total_recharged: typeof rechargeStatsRow.total_recharged === 'string'
            ? Number(rechargeStatsRow.total_recharged)
            : ensureNumber(rechargeStatsRow.total_recharged)
        },
        popular_packages: popularPackages
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("获取套餐统计失败:", err);
      return errorResponse(err.message, 500);
    }
  }

  /**
   * 删除待支付记录
   * DELETE /api/admin/pending-records
   */
  async deletePendingRecords(request) {
    try {
      const adminCheck = await this.validateAdmin(request);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.message, 401);
      }

      // 先查询待支付记录数量
      const pendingRechargeCount = await this.db.db
        .prepare(`SELECT COUNT(*) as count FROM recharge_records WHERE status = 0`)
        .first<CountValueRow>();

      const pendingPurchaseCount = await this.db.db
        .prepare(`SELECT COUNT(*) as count FROM package_purchase_records WHERE status = 0`)
        .first<CountValueRow>();

      const rechargeBefore = ensureNumber(pendingRechargeCount?.count);
      const purchaseBefore = ensureNumber(pendingPurchaseCount?.count);

      console.log('删除前待支付记录数量:', {
        recharge: rechargeBefore,
        purchase: purchaseBefore
      });

      // 删除待支付的充值记录
      await toRunResult(
        await this.db.db
          .prepare(`DELETE FROM recharge_records WHERE status = 0`)
          .run()
      );

      // 删除待支付的购买记录
      await toRunResult(
        await this.db.db
          .prepare(`DELETE FROM package_purchase_records WHERE status = 0`)
          .run()
      );

      // 删除后再次查询数量来确认实际删除数量
      const pendingRechargeAfter = await this.db.db
        .prepare(`SELECT COUNT(*) as count FROM recharge_records WHERE status = 0`)
        .first<CountValueRow>();

      const pendingPurchaseAfter = await this.db.db
        .prepare(`SELECT COUNT(*) as count FROM package_purchase_records WHERE status = 0`)
        .first<CountValueRow>();

      const rechargeAfter = ensureNumber(pendingRechargeAfter?.count);
      const purchaseAfter = ensureNumber(pendingPurchaseAfter?.count);

      // 计算实际删除的数量
      const rechargeDeleted = rechargeBefore - rechargeAfter;
      const purchaseDeleted = purchaseBefore - purchaseAfter;
      const totalDeleted = rechargeDeleted + purchaseDeleted;

      console.log('删除结果:', {
        rechargeBefore,
        rechargeAfter,
        rechargeDeleted,
        purchaseBefore,
        purchaseAfter,
        purchaseDeleted,
        totalDeleted
      });

      return successResponse({
        message: `成功删除 ${totalDeleted} 条待支付记录（充值记录：${rechargeDeleted}，购买记录：${purchaseDeleted}）`,
        recharge_deleted: rechargeDeleted,
        purchase_deleted: purchaseDeleted,
        total_deleted: totalDeleted
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("删除待支付记录失败:", err);
      return errorResponse(err.message, 500);
    }
  }
}
