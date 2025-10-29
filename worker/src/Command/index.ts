// worker/src/Command/index.js - 手动执行命令入口文件

import { handleResetSubFullToken } from './ResetSubFullToken';
import { handleCheckExpiredLevels } from './CheckExpiredLevels';
import { handleClearJwtToken } from './clearJwtToken';
import { handleResetTodayBandwidth } from './resetTodayBandwidth';

/**
 * 可用的手动执行命令
 */
export const AVAILABLE_COMMANDS = {
  'reset-subscription-tokens': {
    name: 'reset-subscription-tokens',
    description: '重置所有用户订阅令牌',
    handler: handleResetSubFullToken
  },
  'check-expired-levels': {
    name: 'check-expired-levels',
    description: '手动检测并重置过期用户等级',
    handler: handleCheckExpiredLevels
  },
  'clear-jwt-tokens': {
    name: 'clear-jwt-tokens',
    description: '清除所有JWT令牌',
    handler: handleClearJwtToken
  },
  'clear-expired-jwt-tokens': {
    name: 'clear-expired-jwt-tokens', 
    description: '清除过期的JWT令牌',
    handler: (env) => handleClearJwtToken(env, true)
  },
  'reset-today-bandwidth': {
    name: 'reset-today-bandwidth',
    description: '重置今日已使用流量',
    handler: handleResetTodayBandwidth
  }
};

/**
 * 执行手动命令
 * @param {string} commandName - 命令名称
 * @param {Object} env - Cloudflare Workers 环境变量
 * @returns {Promise<Object>} 执行结果
 */
export async function executeCommand(commandName, env) {
  console.log(`执行手动命令: ${commandName}`);
  
  if (!commandName) {
    return {
      success: false,
      message: '请指定要执行的命令',
      available_commands: Object.keys(AVAILABLE_COMMANDS)
    };
  }
  
  const command = AVAILABLE_COMMANDS[commandName];
  
  if (!command) {
    return {
      success: false,
      message: `未知命令: ${commandName}`,
      available_commands: Object.keys(AVAILABLE_COMMANDS)
    };
  }
  
  try {
    console.log(`开始执行命令: ${command.description}`);
    const startTime = Date.now();
    
    const result = await command.handler(env);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`命令执行完成，耗时: ${duration}ms`);
    
    return {
      ...result,
      command: commandName,
      description: command.description,
      duration: `${duration}ms`,
      executed_at: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`执行命令 ${commandName} 失败:`, error);
    
    return {
      success: false,
      message: `执行命令失败: ${error.message}`,
      command: commandName,
      error: error.message
    };
  }
}

/**
 * 获取所有可用命令列表
 * @returns {Array} 命令列表
 */
export function getAvailableCommands() {
  return Object.values(AVAILABLE_COMMANDS).map(cmd => ({
    name: cmd.name,
    description: cmd.description
  }));
}

/**
 * 处理命令执行请求的HTTP处理器
 * @param {Request} request - HTTP请求
 * @param {Object} env - 环境变量
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleCommandRequest(request, env) {
  try {
    // 检查请求方法
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        message: '仅支持POST请求',
        available_commands: getAvailableCommands()
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 解析请求参数
    const { command } = await request.json();
    
    // 执行命令
    const result = await executeCommand(command, env);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('处理命令请求失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      message: `处理命令请求失败: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}