// src/utils/etag.js - ETAG 辅助工具

/**
 * 生成内容的 ETAG
 * @param {*} content - 要计算 ETAG 的内容
 * @returns {string} ETAG 值
 */
export function generateETag(content) {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  // 使用简单的哈希算法生成 ETAG
  let hash = 0;
  for (let i = 0; i < contentStr.length; i++) {
    const char = contentStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为 32 位整数
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

/**
 * 检查请求是否包含匹配的 ETAG
 * @param {Request} request - HTTP 请求对象
 * @param {string} etag - 服务器端生成的 ETAG
 * @returns {boolean} 如果 ETAG 匹配则返回 true
 */
export function isETagMatch(request, etag) {
  const ifNoneMatch = request.headers.get('If-None-Match') || request.headers.get('IF-NONE-MATCH');
  if (!ifNoneMatch) {
    return false;
  }
  
  // 处理多个 ETAG 值或通配符
  if (ifNoneMatch === '*') {
    return true;
  }
  
  // 规范化 ETag 格式（移除 W/ 前缀）
  const normalizeETag = (tag) => {
    return tag.replace(/^W\//, '').trim();
  };
  
  const normalizedRequestETag = normalizeETag(ifNoneMatch);
  const normalizedServerETag = normalizeETag(etag);
  
  // 分割多个 ETAG 值
  const eTags = normalizedRequestETag.split(',').map(tag => normalizeETag(tag));
  return eTags.includes(normalizedServerETag) || eTags.includes(etag);
}

/**
 * 创建 304 Not Modified 响应
 * @param {string} etag - ETAG 值
 * @returns {Response} 304 响应对象
 */
export function createNotModifiedResponse(etag) {
  return new Response(null, {
    status: 304,
    headers: {
      'ETag': etag,
      'Cache-Control': 'max-age=3600' // 1小时缓存
    }
  });
}

/**
 * 创建带 ETAG 的成功响应
 * @param {*} content - 响应内容
 * @param {string} etag - ETAG 值
 * @returns {Response} 200 响应对象
 */
export function createETagResponse(content, etag) {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return new Response(contentStr, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'ETag': etag,
      'Cache-Control': 'max-age=3600' // 1小时缓存
    }
  });
}