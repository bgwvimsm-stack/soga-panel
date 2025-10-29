// src/middleware/subscriptionAuth.js - 订阅域名访问控制中间件

import { createSystemConfigManager } from "../utils/systemConfig";
import { errorResponse } from "../utils/response";

/**
 * 验证订阅域名的访问权限
 * 如果配置了自定义订阅链接，则该域名只能访问 /api/subscription/ 路径
 */
export async function validateSubscriptionDomain(request, env) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 获取真实的Host头，优先使用CF-Connecting-IP相关的头，然后是Host头
    const host = request.headers.get('Host') ||
                 request.headers.get('X-Forwarded-Host') ||
                 request.headers.get('X-Original-Host') ||
                 url.hostname;

    // 获取系统配置的订阅链接
    const configManager = createSystemConfigManager(env);
    const subscriptionUrl = await configManager.getSystemConfig('subscription_url', '');

    // 如果没有配置自定义订阅链接，允许所有访问
    if (!subscriptionUrl || subscriptionUrl.trim() === '') {
      return { success: true };
    }

    // 解析配置的订阅链接域名
    const subscriptionHost = new URL(subscriptionUrl).hostname;

    // 如果当前访问的域名不是配置的订阅域名，允许访问（这是主域名）
    if (host !== subscriptionHost) {
      return { success: true };
    }

    // 如果是订阅域名，检查是否只访问 /api/subscription/ 路径
    if (!pathname.startsWith('/api/subscription/')) {
      // 对于非API路径，返回404而不是403，让它看起来像页面不存在
      return {
        success: false,
        message: 'Not Found',
        response: new Response('Not Found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        })
      };
    }

    return { success: true };

  } catch (error) {
    // 配置错误时允许访问，避免完全阻塞
    console.error('Subscription domain validation error:', error);
    return { success: true };
  }
}