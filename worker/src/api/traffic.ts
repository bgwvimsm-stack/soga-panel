import type { Env } from '../types';
import { DatabaseService } from '../services/database';
import { SchedulerService } from '../services/scheduler';
import { validateUserAuth } from '../middleware/auth';
import { successResponse as success, errorResponse as error } from '../utils/response';
import { ensureNumber } from '../utils/d1';

type AuthenticatedUser = {
  id: number;
  is_admin?: boolean;
  [key: string]: unknown;
};

type TrendRow = {
  date: string;
  label: string;
  upload_traffic: number | null;
  download_traffic: number | null;
  total_traffic: number | null;
};

type DailyTrafficRow = {
  date: string;
  upload_traffic: number | null;
  download_traffic: number | null;
  total_traffic: number | null;
};

type SummaryRow = {
  week_upload?: number | null;
  week_download?: number | null;
  week_total?: number | null;
  month_upload?: number | null;
  month_download?: number | null;
  month_total?: number | null;
  active_days?: number | null;
};

type PeakTrafficRow = {
  record_date: string;
  total_traffic: number | null;
  upload_traffic: number | null;
  download_traffic: number | null;
};

type CountRow = {
  count: number;
};

type WeeklyTrendRow = {
  record_date: string;
  total_traffic: number | null;
  total_users: number | null;
};

type SystemTrendRow = {
  date: string;
  upload_traffic: number | null;
  download_traffic: number | null;
  total_traffic: number | null;
  active_users: number | null;
};

type TrafficLogRow = {
  id: number;
  user_id: number;
  node_id: number;
  node_name: string | null;
  upload_traffic: number | null;
  download_traffic: number | null;
  actual_upload_traffic: number | null;
  actual_download_traffic: number | null;
  total_traffic: number | null;
  actual_traffic: number | null;
  deduction_multiplier: number | null;
  log_time: string;
  created_at: string;
};

type DailyTrafficRecordRow = {
  id: number;
  user_id: number;
  node_id: number;
  node_name: string;
  upload_traffic: number | null;
  download_traffic: number | null;
  actual_upload_traffic: number | null;
  actual_download_traffic: number | null;
  total_traffic: number | null;
  actual_traffic: number | null;
  deduction_multiplier: number | null;
  log_time: string;
  created_at: string;
};

type TodayTrafficSummaryRow = {
  total_upload: number | null;
  total_download: number | null;
  total_today: number | null;
};

type SchedulerResult = {
  success: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
};

type ManualTrafficUpdateResult = {
  success: boolean;
  message?: string;
  error?: string;
};

type UserTrafficTrend = {
  date: string;
  label: string;
  upload_traffic: number;
  download_traffic: number;
  total_traffic: number;
};

export class TrafficAPI {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly scheduler: SchedulerService;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.scheduler = new SchedulerService(env);
  }

  // 获取用户流量趋势数据（按日期统计）
  async getUserTrafficTrends(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return error("用户信息异常", 500);
      }

      const url = new URL(request.url);
      const period = url.searchParams.get('period') || 'today'; // today, 3days, 7days
      
      let trends: UserTrafficTrend[] = [];
      
      if (period === 'today') {
        const todayResult = await this.db.db
          .prepare(`
            SELECT 
              date('now', '+8 hours') as date,
              '今天' as label,
              COALESCE(SUM(actual_upload_traffic), 0) as upload_traffic,
              COALESCE(SUM(actual_download_traffic), 0) as download_traffic,
              COALESCE(SUM(actual_traffic), 0) as total_traffic
            FROM traffic_logs
            WHERE user_id = ? AND date = date('now', '+8 hours')
          `)
          .bind(userId)
          .first<TrendRow>();

        if (todayResult) {
          trends = [{
            date: todayResult.date,
            label: todayResult.label,
            upload_traffic: ensureNumber(todayResult.upload_traffic),
            download_traffic: ensureNumber(todayResult.download_traffic),
            total_traffic: ensureNumber(todayResult.total_traffic)
          }];
        }
      } else {
        // 获取最近N天的流量数据
        const daysCount = period === '3days' ? 3 : 7;
        
        // 生成日期列表
        const dateList = [];
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        
        for (let i = daysCount - 1; i >= 0; i--) {
          const targetDate = new Date(beijingTime.getTime() - i * 24 * 60 * 60 * 1000);
          const dateStr = targetDate.toISOString().split('T')[0];
          const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
          const dayName = dayNames[targetDate.getDay()];
          
          dateList.push({
            date: dateStr,
            label: i === 0 ? '今天' : dayName
          });
        }
        
        const lookbackDays = Math.max(daysCount - 1, 0);
        const dailyTrafficResult = await this.db.db
          .prepare(`
            SELECT 
              date as date,
              COALESCE(SUM(actual_upload_traffic), 0) as upload_traffic,
              COALESCE(SUM(actual_download_traffic), 0) as download_traffic,
              COALESCE(SUM(actual_traffic), 0) as total_traffic
            FROM traffic_logs 
            WHERE user_id = ? 
              AND date >= date('now', '+8 hours', '-' || ? || ' days')
            GROUP BY date
            ORDER BY date ASC
          `)
          .bind(userId, lookbackDays)
          .all<DailyTrafficRow>();
        
        const dailyData = dailyTrafficResult.results ?? [];
        const dataMap: Record<string, DailyTrafficRow> = {};
        dailyData.forEach((item) => {
          if (item.date) {
            dataMap[item.date] = item;
          }
        });
        
        // 如果是今天，需要从users表获取当日流量
        const todayStr = beijingTime.toISOString().split('T')[0];
        // 合并数据，确保所有日期都有数据
        trends = dateList.map<UserTrafficTrend>((dateItem) => {
          const data = dataMap[dateItem.date];
          const upload = data ? ensureNumber(data.upload_traffic) : 0;
          const download = data ? ensureNumber(data.download_traffic) : 0;
          const total = data ? ensureNumber(data.total_traffic) : 0;
          return {
            date: dateItem.date,
            label: dateItem.label,
            upload_traffic: upload,
            download_traffic: download,
            total_traffic: total
          };
        });
      }
      
      return success(trends);
      
    } catch (err) {
      console.error('Get user traffic trends error:', err);
      return error('获取流量趋势失败', 500);
    }
  }

  // 获取用户流量统计摘要
  async getUserTrafficSummary(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return error("用户信息异常", 500);
      }
      
      // 获取最近7天的流量记录，使用UTC+8时区
      const recentTrafficResult = await this.db.db.prepare(`
        SELECT 
          SUM(upload_traffic) as week_upload,
          SUM(download_traffic) as week_download,
          SUM(total_traffic) as week_total,
          COUNT(*) as active_days
        FROM daily_traffic 
        WHERE user_id = ? AND record_date >= date('now', '+8 hours', '-7 days')
      `).bind(userId).all<SummaryRow>();
      
      // 获取最近30天的流量记录，使用UTC+8时区
      const monthlyTrafficResult = await this.db.db.prepare(`
        SELECT 
          SUM(upload_traffic) as month_upload,
          SUM(download_traffic) as month_download,
          SUM(total_traffic) as month_total,
          COUNT(*) as active_days
        FROM daily_traffic 
        WHERE user_id = ? AND record_date >= date('now', '+8 hours', '-30 days')
      `).bind(userId).all<SummaryRow>();
      
      // 获取历史最高单日流量
      const peakTrafficResult = await this.db.db.prepare(`
        SELECT record_date, total_traffic, upload_traffic, download_traffic
        FROM daily_traffic 
        WHERE user_id = ?
        ORDER BY total_traffic DESC
        LIMIT 1
      `).bind(userId).all<PeakTrafficRow>();

      const weeklyRow = recentTrafficResult.results?.[0] ?? null;
      const monthlyRow = monthlyTrafficResult.results?.[0] ?? null;
      const peakRow = peakTrafficResult.results?.[0] ?? null;

      const summary = {
        weekly: weeklyRow
          ? {
              week_upload: ensureNumber(weeklyRow.week_upload),
              week_download: ensureNumber(weeklyRow.week_download),
              week_total: ensureNumber(weeklyRow.week_total),
              active_days: ensureNumber(weeklyRow.active_days),
            }
          : {},
        monthly: monthlyRow
          ? {
              month_upload: ensureNumber(monthlyRow.month_upload),
              month_download: ensureNumber(monthlyRow.month_download),
              month_total: ensureNumber(monthlyRow.month_total),
              active_days: ensureNumber(monthlyRow.active_days),
            }
          : {},
        peak: peakRow
          ? {
              record_date: peakRow.record_date,
              total_traffic: ensureNumber(peakRow.total_traffic),
              upload_traffic: ensureNumber(peakRow.upload_traffic),
              download_traffic: ensureNumber(peakRow.download_traffic),
            }
          : null
      };
      
      return success(summary);
      
    } catch (err) {
      console.error('Get user traffic summary error:', err);
      return error('获取流量统计失败', 500);
    }
  }

  // 获取用户流量记录详情
  async getUserTrafficRecords(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return error("用户信息异常", 500);
      }

      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '', 10) || 1);
      const limit = Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '', 10) || 20);
      const offset = (page - 1) * limit;

      // 获取流量记录总数
      const countResult = await this.db.db
        .prepare("SELECT COUNT(*) as total FROM traffic_logs WHERE user_id = ?")
        .bind(userId)
        .first<{ total: number | null }>();

      // 获取流量记录详情（优先从traffic_logs表获取，如果没有则用daily_traffic）
      let records: Array<TrafficLogRow | DailyTrafficRecordRow> = [];
      
      // 首先尝试从traffic_logs表获取
      const trafficLogsResult = await this.db.db
        .prepare(`
          SELECT 
            tl.id,
            tl.user_id,
            tl.node_id,
            n.name as node_name,
            tl.upload_traffic,
            tl.download_traffic,
            tl.actual_upload_traffic,
            tl.actual_download_traffic,
            (tl.upload_traffic + tl.download_traffic) as total_traffic,
            tl.actual_traffic,
            tl.deduction_multiplier,
            tl.date as log_time,
            tl.created_at
          FROM traffic_logs tl
          LEFT JOIN nodes n ON n.id = tl.node_id
          WHERE tl.user_id = ?
          ORDER BY tl.date DESC, tl.created_at DESC
          LIMIT ? OFFSET ?
        `)
        .bind(userId, limit, offset)
        .all<TrafficLogRow>();

      if (trafficLogsResult.results && trafficLogsResult.results.length > 0) {
        records = trafficLogsResult.results;
      } else {
        // 如果traffic_logs没有数据，从daily_traffic表获取并构造类似的数据结构
        const dailyRecordsResult = await this.db.db
          .prepare(`
            SELECT 
              id,
              user_id,
              0 as node_id,
              'Multiple Nodes' as node_name,
              upload_traffic,
              download_traffic,
              upload_traffic as actual_upload_traffic,
              download_traffic as actual_download_traffic,
              total_traffic,
              total_traffic as actual_traffic,
              1 as deduction_multiplier,
              record_date as log_time,
              datetime(created_at, 'unixepoch') as created_at
            FROM daily_traffic
            WHERE user_id = ?
            ORDER BY record_date DESC
            LIMIT ? OFFSET ?
          `)
          .bind(userId, limit, offset)
          .all<DailyTrafficRecordRow>();

        records = dailyRecordsResult.results ?? [];

        // 如果没有数据，直接返回空数组
      }

      const total = ensureNumber(countResult?.total);

      return success({
        data: records,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      });

    } catch (err) {
      console.error('Get user traffic records error:', err);
      return error('获取流量记录失败', 500);
    }
  }

  // 手动触发流量记录更新
  async manualTrafficUpdate(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return error("用户信息异常", 500);
      }
      
      const result = await this.scheduler.manualTrafficUpdate(userId) as ManualTrafficUpdateResult;
      
      if (result.success) {
        return success({ message: result.message ?? "流量更新成功" });
      } else {
        const message = result.message ?? result.error ?? "流量更新失败";
        return error(message, 400);
      }
      
    } catch (err) {
      console.error('Manual traffic update error:', err);
      return error('手动更新流量记录失败', 500);
    }
  }


  // 管理员：手动执行每日流量重置
  async executeDailyReset(request) {
    return this.dailyTrafficReset(request);
  }

  // 管理员：获取流量统计概览
  async getTrafficOverview(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      // 检查管理员权限
      const user = authResult.user as AuthenticatedUser;
      if (!user?.is_admin) {
        return error('权限不足', 403);
      }
      
      // 今日活跃用户数
      const todayActiveRow = await this.db.db.prepare(`
        SELECT COUNT(*) as count
        FROM users 
        WHERE upload_today > 0 OR download_today > 0
      `).first<CountRow>();
      
      // 总用户数
      const totalUsersRow = await this.db.db.prepare(`
        SELECT COUNT(*) as count
        FROM users
        WHERE status = 1
      `).first<CountRow>();
      
      // 今日系统总流量
      const todayTrafficRow = await this.db.db.prepare(`
        SELECT 
          SUM(upload_today) as total_upload,
          SUM(download_today) as total_download,
          SUM(upload_today + download_today) as total_today
        FROM users
        WHERE upload_today > 0 OR download_today > 0
      `).first<TodayTrafficSummaryRow>();
      
      // 最近7天流量趋势，从daily_traffic表统计
      const weeklyTrendsResult = await this.db.db.prepare(`
        SELECT 
          record_date,
          SUM(total_traffic) as total_traffic,
          COUNT(DISTINCT user_id) as total_users
        FROM daily_traffic
        WHERE record_date >= date('now', '+8 hours', '-7 days')
        GROUP BY record_date
        ORDER BY record_date DESC
      `).all<WeeklyTrendRow>();
      
      const overview = {
        todayActive: ensureNumber(todayActiveRow?.count),
        totalUsers: ensureNumber(totalUsersRow?.count),
        todayTraffic: todayTrafficRow
          ? {
              total_upload: ensureNumber(todayTrafficRow.total_upload),
              total_download: ensureNumber(todayTrafficRow.total_download),
              total_today: ensureNumber(todayTrafficRow.total_today),
            }
          : {},
        weeklyTrends: (weeklyTrendsResult.results ?? []).map((row) => ({
          record_date: row.record_date,
          total_traffic: ensureNumber(row.total_traffic),
          total_users: ensureNumber(row.total_users),
        })),
      };
      
      return success(overview);
      
    } catch (err) {
      console.error('Get traffic overview error:', err);
      return error('获取流量概览失败', 500);
    }
  }

  // 管理员：获取系统流量趋势
  async getSystemTrafficTrends(request: Request) {
    try {
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      if (!user?.is_admin) {
        return error('权限不足', 403);
      }

      const url = new URL(request.url);
      const period = url.searchParams.get('period') || '7days';
      const days =
        period === '30days' ? 30 :
        period === 'today' ? 1 :
        period === '3days' ? 3 : 7;

      const trendsResult = await this.db.db
        .prepare(`
          SELECT 
            record_date as date,
            COALESCE(SUM(upload_traffic), 0) as upload_traffic,
            COALESCE(SUM(download_traffic), 0) as download_traffic,
            COALESCE(SUM(total_traffic), 0) as total_traffic,
            COUNT(DISTINCT user_id) as active_users
          FROM daily_traffic
          WHERE record_date >= date('now', '+8 hours', '-' || ? || ' days')
          GROUP BY record_date
          ORDER BY record_date DESC
        `)
        .bind(days)
        .all<SystemTrendRow>();

      const trends = (trendsResult.results ?? []).map(row => ({
        date: row.date,
        upload_traffic: ensureNumber(row.upload_traffic),
        download_traffic: ensureNumber(row.download_traffic),
        total_traffic: ensureNumber(row.total_traffic),
        active_users: ensureNumber(row.active_users),
      }));
      return success(trends);
    } catch (err) {
      console.error('Get system traffic trends error:', err);
      return error('获取系统流量趋势失败', 500);
    }
  }

  // 管理员：主动触发每日流量重置流程
  async dailyTrafficReset(request: Request) {
    try {
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return error(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      if (!user?.is_admin) {
        return error('权限不足', 403);
      }

      const result = await this.scheduler.executeDailyTrafficReset() as SchedulerResult;
      if (result.success) {
        return success(result);
      }

      const message = result.error ?? result.message ?? '每日流量重置失败';
      return error(message, 500);
    } catch (err) {
      console.error('Manual daily traffic reset error:', err);
      return error('执行每日流量重置失败', 500);
    }
  }
}
