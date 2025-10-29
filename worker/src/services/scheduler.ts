// src/services/scheduler.ts - 统一定时任务服务

import type { Env } from "../types";
import type { Logger } from "../utils/logger";
import { DatabaseService } from "./database";
import { ExpiryCheckerService } from "./expiry-checker";
import { TrafficResetService } from "./traffic-reset";
import { getLogger } from "../utils/logger";
import { getChanges, toRunResult } from "../utils/d1";

interface NodeResetRow {
  id: number;
  name: string;
  node_bandwidth: number;
  node_bandwidth_limit: number;
  bandwidthlimit_resetday: number;
  status?: number;
}

interface DailyTrafficUserRow {
  id: number;
  username: string;
  upload_today: number;
  download_today: number;
  upload_traffic: number;
  download_traffic: number;
  transfer_total: number;
  transfer_enable: number;
}

interface ConfigRow {
  value: string | number | null;
}

type BarkUser = DailyTrafficUserRow & {
  email: string;
  bark_key: string;
  class_expire_time: string | null;
  class: number;
};

export class SchedulerService {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly logger: Logger;
  private readonly expiryChecker: ExpiryCheckerService;
  private readonly trafficReset: TrafficResetService;

  constructor(env: Env) {
    this.db = new DatabaseService(env.DB);
    this.env = env;
    this.logger = getLogger(env);
    this.expiryChecker = new ExpiryCheckerService(env);
    this.trafficReset = new TrafficResetService(env);
  }

  /**
   * 检查并重置需要重置流量的节点
   */
  async checkNodeTrafficReset() {
    try {
      console.log('开始检查节点流量重置...');
      
      // 获取当前UTC+8时区的日期
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const currentDay = utc8Time.getDate(); // 获取当前日期（1-31）
      
      // 查找需要在今天重置流量的节点
      const nodesResult = await this.db.db.prepare(`
        SELECT id, name, node_bandwidth, node_bandwidth_limit, bandwidthlimit_resetday
        FROM nodes 
        WHERE bandwidthlimit_resetday = ? 
        AND status = 1
      `).bind(currentDay).all<NodeResetRow>();
      const nodes = nodesResult.results ?? [];
      
      console.log(`找到 ${nodes.length} 个需要在今天重置流量的节点`);
      
      if (nodes.length === 0) {
        return { success: true, message: '没有节点需要重置流量' };
      }
      
      let resetCount = 0;
      for (const node of nodes) {
        try {
          await this.db.db.prepare(`
            UPDATE nodes 
            SET node_bandwidth = 0,
                updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `).bind(node.id).run();
          
          resetCount++;
          console.log(`节点 ${node.name} (ID: ${node.id}) 流量已重置`);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(`重置节点 ${node.id} 流量失败:`, err);
        }
      }
      
      console.log(`节点流量重置完成，共重置了 ${resetCount} 个节点`);
      
      return {
        success: true,
        message: `成功重置 ${resetCount} 个节点的流量`,
        reset_count: resetCount
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('节点流量重置检查失败:', err);
      return {
        success: false,
        message: `节点流量重置检查失败: ${err.message}`
      };
    }
  }

  /**
   * 每日流量重置任务 - 在UTC+8时区的每日0点执行
   */
  async dailyTrafficReset() {
    try {
      console.log('开始执行每日流量重置任务...');
      
      // 获取当前UTC+8时区的日期
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const yesterday = new Date(utc8Time.getTime() - (24 * 60 * 60 * 1000));
      const recordDate = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD格式
      
      console.log(`处理日期: ${recordDate} 的流量数据`);
      
      // 1. 获取所有用户的当前流量数据
      const usersResult = await this.db.db.prepare(`
        SELECT id, username, upload_traffic, download_traffic, upload_today, download_today, transfer_total, transfer_enable
        FROM users 
        WHERE upload_today > 0 OR download_today > 0
        ORDER BY id
      `).all<DailyTrafficUserRow>();
      const users = (usersResult.results ?? []) as DailyTrafficUserRow[];
      
      console.log(`找到 ${users.length} 个有流量使用的用户`);
      
      if (users.length === 0) {
        console.log('没有用户需要重置流量，但仍需发送Bark通知和检查节点流量重置');
        
        // 即使没有用户需要重置流量，仍然需要发送Bark通知给符合条件的用户
        const notificationResult = await this.sendDailyResetNotifications();
        
        // 检查节点流量重置
        const nodeResetResult = await this.checkNodeTrafficReset();
        
        return { 
          success: true, 
          message: `没有用户需要重置流量，但已发送 ${notificationResult.sent_count || 0} 条Bark通知，${nodeResetResult.reset_count || 0} 个节点的流量已重置`,
          processed_users: 0,
          notification_result: notificationResult,
          node_reset_result: nodeResetResult
        };
      }

      let processedUsers = 0;
      
      // 2. 为每个用户记录昨日流量
      for (const user of users) {
        try {
          await this.recordDailyTraffic(user, recordDate);
          processedUsers++;
        } catch (userError) {
          console.error(`处理用户 ${user.id} 流量重置失败:`, userError);
          // 继续处理其他用户，不中断整个任务
        }
      }
      
      // 3. 在重置之前发送Bark通知给启用通知且等级超过1的用户（使用重置前的流量数据）
      const notificationResult = await this.sendDailyResetNotifications();
      
      // 4. 重置所有用户的当日流量
      await this.resetDailyTraffic();
      
      // 5. 检查并重置需要重置的节点流量
      const nodeResetResult = await this.checkNodeTrafficReset();
      
      console.log(`流量重置任务完成，处理了 ${processedUsers} 个用户`);
      
      return {
        success: true,
        message: `成功重置 ${processedUsers} 个用户的流量，${nodeResetResult.reset_count || 0} 个节点的流量`,
        processed_users: processedUsers,
        notification_result: notificationResult,
        node_reset_result: nodeResetResult
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('每日流量重置任务失败:', err);
      return {
        success: false,
        message: `流量重置任务失败: ${err.message}`
      };
    }
  }

  /**
   * 记录单个用户的每日流量
   */
  async recordDailyTraffic(user: DailyTrafficUserRow, recordDate: string) {
    try {
      const totalTraffic = (user.upload_today || 0) + (user.download_today || 0);
      
      // 检查是否已存在记录
      const existingResult = await this.db.db.prepare(
        'SELECT id FROM daily_traffic WHERE user_id = ? AND record_date = ?'
      ).bind(user.id, recordDate).all<{ id: number }>();
      const existing = existingResult.results ?? [];
      
      if (existing.length === 0) {
        // 插入新记录，使用今日流量数据，created_at使用UTC+8时区的datetime格式
        await this.db.db.prepare(`
          INSERT INTO daily_traffic (user_id, record_date, upload_traffic, download_traffic, total_traffic, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'))
        `).bind(
          user.id,
          recordDate, 
          user.upload_today || 0,
          user.download_today || 0,
          totalTraffic
        ).run();
        
        console.log(`记录用户 ${user.username} 流量: 上传 ${this.formatBytes(user.upload_today || 0)}, 下载 ${this.formatBytes(user.download_today || 0)}`);
      } else {
        console.log(`用户 ${user.username} 在 ${recordDate} 的流量记录已存在`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`为用户 ${user.username} 记录流量失败:`, err);
      throw err;
    }
  }

  /**
   * 重置所有用户的当日流量
   */
  async resetDailyTraffic() {
    try {
      // 重置所有用户的当日流量，使用UTC+8时区的datetime格式
      const result = toRunResult(
        await this.db.db.prepare(`
        UPDATE users 
        SET upload_today = 0, 
            download_today = 0,
            updated_at = datetime('now', '+8 hours')
        WHERE upload_today > 0 OR download_today > 0
      `).run()
      );
      
      console.log(`重置了 ${getChanges(result)} 个用户的当日流量`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('重置当日流量失败:', err);
      throw err;
    }
  }


  /**
   * 清理过期数据任务
   */
  async cleanupExpiredData(retentionDays = 90) {
    try {
      console.log('开始清理过期数据...');
      
      // 使用UTC+8时区计算截止日期
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const cutoffDate = new Date(utc8Time.getTime() - (retentionDays * 24 * 60 * 60 * 1000));
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      
      // 清理每日流量记录
      const dailyResult = toRunResult(
        await this.db.db.prepare(
        'DELETE FROM daily_traffic WHERE record_date < ?'
      ).bind(cutoffDateStr).run()
      );
      
      console.log(`清理了 ${getChanges(dailyResult)} 条每日记录`);
      
      return {
        success: true,
        message: `清理了 ${getChanges(dailyResult)} 条过期记录`
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('清理过期数据失败:', err);
      return {
        success: false,
        message: `清理过期数据失败: ${err.message}`
      };
    }
  }

  /**
   * 获取用户流量趋势数据
   */
  async getUserTrafficTrends(userId: number, days = 30) {
    try {
      const trendsResult = await this.db.db.prepare(`
        SELECT record_date, upload_traffic, download_traffic, total_traffic
        FROM daily_traffic
        WHERE user_id = ? AND record_date >= date('now', '+8 hours', '-${days} days')
        ORDER BY record_date DESC
        LIMIT ?
      `).bind(userId, days).all<{ record_date: string; upload_traffic: number; download_traffic: number; total_traffic: number }>();
      const trends = trendsResult.results ?? [];
      
      return trends;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('获取用户流量趋势失败:', err);
      return [];
    }
  }


  /**
   * 手动触发流量统计更新
   */
  async manualTrafficUpdate(userId: number | null = null) {
    try {
      // 使用UTC+8时区获取今日日期
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const today = utc8Time.toISOString().split('T')[0];
      
      if (userId) {
        // 更新单个用户
        const userResult = await this.db.db.prepare(
          'SELECT id, username, upload_traffic, download_traffic, upload_today, download_today FROM users WHERE id = ?'
        ).bind(userId).all<DailyTrafficUserRow>();
        const user = userResult.results ?? [];
        
        if (user.length > 0) {
          const target = user[0] as DailyTrafficUserRow;
          await this.recordDailyTraffic(target, today);
          return { success: true, message: `已更新用户 ${target.username} 的流量统计` };
        } else {
          return { success: false, message: '用户不存在' };
        }
      } else {
        // 更新所有用户
        const usersResult = await this.db.db.prepare(`
          SELECT id, username, upload_traffic, download_traffic, upload_today, download_today
          FROM users 
          WHERE upload_today > 0 OR download_today > 0
        `).all<DailyTrafficUserRow>();
        const users = usersResult.results ?? [];
        
        for (const user of users) {
          await this.recordDailyTraffic(user as DailyTrafficUserRow, today);
        }
        
        return { success: true, message: `已更新 ${users.length} 个用户的流量统计` };
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('手动流量更新失败:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 检查并处理过期用户
   */
  async checkExpiredUsers() {
    try {
      console.log('开始检查过期用户...');
      
      // 获取当前UTC+8时间
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      
      // 检查账户过期的用户
      const expiredUsersResult = await this.db.db.prepare(`
        SELECT id, username, email, expire_time
        FROM users 
        WHERE expire_time IS NOT NULL 
        AND expire_time <= datetime('now', '+8 hours')
        AND status = 1
      `).all();
      const expiredUsers = expiredUsersResult.results || [];
      
      let disabledCount = 0;
      if (expiredUsers && expiredUsers.length > 0) {
        for (const user of expiredUsers) {
          try {
            // 禁用过期用户
            await this.db.db.prepare(`
              UPDATE users 
              SET status = 0,
                  updated_at = datetime('now', '+8 hours')
              WHERE id = ?
            `).bind(user.id).run();
            
            disabledCount++;
            console.log(`用户 ${user.username} (${user.email}) 已过期并被禁用`);
          } catch (error) {
            console.error(`禁用用户 ${user.username} 失败:`, error);
          }
        }
      }
      
      // 检查等级过期的用户
      const expiredLevelUsersResult = await this.db.db.prepare(`
        SELECT id, username, class, class_expire_time
        FROM users 
        WHERE class_expire_time IS NOT NULL 
        AND class_expire_time <= datetime('now', '+8 hours')
        AND class > 1
      `).all();
      const expiredLevelUsers = expiredLevelUsersResult.results || [];
      
      let resetLevelCount = 0;
      if (expiredLevelUsers && expiredLevelUsers.length > 0) {
        for (const user of expiredLevelUsers) {
          try {
            // 重置用户等级为默认等级1
            await this.db.db.prepare(`
              UPDATE users 
              SET class = 1,
                  class_expire_time = NULL,
                  updated_at = datetime('now', '+8 hours')
              WHERE id = ?
            `).bind(user.id).run();
            
            resetLevelCount++;
            console.log(`用户 ${user.username} 等级已从 ${user.class} 重置为 1`);
          } catch (error) {
            console.error(`重置用户 ${user.username} 等级失败:`, error);
          }
        }
      }
      
      const message = `检查完成: 禁用 ${disabledCount} 个过期用户, 重置 ${resetLevelCount} 个等级过期用户`;
      console.log(message);
      
      return {
        success: true,
        message: message,
        disabled_users: disabledCount,
        reset_level_users: resetLevelCount
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('检查过期用户失败:', err);
      return {
        success: false,
        message: `检查过期用户失败: ${err.message}`
      };
    }
  }

  /**
   * 格式化字节数
   */
  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * 检查是否需要执行定时任务
   */
  static shouldRunScheduledTask() {
    const now = new Date();
    const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const hour = utc8Time.getHours();
    const minute = utc8Time.getMinutes();
    
    // 在UTC+8时区的0点0-5分之间执行
    return hour === 0 && minute >= 0 && minute < 5;
  }

  /**
   * 手动执行每日流量重置（供外部调用）
   */
  async executeDailyTrafficReset() {
    return await this.dailyTrafficReset();
  }

  /**
   * 检查并执行月度流量重置
   */
  async checkMonthlyTrafficReset() {
    try {
      console.log('开始检查月度流量重置...');
      
      // 获取系统配置的流量重置日
      const configResult = await this.db.db.prepare(`
        SELECT value FROM system_configs WHERE key = 'traffic_reset_day'
      `).all<ConfigRow>();
      
      const configs = configResult.results ?? [];
      if (configs.length === 0) {
        this.logger.debug('未找到traffic_reset_day配置，跳过月度流量重置');
        return { success: true, message: '未配置流量重置日', reset_count: 0 };
      }
      
      const resetDay = Number.parseInt(String(configs[0].value ?? "0"), 10);
      
      // 如果设置为0，表示不执行每月定时任务
      if (resetDay === 0) {
        this.logger.debug('traffic_reset_day设置为0，跳过月度流量重置');
        return { success: true, message: '已禁用月度流量重置', reset_count: 0 };
      }
      
      // 验证重置日期有效性（1-31）
      if (resetDay < 1 || resetDay > 31) {
        this.logger.warn(`traffic_reset_day配置无效: ${resetDay}，应设置为0-31`);
        return { success: false, message: '流量重置日配置无效', reset_count: 0 };
      }
      
      // 获取北京时间
      const now = new Date();
      const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const currentDay = beijingTime.getUTCDate();
      
      console.log(`当前日期: ${currentDay}，配置重置日: ${resetDay}`);
      
      if (currentDay !== resetDay) {
        console.log('不是流量重置日，跳过月度流量重置');
        return { success: true, message: '不是流量重置日', reset_count: 0 };
      }
      
      console.log('开始执行月度流量重置...');
      
      // 重置所有用户的月度流量统计
      const result = toRunResult(
        await this.db.db.prepare(`
        UPDATE users 
        SET transfer_total = 0,
            upload_traffic = 0, 
            download_traffic = 0,
            updated_at = datetime('now', '+8 hours')
        WHERE transfer_enable > 0
      `).run()
      );
      
      const resetCount = getChanges(result);
      const message = `月度流量重置完成，重置了 ${resetCount} 个用户的流量统计`;
      
      console.log(message);
      
      return {
        success: true,
        message,
        reset_count: resetCount,
        reset_day: resetDay,
        current_day: currentDay
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('月度流量重置失败:', err);
      return {
        success: false,
        message: `月度流量重置失败: ${err.message}`,
        reset_count: 0
      };
    }
  }

  /**
   * 清理节点状态历史数据
   */
  async cleanupNodeStatusData() {
    try {
      console.log('开始清理节点状态数据...');
      
      // 获取当前UTC+8时区的时间
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      
      // 清空所有节点状态数据
      const result = toRunResult(await this.db.db.prepare('DELETE FROM node_status').run());
      
      const deletedCount = getChanges(result);
      console.log(`清理了 ${deletedCount} 条节点状态记录`);
      
      return {
        success: true,
        message: `成功清理 ${deletedCount} 条节点状态记录`,
        deleted_count: deletedCount,
        cleanup_time: utc8Time.toISOString()
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('清理节点状态数据失败:', err);
      return {
        success: false,
        message: `清理节点状态数据失败: ${err.message}`,
        error: err.message
      };
    }
  }

  /**
   * 发送每日重置通知给启用Bark通知且等级超过1的用户
   */
  async sendDailyResetNotifications() {
    try {
      console.log('开始发送每日重置Bark通知...');

      const siteName = await this.configManager.getSystemConfig('site_name', (this.env.SITE_NAME as string) || 'Soga Panel');
      const siteUrl = await this.configManager.getSystemConfig('site_url', (this.env.SITE_URL as string) || '');

      const usersWithBarkResult = await this.db.db.prepare(`
        SELECT id, username, email, bark_key, upload_today, download_today,
               transfer_enable, transfer_total, class_expire_time, class
        FROM users
        WHERE bark_enabled = 1 AND bark_key IS NOT NULL AND bark_key != ''
        AND class > 0
        ORDER BY id
      `).all<BarkUser>();
      const usersWithBark = (usersWithBarkResult.results ?? []) as BarkUser[];

      if (!usersWithBark || usersWithBark.length === 0) {
        console.log('没有符合条件的用户需要发送Bark通知 (需要等级>0且启用Bark)');
        return { success: true, message: '没有符合条件的用户需要发送Bark通知', sent_count: 0 };
      }

      console.log(`找到 ${usersWithBark.length} 个符合条件的用户 (等级>0且启用Bark通知)`);

      let sentCount = 0;
      let failedCount = 0;

      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const timeStr = utc8Time.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      const batchSize = 5;
      for (let i = 0; i < usersWithBark.length; i += batchSize) {
        const batch = usersWithBark.slice(i, i + batchSize);
        const promises = batch.map(user => this.sendBarkNotification(user, timeStr, siteName, siteUrl));

        const results = await Promise.allSettled(promises);

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              sentCount++;
              console.log(`成功发送通知给用户 ${batch[index].username}`);
            } else {
              failedCount++;
              console.error(`发送通知给用户 ${batch[index].username} 失败:`, result.value.error);
            }
          } else {
            failedCount++;
            const reason = result.reason instanceof Error ? result.reason : new Error(String(result.reason ?? 'Unknown error'));
            console.error(`发送通知给用户 ${batch[index].username} 失败:`, reason);
          }
        });
      }

      const message = `Bark通知发送完成: 成功 ${sentCount} 个, 失败 ${failedCount} 个`;
      console.log(message);

      return {
        success: true,
        message: message,
        sent_count: sentCount,
        failed_count: failedCount,
        total_bark_users: usersWithBark.length
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('发送每日重置Bark通知失败:', err);
      return {
        success: false,
        message: `发送Bark通知失败: ${err.message}`,
        error: err.message
      };
    }
  }

  /**
   * 发送单个Bark通知
   */
  async sendBarkNotification(user: BarkUser, timeStr: string, siteName: string, siteUrl: string) {
    try {
      // 直接使用传入的用户数据（重置前的数据）
      // 计算今日总使用流量并格式化
      const todayTotalTraffic = this.formatBytes((user.upload_today || 0) + (user.download_today || 0));
      const remainTraffic = this.formatBytes(Math.max(0, user.transfer_enable - user.transfer_total));
      
      // 格式化等级过期时间
      let classExpireText = '永不过期';
      if (user.class_expire_time) {
        try {
          const expireDate = new Date(user.class_expire_time);
          classExpireText = expireDate.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        } catch (e) {
          classExpireText = user.class_expire_time;
        }
      }
      
      // 构建通知消息
      const title = '每日流量使用情况';
      const todayUsage = (user.upload_today || 0) + (user.download_today || 0);
      let body;
      
      if (todayUsage > 0) {
        // 有使用流量的情况
        body = `${user.username}，您好！\n\n您今日已用流量为 ${todayTotalTraffic}\n剩余流量为 ${remainTraffic}\n\n您的等级到期时间为 ${classExpireText}\n\n祝您使用愉快！`;
      } else {
        // 没有使用流量的情况
        body = `${user.username}，您好！\n\n今日您未使用流量\n剩余流量为 ${remainTraffic}\n\n您的等级到期时间为 ${classExpireText}\n\n祝您使用愉快！`;
      }
      
      let endpoint = 'https://api.day.app';
      let keyPath = user.bark_key;

      if (user.bark_key.startsWith('http')) {
        const url = new URL(user.bark_key);
        endpoint = `${url.protocol}//${url.host}`;
        const path = url.pathname.replace(/^\//, '');
        keyPath = path || 'push';
      }

      const response = await fetch(`${endpoint}/${keyPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': 'Soga-Panel/1.0'
        },
        body: JSON.stringify({
          title,
          body,
          badge: 1,
          sound: 'default',
          group: siteName || '流量管理',
          icon: siteUrl ? `${siteUrl.replace(/\/?$/, '')}/favicon.ico` : undefined,
          url: siteUrl || undefined
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = (await response.json()) as { code?: number; message?: string };
      const code = typeof result.code === 'number' ? result.code : undefined;
      
      if (code === 200) {
        return { success: true, message: '通知发送成功' };
      } else {
        const message = typeof result.message === 'string' ? result.message : 'Unknown error';
        throw new Error(`Bark API返回错误: code=${code ?? 'N/A'}, message=${message}`);
      }
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.disableBarkNotification(user.id);
      return { success: false, error: err.message };
    }
  }

  /**
   * 禁用用户的Bark通知
   */
  async disableBarkNotification(userId) {
    try {
      await this.db.db
        .prepare("UPDATE users SET bark_enabled = 0, updated_at = datetime('now', '+8 hours') WHERE id = ?")
        .bind(userId)
        .run();
      console.log(`已禁用用户 ${userId} 的Bark通知`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`禁用用户 ${userId} Bark通知失败:`, err);
    }
  }

  /**
   * 清理7天前的订阅记录
   */
  async cleanupOldSubscriptionLogs() {
    try {
      console.log('开始清理7天前的订阅记录...');
      
      // 获取当前UTC+8时区的时间
      const now = new Date();
      const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      
      // 计算7天前的时间
      const sevenDaysAgo = new Date(utc8Time.getTime() - (7 * 24 * 60 * 60 * 1000));
      const cutoffTime = sevenDaysAgo.toISOString().replace('T', ' ').split('.')[0];
      
      console.log(`清理截止时间: ${cutoffTime} (UTC+8)`);
      
      // 删除7天前的订阅记录
      const result = toRunResult(
        await this.db.db.prepare(`
        DELETE FROM subscriptions 
        WHERE request_time < ?
      `).bind(cutoffTime).run()
      );
      
      const deletedCount = getChanges(result);
      console.log(`清理了 ${deletedCount} 条7天前的订阅记录`);
      
      return {
        success: true,
        message: `成功清理 ${deletedCount} 条7天前的订阅记录`,
        deleted_count: deletedCount,
        cleanup_time: utc8Time.toISOString()
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('清理订阅记录失败:', err);
      return {
        success: false,
        message: `清理订阅记录失败: ${err.message}`,
        error: err.message
      };
    }
  }

  /**
   * 检查并执行定时任务
   */
  async checkAndRunScheduledTasks() {
    try {
      const now = new Date();
      const utc8Time = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const hour = utc8Time.getHours();
      const minute = utc8Time.getMinutes();
      
      // 检查是否是UTC+8时区的0点0-5分
      if (hour === 0 && minute < 5) {
        console.log('检测到UTC+8时区0点，开始执行定时任务');
        
        const trafficResetResult = await this.dailyTrafficReset();
        const cleanupResult = await this.cleanupExpiredData();
        const nodeStatusCleanupResult = await this.cleanupNodeStatusData();
        
        return {
          success: true,
          traffic_reset: trafficResetResult,
          cleanup: cleanupResult,
          node_status_cleanup: nodeStatusCleanupResult
        };
      }
      
      return {
        success: true,
        message: '当前不是定时任务执行时间'
      };
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('定时任务检查失败:', err);
      return {
        success: false,
        message: `定时任务检查失败: ${err.message}`
      };
    }
  }
}
