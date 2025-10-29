// 简化的 i18n 插件，直接返回原始文本
export function transformI18n(message: any = "") {
  if (!message) {
    return "";
  }
  // 如果是字符串，直接返回
  if (typeof message === "string") {
    return message;
  }
  // 如果是对象，尝试获取 zh-CN 或默认值
  if (typeof message === "object") {
    return message["zh-CN"] || message.default || "";
  }
  return String(message);
}
