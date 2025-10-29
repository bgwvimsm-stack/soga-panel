// src/utils/format.ts - 通用格式化工具函数

/**
 * 格式化字节数为人类可读的大小
 * @param bytes - 字节数
 * @param decimals - 小数位数，默认2位
 * @returns 格式化后的字符串，如 "1.23 GB"
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * 格式化速度（字节/秒）
 * @param bytesPerSecond - 每秒字节数
 * @param decimals - 小数位数，默认2位
 * @returns 格式化后的速度字符串，如 "1.23 MB/s"
 */
export function formatSpeed(bytesPerSecond: number, decimals: number = 2): string {
  return formatBytes(bytesPerSecond, decimals) + '/s';
}

/**
 * 格式化时间持续时间
 * @param seconds - 秒数
 * @returns 格式化后的时间字符串，如 "1h 23m 45s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 
      ? `${minutes}m ${Math.round(remainingSeconds)}s`
      : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours < 24) {
    return remainingMinutes > 0 
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  return remainingHours > 0 
    ? `${days}d ${remainingHours}h`
    : `${days}d`;
}

/**
 * 格式化日期时间
 * @param dateTime - 日期时间字符串或Date对象
 * @param format - 格式类型：'date' | 'time' | 'datetime' | 'relative'
 * @returns 格式化后的日期时间字符串
 */
export function formatDateTime(
  dateTime: string | Date | null | undefined, 
  format: 'date' | 'time' | 'datetime' | 'relative' = 'datetime'
): string {
  if (!dateTime) return '未知';
  
  const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
  
  if (isNaN(date.getTime())) return '无效日期';
  
  // 转换为北京时间
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  
  switch (format) {
    case 'date':
      return beijingTime.toISOString().split('T')[0];
    
    case 'time':
      return beijingTime.toISOString().split('T')[1].slice(0, 8);
    
    case 'datetime':
      return beijingTime.toISOString().replace('T', ' ').slice(0, -5);
    
    case 'relative':
      return formatRelativeTime(date);
    
    default:
      return beijingTime.toISOString().replace('T', ' ').slice(0, -5);
  }
}

/**
 * 格式化相对时间
 * @param date - 日期对象
 * @returns 相对时间字符串，如 "2小时前"
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) {
    return '刚刚';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`;
  } else if (diffHours < 24) {
    return `${diffHours}小时前`;
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else {
    return formatDateTime(date, 'date');
  }
}

/**
 * 格式化百分比
 * @param value - 数值 (0-1 或 0-100)
 * @param total - 总数 (可选，如果提供则计算 value/total)
 * @param decimals - 小数位数，默认1位
 * @returns 格式化后的百分比字符串，如 "75.5%"
 */
export function formatPercentage(
  value: number, 
  total?: number, 
  decimals: number = 1
): string {
  let percentage: number;
  
  if (total !== undefined && total !== 0) {
    percentage = (value / total) * 100;
  } else if (value <= 1) {
    percentage = value * 100;
  } else {
    percentage = value;
  }
  
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * 格式化数字（添加千分位分隔符）
 * @param num - 数字
 * @returns 格式化后的数字字符串，如 "1,234,567"
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

/**
 * 截断文本
 * @param text - 原始文本
 * @param maxLength - 最大长度
 * @param suffix - 后缀，默认 "..."
 * @returns 截断后的文本
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}