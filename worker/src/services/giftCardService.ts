import type { D1Database } from "@cloudflare/workers-types";
import { ensureNumber, ensureString, getLastRowId, toRunResult } from "../utils/d1";
import { fixMoneyPrecision } from "../utils/money";

export type GiftCardType = "balance" | "duration" | "traffic" | "reset_traffic" | "package";

export interface GiftCardRow {
  id: number;
  batch_id?: number | null;
  name: string;
  code: string;
  card_type: GiftCardType;
  status: number;
  balance_amount?: number | null;
  duration_days?: number | null;
  traffic_value_gb?: number | null;
  reset_traffic_gb?: number | null;
  package_id?: number | null;
  max_usage?: number | null;
  used_count?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  created_by?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface GiftCardRedemptionInput {
  card_id: number;
  user_id: number;
  code: string;
  card_type: GiftCardType;
  change_amount?: number | null;
  duration_days?: number | null;
  traffic_value_gb?: number | null;
  reset_traffic_gb?: number | null;
  package_id?: number | null;
  recharge_record_id?: number | null;
  purchase_record_id?: number | null;
  trade_no?: string | null;
  message?: string | null;
  result_status?: "success" | "failed";
}

export interface CreateGiftCardPayload {
  name: string;
  card_type: GiftCardType;
  balance_amount?: number | null;
  duration_days?: number | null;
  traffic_value_gb?: number | null;
  reset_traffic_gb?: number | null;
  package_id?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  max_usage?: number | null;
  quantity?: number | null;
  code?: string | null;
  code_prefix?: string | null;
  description?: string | null;
}

function formatDateTimeInput(value?: string | number | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function normalizeCardRow(row: GiftCardRow): GiftCardRow {
  return {
    ...row,
    status: ensureNumber(row.status),
    balance_amount: row.balance_amount != null ? fixMoneyPrecision(ensureNumber(row.balance_amount)) : null,
    duration_days: row.duration_days != null ? ensureNumber(row.duration_days) : null,
    traffic_value_gb: row.traffic_value_gb != null ? ensureNumber(row.traffic_value_gb) : null,
    reset_traffic_gb: row.reset_traffic_gb != null ? ensureNumber(row.reset_traffic_gb) : null,
    package_id: row.package_id != null ? ensureNumber(row.package_id) : null,
    max_usage: row.max_usage != null ? ensureNumber(row.max_usage) : null,
    used_count: row.used_count != null ? ensureNumber(row.used_count) : null
  };
}

export class GiftCardService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private generateCodeSuffix(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  private sanitizeCode(code: string): string {
    return ensureString(code).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }

  async getGiftCardByCode(code: string): Promise<GiftCardRow | null> {
    const sanitized = this.sanitizeCode(code);
    if (!sanitized) {
      return null;
    }
    const card = await this.db
      .prepare("SELECT * FROM gift_cards WHERE UPPER(code) = ? LIMIT 1")
      .bind(sanitized)
      .first<GiftCardRow>();
    return card ? normalizeCardRow(card) : null;
  }

  async getGiftCardById(id: number): Promise<GiftCardRow | null> {
    if (!id) return null;
    const card = await this.db
      .prepare("SELECT * FROM gift_cards WHERE id = ?")
      .bind(id)
      .first<GiftCardRow>();
    return card ? normalizeCardRow(card) : null;
  }

  async updateGiftCardStatus(id: number, status: number): Promise<boolean> {
    const result = toRunResult(
      await this.db
        .prepare("UPDATE gift_cards SET status = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?")
        .bind(status, id)
        .run()
    );
    return (result.meta?.changes ?? 0) > 0;
  }

  async updateGiftCardUsage(cardId: number, usedCount: number, maxUsage: number | null): Promise<void> {
    const shouldDisable = maxUsage != null && usedCount >= maxUsage;
    const status = shouldDisable ? 2 : 1;
    await this.db
      .prepare(`
        UPDATE gift_cards
        SET used_count = ?, status = ?, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `)
      .bind(usedCount, status, cardId)
      .run();
  }

  async recordRedemption(entry: GiftCardRedemptionInput): Promise<number | null> {
    const result = await this.db
      .prepare(`
        INSERT INTO gift_card_redemptions
        (card_id, user_id, code, card_type, change_amount, duration_days, traffic_value_gb, reset_traffic_gb,
         package_id, recharge_record_id, purchase_record_id, trade_no, result_status, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
      `)
      .bind(
        entry.card_id,
        entry.user_id,
        entry.code,
        entry.card_type,
        entry.change_amount ?? null,
        entry.duration_days ?? null,
        entry.traffic_value_gb ?? null,
        entry.reset_traffic_gb ?? null,
        entry.package_id ?? null,
        entry.recharge_record_id ?? null,
        entry.purchase_record_id ?? null,
        entry.trade_no ?? entry.code,
        entry.result_status ?? "success",
        entry.message ?? null
      )
      .run();

    return getLastRowId(toRunResult(result));
  }

  async createGiftCards(payload: CreateGiftCardPayload, creatorId?: number | null) {
    const {
      name,
      card_type,
      description,
      quantity = 1,
      code_prefix,
      code
    } = payload;

    const normalizedQuantity = Math.max(1, Math.min(ensureNumber(quantity, 1), 500));
    const normalizedPrefix = this.sanitizeCode(code_prefix || "GC");
    const normalizedMaxUsage =
      payload.max_usage != null ? Math.max(1, ensureNumber(payload.max_usage, 1)) : null;
    const normalizedBalance =
      payload.balance_amount != null ? fixMoneyPrecision(Math.max(ensureNumber(payload.balance_amount, 0), 0)) : null;
    const normalizedDuration =
      payload.duration_days != null ? Math.max(1, Math.floor(ensureNumber(payload.duration_days, 1))) : null;
    const normalizedTraffic =
      payload.traffic_value_gb != null ? Math.max(0, ensureNumber(payload.traffic_value_gb, 0)) : null;
    const normalizedReset =
      payload.reset_traffic_gb != null ? Math.max(0, ensureNumber(payload.reset_traffic_gb, 0)) : null;
    const normalizedPackage = payload.package_id != null ? ensureNumber(payload.package_id) : null;

    const startAt = formatDateTimeInput(payload.start_at);
    const endAt = formatDateTimeInput(payload.end_at);

    let batchId: number | null = null;
    const batchResult = await this.db
      .prepare(`
        INSERT INTO gift_card_batches
        (name, description, card_type, quantity, code_prefix, balance_amount, duration_days, traffic_value_gb,
         reset_traffic_gb, package_id, max_usage, start_at, end_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        name,
        description ?? null,
        card_type,
        normalizedQuantity,
        normalizedPrefix,
        normalizedBalance,
        normalizedDuration,
        normalizedTraffic,
        normalizedReset,
        normalizedPackage,
        normalizedMaxUsage,
        startAt,
        endAt,
        creatorId ?? null
      )
      .run();

    batchId = getLastRowId(toRunResult(batchResult));

    const cards: GiftCardRow[] = [];
    for (let i = 0; i < normalizedQuantity; i++) {
      let finalCode =
        normalizedQuantity === 1 && code
          ? this.sanitizeCode(code)
          : `${normalizedPrefix}${Date.now().toString().slice(-6)}${this.generateCodeSuffix()}`;

      // 确保唯一性，发生冲突则重新生成
      let attempt = 0;
      while (attempt < 5) {
        const existing = await this.db
          .prepare("SELECT id FROM gift_cards WHERE code = ?")
          .bind(finalCode)
          .first();
        if (!existing) break;
        finalCode = `${normalizedPrefix}${this.generateCodeSuffix()}${Math.floor(Math.random() * 90 + 10)}`;
        attempt++;
      }

      const insertResult = await this.db
        .prepare(`
          INSERT INTO gift_cards
          (batch_id, name, code, card_type, status, balance_amount, duration_days, traffic_value_gb,
           reset_traffic_gb, package_id, max_usage, start_at, end_at, created_by)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          batchId,
          name,
          finalCode,
          card_type,
          normalizedBalance,
          normalizedDuration,
          normalizedTraffic,
          normalizedReset,
          normalizedPackage,
          normalizedMaxUsage,
          startAt,
          endAt,
          creatorId ?? null
        )
        .run();

      const cardId = getLastRowId(toRunResult(insertResult));
      cards.push({
        id: cardId ?? 0,
        batch_id: batchId,
        name,
        code: finalCode,
        card_type,
        status: 1,
        balance_amount: normalizedBalance,
        duration_days: normalizedDuration,
        traffic_value_gb: normalizedTraffic,
        reset_traffic_gb: normalizedReset,
        package_id: normalizedPackage,
        max_usage: normalizedMaxUsage,
        used_count: 0,
        start_at: startAt,
        end_at: endAt,
        created_by: creatorId ?? null
      });
    }

    return { batchId, cards };
  }

  async deleteGiftCard(id: number): Promise<boolean> {
    const result = toRunResult(
      await this.db.prepare("DELETE FROM gift_cards WHERE id = ?").bind(id).run()
    );
    return (result.meta?.changes ?? 0) > 0;
  }

  async updateGiftCard(
    id: number,
    data: Partial<Omit<CreateGiftCardPayload, "quantity" | "code" | "code_prefix">>
  ): Promise<boolean> {
    const fields: string[] = [];
    const params: Array<string | number | null> = [];

    if (data.name !== undefined) {
      fields.push("name = ?");
      params.push(data.name);
    }
    if (data.card_type) {
      fields.push("card_type = ?");
      params.push(data.card_type);
    }
    if (data.balance_amount !== undefined) {
      fields.push("balance_amount = ?");
      params.push(
        data.balance_amount != null
          ? fixMoneyPrecision(Math.max(ensureNumber(data.balance_amount, 0), 0))
          : null
      );
    }
    if (data.duration_days !== undefined) {
      fields.push("duration_days = ?");
      params.push(
        data.duration_days != null
          ? Math.max(1, Math.floor(ensureNumber(data.duration_days, 1)))
          : null
      );
    }
    if (data.traffic_value_gb !== undefined) {
      fields.push("traffic_value_gb = ?");
      params.push(
        data.traffic_value_gb != null ? Math.max(0, ensureNumber(data.traffic_value_gb, 0)) : null
      );
    }
    if (data.reset_traffic_gb !== undefined) {
      fields.push("reset_traffic_gb = ?");
      params.push(
        data.reset_traffic_gb != null ? Math.max(0, ensureNumber(data.reset_traffic_gb, 0)) : null
      );
    }
    if (data.package_id !== undefined) {
      fields.push("package_id = ?");
      params.push(data.package_id != null ? ensureNumber(data.package_id) : null);
    }
    if (data.max_usage !== undefined) {
      fields.push("max_usage = ?");
      params.push(
        data.max_usage != null ? Math.max(1, ensureNumber(data.max_usage, 1)) : null
      );
    }
    if (data.start_at !== undefined) {
      fields.push("start_at = ?");
      params.push(formatDateTimeInput(data.start_at));
    }
    if (data.end_at !== undefined) {
      fields.push("end_at = ?");
      params.push(formatDateTimeInput(data.end_at));
    }

    if (!fields.length) {
      return false;
    }

    fields.push("updated_at = datetime('now', '+8 hours')");
    const result = toRunResult(
      await this.db
        .prepare(`UPDATE gift_cards SET ${fields.join(", ")} WHERE id = ?`)
        .bind(...params, id)
        .run()
    );
    return (result.meta?.changes ?? 0) > 0;
  }
}
