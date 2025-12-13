import type { Redis } from "ioredis";
import { DatabaseService } from "./database";

type CacheValue = string;

// Redis 可用时优先使用；Redis 不可用时自动回退到 MariaDB（user_sessions 表）
export class CacheService {
  private readonly db: DatabaseService;
  private readonly redis: Redis | null;
  private redisHealthy: boolean;

  constructor(deps: { db: DatabaseService; redis?: Redis | null }) {
    this.db = deps.db;
    this.redis = deps.redis ?? null;
    this.redisHealthy = !!this.redis;
  }

  async get(key: string): Promise<CacheValue | null> {
    if (this.redis && this.redisHealthy) {
      try {
        const val = await this.redis.get(key);
        if (val !== null) return val;
      } catch (error) {
        this.markRedisUnhealthy(error);
      }
    }

    if (key.startsWith("session_")) {
      return await this.getSessionFromDB(key);
    } else if (key.startsWith("sub_token_")) {
      return await this.getSubscriptionTokenFromDB(key);
    }

    return null;
  }

  async set(key: string, value: CacheValue, ttlSeconds = 300): Promise<void> {
    if (this.redis && this.redisHealthy) {
      try {
        await this.redis.set(key, value, "EX", ttlSeconds);
      } catch (error) {
        this.markRedisUnhealthy(error);
      }
    }

    if (key.startsWith("session_")) {
      await this.setSessionToDB(key, value, ttlSeconds);
    }
  }

  async delete(key: string): Promise<void> {
    if (this.redis && this.redisHealthy) {
      try {
        await this.redis.del(key);
      } catch (error) {
        this.markRedisUnhealthy(error);
      }
    }

    if (key.startsWith("session_")) {
      const token = key.replace("session_", "");
      await this.db.db
        .prepare("DELETE FROM user_sessions WHERE token = ?")
        .bind(token)
        .run();
    }
  }

  async cleanupExpiredSessions(): Promise<void> {
    await this.db.db
      .prepare('DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
      .run();
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    if (this.redis && this.redisHealthy) {
      try {
        let cursor = "0";
        do {
          const [next, keys] = await this.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
          cursor = next;
          if (keys.length) {
            await this.redis.del(...keys);
          }
        } while (cursor !== "0");
      } catch (error) {
        this.markRedisUnhealthy(error);
      }
    }

    if (prefix.startsWith("user_") && prefix.includes("_")) {
      const userId = Number.parseInt(prefix.split("_")[1] ?? "", 10);
      if (!Number.isNaN(userId)) {
        await this.db.db
          .prepare("DELETE FROM user_sessions WHERE user_id = ?")
          .bind(userId)
          .run();
      }
    }
  }

  private async getSessionFromDB(key: string): Promise<string | null> {
    const token = key.replace("session_", "");
    const stmt = this.db.db.prepare(`
      SELECT user_data FROM user_sessions 
      WHERE token = ? AND expires_at > CURRENT_TIMESTAMP
    `);
    const result = await stmt.bind(token).first<{ user_data: string }>();
    return result?.user_data ?? null;
  }

  private async setSessionToDB(key: string, value: string, ttlSeconds: number): Promise<void> {
    const token = key.replace("session_", "");
    const userData = JSON.parse(value);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.db.db
      .prepare(
        `
        INSERT INTO user_sessions (token, user_id, user_data, expires_at, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE 
          user_id = VALUES(user_id),
          user_data = VALUES(user_data),
          expires_at = VALUES(expires_at)
      `
      )
      .bind(token, userData.id, value, expiresAt.toISOString().slice(0, 19).replace("T", " "))
      .run();
  }

  private async getSubscriptionTokenFromDB(key: string): Promise<string | null> {
    const token = key.replace("sub_token_", "");
    const stmt = this.db.db.prepare(`
      SELECT id AS user_id FROM users WHERE token = ?
    `);
    const result = await stmt.bind(token).first<{ user_id: number | string }>();
    if (result) {
      const userId = result.user_id.toString();
      if (this.redis && this.redisHealthy) {
        try {
          await this.redis.set(key, userId, "EX", 300);
        } catch (error) {
          this.markRedisUnhealthy(error);
        }
      }
      return userId;
    }
    return null;
  }

  private markRedisUnhealthy(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[redis] fallback to MariaDB:", message);
    this.redisHealthy = false;
  }
}
