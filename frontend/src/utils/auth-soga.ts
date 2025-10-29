import Cookies from "js-cookie";
import type { User } from "@/api/types";

const TOKEN_KEY = "soga-panel-token";
const USER_KEY = "soga-panel-user";

/**
 * 获取Token
 */
export const getToken = (): string | undefined => {
  return Cookies.get(TOKEN_KEY);
};

/**
 * 设置Token
 */
export const setToken = (token: string): void => {
  Cookies.set(TOKEN_KEY, token, { expires: 7 }); // 7天过期
};

/**
 * 移除Token
 */
export const removeToken = (): void => {
  Cookies.remove(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

/**
 * 检查是否已登录
 */
export const isAuthenticated = (): boolean => {
  return !!getToken();
};

/**
 * 获取用户信息
 */
export const getUser = (): User | null => {
  const userStr = localStorage.getItem(USER_KEY);
  if (userStr) {
    try {
      return JSON.parse(userStr) as User;
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * 设置用户信息
 */
export const setUser = (user: User): void => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

/**
 * 检查是否为管理员
 */
export const isAdmin = (): boolean => {
  const user = getUser();
  // 支持多种类型：boolean true, 数字 1, 字符串 "1"
  return user?.is_admin === true || user?.is_admin === 1 || user?.is_admin === "1";
};

/**
 * 格式化Token (添加Bearer前缀)
 */
export const formatToken = (token: string): string => {
  return `Bearer ${token}`;
};