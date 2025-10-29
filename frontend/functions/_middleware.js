// Cloudflare Pages Functions 中间件
// 处理订阅域名访问控制和全局 CORS

export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const hostname = url.hostname;
    const pathname = url.pathname;

    // 检查是否配置了订阅域名
    const subscriptionDomain = env.SUBSCRIPTION_DOMAIN;

    if (subscriptionDomain && hostname === subscriptionDomain) {
      // 如果是订阅域名，只允许访问 /api/subscription/ 路径
      if (!pathname.startsWith('/api/subscription/')) {
        // 返回404状态码
        return new Response('Not Found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 订阅API请求，正常处理
      const response = await context.next();

      // 添加安全头
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-XSS-Protection', '1; mode=block');

      return response;
    }

    // 不是订阅域名或未配置订阅域名，正常处理
    const response = await context.next();

    // 添加安全头
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');

    return response;
  } catch (error) {
    console.error('Middleware error:', error);

    return new Response(JSON.stringify({
      success: false,
      message: 'Request processing failed',
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}