/**
 * 审计功能相关的API接口
 */
import http from "./http";
import type { ApiResponse, AuditRule, AuditLog, AuditStats, PaginationParams, PaginationResponse } from "./types";

// 获取用户审计规则列表
export function getUserAuditRules(params?: PaginationParams & {
  action?: string;
  search?: string;
}): Promise<ApiResponse<{
  rules: AuditRule[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  statistics: {
    enabledRules: number;
    blockRules: number;
    warnRules: number;
  };
}>> {
  return http.get("/user/audit-rules", { params });
}

// 获取用户审计记录列表
export function getUserAuditLogs(params?: PaginationParams & {
  action?: string;
  date_start?: string;
  date_end?: string;
  search?: string;
}): Promise<ApiResponse<{
  logs: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  statistics: {
    totalLogs: number;
    blockedLogs: number;
    warnedLogs: number;
    todayLogs: number;
  };
}>> {
  return http.get("/user/audit-logs", { params });
}

// 获取用户审计概览统计
export function getUserAuditOverview(): Promise<ApiResponse<{
  rules: {
    totalRules: number;
    enabledRules: number;
    blockRules: number;
    warnRules: number;
  };
  logs: {
    totalLogs: number;
    blockedLogs: number;
    warnedLogs: number;
    todayLogs: number;
    weekLogs: number;
    monthLogs: number;
  };
  recentLogs: Array<{
    timestamp: string;
    action: string;
    target_url: string;
    rule_name: string;
    node_name?: string;
  }>;
}>> {
  return http.get("/user/audit-overview");
}