// Cloudflare Worker 绑定工具

type WorkerFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

declare global {
  const BACKEND: WorkerFetcher;
}

/**
 * 检测是否在 Cloudflare Pages 环境中运行
 */
export const isCloudflarePages = (): boolean => {
  return typeof BACKEND !== 'undefined';
};

/**
 * 获取API基础URL
 * 在 Cloudflare Pages 环境中使用 Worker 绑定
 * 在开发环境中使用配置的API地址
 */
export const getApiBaseUrl = (): string => {
  if (isCloudflarePages()) {
    // 在 Cloudflare Pages 环境中，直接返回空字符串
    // 因为我们会通过 Worker 绑定来处理请求
    return '';
  }
  
  // 开发环境或其他环境，使用环境变量配置的API地址
  return import.meta.env.VITE_API_BASE_URL || '/api';
};

/**
 * 使用 Worker 绑定发送请求
 * 这个函数只在 Cloudflare Pages 环境中有效
 */
export const workerFetch = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  if (!isCloudflarePages()) {
    throw new Error('Worker binding is only available in Cloudflare Pages environment');
  }
  
  // 使用 Worker 绑定发送请求
  return BACKEND.fetch(url, options);
};

/**
 * 创建适应性的 fetch 函数
 * 自动选择使用 Worker 绑定还是普通的 fetch
 */
export const adaptiveFetch = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  if (isCloudflarePages()) {
    // 在 Cloudflare Pages 环境中使用 Worker 绑定
    // 确保 URL 以 / 开头
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    return workerFetch(cleanUrl, options);
  } else {
    // 在其他环境中使用普通的 fetch
    const baseUrl = getApiBaseUrl();
    const fullUrl = baseUrl ? `${baseUrl}${url}` : url;
    return fetch(fullUrl, options);
  }
};
