// src/utils/d1.ts - Cloudflare D1 类型辅助工具

import type { D1Result } from "@cloudflare/workers-types";

export type D1RunResult<T extends Record<string, unknown> = Record<string, unknown>> =
  D1Result<T> & {
    changes?: number;
    lastRowId?: number;
    meta?: {
      changes?: number;
      changed_db_rows?: number;
      last_rowid?: number;
      duration?: number;
    };
  };

export function getChanges(result: D1RunResult | null | undefined): number {
  if (!result) return 0;
  if (typeof result.changes === "number") {
    return result.changes;
  }
  const meta = result.meta;
  if (meta) {
    if (typeof meta.changes === "number") return meta.changes;
    if (typeof meta.changed_db_rows === "number") return meta.changed_db_rows;
  }
  return 0;
}

export function toRunResult<T extends Record<string, unknown> = Record<string, unknown>>(
  result: D1Result<T>
): D1RunResult<T> {
  return result as D1RunResult<T>;
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
