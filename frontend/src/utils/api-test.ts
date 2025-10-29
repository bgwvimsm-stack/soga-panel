// API连接测试工具

import http from "@/api/http";
import { ElMessage } from "element-plus";

export interface ApiTestResult {
  success: boolean;
  message: string;
  statusCode?: number;
  data?: any;
}

/**
 * 测试API连接状态
 */
export const testApiConnection = async (): Promise<ApiTestResult> => {
  try {
    const response = await http.get("/health", {
      timeout: 5000
    });
    
    return {
      success: true,
      message: "API连接正常",
      statusCode: 200,
      data: response.data
    };
  } catch (error: any) {
    console.error("API连接测试失败:", error);
    
    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        message: "无法连接到后端服务，请确保后端服务正在运行",
        statusCode: 0
      };
    }
    
    if (error.response) {
      return {
        success: false,
        message: `API请求失败: ${error.response.status} ${error.response.statusText}`,
        statusCode: error.response.status,
        data: error.response.data
      };
    }
    
    return {
      success: false,
      message: `网络错误: ${error.message}`,
      statusCode: 0
    };
  }
};

/**
 * 测试登录API
 */
export const testLoginApi = async (email: string = "test@example.com", password: string = "test123"): Promise<ApiTestResult> => {
  try {
    const response = await http.post("/auth/login", {
      email,
      password
    });
    
    return {
      success: true,
      message: "登录API测试成功",
      statusCode: 200,
      data: response.data
    };
  } catch (error: any) {
    console.error("登录API测试失败:", error);
    
    if (error.response?.status === 401) {
      return {
        success: false,
        message: "登录凭证无效，这是正常的（测试账户不存在）",
        statusCode: 401,
        data: error.response.data
      };
    }
    
    return {
      success: false,
      message: `登录API测试失败: ${error.message}`,
      statusCode: error.response?.status || 0,
      data: error.response?.data
    };
  }
};

/**
 * 显示API测试结果
 */
export const showApiTestResult = (result: ApiTestResult) => {
  if (result.success) {
    ElMessage.success(result.message);
  } else {
    ElMessage.error(result.message);
  }
  
  console.log("API测试结果:", result);
};

/**
 * 运行完整的API连接测试
 */
export const runFullApiTest = async () => {
  console.log("开始API连接测试...");
  
  // 测试基础连接
  const connectionResult = await testApiConnection();
  console.log("1. 基础连接测试:", connectionResult);
  
  // 测试登录API
  const loginResult = await testLoginApi();
  console.log("2. 登录API测试:", loginResult);
  
  // 显示综合结果
  if (connectionResult.success || loginResult.statusCode === 401) {
    ElMessage.success("API连接配置正确，后端服务可访问");
  } else {
    ElMessage.error("API连接失败，请检查后端服务是否运行");
  }
  
  return {
    connection: connectionResult,
    login: loginResult
  };
};