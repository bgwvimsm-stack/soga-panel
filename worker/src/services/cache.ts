// src/services/cache.ts - 缓存服务（使用内存缓存 + D1）

import type { D1Database } from "@cloudflare/workers-types";
import { memoryCache, MemoryCache } from "./memory-cache";

export class CacheService {
  public readonly db: D1Database;
  public readonly memoryCache: MemoryCache;

  constructor(db: D1Database) {
    this.db = db;
    this.memoryCache = memoryCache;
  }

  // 通用缓存方法 - 优先使用内存缓存
  async get(key: string) {
    // 先检查内存缓存
    const cached = this.memoryCache.get(key);
    if (cached) return cached;

    // 对于会话类数据，从数据库查询
    if (key.startsWith("session_")) {
      return await this.getSessionFromDB(key);
    } else if (key.startsWith("sub_token_")) {
      return await this.getSubscriptionTokenFromDB(key);
    }

    return null;
  }

  async set(key: string, value: string, ttl = 300) {
    // 存入内存缓存
    this.memoryCache.set(key, value, ttl);

    // 对于会话类数据，同时存入数据库
    if (key.startsWith("session_")) {
      await this.setSessionToDB(key, value, ttl);
    } else if (key.startsWith("sub_token_")) {
      await this.setSubscriptionTokenToDB(key, value, ttl);
    }
  }

  async delete(key: string) {
    // 从内存缓存删除
    this.memoryCache.delete(key);

    // 从数据库删除
    if (key.startsWith("session_")) {
      const token = key.replace("session_", "");
      await this.db
        .prepare("DELETE FROM user_sessions WHERE token = ?")
        .bind(token)
        .run();
    }
  }

  // 数据库会话操作
  async getSessionFromDB(key: string) {
    const token = key.replace("session_", "");
    const stmt = this.db.prepare(`
      SELECT user_data FROM user_sessions 
      WHERE token = ? AND expires_at > datetime('now', '+8 hours')
    `);
    const result = await stmt.bind(token).first<{ user_data: string }>();

    if (result) {
      // 缓存到内存
      this.memoryCache.set(key, result.user_data, 300);
      return result.user_data;
    }
    return null;
  }

  async setSessionToDB(key: string, value: string, ttl: number) {
    const token = key.replace("session_", "");
    const userData = JSON.parse(value);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000 + ttl * 1000).toISOString().replace('Z', '+08:00');

    await this.db
      .prepare(
        `
      INSERT OR REPLACE INTO user_sessions (token, user_id, user_data, expires_at)
      VALUES (?, ?, ?, ?)
    `
      )
      .bind(token, userData.id, value, expiresAt)
      .run();
  }

  async getSubscriptionTokenFromDB(key: string) {
    const token = key.replace("sub_token_", "");
    const stmt = this.db.prepare(`
      SELECT user_id FROM users WHERE token = ?
    `);
    const result = await stmt.bind(token).first<{ user_id: number | string }>();

    if (result) {
      const userId = result.user_id.toString();
      this.memoryCache.set(key, userId, 300);
      return userId;
    }
    return null;
  }

  async setSubscriptionTokenToDB(_key: string, _value: string, _ttl: number) {
    // 订阅令牌直接存储在用户表的 token 字段中，无需额外存储
  }

  // 清理过期数据
  async cleanupExpiredSessions() {
    await this.db
      .prepare('DELETE FROM user_sessions WHERE expires_at < datetime("now")')
      .run();
  }

  // 批量删除（用于替代 deleteByPrefix）
  async deleteByPrefix(prefix: string) {
    // 清理内存缓存
    for (const [key] of this.memoryCache.entries()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }

    // 如果是用户相关的前缀，从数据库清理
    if (prefix.startsWith("user_") && prefix.includes("_")) {
      const userId = Number.parseInt(prefix.split("_")[1] ?? "", 10);
      if (!Number.isNaN(userId)) {
        await this.db
          .prepare("DELETE FROM user_sessions WHERE user_id = ?")
          .bind(userId)
          .run();
      }
    }
  }
}
