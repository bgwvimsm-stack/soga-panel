import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";

type Executor = Pool | PoolConnection;

export type D1Result<T = RowDataPacket> = {
  success: boolean;
  results?: T[];
  error?: string;
};

export type D1RunResult = {
  success: boolean;
  changes?: number;
  lastRowId?: number | null;
  meta?: {
    changes?: number;
    last_rowid?: number;
    changed_db_rows?: number;
  };
  error?: string;
};

class MariaPreparedStatement {
  constructor(
    private readonly executor: Executor,
    private readonly sql: string,
    private readonly params: unknown[] = []
  ) {}

  bind(...params: unknown[]) {
    return new MariaPreparedStatement(this.executor, this.sql, params);
  }

  async all<T = RowDataPacket>(): Promise<D1Result<T>> {
    try {
      const [rows] = await this.executor.query(this.sql, this.params);
      return { success: true, results: rows as T[] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  async first<T = RowDataPacket>(): Promise<T | null> {
    const result = await this.all<T>();
    if (!result.success || !result.results?.length) return null;
    return result.results[0] as T;
  }

  async run(): Promise<D1RunResult> {
    try {
      const [result] = await this.executor.execute(this.sql, this.params);
      const header = result as ResultSetHeader;
      const changes =
        typeof header.affectedRows === "number" ? header.affectedRows : 0;
      const lastRowId =
        typeof header.insertId === "number" ? header.insertId : null;

      return {
        success: true,
        changes,
        lastRowId,
        meta: {
          changes,
          last_rowid: lastRowId ?? undefined
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}

export class MariaD1Database {
  private readonly executor: Executor;
  public readonly db: this;

  constructor(executor: Executor) {
    this.executor = executor;
    this.db = this;
  }

  prepare(sql: string) {
    return new MariaPreparedStatement(this.executor, sql);
  }

  async transaction<T>(fn: (db: MariaD1Database) => Promise<T>): Promise<T> {
    if (!("getConnection" in this.executor)) {
      throw new Error("Transactions require a Pool executor");
    }

    const pool = this.executor as Pool;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const txDb = new MariaD1Database(connection);
      const result = await fn(txDb);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
