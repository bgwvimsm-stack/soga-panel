// API响应基础类型
export interface ApiResponse<T = any> {
  code: number;
  data: T;
  message: string;
}

// 用户相关类型
export interface User {
  id: number;
  email: string;
  username: string;
  uuid: string;
  passwd: string;
  token: string;
  is_admin: boolean | number;
  speed_limit: number;
  device_limit: number;
  upload_traffic: number;
  download_traffic: number;
  upload_today: number;
  download_today: number;
  transfer_total: number;
  transfer_enable: number;
  status: number;
  reg_date: string;
  expire_time: string;
  last_login_time: string;
  last_login_ip: string;
  class: number;
  class_expire_time: string;
  traffic_reset_day: number;
  subscription_url: string;
}

// 节点相关类型
export interface Node {
  id: number;
  name: string;
  type: string;
  server: string;
  server_port: number;
  node_class: number;
  node_bandwidth: number;
  node_bandwidth_limit: number;
  node_config: string;
  status: number;
  is_online?: boolean;
  tls_host?: string;
  created_at: string;
  // 用户在该节点的流量使用情况
  user_upload_traffic?: number;
  user_download_traffic?: number;
  user_total_traffic?: number;
}

// 节点统计信息
export interface NodeStatistics {
  total: number;
  online: number;
  offline: number;
  accessible: number;
}

// 节点列表响应
export interface NodesResponse {
  nodes: Node[];
  statistics: NodeStatistics;
}

// 登录请求
export interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
}

// 登录响应
export interface LoginResponse {
  token: string;
  user: User;
  isNewUser?: boolean;
  tempPassword?: string | null;
  passwordEmailSent?: boolean;
}

// 注册请求
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  verificationCode: string;
}

export interface PasswordResetRequestPayload {
  email: string;
}

export interface PasswordResetConfirmPayload {
  email: string;
  verificationCode: string;
  newPassword: string;
  confirmPassword?: string;
}

export interface GoogleLoginRequest {
  idToken: string;
  remember?: boolean;
}

export interface GithubLoginRequest {
  code: string;
  redirectUri?: string;
  state?: string;
  remember?: boolean;
}

export interface SendEmailCodeResponse {
  message: string;
  cooldown: number;
  expire_minutes: number;
}

// 流量统计
export interface TrafficStats {
  used: number;
  total: number;
  percentage: number;
  today_used: number;
}

// 流量详情记录
export interface TrafficRecord {
  id: number;
  user_id: number;
  node_id: number;
  node_name: string;
  upload_traffic: number;
  download_traffic: number;
  total_traffic: number;
  rate: number;
  log_time: string;
  created_at: string;
}

// 分页参数
export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

// 分页响应
export interface PaginationResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// 审计规则类型
export interface AuditRule {
  id: number;
  name: string;
  pattern: string;
  action: 'block' | 'warn';
  description: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// 审计记录类型
export interface AuditLog {
  id: number;
  user_id: number;
  timestamp: string;
  action: 'block' | 'warn';
  target_url: string;
  rule_id: number;
  rule_name: string;
  rule_pattern: string;
  node_id?: number;
  node_name?: string;
  user_ip?: string;
  user_agent?: string;
  created_at: string;
}

// 审计统计信息
export interface AuditStats {
  totalRules: number;
  enabledRules: number;
  blockRules: number;
  warnRules: number;
  totalLogs: number;
  blockedLogs: number;
  warnedLogs: number;
  todayLogs: number;
}
