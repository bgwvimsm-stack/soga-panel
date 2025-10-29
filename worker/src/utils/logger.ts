// src/utils/logger.ts - 结构化日志系统

type LogLevel = "info" | "warn" | "error" | "debug" | "audit";
type LogContext = Record<string, unknown>;

export interface FormattedLog {
  timestamp: string;
  level: string;
  message: string;
  context: LogContext;
  formatted: string;
}

class Logger {
  private readonly env: Record<string, unknown>;
  private readonly isDevelopment: boolean;

  constructor(env: Record<string, unknown> = {}) {
    this.env = env;
    const environment = (env.ENVIRONMENT ?? env.NODE_ENV) as string | undefined;
    this.isDevelopment = environment === "development";
  }

  // 格式化时间戳（北京时间）
  getTimestamp(): string {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return beijingTime.toISOString().replace('T', ' ').replace('Z', ' +08:00');
  }

  // 格式化日志消息
  formatMessage(level: LogLevel | string, message: string, context: LogContext = {}): FormattedLog {
    const timestamp = this.getTimestamp();
    const contextStr = Object.keys(context).length > 0 ? JSON.stringify(context) : '';
    
    return {
      timestamp,
      level: level.toUpperCase(),
      message,
      context,
      formatted: `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr ? ' | Context: ' + contextStr : ''}`
    };
  }

  // 输出日志到控制台（开发环境）或存储（生产环境）
  output(logData: FormattedLog): void {
    if (this.isDevelopment) {
      // 开发环境：彩色输出到控制台
      const colors = {
        INFO: '\x1b[36m',    // 青色
        WARN: '\x1b[33m',    // 黄色
        ERROR: '\x1b[31m',   // 红色
        DEBUG: '\x1b[35m',   // 紫色
        AUDIT: '\x1b[32m',   // 绿色
        RESET: '\x1b[0m'     // 重置颜色
      };
      
      const color = colors[logData.level] || colors.RESET;
      console.log(color + logData.formatted + colors.RESET);
    } else {
      // 生产环境：结构化输出
      console.log(JSON.stringify(logData));
    }
  }

  // 信息日志
  info(message: string, context: LogContext = {}): FormattedLog {
    const logData = this.formatMessage('info', message, context);
    this.output(logData);
    return logData;
  }

  // 警告日志
  warn(message: string, context: LogContext = {}): FormattedLog {
    const logData = this.formatMessage('warn', message, context);
    this.output(logData);
    return logData;
  }

  // 错误日志
  error(message: string, error: unknown = null, context: LogContext = {}): FormattedLog {
    const normalizedError =
      error instanceof Error
        ? error
        : error === null
        ? null
        : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const errorContext = {
      ...context,
      ...(normalizedError && {
        error_message: normalizedError.message,
        error_stack: normalizedError.stack,
        error_name: normalizedError.name
      })
    };
    
    const logData = this.formatMessage('error', message, errorContext);
    this.output(logData);
    return logData;
  }

  // 调试日志（仅开发环境）
  debug(message: string, context: LogContext = {}): FormattedLog | undefined {
    if (!this.isDevelopment) return;
    
    const logData = this.formatMessage('debug', message, context);
    this.output(logData);
    return logData;
  }

  // 审计日志（重要操作记录）
  audit(action: string, userId: number | string, details: LogContext = {}, nodeId: number | string | null = null): FormattedLog {
    const auditContext = {
      action,
      user_id: userId,
      node_id: nodeId,
      timestamp: this.getTimestamp(),
      details
    };

    const logData = this.formatMessage('audit', `User ${userId} performed ${action}`, auditContext);
    this.output(logData);
    
    // 审计日志可以考虑额外存储到数据库
    return logData;
  }

  // API请求日志
  apiRequest(method: string, path: string, userId: number | string | null = null, nodeId: number | string | null = null, responseTime = 0): FormattedLog {
    const context = {
      method,
      path,
      user_id: userId,
      node_id: nodeId,
      response_time_ms: responseTime,
      timestamp: this.getTimestamp()
    };

    const message = `${method} ${path} - ${responseTime}ms`;
    const logData = this.formatMessage('info', message, context);
    this.output(logData);
    return logData;
  }

  // 数据库操作日志
  database(operation: string, table: string, recordId: number | string | null = null, context: LogContext = {}): FormattedLog {
    const dbContext = {
      operation,
      table,
      record_id: recordId,
      ...context
    };

    const message = `Database ${operation} on ${table}${recordId ? ` (ID: ${recordId})` : ''}`;
    const logData = this.formatMessage('debug', message, dbContext);
    this.output(logData);
    return logData;
  }

  // 定时任务日志
  scheduler(taskName: string, status: "started" | "completed" | "failed", duration = 0, result: LogContext = {}): FormattedLog {
    const schedulerContext = {
      task_name: taskName,
      status, // 'started', 'completed', 'failed'
      duration_ms: duration,
      result
    };

    const message = `Scheduled task ${taskName} ${status}${duration > 0 ? ` (${duration}ms)` : ''}`;
    const logData = this.formatMessage('info', message, schedulerContext);
    this.output(logData);
    return logData;
  }

  // 性能监控日志
  performance(metric: string, value: number, context: LogContext = {}): FormattedLog {
    const unit = typeof context.unit === "string" ? context.unit : "ms";
    const perfContext = {
      metric,
      value,
      unit,
      ...context
    };

    const message = `Performance: ${metric} = ${value}${perfContext.unit}`;
    const logData = this.formatMessage('info', message, perfContext);
    this.output(logData);
    return logData;
  }

  // 创建子记录器（带有固定上下文）
  child(fixedContext: LogContext = {}) {
    const parentLogger = this;
    
    return {
      info: (message: string, context: LogContext = {}) =>
        parentLogger.info(message, { ...fixedContext, ...context }),
      warn: (message: string, context: LogContext = {}) =>
        parentLogger.warn(message, { ...fixedContext, ...context }),
      error: (message: string, error: unknown = null, context: LogContext = {}) =>
        parentLogger.error(message, error, { ...fixedContext, ...context }),
      debug: (message: string, context: LogContext = {}) =>
        parentLogger.debug(message, { ...fixedContext, ...context }),
      audit: (
        action: string,
        userId: number | string,
        details: LogContext = {},
        nodeId: number | string | null = null
      ) => parentLogger.audit(action, userId, { ...fixedContext, ...details }, nodeId)
    };
  }
}

// 全局日志实例
let globalLogger: Logger | null = null;

export function createLogger(env: Record<string, unknown> = {}): Logger {
  return new Logger(env);
}

export function getLogger(env: Record<string, unknown> = {}): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(env);
  }
  return globalLogger;
}

export { Logger };
