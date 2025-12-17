import cron from "node-cron";
import type { AppEnv } from "./config/env";
import { DatabaseService } from "./services/database";
import { CacheService } from "./services/cache";

export type SchedulerJobKey =
  | "userExpirationCheck"
  | "dailyTasks"
  | "subscriptionCleanup";

export type SchedulerJobStatus = {
  key: SchedulerJobKey;
  name: string;
  schedule: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastResult: "success" | "error" | null;
  lastError: string | null;
};

type SchedulerState = {
  startedAt: string | null;
  timezone: string;
  jobs: Record<SchedulerJobKey, SchedulerJobStatus>;
};

type BarkUser = {
  id: number;
  username: string;
  email: string;
  bark_key: string;
  upload_today: number;
  download_today: number;
  transfer_enable: number;
  transfer_total: number;
  class_expire_time: string | null;
  class: number;
};

const schedulerState: SchedulerState = {
  startedAt: null,
  timezone: "Asia/Shanghai",
  jobs: {
    userExpirationCheck: {
      key: "userExpirationCheck",
      name: "user-expiration-check",
      schedule: "*/1 * * * *",
      lastRunAt: null,
      lastDurationMs: null,
      lastResult: null,
      lastError: null
    },
    dailyTasks: {
      key: "dailyTasks",
      name: "daily-traffic-reset-and-node-cleanup",
      schedule: "0 0 * * *",
      lastRunAt: null,
      lastDurationMs: null,
      lastResult: null,
      lastError: null
    },
    subscriptionCleanup: {
      key: "subscriptionCleanup",
      name: "subscription-logs-cleanup",
      schedule: "0 1 * * *",
      lastRunAt: null,
      lastDurationMs: null,
      lastResult: null,
      lastError: null
    }
  }
};

const CRON_TIMEZONE = "Asia/Shanghai";

function updateJobStatus(key: SchedulerJobKey, patch: Partial<SchedulerJobStatus>) {
  schedulerState.jobs[key] = {
    ...schedulerState.jobs[key],
    ...patch
  };
}

export function getSchedulerStatus() {
  return {
    startedAt: schedulerState.startedAt,
    timezone: schedulerState.timezone,
    jobs: Object.values(schedulerState.jobs)
  };
}

// Node 版定时任务：尽量对齐 Worker 版 SchedulerService 逻辑
export function startSchedulers(db: DatabaseService, cache: CacheService, env: AppEnv) {
  schedulerState.startedAt = new Date().toISOString();

  // 每分钟执行一次：检查过期用户（账号/等级），避免长时间挂在已过期状态
  cron.schedule(
    "*/1 * * * *",
    async () => {
      const started = Date.now();
      const startedAt = new Date().toISOString();
      updateJobStatus("userExpirationCheck", {
        lastRunAt: startedAt,
        lastResult: null,
        lastError: null,
        lastDurationMs: null
      });
      try {
        const expired = await db.getExpiredLevelUsers(true);
        const ids = expired.map((u: any) => u.id);
        await db.resetExpiredUsersLevel(ids);
        await db.logLevelResets(
          await Promise.all(ids.map((id: number) => db.resetUserLevel(id)))
        );
        console.log("[scheduler] user expiration check done", ids.length);
        updateJobStatus("userExpirationCheck", {
          lastResult: "success",
          lastDurationMs: Date.now() - started
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJobStatus("userExpirationCheck", {
          lastResult: "error",
          lastError: message,
          lastDurationMs: Date.now() - started
        });
        console.error("[scheduler] user expiration check failed", error);
      }
    },
    { timezone: CRON_TIMEZONE }
  );

  // 每天 00:00：每日流量重置 + 月度流量重置 + 节点状态/在线 IP 清理 + 流量汇总 + Bark 通知
  cron.schedule(
    "0 0 * * *",
    async () => {
      const started = Date.now();
      const startedAt = new Date().toISOString();
      updateJobStatus("dailyTasks", {
        lastRunAt: startedAt,
        lastResult: null,
        lastError: null,
        lastDurationMs: null
      });
      try {
        // 1）按用户聚合昨日流量并写入 daily_traffic / system_traffic_summary
        const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // 业务按 UTC+8（对齐 Worker 的 date('now','+8 hours')）
        now.setDate(now.getDate() - 1);
        const dateStr = now.toISOString().slice(0, 10);
        const aggResult = await db.aggregateTrafficForDate(dateStr);
        console.log("[scheduler] daily traffic aggregation done", dateStr, aggResult);

        // 2）发送 Bark 每日流量通知（使用重置前的 upload_today / download_today）
        const barkResult = await sendDailyBarkNotifications(db, env);
        console.log("[scheduler] daily Bark notifications", barkResult);

        // 3）每日流量字段清零（upload_today / download_today）
        await db.db
          .prepare(
            `
            UPDATE users 
            SET upload_today = 0,
                download_today = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE upload_today > 0 OR download_today > 0
          `
          )
          .run();
        console.log("[scheduler] daily transfer reset done");

        // 4）月度流量重置（复用 system_configs.traffic_reset_day）
        try {
          const configs = await db.db
            .prepare("SELECT `value` FROM system_configs WHERE `key` = 'traffic_reset_day'")
            .all<{ value: string | number | null }>();
          const value = configs.results?.[0]?.value ?? 0;
          const resetDay = Number.parseInt(String(value ?? "0"), 10);
          if (resetDay > 0 && resetDay <= 31) {
            const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
            const currentDay = beijing.getUTCDate();
            if (currentDay === resetDay) {
              const result = await db.db
                .prepare(
                  `
                  UPDATE users 
                  SET transfer_total = 0,
                      upload_traffic = 0,
                      download_traffic = 0,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE transfer_enable > 0
                `
                )
                .run();
              console.log(
                "[scheduler] monthly traffic reset done",
                "reset_day",
                resetDay,
                "affected",
                result
              );
            }
          }
        } catch (e) {
          console.error("[scheduler] monthly traffic reset failed", e);
        }

        // 5）节点状态/在线 IP 清理（保留近 7 天）
        await db.db
          .prepare("DELETE FROM node_status WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
          .run();
        await db.db
          .prepare("DELETE FROM online_ips WHERE last_seen < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)")
          .run();
        console.log("[scheduler] node status/online ip cleanup done");

        updateJobStatus("dailyTasks", {
          lastResult: "success",
          lastDurationMs: Date.now() - started
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJobStatus("dailyTasks", {
          lastResult: "error",
          lastError: message,
          lastDurationMs: Date.now() - started
        });
        console.error("[scheduler] daily tasks failed", error);
      }
    },
    { timezone: CRON_TIMEZONE }
  );

  // 每天 01:00：清理 7 天前订阅记录，并清理订阅缓存
  cron.schedule(
    "0 1 * * *",
    async () => {
      const started = Date.now();
      const startedAt = new Date().toISOString();
      updateJobStatus("subscriptionCleanup", {
        lastRunAt: startedAt,
        lastResult: null,
        lastError: null,
        lastDurationMs: null
      });
      try {
        // 计算 7 天前时间（UTC+8），转为时间字符串
        const now = new Date();
        const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(utc8.getTime() - 7 * 24 * 60 * 60 * 1000);
        const cutoff = sevenDaysAgo.toISOString().replace("T", " ").split(".")[0];

        await db.db
          .prepare(
            `
            DELETE FROM subscriptions
            WHERE request_time < ?
          `
          )
          .bind(cutoff)
          .run();
        await cache.deleteByPrefix("sub_token_");
        console.log("[scheduler] subscription logs cleanup done (7 days)");

        updateJobStatus("subscriptionCleanup", {
          lastResult: "success",
          lastDurationMs: Date.now() - started
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJobStatus("subscriptionCleanup", {
          lastResult: "error",
          lastError: message,
          lastDurationMs: Date.now() - started
        });
        console.error("[scheduler] subscription logs cleanup failed", error);
      }
    },
    { timezone: CRON_TIMEZONE }
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

async function sendDailyBarkNotifications(db: DatabaseService, env: AppEnv) {
  try {
    console.log("[scheduler] start daily Bark notifications");

    let siteName = env.SITE_NAME || "Soga Panel";
    let siteUrl = env.SITE_URL || "";

    try {
      const configRows = await db.db
        .prepare("SELECT `key`, `value` FROM system_configs WHERE `key` IN ('site_name','site_url')")
        .all<{ key: string; value: string | null }>();
      const configs = Object.fromEntries(
        (configRows.results || []).map((row) => [row.key, row.value ?? ""])
      );
      if (configs["site_name"]) siteName = String(configs["site_name"]);
      if (configs["site_url"]) siteUrl = String(configs["site_url"]);
    } catch (error) {
      console.warn("[scheduler] load system configs for Bark failed:", error);
    }

    const usersResult = await db.db
      .prepare(
        `
        SELECT id,
               username,
               email,
               bark_key,
               upload_today,
               download_today,
               transfer_enable,
               transfer_total,
               class_expire_time,
               class
        FROM users
        WHERE bark_enabled = 1
          AND bark_key IS NOT NULL
          AND bark_key != ''
          AND class > 0
        ORDER BY id
      `
      )
      .all<BarkUser>();
    const users = (usersResult.results || []) as BarkUser[];

    if (!users.length) {
      console.log("[scheduler] no Bark users to notify");
      return { success: true, message: "no bark users", sent_count: 0, failed_count: 0 };
    }

    console.log("[scheduler] Bark users:", users.length);

    const now = new Date();
    const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const timeStr = utc8.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    let sentCount = 0;
    let failedCount = 0;
    const batchSize = 5;

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const promises = batch.map((user) =>
        sendBarkNotification(db, user, timeStr, siteName, siteUrl)
      );
      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        const user = batch[index];
        if (result.status === "fulfilled") {
          if (result.value.success) {
            sentCount += 1;
            console.log("[scheduler] Bark sent to", user.username);
          } else {
            failedCount += 1;
            console.error(
              "[scheduler] Bark failed for",
              user.username,
              "error:",
              result.value.error
            );
          }
        } else {
          failedCount += 1;
          const reason =
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason ?? "Unknown error"));
          console.error("[scheduler] Bark failed for", user.username, reason);
        }
      });
    }

    const message = `Bark通知发送完成: 成功 ${sentCount} 个, 失败 ${failedCount} 个`;
    console.log("[scheduler]", message);

    return {
      success: true,
      message,
      sent_count: sentCount,
      failed_count: failedCount,
      total_bark_users: users.length
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[scheduler] daily Bark notifications failed:", err);
    return {
      success: false,
      message: `发送Bark通知失败: ${err.message}`,
      error: err.message
    };
  }
}

async function sendBarkNotification(
  db: DatabaseService,
  user: BarkUser,
  timeStr: string,
  siteName: string,
  siteUrl: string
) {
  try {
    const todayUsageBytes = (user.upload_today || 0) + (user.download_today || 0);
    const todayTotalTraffic = formatBytes(todayUsageBytes);
    const remainTraffic = formatBytes(
      Math.max(0, (user.transfer_enable || 0) - (user.transfer_total || 0))
    );

    let classExpireText = "永不过期";
    if (user.class_expire_time) {
      try {
        const expireDate = new Date(user.class_expire_time);
        classExpireText = expireDate.toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });
      } catch {
        classExpireText = user.class_expire_time;
      }
    }

    const title = "每日流量使用情况";
    let body: string;
    if (todayUsageBytes > 0) {
      body = `${user.username}，您好！\n\n您今日已用流量为 ${todayTotalTraffic}\n剩余流量为 ${remainTraffic}\n\n您的等级到期时间为 ${classExpireText}\n\n发送时间：${timeStr}\n祝您使用愉快！`;
    } else {
      body = `${user.username}，您好！\n\n今日您未使用流量\n剩余流量为 ${remainTraffic}\n\n您的等级到期时间为 ${classExpireText}\n\n发送时间：${timeStr}\n祝您使用愉快！`;
    }

    let endpoint = "https://api.day.app";
    let keyPath = user.bark_key;

    if (user.bark_key.startsWith("http")) {
      const url = new URL(user.bark_key);
      endpoint = `${url.protocol}//${url.host}`;
      const path = url.pathname.replace(/^\//, "");
      keyPath = path || "push";
    }

    const response = await fetch(`${endpoint}/${keyPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Soga-Panel-Server/1.0"
      },
      body: JSON.stringify({
        title,
        body,
        badge: 1,
        sound: "default",
        action: "none",
        group: siteName || "流量管理",
        icon: siteUrl ? `${siteUrl.replace(/\/?$/, "")}/favicon.ico` : undefined,
        url: siteUrl || undefined
      })
    });

    if (!response.ok) {
      await db.updateUserBarkSettings(user.id, user.bark_key, false);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let result: any = null;
    try {
      result = await response.json();
    } catch {
      // 部分 Bark 服务可能不返回 JSON，忽略解析错误
    }

    const code = typeof result?.code === "number" ? result.code : undefined;
    if (code === 200 || result?.message === "success") {
      return { success: true, message: "通知发送成功" };
    }

    await db.updateUserBarkSettings(user.id, user.bark_key, false);
    const msg = typeof result?.message === "string" ? result.message : "Unknown error";
    throw new Error(`Bark API 返回错误: code=${code ?? "N/A"}, message=${msg}`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[scheduler] send Bark failed for user", user.id, err);
    return { success: false, error: err.message };
  }
}
