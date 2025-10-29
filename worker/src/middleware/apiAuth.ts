// src/middleware/apiAuth.js - API认证中间件

import type { Env } from "../types";
import { errorResponse } from "../utils/response";

/**
 * API认证中间件
 * 验证来自前端的请求是否包含正确的API密钥
 */
export class APIAuthMiddleware {
  private readonly env: Env;
  private readonly apiSecret: string;

  constructor(env: Env) {
    this.env = env;
    // 从环境变量获取前后端通信密钥
    this.apiSecret = (env.FRONTEND_API_SECRET as string) || "";
    
    // 如果没有设置API密钥，输出警告但不拦截（向后兼容）
    if (!this.apiSecret) {
      console.warn("⚠️  FRONTEND_API_SECRET not configured - API authentication disabled");
    }
  }

  /**
   * 验证API请求
   * @param {Request} request - 请求对象
   * @returns {Response|null} - 如果验证失败返回错误响应，通过则返回null
   */
  async validateRequest(request) {
    const url = new URL(request.url);
    
    // 跳过不需要认证的端点
    if (this.shouldSkipAuth(url.pathname, request.method)) {
      return null;
    }

    // 检查是否为Cloudflare服务绑定调用（内部安全通信）
    if (this.isInternalServiceCall(request)) {
      console.log("Internal service call detected, skipping API key validation");
      return null; // 内部绑定调用，跳过验证
    }

    // 如果没有配置API密钥，跳过验证（向后兼容）
    if (!this.apiSecret) {
      return null;
    }

    // 外部调用必须验证API密钥
    const providedSecret = this.extractApiSecret(request);
    
    if (!providedSecret) {
      return errorResponse("外部访问需要API认证密钥", 401, {
        error_code: "MISSING_API_SECRET",
        message: "外部访问请在请求头中包含 X-API-Secret"
      });
    }

    if (providedSecret !== this.apiSecret) {
      return errorResponse("API认证失败", 403, {
        error_code: "INVALID_API_SECRET",
        message: "提供的API密钥无效"
      });
    }

    console.log("External API call authenticated successfully");
    return null; // 验证通过
  }

  /**
   * 从请求中提取API密钥
   * @param {Request} request - 请求对象
   * @returns {string|null} - API密钥或null
   */
  extractApiSecret(request) {
    // 支持多种方式传递API密钥
    return (
      request.headers.get("X-API-Secret") ||           // 推荐方式
      request.headers.get("X-Frontend-Auth") ||        // 备用方式1
      request.headers.get("Authorization")?.replace("Bearer ", "") || // Bearer token方式
      null
    );
  }

  /**
   * 检查是否为内部服务绑定调用
   * @param {Request} request - 请求对象
   * @returns {boolean} - 是否为内部服务调用
   */
  isInternalServiceCall(request) {
    // 检查是否有内部服务绑定标识头
    const internalMarker = request.headers.get("X-Cloudflare-Service-Binding");
    if (internalMarker === "true") {
      return true;
    }

    // 检查是否有Cloudflare Worker内部调用标识
    const cfWorker = request.headers.get("CF-Worker");
    if (cfWorker) {
      return true;
    }

    // 检查User-Agent是否包含Cloudflare Worker标识
    const userAgent = request.headers.get("User-Agent") || "";
    if (userAgent.includes("Cloudflare-Worker")) {
      return true;
    }

    return false;
  }

  /**
   * 判断是否跳过认证
   * @param {string} pathname - 请求路径
   * @param {string} method - 请求方法
   * @returns {boolean} - 是否跳过认证
   */
  shouldSkipAuth(pathname, method) {
    // Soga后端API（使用WEBAPI_KEY认证）
    if (pathname.startsWith("/api/v1/")) {
      return true;
    }

    // 健康检查端点
    if (pathname === "/api/health" || pathname === "/api/database/test") {
      return true;
    }

    // 订阅端点（通过token认证）
    if (pathname.startsWith("/api/subscription/")) {
      return true;
    }

    // 前端API端点（通过JWT token认证）
    if (pathname.startsWith("/api/auth/") ||
        pathname.startsWith("/api/user/") ||
        pathname.startsWith("/api/admin/") ||
        pathname.startsWith("/api/announcement/") ||
        pathname.startsWith("/api/packages") ||
        pathname.startsWith("/api/wallet/") ||
        pathname.startsWith("/api/payment/")) {
      return true;
    }

    // OPTIONS请求（CORS预检）
    if (method === "OPTIONS") {
      return true;
    }

    return false;
  }

  /**
   * 生成随机API密钥
   * @param {number} length - 密钥长度
   * @returns {string} - 生成的API密钥
   */
  static generateApiSecret(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
