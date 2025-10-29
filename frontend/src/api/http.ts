import axios from "axios";
import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from "axios";
import { getToken, removeToken } from "@/utils/auth-soga";
import router from "@/router";
import { globalErrorHandler } from "@/utils/error-handler";
import { setupApiAuthInterceptor } from "@/utils/api-auth";
import type { ApiResponse } from "./types";

// 从环境变量获取配置
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL || '/api';
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT) || 10000;

// 创建axios实例
const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json;charset=utf-8"
  }
});

// 请求拦截器
http.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
http.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const { data } = response;
    
    // 如果是二进制数据（如文件下载），直接返回
    if (response.config.responseType === 'blob') {
      return response;
    }
    
    // 检查业务状态码
    if (data.code !== 0) {
      const businessError: any = new Error(data.message || "请求失败");
      businessError.response = {
        status: response.status,
        data,
        config: response.config
      };
      return Promise.reject(businessError);
    }
    
    return data;
  },
  (error) => {
    // 使用全局错误处理器
    globalErrorHandler.handleApiError(error);
    
    const { response } = error;
    
    if (response) {
      const { status } = response;
      
      // 特殊处理需要跳转的错误
      if (status === 401) {
        removeToken();
        router.push("/login");
      }
    }
    
    return Promise.reject(error);
  }
);

// 设置API认证拦截器
setupApiAuthInterceptor(http);

export default http;
