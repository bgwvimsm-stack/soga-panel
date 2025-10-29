// src/utils/systemConfig.ts - 系统配置工具类

import type { Env } from "../types";
import { DatabaseService } from "../services/database";

interface ConfigKeyDescriptor {
  key: string;
  fallback?: string;
}

export class SystemConfigManager {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly configCache: Map<string, string>;
  private readonly cacheTimestamp: Map<string, number>;
  private readonly CACHE_DURATION: number;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.configCache = new Map();
    this.cacheTimestamp = new Map();
    this.CACHE_DURATION = 5 * 60 * 1000;
  }

  /**
   * 获取系统配置
   * 优先从数据库获取，如果失败则使用环境变量fallback
   * @param {string} key - 配置键名
   * @param {string} fallback - 环境变量fallback值
   * @returns {Promise<string>} 配置值
   */
  async getSystemConfig(key: string, fallback: string | null = null): Promise<string> {
    try {
      // 检查缓存
      const cachedValue = this.getCachedConfig(key);
      if (cachedValue !== null) {
        return cachedValue;
      }

      // 从数据库查询
      const result = await this.db.db
        .prepare("SELECT value FROM system_configs WHERE key = ?")
        .bind(key)
        .first<{ value?: string }>();

      let configValue = result?.value;

      // 如果数据库中没有值或值为空，使用fallback
      if (!configValue && fallback !== null) {
        configValue = fallback;
      }

      // 缓存结果
      if (configValue) {
        this.setCachedConfig(key, configValue);
      }

      return configValue || "";

    } catch (error) {
      console.error(`获取系统配置失败 [${key}]:`, error);
      // 数据库查询失败时，使用环境变量fallback
      return fallback || "";
    }
  }

  /**
   * 批量获取系统配置
   * @param {Array} configKeys - 配置键名数组，格式：[{key: 'site_name', fallback: 'default'}, ...]
   * @returns {Promise<Object>} 配置对象
   */
  async getSystemConfigs(configKeys: ConfigKeyDescriptor[]): Promise<Record<string, string>> {
    const configs: Record<string, string> = {};

    try {
      // 构建批量查询
      const keys = configKeys.map(item => item.key);
      const placeholders = keys.map(() => '?').join(',');

      const results = await this.db.db
        .prepare(`SELECT key, value FROM system_configs WHERE key IN (${placeholders})`)
        .bind(...keys)
        .all<{ key: string; value: string }>();

      const dbConfigs = {};
      if (results.results) {
        results.results.forEach(row => {
          dbConfigs[row.key] = row.value;
        });
      }

      // 处理每个配置项
      for (const configItem of configKeys) {
        const { key, fallback } = configItem;
        let configValue = dbConfigs[key];

        // 如果数据库中没有值，使用fallback
        if (!configValue && fallback !== undefined) {
          configValue = fallback;
        }

        configs[key] = configValue || "";

        // 缓存结果
        if (configValue) {
          this.setCachedConfig(key, configValue);
        }
      }

    } catch (error) {
      console.error("批量获取系统配置失败:", error);
      // 如果批量查询失败，使用fallback值
      for (const configItem of configKeys) {
        configs[configItem.key] = configItem.fallback || "";
      }
    }

    return configs;
  }

  /**
   * 获取站点相关配置的便捷方法
   * @returns {Promise<Object>} 站点配置对象 {site_name, site_url}
   */
  async getSiteConfigs(): Promise<Record<string, string>> {
    return await this.getSystemConfigs([
      { key: "site_name", fallback: (this.env.SITE_NAME as string) || "代理面板" },
      { key: "site_url", fallback: (this.env.SITE_URL as string) || "https://panel.example.com" }
    ]);
  }

  /**
   * 清除配置缓存
   * @param {string} key - 要清除的配置键，如果不提供则清除所有缓存
   */
  clearCache(key: string | null = null): void {
    if (key) {
      this.configCache.delete(key);
      this.cacheTimestamp.delete(key);
    } else {
      this.configCache.clear();
      this.cacheTimestamp.clear();
    }
  }

  /**
   * 获取缓存的配置值
   * @private
   */
  getCachedConfig(key: string): string | null {
    const timestamp = this.cacheTimestamp.get(key);
    if (!timestamp || Date.now() - timestamp > this.CACHE_DURATION) {
      // 缓存过期
      this.configCache.delete(key);
      this.cacheTimestamp.delete(key);
      return null;
    }
    return this.configCache.get(key) || null;
  }

  /**
   * 设置缓存的配置值
   * @private
   */
  setCachedConfig(key: string, value: string): void {
    this.configCache.set(key, value);
    this.cacheTimestamp.set(key, Date.now());
  }
}

/**
 * 创建系统配置管理器的便捷函数
 * @param {Object} env - 环境变量对象
 * @returns {SystemConfigManager} 配置管理器实例
 */
export function createSystemConfigManager(env: Env): SystemConfigManager {
  return new SystemConfigManager(env);
}
