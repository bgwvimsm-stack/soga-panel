import { DatabaseService } from "./database";
import { ensureNumber, ensureString } from "../utils/d1";

export class UserAuditService {
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async listRules(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const rows = await this.db.db
      .prepare(
        `
        SELECT name, rule as pattern, description
        FROM audit_rules
        WHERE enabled = 1
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(limit, offset)
      .all();
    const total = await this.db.db
      .prepare("SELECT COUNT(*) as total FROM audit_rules WHERE enabled = 1")
      .first<{ total?: number }>();
    return {
      rules: rows.results || [],
      pagination: {
        page,
        limit,
        total: ensureNumber(total?.total)
      },
      statistics: {
        enabledRules: ensureNumber(total?.total),
        blockRules: 0,
        warnRules: 0
      }
    };
  }

  async listLogs(userId: number, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const rows = await this.db.db
      .prepare(
        `
        SELECT 
          al.created_at as time,
          n.name as node_name,
          ar.name as triggered_rule,
          al.ip_address as client_ip
        FROM audit_logs al
        LEFT JOIN nodes n ON al.node_id = n.id
        LEFT JOIN audit_rules ar ON al.audit_rule_id = ar.id
        WHERE al.user_id = ?
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(userId, limit, offset)
      .all();
    const total = await this.db.db
      .prepare("SELECT COUNT(*) as total FROM audit_logs WHERE user_id = ?")
      .bind(userId)
      .first<{ total?: number }>();
    return {
      logs: rows.results || [],
      pagination: {
        page,
        limit,
        total: ensureNumber(total?.total)
      },
      statistics: {
        totalLogs: ensureNumber(total?.total),
        blockedLogs: 0,
        warnedLogs: 0,
        todayLogs: 0
      }
    };
  }

  async overview(userId: number) {
    const rulesStats = await this.db.db
      .prepare(
        `
        SELECT 
          COUNT(*) as total_rules,
          SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_rules
        FROM audit_rules
      `
      )
      .first<{ total_rules?: number; enabled_rules?: number }>();

    const logsStats = await this.db.db
      .prepare(
        `
        SELECT 
          COUNT(*) as total_logs,
          SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today_logs,
          SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY) THEN 1 ELSE 0 END) as week_logs,
          SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) THEN 1 ELSE 0 END) as month_logs
        FROM audit_logs
        WHERE user_id = ?
      `
      )
      .bind(userId)
      .first<{
        total_logs?: number;
        today_logs?: number;
        week_logs?: number;
        month_logs?: number;
      }>();

    const recent = await this.db.db
      .prepare(
        `
        SELECT 
          al.created_at as timestamp,
          n.name as node_name,
          ar.name as rule_name,
          al.ip_address as target_url,
          'log' as action
        FROM audit_logs al
        LEFT JOIN nodes n ON al.node_id = n.id
        LEFT JOIN audit_rules ar ON al.audit_rule_id = ar.id
        WHERE al.user_id = ?
        ORDER BY al.created_at DESC
        LIMIT 5
      `
      )
      .bind(userId)
      .all();

    return {
      rules: {
        totalRules: ensureNumber(rulesStats?.total_rules),
        enabledRules: ensureNumber(rulesStats?.enabled_rules),
        blockRules: 0,
        warnRules: 0
      },
      logs: {
        totalLogs: ensureNumber(logsStats?.total_logs),
        blockedLogs: 0,
        warnedLogs: 0,
        todayLogs: ensureNumber(logsStats?.today_logs),
        weekLogs: ensureNumber(logsStats?.week_logs),
        monthLogs: ensureNumber(logsStats?.month_logs)
      },
      recentLogs: (recent.results || []).map((row: any) => ({
        timestamp: ensureString(row.timestamp),
        action: ensureString(row.action || "log"),
        target_url: row.target_url || null,
        rule_name: row.rule_name || null,
        node_name: row.node_name || null
      }))
    };
  }
}
