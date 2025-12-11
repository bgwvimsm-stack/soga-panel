import { DatabaseService } from "./database";
import { ensureNumber } from "../utils/d1";

export class TrafficService {
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async getUserTrafficTrends(userId: number, days = 7) {
    const result = await this.db.db
      .prepare(
        `
        SELECT record_date, upload_traffic, download_traffic, total_traffic
        FROM daily_traffic
        WHERE user_id = ? 
          AND record_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
        ORDER BY record_date DESC
      `
      )
      .bind(userId, days)
      .all();
    return result.results || [];
  }

  async getUserTrafficSummary(userId: number) {
    const stats = await this.db.db
      .prepare(
        `
        SELECT 
          COALESCE(SUM(upload_traffic), 0) as total_upload,
          COALESCE(SUM(download_traffic), 0) as total_download,
          COALESCE(SUM(total_traffic), 0) as total_traffic
        FROM daily_traffic
        WHERE user_id = ?
      `
      )
      .bind(userId)
      .first<{ total_upload?: number; total_download?: number; total_traffic?: number }>();

    return {
      total_upload: ensureNumber(stats?.total_upload),
      total_download: ensureNumber(stats?.total_download),
      total_traffic: ensureNumber(stats?.total_traffic)
    };
  }

  async getUserTrafficStats(userId: number, days = 30) {
    const user = await this.db.db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();
    if (!user) return null;

    const upload = ensureNumber(user.upload_traffic);
    const download = ensureNumber(user.download_traffic);
    const transferEnable = ensureNumber(user.transfer_enable);
    const transferTotal = ensureNumber(user.transfer_total);
    const todayUpload = ensureNumber(user.upload_today);
    const todayDownload = ensureNumber(user.download_today);
    const transferToday = todayUpload + todayDownload;
    const remain = Math.max(0, transferEnable - transferTotal);
    const percentage = transferEnable > 0 ? Math.round((transferTotal / transferEnable) * 100) : 0;

    let history = await this.db.db
      .prepare(
        `
        SELECT record_date as date, upload_traffic as upload, download_traffic as download, total_traffic
        FROM daily_traffic
        WHERE user_id = ? AND record_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
        ORDER BY record_date ASC
      `
      )
      .bind(userId, days)
      .all();

    if (!history.results || history.results.length === 0) {
      history = await this.db.db
        .prepare(
          `
          SELECT date, SUM(upload_traffic) as upload, SUM(download_traffic) as download, SUM(actual_traffic) as total_traffic
          FROM traffic_logs
          WHERE user_id = ? AND date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
          GROUP BY date
          ORDER BY date ASC
        `
        )
        .bind(userId, days)
        .all();
    }

    return {
      transfer_enable: transferEnable,
      transfer_total: transferTotal,
      transfer_today: transferToday,
      remain_traffic: remain,
      traffic_percentage: percentage,
      upload_traffic: upload,
      download_traffic: download,
      today_upload: todayUpload,
      today_download: todayDownload,
      traffic_stats: history.results || [],
      total_days: days,
      last_checkin_time: user.last_login_time || null
    };
  }

  async getSystemTrafficOverview(days = 30) {
    const result = await this.db.db
      .prepare(
        `
        SELECT record_date, total_users, total_upload, total_download, total_traffic
        FROM system_traffic_summary
        WHERE record_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
        ORDER BY record_date DESC
      `
      )
      .bind(days)
      .all();
    return result.results || [];
  }
}
