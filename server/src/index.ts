import { createApp } from "./app";
import { createDbPool } from "./config/db";
import { loadEnv } from "./config/env";
import { createRedis } from "./config/redis";
import { MariaD1Database } from "./db/d1-adapter";
import { DatabaseService } from "./services/database";
import { CacheService } from "./services/cache";
import { startSchedulers } from "./scheduler";

async function bootstrap() {
  const env = loadEnv();
  const pool = createDbPool(env);
  const db = new MariaD1Database(pool);
  const dbService = new DatabaseService(db);
  const redis = createRedis(env);

  if (redis) {
    try {
      await redis.connect();
      console.log("[redis] connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[redis] connect failed, fallback to MariaDB only:", message);
    }
  }

  const cache = new CacheService({ db: dbService, redis: redis ?? undefined });
  startSchedulers(dbService, cache);
  const app = createApp({ env, db, dbService, cache, redis: redis ?? null });
  const port = env.PORT ?? 18787;

  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
