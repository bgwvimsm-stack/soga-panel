// src/services/traffic-reset.ts - 流量重置服务

import type { Env } from "../types";
import type { Logger } from "../utils/logger";
import { DatabaseService } from "./database";
import { getLogger } from "../utils/logger";
import { getChanges, toRunResult } from "../utils/d1";

interface NodeResetStatRow {
  reset_day: number;
  node_count: number;
  total_bandwidth_used: number;
}

interface UserTrafficStatRow {
  total_users: number;
  total_daily_usage: number;
  total_usage: number;
  avg_daily_usage: number;
}

export class TrafficResetService {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly logger: Logger;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.logger = getLogger(env);
  }

  /**
   * 重置月流量
   * @param {number} resetDay - 重置日期
   */
  async resetMonthlyTraffic(resetDay) {
    const startTime = Date.now();
    
    try {
      this.logger.info(`开始重置月流量`, { reset_day: resetDay });

      const result = toRunResult(
        await this.db.db
        .prepare("UPDATE nodes SET node_bandwidth = 0 WHERE bandwidthlimit_resetday = ?")
        .bind(resetDay)
        .run()
      );

      const duration = Date.now() - startTime;
      const resetResult = {
        success: true,
        message: `Successfully reset monthly traffic for nodes with reset day ${resetDay}`,
        affected_rows: getChanges(result),
        reset_day: resetDay,
        duration
      };

      this.logger.info("月流量重置完成", resetResult);
      return resetResult;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("重置月流量失败", err, { reset_day: resetDay });
      return {
        success: false,
        error: err.message,
        reset_day: resetDay,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 重置每日流量
   */
  async resetDailyTraffic() {
    const startTime = Date.now();
    
    try {
      this.logger.info("开始重置每日流量");

      // 重置所有用户的每日流量统计
      const userResult = toRunResult(
        await this.db.db
        .prepare(`
          UPDATE users 
          SET upload_today = 0, 
              download_today = 0,
              updated_at = datetime('now', '+8 hours')
        `)
        .run()
      );

      // 重置所有节点的每日流量统计
      const nodeResult = toRunResult(
        await this.db.db
        .prepare(`
          UPDATE nodes 
          SET node_bandwidth_today = 0,
              updated_at = datetime('now', '+8 hours')
        `)
        .run()
      );

      const duration = Date.now() - startTime;
      const resetResult = {
        success: true,
        message: "Successfully reset daily traffic for all users and nodes",
        users_affected: getChanges(userResult),
        nodes_affected: getChanges(nodeResult),
        duration
      };

      this.logger.info("每日流量重置完成", resetResult);
      return resetResult;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("重置每日流量失败", err);
      return {
        success: false,
        error: err.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 清理历史流量数据（可选功能）
   * @param {number} daysToKeep - 保留多少天的历史数据
   */
  async cleanupHistoricalTraffic(daysToKeep = 30) {
    const startTime = Date.now();
    
    try {
      this.logger.info(`开始清理历史流量数据`, { days_to_keep: daysToKeep });

      // 清理过期的流量统计记录
      const result = toRunResult(
        await this.db.db
        .prepare(`
          DELETE FROM traffic_statistics 
          WHERE record_date < date('now', '-${daysToKeep} days')
        `)
        .run()
      );

      const duration = Date.now() - startTime;
      const cleanupResult = {
        success: true,
        message: `Successfully cleaned up historical traffic data older than ${daysToKeep} days`,
        deleted_records: getChanges(result),
        days_kept: daysToKeep,
        duration
      };

      this.logger.info("历史流量数据清理完成", cleanupResult);
      return cleanupResult;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("清理历史流量数据失败", err);
      return {
        success: false,
        error: err.message,
        days_to_keep: daysToKeep,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 获取流量重置统计
   */
  async getTrafficResetStats() {
    try {
      // 获取不同重置日的节点统计
      const nodeStats = await this.db.db
        .prepare(`
          SELECT 
            bandwidthlimit_resetday as reset_day,
            COUNT(*) as node_count,
            SUM(node_bandwidth) as total_bandwidth_used
          FROM nodes 
          WHERE bandwidthlimit_resetday IS NOT NULL
          GROUP BY bandwidthlimit_resetday
          ORDER BY bandwidthlimit_resetday
        `)
        .all<NodeResetStatRow>();

      // 获取用户流量统计
      const userStats = await this.db.db
        .prepare(`
          SELECT 
            COUNT(*) as total_users,
            SUM(upload_today + download_today) as total_daily_usage,
            SUM(u + d) as total_usage,
            AVG(upload_today + download_today) as avg_daily_usage
          FROM users
        `)
        .first<UserTrafficStatRow>();

      return {
        success: true,
        node_reset_stats: nodeStats.results ?? [],
        user_traffic_stats: userStats ?? {},
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("获取流量重置统计失败", err);
      return {
        success: false,
        error: err.message
      };
    }
  }
}
