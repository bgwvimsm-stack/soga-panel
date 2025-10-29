/**
 * 用户端审计功能API
 * 提供用户查看审计规则和审计记录的接口
 */

import type { Env } from "../types";
import { ensureNumber } from "../utils/d1";

type PaginationParams = {
  page?: number | string;
  limit?: number | string;
  action?: string;
  search?: string;
  type?: string;
  date_start?: string;
  date_end?: string;
};

type AuditRuleRow = {
  name: string;
  pattern: string;
  description: string | null;
};

type AuditRuleCountRow = {
  total: number;
};

type AuditLogRow = {
  time: string;
  node_name: string | null;
  triggered_rule: string | null;
  client_ip: string | null;
};

type AuditLogCountRow = {
  total: number;
};

type AuditRuleStatsRow = {
  total_rules: number;
  enabled_rules: number;
  block_rules: number;
  warn_rules: number;
};

type AuditLogStatsRow = {
  total_logs: number;
  blocked_logs: number;
  warned_logs: number;
  today_logs: number;
  week_logs: number;
  month_logs: number;
};

type RecentAuditLogRow = {
  timestamp: string;
  action: string;
  target_url: string | null;
  rule_name: string | null;
  node_name: string | null;
};

function normalizePagination(params: PaginationParams = {}) {
  const rawPage = params.page ?? 1;
  const rawLimit = params.limit ?? 20;
  const page = Math.max(1, ensureNumber(rawPage, Number(rawPage) || 1));
  const limit = Math.max(1, ensureNumber(rawLimit, Number(rawLimit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * 获取用户可见的审计规则列表
 */
export async function getUserAuditRules(env: Env, userId: number, params: PaginationParams = {}) {
  try {
    const { page, limit, offset } = normalizePagination(params);

    // 获取审计规则列表 - 只返回启用的规则
    const rulesQuery = `
      SELECT 
        name,
        rule as pattern,
        description
      FROM audit_rules 
      WHERE enabled = 1
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rulesResult = await env.DB.prepare(rulesQuery)
      .bind(limit, offset)
      .all<AuditRuleRow>();
    
    // 获取总数
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM audit_rules 
      WHERE enabled = 1
    `;
    const countResult = await env.DB.prepare(countQuery).first<AuditRuleCountRow>();
    const total = ensureNumber(countResult?.total);

    return {
      success: true,
      data: {
        rules: rulesResult.results ?? [],
        pagination: {
          page,
          limit,
          total
        }
      }
    };

  } catch (error) {
    console.error('获取用户审计规则失败:', error);
    return {
      success: false,
      message: "获取审计规则失败",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 获取用户的审计记录列表
 */
export async function getUserAuditLogs(env: Env, userId: number, params: PaginationParams = {}) {
  try {
    const { page, limit, offset } = normalizePagination(params);

    // 获取审计记录列表
    const logsQuery = `
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
    `;

    const logsResult = await env.DB.prepare(logsQuery)
      .bind(userId, limit, offset)
      .all<AuditLogRow>();
    
    // 获取总数
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM audit_logs
      WHERE user_id = ?
    `;
    const countResult = await env.DB.prepare(countQuery)
      .bind(userId)
      .first<AuditLogCountRow>();
    const total = ensureNumber(countResult?.total);

    return {
      success: true,
      data: {
        logs: logsResult.results ?? [],
        pagination: {
          page,
          limit,
          total
        }
      }
    };

  } catch (error) {
    console.error('获取用户审计记录失败:', error);
    return {
      success: false,
      message: "获取审计记录失败",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 获取用户审计概览统计
 */
export async function getUserAuditOverview(env: Env, userId: number) {
  try {
    // 获取规则统计
    const rulesStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_rules,
        COUNT(CASE WHEN enabled = 1 THEN 1 END) as enabled_rules,
        COUNT(CASE WHEN enabled = 1 AND action = 'block' THEN 1 END) as block_rules,
        COUNT(CASE WHEN enabled = 1 AND action = 'warn' THEN 1 END) as warn_rules
      FROM audit_rules
    `).first<AuditRuleStatsRow>();

    // 获取用户日志统计
    const logsStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_logs,
        COUNT(CASE WHEN action = 'block' THEN 1 END) as blocked_logs,
        COUNT(CASE WHEN action = 'warn' THEN 1 END) as warned_logs,
        COUNT(CASE WHEN DATE(timestamp) = DATE('now', '+8 hours') THEN 1 END) as today_logs,
        COUNT(CASE WHEN DATE(timestamp) >= DATE('now', '+8 hours', '-7 days') THEN 1 END) as week_logs,
        COUNT(CASE WHEN DATE(timestamp) >= DATE('now', '+8 hours', '-30 days') THEN 1 END) as month_logs
      FROM audit_logs
      WHERE user_id = ?
    `)
      .bind(userId)
      .first<AuditLogStatsRow>();

    // 获取最近的审计记录
    const recentLogsResult = await env.DB.prepare(`
      SELECT 
        al.timestamp,
        al.action,
        al.target_url,
        al.rule_name,
        n.name as node_name
      FROM audit_logs al
      LEFT JOIN nodes n ON al.node_id = n.id
      WHERE al.user_id = ?
      ORDER BY al.timestamp DESC
      LIMIT 5
    `)
      .bind(userId)
      .all<RecentAuditLogRow>();

    return {
      success: true,
      data: {
        rules: {
          totalRules: ensureNumber(rulesStats?.total_rules),
          enabledRules: ensureNumber(rulesStats?.enabled_rules),
          blockRules: ensureNumber(rulesStats?.block_rules),
          warnRules: ensureNumber(rulesStats?.warn_rules)
        },
        logs: {
          totalLogs: ensureNumber(logsStats?.total_logs),
          blockedLogs: ensureNumber(logsStats?.blocked_logs),
          warnedLogs: ensureNumber(logsStats?.warned_logs),
          todayLogs: ensureNumber(logsStats?.today_logs),
          weekLogs: ensureNumber(logsStats?.week_logs),
          monthLogs: ensureNumber(logsStats?.month_logs)
        },
        recentLogs: recentLogsResult.results ?? []
      }
    };

  } catch (error) {
    console.error('获取用户审计概览失败:', error);
    return {
      success: false,
      message: "获取审计概览失败",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
