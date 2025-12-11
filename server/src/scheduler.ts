import cron from "node-cron";
import { DatabaseService } from "./services/database";
import { CacheService } from "./services/cache";

// 简易定时任务：每日流量重置、等级过期检查、订阅记录清理
export function startSchedulers(db: DatabaseService, cache: CacheService) {
  // 每天 00:05 重置 transfer_today
  cron.schedule("5 0 * * *", async () => {
    try {
      await db.db.prepare("UPDATE users SET upload_today = 0, download_today = 0").run();
      console.log("[scheduler] daily transfer reset done");
    } catch (error) {
      console.error("[scheduler] daily transfer reset failed", error);
    }
  });

  // 每天 00:10 检查等级过期
  cron.schedule("10 0 * * *", async () => {
    try {
      const expired = await db.getExpiredLevelUsers();
      const ids = expired.map((u) => u.id);
      await db.resetExpiredUsersLevel(ids);
      await db.logLevelResets(
        await Promise.all(ids.map((id) => db.resetUserLevel(id)))
      );
      console.log("[scheduler] expired level reset done", ids.length);
    } catch (error) {
      console.error("[scheduler] expired level reset failed", error);
    }
  });

  // 每天 01:00 清理 30 天前的订阅日志
  cron.schedule("0 1 * * *", async () => {
    try {
      await db.db.prepare("DELETE FROM subscriptions WHERE request_time < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)").run();
      await cache.deleteByPrefix("sub_token_");
      console.log("[scheduler] subscription logs cleanup done");
    } catch (error) {
      console.error("[scheduler] subscription logs cleanup failed", error);
    }
  });

  // 每天 00:20 汇总昨日流量到 daily_traffic / system_traffic_summary
  cron.schedule("20 0 * * *", async () => {
    try {
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+8 对齐
      now.setDate(now.getDate() - 1);
      const dateStr = now.toISOString().slice(0, 10);
      const result = await db.aggregateTrafficForDate(dateStr);
      console.log("[scheduler] traffic aggregation done", dateStr, result);
    } catch (error) {
      console.error("[scheduler] traffic aggregation failed", error);
    }
  });

  // 每天 03:00 清理过期节点状态/在线 IP 记录
  cron.schedule("0 3 * * *", async () => {
    try {
      await db.db
        .prepare("DELETE FROM node_status WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
        .run();
      await db.db
        .prepare("DELETE FROM online_ips WHERE last_seen < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
        .run();
      console.log("[scheduler] node status/online ip cleanup done");
    } catch (error) {
      console.error("[scheduler] node status cleanup failed", error);
    }
  });
}
