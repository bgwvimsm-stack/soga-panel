import http from "./http";
import type { 
  ApiResponse, 
  Node,
  NodesResponse,
  TrafficStats,
  TrafficRecord,
  PaginationResponse,
  PaginationParams
} from "./types";

/**
 * 获取可访问节点列表
 */
export const getUserNodes = (): Promise<ApiResponse<NodesResponse>> => {
  return http.get("/user/nodes");
};

/**
 * 获取流量统计信息
 */
export const getTrafficStats = (days: number = 30): Promise<ApiResponse<TrafficStats>> => {
  return http.get(`/user/traffic-stats?days=${days}`);
};

// 定义流量趋势数据类型
interface TrafficTrendItem {
  date: string;
  label: string;
  upload_traffic: number;
  download_traffic: number;
  total_traffic: number;
}

/**
 * 获取流量趋势数据
 */
export const getTrafficTrends = (period: 'today' | '3days' | '7days' = 'today'): Promise<ApiResponse<TrafficTrendItem[]>> => {
  return http.get(`/user/traffic/trends?period=${period}`);
};

// 定义流量统计摘要类型
interface TrafficSummary {
  weekly: {
    week_upload: number;
    week_download: number;
    week_total: number;
    active_days: number;
  };
  monthly: {
    month_upload: number;
    month_download: number;
    month_total: number;
    active_days: number;
  };
  peak: {
    record_date: string;
    total_traffic: number;
    upload_traffic: number;
    download_traffic: number;
  } | null;
}

/**
 * 获取流量统计摘要
 */
export const getTrafficSummary = (): Promise<ApiResponse<TrafficSummary>> => {
  return http.get("/user/traffic/summary");
};

/**
 * 重置订阅令牌
 */
export const resetSubscriptionToken = (): Promise<ApiResponse<{ token: string }>> => {
  return http.post("/user/reset-subscription-token");
};

/**
 * 手动更新流量记录
 */
export const manualTrafficUpdate = (): Promise<ApiResponse<null>> => {
  return http.post("/user/traffic/manual-update");
};

/**
 * 更新用户资料
 */
export const updateUserProfile = (data: {
  email?: string;
  username?: string;
  telegram_id?: number;
}): Promise<ApiResponse<any>> => {
  return http.put("/user/profile", data);
};

/**
 * 修改用户密码
 */
export const changeUserPassword = (data: {
  current_password: string;
  new_password: string;
}): Promise<ApiResponse<null>> => {
  return http.post("/user/change-password", data);
};

/**
 * 获取用户流量详情记录
 */
export const getUserTrafficRecords = (params: PaginationParams = {}): Promise<ApiResponse<PaginationResponse<TrafficRecord>>> => {
  return http.get("/user/traffic-records", { params });
};

/**
 * 获取订阅记录
 */
export const getSubscriptionLogs = (params?: {
  page?: number;
  limit?: number;
  type?: string;
}): Promise<ApiResponse<PaginationResponse<any>>> => {
  return http.get("/user/subscription-logs", { params });
};

/**
 * 获取Bark设置
 */
export const getBarkSettings = (): Promise<ApiResponse<{
  bark_key: string;
  bark_enabled: boolean;
}>> => {
  return http.get("/user/bark-settings");
};

/**
 * 更新Bark设置
 */
export const updateBarkSettings = (data: {
  bark_key: string;
  bark_enabled: boolean;
}): Promise<ApiResponse<{ message: string }>> => {
  return http.put("/user/bark-settings", data);
};

/**
 * 测试Bark通知
 */
export const testBarkNotification = (barkKey?: string): Promise<ApiResponse<{ message: string; success: boolean }>> => {
  return http.post("/user/bark-test", barkKey ? { bark_key: barkKey } : {});
};

/**
 * 获取登录记录
 */
export const getLoginLogs = (params?: {
  limit?: number;
}): Promise<ApiResponse<{
  data: Array<{
    id: number;
    login_ip: string;
    login_time: string;
    user_agent?: string;
    login_status: number;
    failure_reason?: string;
  }>;
}>> => {
  return http.get("/user/login-logs", { params });
};
/**
 * 获取用户钱包信息
 */
export const getUserWalletInfo = (): Promise<ApiResponse<{
  balance: number;
  total_recharge: number;
  total_consume: number;
}>> => {
  return http.get("/user/wallet");
};

/**
 * 获取充值记录
 */
export const getUserRechargeRecords = (params?: {
  page?: number;
  limit?: number;
  status?: number | string;
}): Promise<ApiResponse<{
  records: Array<{
    id: number;
    trade_no: string;
    amount: number;
    status: number;
    pay_url?: string;
    created_at: string;
  }>;
  pagination: {
    total: number;
    page: number;
    limit: number;
  };
}>> => {
  return http.get("/user/recharge-records", { params });
};

/**
 * 创建充值订单
 */
export const createRechargeOrder = (data: {
  amount: number;
  paymentMethod: string;
}): Promise<ApiResponse<{
  trade_no: string;
  pay_url: string;
}>> => {
  return http.post("/user/recharge", data);
};
