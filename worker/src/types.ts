export type Env = {
  DB: D1Database;
  [key: string]: unknown;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

export type Nullable<T> = T | null;
