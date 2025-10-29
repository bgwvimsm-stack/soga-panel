// index.ts - Cloudflare Worker 入口

import type { Env } from "./src/types";
import { handleRequest } from "./src/handler";
import { SchedulerService } from "./src/services/scheduler";
import { APIAuthMiddleware } from "./src/middleware/apiAuth";
import { ExpiryCheckerService } from "./src/services/expiry-checker";
import { CacheService } from "./src/services/cache";
import { DatabaseService } from "./src/services/database";
import { getLogger } from "./src/utils/logger";

// CORS 头配置
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, API-KEY, NODE-ID, NODE-TYPE, IF-NONE-MATCH, X-API-Secret, X-Frontend-Auth, X-Cloudflare-Service-Binding",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const startTime = Date.now();
    const logger = getLogger(env);
    const url = new URL(request.url);
    
    try {
      // 处理 CORS 预检请求
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // API认证中间件
      const apiAuth = new APIAuthMiddleware(env);
      const authResult = await apiAuth.validateRequest(request);
      if (authResult) {
        // 认证失败，返回错误响应
        logger.warn('API认证失败', { 
          path: url.pathname, 
          method: request.method,
          ip: request.headers.get('CF-Connecting-IP') || 'unknown'
        });
        
        Object.entries(corsHeaders).forEach(([key, value]) => {
          authResult.headers.set(key, value);
        });
        return authResult;
      }

      // 基于时间间隔的后台任务执行（更优雅的方式）
      const now = Date.now();
      
      // 每10分钟清理一次过期会话（基于时间而非随机）
      if (now % (10 * 60 * 1000) < 60 * 1000) {
        const expiryChecker = new ExpiryCheckerService(env);
        ctx.waitUntil(expiryChecker.cleanupExpiredSessions());
      }

      // 每30分钟检测一次用户等级过期（避免频繁执行）
      if (now % (30 * 60 * 1000) < 60 * 1000) {
        const expiryChecker = new ExpiryCheckerService(env);
        ctx.waitUntil(expiryChecker.checkExpiredUserLevels());
      }

      // 处理请求
      const response = await handleRequest(request, env, ctx);

      // 添加 CORS 头
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      // 允许第三方登录弹窗与主窗口通信（OAuth 登录场景）
      response.headers.set(
        "Cross-Origin-Opener-Policy",
        "same-origin-allow-popups"
      );

      // 记录API请求日志
      const responseTime = Date.now() - startTime;
      logger.apiRequest(
        request.method,
        url.pathname, 
        null, // userId将在handler中获取
        null, // nodeId将在handler中获取
        responseTime
      );

      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Unhandled error in main handler", err, {
        path: url.pathname,
        method: request.method,
        response_time_ms: responseTime,
        ip: request.headers.get('CF-Connecting-IP') || 'unknown'
      });
      
      const errorResponse = new Response(
        JSON.stringify({
          code: 500,
          message: "Internal Server Error",
          error: err.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
      errorResponse.headers.set(
        "Cross-Origin-Opener-Policy",
        "same-origin-allow-popups"
      );
      return errorResponse;
    }
  },

  // 定时触发器 - 根据不同的 cron 表达式执行不同任务
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const logger = getLogger(env);
    const taskStartTime = Date.now();
    const cron = event.cron || 'unknown';

    logger.info(`定时任务触发`, { cron });

    try {
      const scheduler = new SchedulerService(env);
      const now = new Date();
      const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const results = { executed_tasks: [] };

      // 根据 cron 表达式判断执行哪个任务
      // 每分钟执行：用户过期检查 (*/1 * * * *)
      if (cron === '*/1 * * * *') {
        logger.scheduler('user_expiration_check', 'started');
        const userExpirationResult = await scheduler.checkExpiredUsers();
        results.executed_tasks.push({
          task: 'user_expiration_check',
          time: beijingTime.toISOString(),
          result: userExpirationResult
        });

        if (userExpirationResult.success) {
          logger.scheduler('user_expiration_check', 'completed', Date.now() - taskStartTime, userExpirationResult);
        } else {
          logger.scheduler('user_expiration_check', 'failed', Date.now() - taskStartTime, userExpirationResult);
        }
      }

      // 北京时间 0:00 (UTC 16:00)：每日流量重置和节点状态清理
      else if (cron === '0 16 * * *') {
        logger.scheduler('daily_tasks', 'started');
        console.log('Starting daily traffic reset and node status cleanup task...');

        // 先执行每日流量重置（包含Bark通知，使用重置前的流量数据）
        const trafficResetResult = await scheduler.dailyTrafficReset();
        results.executed_tasks.push({
          task: 'daily_traffic_reset',
          time: beijingTime.toISOString(),
          result: trafficResetResult
        });

        if (trafficResetResult.success) {
          console.log('Daily traffic reset completed successfully');
        } else {
          console.error('Daily traffic reset failed:', trafficResetResult.message);
        }

        // 然后检查月度流量重置（在Bark通知发送完成后执行）
        const monthlyResetResult = await scheduler.checkMonthlyTrafficReset();
        results.executed_tasks.push({
          task: 'monthly_traffic_reset',
          time: beijingTime.toISOString(),
          result: monthlyResetResult
        });

        if (monthlyResetResult.success && monthlyResetResult.reset_count > 0) {
          console.log('Monthly traffic reset completed successfully:', monthlyResetResult.message);
        } else if (!monthlyResetResult.success) {
          console.error('Monthly traffic reset failed:', monthlyResetResult.message);
        } else {
          console.log('Monthly traffic reset skipped:', monthlyResetResult.message);
        }

        // 执行节点状态清理
        const nodeStatusCleanupResult = await scheduler.cleanupNodeStatusData();
        results.executed_tasks.push({
          task: 'node_status_cleanup',
          time: beijingTime.toISOString(),
          result: nodeStatusCleanupResult
        });

        if (nodeStatusCleanupResult.success) {
          console.log('Node status cleanup completed successfully:', nodeStatusCleanupResult.message);
        } else {
          console.error('Node status cleanup failed:', nodeStatusCleanupResult.message);
        }

        logger.scheduler('daily_tasks', 'completed', Date.now() - taskStartTime);
      }

      // 北京时间 1:00 (UTC 17:00)：清理7天前的订阅记录
      else if (cron === '0 17 * * *') {
        logger.scheduler('subscription_cleanup', 'started');
        console.log('Starting subscription logs cleanup task...');

        const subscriptionCleanupResult = await scheduler.cleanupOldSubscriptionLogs();
        results.executed_tasks.push({
          task: 'subscription_logs_cleanup',
          time: beijingTime.toISOString(),
          result: subscriptionCleanupResult
        });

        if (subscriptionCleanupResult.success) {
          console.log('Subscription logs cleanup completed:', subscriptionCleanupResult.message);
          logger.scheduler('subscription_cleanup', 'completed', Date.now() - taskStartTime, subscriptionCleanupResult);
        } else {
          console.error('Subscription logs cleanup failed:', subscriptionCleanupResult.error);
          logger.scheduler('subscription_cleanup', 'failed', Date.now() - taskStartTime, subscriptionCleanupResult);
        }
      }

      logger.info(`定时任务完成`, {
        cron,
        tasks_count: results.executed_tasks.length,
        duration_ms: Date.now() - taskStartTime
      });
      return results;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("定时任务执行失败", err, { cron });
      return { success: false, error: err.message };
    }
  },
};

// 检测用户等级过期并重置
async function checkExpiredUserLevels(env: Env) {
  try {
    const db = new DatabaseService(env.DB);
    const cache = new CacheService(env.DB);

    console.log("Checking for expired user levels...");

    // 查找等级过期的用户
    const expiredUsers = await db.db
      .prepare(
        `
      SELECT id, email, username, class, class_expire_time
      FROM users 
      WHERE class_expire_time IS NOT NULL 
        AND class_expire_time < datetime('now', '+8 hours')
        AND class > 0
    `
      )
      .all();

    if (!expiredUsers.results || expiredUsers.results.length === 0) {
      console.log("No expired user levels found");
      return;
    }

    console.log(
      `Found ${expiredUsers.results.length} users with expired levels`
    );

    // 批量重置过期用户
    for (const user of expiredUsers.results) {
      console.log(
        `Resetting user ${user.email} (ID: ${user.id}) - Level ${user.class} expired at ${user.class_expire_time}`
      );

      // 重置用户等级和流量数据
      await db.db
        .prepare(
          `
        UPDATE users 
        SET class = 0,
            class_expire_time = NULL,
            upload_traffic = 0,
            download_traffic = 0,
            transfer_today = 0,
            transfer_total = 0,
            transfer_enable = 0,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
        )
        .bind(user.id)
        .run();

      // 清除该用户的相关缓存
      await cache.deleteByPrefix(`user_${user.id}`);

      // 记录操作日志
      console.log(
        `User ${user.email} level reset: ${user.class} -> 0, traffic reset to 0`
      );
    }

    console.log(
      `Successfully reset ${expiredUsers.results.length} expired user levels`
    );
  } catch (error) {
    console.error("Error checking expired user levels:", error);
    throw error;
  }
}

// 清理过期会话
async function cleanupExpiredSessions(env: Env) {
  try {
    const cache = new CacheService(env.DB);
    await cache.cleanupExpiredSessions();
    console.log("Cleaned up expired sessions");
  } catch (error) {
    console.error("Error cleaning up sessions:", error);
  }
}

// 重置每日流量
async function resetDailyTraffic(env: Env) {
  try {
    await env.DB.prepare("UPDATE users SET transfer_today = 0").run();
    console.log("Reset daily traffic");
  } catch (error) {
    console.error("Error resetting daily traffic:", error);
  }
}

// 获取流量重置日
async function getTrafficResetDay(env: Env) {
  try {
    const result = await env.DB.prepare(
      "SELECT value FROM system_configs WHERE key = 'traffic_reset_day'"
    ).first<{ value?: unknown }>();
    const rawValue = result?.value;
    const value =
      typeof rawValue === "string"
        ? rawValue
        : rawValue !== undefined && rawValue !== null
        ? String(rawValue)
        : undefined;
    return Number.parseInt(value ?? "1", 10);
  } catch (error) {
    console.error("Error getting traffic reset day:", error);
    return 1;
  }
}

// 业务逻辑函数已移动到专门的服务类中
