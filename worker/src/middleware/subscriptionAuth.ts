// src/middleware/subscriptionAuth.ts - 订阅域名访问控制中间件
// 当前逻辑：不再限制订阅域名访问，直接放行请求

export async function validateSubscriptionDomain(_request: Request, _env: any) {
  return { success: true };
}
