import type { Redis } from "ioredis";
import type { MariaD1Database } from "./db/d1-adapter";
import type { DatabaseService } from "./services/database";
import type { CacheService } from "./services/cache";
import type { AppEnv } from "./config/env";

export type AppContext = {
  env: AppEnv;
  db: MariaD1Database;
  dbService: DatabaseService;
  cache: CacheService;
  redis: Redis | null;
};
