// Cloudflare Pages Functions API 代理
// 优先使用服务绑定，回退到环境变量配置

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  try {
    // 优先使用服务绑定（最安全，无需配置）
    const backend = env.BACKEND;
    
    if (backend) {
      console.log('Using Service Binding for secure communication');
      
      // 准备请求体
      let body = null;
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        body = await request.clone().arrayBuffer();
      }
      
      // 通过服务绑定直接调用后端
      const proxyRequest = new Request(`https://backend${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: body
      });
      
      // 发送到绑定的服务
      const response = await backend.fetch(proxyRequest);
      
      // 创建响应副本
      const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      
      // 确保CORS头
      newResponse.headers.set('Access-Control-Allow-Origin', '*');
      newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      return newResponse;
    }
    
    // 回退到环境变量配置（需要手动配置后端地址和密钥）
    const BACKEND_URL = env.BACKEND_URL;
    const API_SECRET = env.API_SECRET;
    
    // 检查环境变量配置
    if (!BACKEND_URL || !API_SECRET) {
      console.error('No service binding and missing environment variables');
      return new Response(JSON.stringify({
        success: false,
        message: 'Backend not configured',
        error: 'Please configure Service Binding or set BACKEND_URL and API_SECRET environment variables',
        debug: {
          hasServiceBinding: false,
          hasBackendUrl: !!BACKEND_URL,
          hasApiSecret: !!API_SECRET
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    console.log('Using environment variables fallback');
    
    // 构建后端请求URL
    const targetUrl = `${BACKEND_URL}${url.pathname}${url.search}`;
    
    // 复制原始请求头
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      // 跳过可能暴露前端信息的头
      if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    
    // 添加API密钥到请求头
    headers.set('X-API-Secret', API_SECRET);
    
    // 添加内部标识
    headers.set('X-Cloudflare-Service-Binding', 'true');
    headers.set('CF-Worker', 'pages-functions');
    
    // 准备请求体
    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      body = await request.clone().arrayBuffer();
    }
    
    // 创建代理请求
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: body
    });
    
    // 发送到后端
    const response = await fetch(proxyRequest);
    
    // 创建响应副本
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    
    // 确保CORS头
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return newResponse;
    
  } catch (error) {
    console.error('Functions proxy error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      message: 'API request failed',
      error: 'Proxy error occurred'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}