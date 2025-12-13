import { createPool, Pool } from "mysql2/promise";
import type { AppEnv } from "./env";

export function createDbPool(env: AppEnv): Pool {
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    timezone: env.DB_TIMEZONE,
    dateStrings: true
  });
  return pool;
}
