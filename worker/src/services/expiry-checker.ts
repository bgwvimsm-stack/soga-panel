// src/services/expiry-checker.ts - 用户等级过期检测服务

import type { Env } from "../types";
import type { Logger } from "../utils/logger";
import { DatabaseService } from "./database";
import { CacheService } from "./cache";
import { getLogger } from "../utils/logger";
import { getChanges, toRunResult } from "../utils/d1";

interface ExpiredUserRow {
  id: number;
  email: string;
  username: string;
  class: number;
  class_expire_time: string | null;
}

interface UpcomingExpiryRow extends ExpiredUserRow {
  days_left: number;
}

export class ExpiryCheckerService {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly cache: CacheService;
  private readonly logger: Logger;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.cache = new CacheService(env.DB);
    this.logger = getLogger(env);
  }

  /**
   * 检测用户等级过期并重置
   */
  async checkExpiredUserLevels() {
    const startTime = Date.now();
    
    try {
      this.logger.info("开始检查过期用户等级");

      // 查找等级过期的用户
      const expiredUsers = await this.db.db
        .prepare(`
          SELECT id, email, username, class, class_expire_time
          FROM users 
          WHERE class_expire_time IS NOT NULL 
            AND class_expire_time < datetime('now', '+8 hours')
            AND class > 0
            AND status = 1
        `)
        .all<ExpiredUserRow>();

      if (!expiredUsers.results || expiredUsers.results.length === 0) {
        this.logger.debug("未发现过期用户等级");
        return { 
          success: true, 
          message: "No expired user levels found", 
          count: 0,
          duration: Date.now() - startTime
        };
      }

      const users = expiredUsers.results ?? [];
      this.logger.info(`发现 ${users.length} 个过期用户等级`, { count: users.length });

      let processedCount = 0;
      const errors = [];

      // 批量重置用户等级
      for (const user of users) {
        try {
          await this.resetUserLevel(user);
          processedCount++;
          
          this.logger.audit('user_level_expired', user.id, {
            old_class: user.class,
            expired_time: user.class_expire_time,
            reset_time: new Date().toISOString()
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(`用户 ${user.id} 等级重置失败`, err, { user_id: user.id });
          errors.push({ user_id: user.id, error: err.message });
        }
      }

      // 清理相关用户的缓存
      for (const user of users) {
        await this.cache.deleteByPrefix(`user_${user.id}_`);
      }

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        message: `Successfully processed ${processedCount} expired user levels`,
        total: users.length,
        processed: processedCount,
        errors: errors,
        duration
      };

      this.logger.info("用户等级过期检查完成", result);
      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("检查过期用户等级失败", err);
      return {
        success: false,
        error: err.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 重置单个用户的等级
   * @param {Object} user - 用户对象
   */
  async resetUserLevel(user: ExpiredUserRow) {
    await this.db.db
      .prepare(`
        UPDATE users 
        SET class = 0, 
            class_expire_time = NULL,
            transfer_enable = 0,
            transfer_total = 0,
            upload_today = 0,
            download_today = 0,
            upload_traffic = 0,
            download_traffic = 0,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `)
      .bind(user.id)
      .run();

    this.logger.info(`用户等级已重置`, {
      user_id: user.id,
      email: user.email,
      old_class: user.class,
      new_class: 0
    });
  }

  /**
   * 清理过期会话
   */
  async cleanupExpiredSessions() {
    const startTime = Date.now();
    
    try {
      this.logger.debug("开始清理过期会话");

      // 清理数据库中的过期会话
      const result = toRunResult(
        await this.db.db
        .prepare('DELETE FROM user_sessions WHERE expires_at < datetime("now", "+8 hours")')
        .run()
      );

      // 清理缓存中的过期数据
      await this.cache.cleanupExpiredSessions();

      const duration = Date.now() - startTime;
      const cleanupResult = {
        success: true,
        message: `Cleaned up ${getChanges(result)} expired sessions`,
        deleted_count: getChanges(result),
        duration
      };

      this.logger.debug("过期会话清理完成", cleanupResult);
      return cleanupResult;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("清理过期会话失败", err);
      return {
        success: false,
        error: err.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 检查即将过期的用户（用于提醒）
   * @param {number} daysBefore - 提前多少天提醒
   */
  async checkUpcomingExpiry(daysBefore = 3) {
    try {
      const upcomingExpiry = await this.db.db
        .prepare(`
          SELECT id, email, username, class, class_expire_time,
                 CAST((julianday(class_expire_time) - julianday('now', '+8 hours')) AS INTEGER) as days_left
          FROM users 
          WHERE class_expire_time IS NOT NULL 
            AND class_expire_time > datetime('now', '+8 hours')
            AND class_expire_time <= datetime('now', '+${daysBefore} days')
            AND class > 0
            AND status = 1
          ORDER BY class_expire_time ASC
        `)
        .all<UpcomingExpiryRow>();

      const users = upcomingExpiry.results ?? [];
      
      if (users.length > 0) {
        this.logger.info(`发现 ${users.length} 个即将过期的用户`, { 
          count: users.length,
          days_before: daysBefore
        });
      }

      return {
        success: true,
        users,
        count: users.length
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("检查即将过期用户失败", err);
      return {
        success: false,
        error: err.message,
        users: [],
        count: 0
      };
    }
  }
}
