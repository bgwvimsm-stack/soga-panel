import Redis from "ioredis";
import type { AppEnv } from "./env";

export type RedisClient = Redis | null;

export function createRedis(env: AppEnv): RedisClient {
  if (!env.REDIS_HOST) return null;

  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB ?? 0,
    keyPrefix: env.REDIS_PREFIX || "soga:",
    lazyConnect: true
  });

  client.on("error", (err) => {
    console.error("[redis] error:", err.message);
  });

  client.on("close", () => {
    console.warn("[redis] connection closed");
  });

  return client;
}
