import axios, {
  isAxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from "axios";
import { getToken, removeToken } from "@/utils/auth-soga";
import router from "@/router";
import { globalErrorHandler } from "@/utils/error-handler";
import { setupApiAuthInterceptor } from "@/utils/api-auth";
import type { ApiResponse } from "./types";

// 从环境变量获取配置
const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL || "/api";
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT) || 10000;

// 创建axios实例
const httpClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json;charset=utf-8"
  }
});

// 请求拦截器
httpClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

const normalizeBusinessResponse = <T>(response: ApiResponse<T>): ApiResponse<T> => {
  if (response.code !== 0) {
    const businessError: any = new Error(response.message || "请求失败");
    businessError.response = response;
    throw businessError;
  }
  return response;
};

async function sendRequest<T = any>(config: AxiosRequestConfig): Promise<ApiResponse<T>> {
  try {
    const response = await httpClient.request<ApiResponse<T>>(config);
    return normalizeBusinessResponse(response.data);
  } catch (error) {
    if (isAxiosError(error)) {
      globalErrorHandler.handleApiError(error);
      const status = error.response?.status;
      if (status === 401) {
        removeToken();
        router.push("/login");
      }
    }
    throw error;
  }
}

const http = {
  get<T = any>(url: string, config?: AxiosRequestConfig) {
    return sendRequest<T>({ ...config, method: "GET", url });
  },
  delete<T = any>(url: string, config?: AxiosRequestConfig) {
    return sendRequest<T>({ ...config, method: "DELETE", url });
  },
  head<T = any>(url: string, config?: AxiosRequestConfig) {
    return sendRequest<T>({ ...config, method: "HEAD", url });
  },
  post<T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return sendRequest<T>({ ...config, method: "POST", url, data });
  },
  put<T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return sendRequest<T>({ ...config, method: "PUT", url, data });
  },
  patch<T = any, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return sendRequest<T>({ ...config, method: "PATCH", url, data });
  },
  request: sendRequest
};

// 设置API认证拦截器（作用于底层Axios实例）
setupApiAuthInterceptor(httpClient);

export { httpClient };
export default http;
