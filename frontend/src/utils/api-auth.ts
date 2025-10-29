// src/utils/api-auth.ts - 前端API认证工具

import { ElMessage } from 'element-plus';

/**
 * API认证配置
 */
interface ApiAuthConfig {
  apiSecret: string;
  headerName: string;
  enableAuth: boolean;
  isInternalBinding: boolean;
  backendUrl: string | null;
}

/**
 * API认证管理类
 */
class ApiAuthManager {
  private config: ApiAuthConfig;

  constructor() {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL;
    const isInternalBinding = !backendUrl || backendUrl === '/api';
    
    this.config = {
      // 从环境变量或配置中获取API密钥
      apiSecret: import.meta.env.VITE_FRONTEND_API_SECRET || '',
      headerName: 'X-API-Secret',
      enableAuth: !!import.meta.env.VITE_FRONTEND_API_SECRET && !isInternalBinding,
      isInternalBinding: isInternalBinding,
      backendUrl: backendUrl
    };

    if (this.config.isInternalBinding) {
      console.log('🔗 检测到Cloudflare服务绑定，使用内部安全通信');
    } else {
      console.log('🌐 检测到外部后端URL，启用API密钥认证:', this.config.backendUrl);
      if (!this.config.apiSecret && import.meta.env.PROD) {
        console.warn('⚠️  外部访问需要配置API密钥 VITE_FRONTEND_API_SECRET');
      }
    }
  }

  /**
   * 获取API认证头
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    
    // 内部服务绑定：添加标识头
    if (this.config.isInternalBinding) {
      headers['X-Cloudflare-Service-Binding'] = 'true';
      return headers;
    }
    
    // 外部访问：添加API密钥（如果配置了的话）
    if (this.config.enableAuth && this.config.apiSecret) {
      headers[this.config.headerName] = this.config.apiSecret;
    }
    
    return headers;
  }

  /**
   * 检查是否启用了API认证
   */
  isEnabled(): boolean {
    return this.config.enableAuth && !!this.config.apiSecret;
  }

  /**
   * 检查是否为内部绑定
   */
  isInternalBinding(): boolean {
    return this.config.isInternalBinding;
  }

  /**
   * 获取连接模式信息
   */
  getConnectionMode(): { type: 'internal' | 'external'; description: string; secure: boolean } {
    if (this.config.isInternalBinding) {
      return {
        type: 'internal',
        description: 'Cloudflare服务绑定（内部安全通信）',
        secure: true
      };
    } else {
      return {
        type: 'external',
        description: `外部HTTP访问 (${this.config.backendUrl})`,
        secure: this.config.enableAuth && !!this.config.apiSecret
      };
    }
  }

  /**
   * 更新API密钥（用于动态配置）
   */
  updateApiSecret(newSecret: string) {
    this.config.apiSecret = newSecret;
    this.config.enableAuth = !!newSecret;
    
    // 更新localStorage以便下次加载使用
    if (newSecret) {
      localStorage.setItem('api_secret', newSecret);
    } else {
      localStorage.removeItem('api_secret');
    }
  }

  /**
   * 从localStorage恢复API密钥
   */
  restoreFromStorage() {
    const storedSecret = localStorage.getItem('api_secret');
    if (storedSecret && !this.config.apiSecret) {
      this.config.apiSecret = storedSecret;
      this.config.enableAuth = true;
    }
  }

  /**
   * 处理API认证错误
   */
  handleAuthError(error: import('axios').AxiosError) {
    const responseData = error.response?.data as { error_code?: string } | undefined;
    
    if (error.response?.status === 401 && responseData?.error_code === 'MISSING_API_SECRET') {
      ElMessage.error('前后端API密钥未配置，请联系管理员');
      return true;
    }
    
    if (error.response?.status === 403 && responseData?.error_code === 'INVALID_API_SECRET') {
      ElMessage.error('API密钥无效，请检查配置');
      // 清除无效的密钥
      this.updateApiSecret('');
      return true;
    }

    return false;
  }
}

// 导出单例实例
export const apiAuthManager = new ApiAuthManager();

// 初始化时尝试从storage恢复
apiAuthManager.restoreFromStorage();

/**
 * Axios请求拦截器配置函数
 */
export const setupApiAuthInterceptor = (axiosInstance: import('axios').AxiosInstance) => {
  // 请求拦截器：自动添加API认证头
  axiosInstance.interceptors.request.use(
    (config) => {
      // 添加API认证头
      const authHeaders = apiAuthManager.getAuthHeaders();
      Object.assign(config.headers, authHeaders);

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // 响应拦截器：处理认证错误
  axiosInstance.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      // 检查是否是API认证错误
      const isAuthError = apiAuthManager.handleAuthError(error);
      
      if (isAuthError) {
        // 认证错误已处理，不再向上抛出
        return Promise.reject(new Error('API认证失败'));
      }

      return Promise.reject(error);
    }
  );
};

/**
 * API密钥设置页面组件所需的工具函数
 */
export const apiAuthUtils = {
  /**
   * 生成随机API密钥
   */
  generateApiSecret(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * 验证API密钥格式
   */
  validateApiSecret(secret: string): boolean {
    return /^[A-Za-z0-9]{16,64}$/.test(secret);
  },

  /**
   * 获取当前API密钥状态
   */
  getStatus() {
    return {
      enabled: apiAuthManager.isEnabled(),
      configured: !!apiAuthManager.getAuthHeaders()['X-API-Secret']
    };
  }
};