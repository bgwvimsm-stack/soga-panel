import type { D1Result, D1RunResult } from "../db/d1-adapter";

export function getChanges(result: D1RunResult | null | undefined): number {
  if (!result) return 0;
  if (typeof result.changes === "number") {
    return result.changes;
  }
  const meta = result.meta;
  if (meta) {
    if (typeof meta.changes === "number") return meta.changes;
    if (typeof (meta as any).changed_db_rows === "number") return (meta as any).changed_db_rows;
  }
  return 0;
}

export function toRunResult<T = Record<string, unknown>>(result: D1Result<T>): D1RunResult {
  return result as unknown as D1RunResult;
}

export function getLastRowId(result: D1RunResult | null | undefined): number | null {
  if (!result) return null;
  if (typeof result.lastRowId === "number") return result.lastRowId;
  const meta = result.meta;
  if (meta && typeof meta.last_rowid === "number") {
    return meta.last_rowid;
  }
  return null;
}

export function ensureNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

export function ensureString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function ensureDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}
