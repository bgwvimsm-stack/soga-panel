import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { generateRandomString } from "../../utils/crypto";
import { ensureNumber } from "../../utils/d1";

export function createAdminGiftCardRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  const ensureAdmin = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) {
      errorResponse(res, "需要管理员权限", 403);
      return null;
    }
    return user;
  };

  router.get("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const limitCandidate = Number(limitRaw) || 20;
    const limit = Math.min(Math.max(limitCandidate, 1), 100);
    const statusParam = req.query.status;
    const typeParam = req.query.card_type;
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    const offset = (page - 1) * limit;

    let whereClause = "WHERE 1=1";
    const params: Array<string | number> = [];

    if (statusParam !== undefined && statusParam !== null && String(statusParam) !== "") {
      whereClause += " AND gc.status = ?";
      params.push(Number(statusParam));
    }

    if (typeof typeParam === "string" && typeParam.trim() !== "") {
      whereClause += " AND gc.card_type = ?";
      params.push(typeParam.trim());
    }

    if (keyword) {
      whereClause += " AND (UPPER(gc.code) LIKE ? OR gc.name LIKE ?)";
      params.push(`%${keyword.toUpperCase()}%`, `%${keyword}%`);
    }

    const totalRow = await ctx.db.db
      .prepare(`SELECT COUNT(*) as total FROM gift_cards gc ${whereClause}`)
      .bind(...params)
      .first<{ total: number | string | null }>();
    const total = ensureNumber(totalRow?.total ?? 0);

    const listResult = await ctx.db.db
      .prepare(
        `
        SELECT
          gc.*,
          gb.name as batch_name,
          p.name as package_name
        FROM gift_cards gc
        LEFT JOIN gift_card_batches gb ON gc.batch_id = gb.id
        LEFT JOIN packages p ON gc.package_id = p.id
        ${whereClause}
        ORDER BY gc.id DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...params, limit, offset)
      .all<{
        id: number;
        batch_id?: number | string | null;
        name: string;
        code: string;
        card_type: string;
        status: number | string;
        balance_amount?: number | string | null;
        duration_days?: number | string | null;
        traffic_value_gb?: number | string | null;
        reset_traffic_gb?: number | string | null;
        package_id?: number | string | null;
        max_usage?: number | string | null;
        per_user_limit?: number | string | null;
        used_count?: number | string | null;
        start_at?: string | null;
        end_at?: string | null;
        created_at?: string | null;
        batch_name?: string | null;
        package_name?: string | null;
      }>();

    const records = (listResult.results ?? []).map((record) => {
      const maxUsage =
        record.max_usage !== undefined && record.max_usage !== null
          ? ensureNumber(record.max_usage)
          : null;
      const perUserLimit =
        record.per_user_limit !== undefined && record.per_user_limit !== null
          ? ensureNumber(record.per_user_limit)
          : null;
      const usedCount = ensureNumber(record.used_count ?? 0);
      const remaining = maxUsage !== null ? Math.max(maxUsage - usedCount, 0) : null;
      const endAt = record.end_at ? new Date(record.end_at) : null;
      const isExpired = endAt ? endAt.getTime() < Date.now() : false;
      return {
        ...record,
        max_usage: maxUsage,
        per_user_limit: perUserLimit,
        used_count: usedCount,
        remaining_usage: remaining,
        is_expired: isExpired
      };
    });

    return successResponse(res, {
      records,
      pagination: {
        total,
        page,
        limit,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0
      }
    });
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { name, code, card_type, balance_amount, duration_days, traffic_value_gb, reset_traffic_gb, package_id, max_usage, per_user_limit, start_at, end_at } =
      req.body || {};
    if (!name) return errorResponse(res, "名称必填", 400);
    if (max_usage !== undefined && max_usage !== null && (!Number(max_usage) || Number(max_usage) <= 0)) {
      return errorResponse(res, "最大使用次数必须大于 0", 400);
    }
    if (per_user_limit !== undefined && per_user_limit !== null && (!Number(per_user_limit) || Number(per_user_limit) <= 0)) {
      return errorResponse(res, "单用户使用次数必须大于 0", 400);
    }
    const finalCode = code || generateRandomString(16);
    await ctx.dbService.createGiftCard({
      name,
      code: finalCode,
      cardType: card_type || "balance",
      balanceAmount: balance_amount ?? null,
      durationDays: duration_days ?? null,
      trafficValueGb: traffic_value_gb ?? null,
      resetTrafficGb: reset_traffic_gb ?? null,
      packageId: package_id ?? null,
      maxUsage: max_usage ?? null,
      perUserLimit: per_user_limit ?? null,
      startAt: start_at ? new Date(start_at) : null,
      endAt: end_at ? new Date(end_at) : null
    });
    return successResponse(res, { code: finalCode }, "礼品卡已创建");
  });

  // 兼容 Worker/前端：PUT /api/admin/gift-cards/:id
  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    const payload = req.body || {};
    const allowedFields = [
      "name",
      "card_type",
      "balance_amount",
      "duration_days",
      "traffic_value_gb",
      "reset_traffic_gb",
      "package_id",
      "max_usage",
      "per_user_limit",
      "start_at",
      "end_at"
    ];

    const updates: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (payload[field] === undefined) continue;
      if (field === "card_type") {
        updates.push("card_type = ?");
        values.push(String(payload[field] || "").trim());
        continue;
      }
      if (field === "start_at" || field === "end_at") {
        updates.push(`${field} = ?`);
        values.push(payload[field] ? new Date(payload[field]).toISOString().slice(0, 19).replace("T", " ") : null);
        continue;
      }
      if (field === "max_usage" || field === "per_user_limit") {
        const v = payload[field];
        if (v !== null && v !== undefined) {
          const n = ensureNumber(v);
          if (!Number.isFinite(n) || n <= 0) return errorResponse(res, `${field} 必须大于 0`, 400);
          updates.push(`${field} = ?`);
          values.push(n);
        } else {
          updates.push(`${field} = ?`);
          values.push(null);
        }
        continue;
      }
      updates.push(`${field} = ?`);
      values.push(payload[field]);
    }

    if (!updates.length) return errorResponse(res, "没有需要更新的字段", 400);

    values.push(id);
    await ctx.db.db
      .prepare(
        `
        UPDATE gift_cards
        SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(...values)
      .run();

    return successResponse(res, { id, message: "礼品卡已更新" }, "礼品卡已更新");
  });

  // 更新礼品卡状态
  router.post("/:id/status", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    const { status } = req.body || {};
    const nextStatus = Number(status);
    if (![0, 1, 2].includes(nextStatus)) {
      return errorResponse(res, "状态无效", 400);
    }
    await ctx.db.db
      .prepare(
        `
        UPDATE gift_cards
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(nextStatus, id)
      .run();
    return successResponse(res, { id, status: nextStatus }, "状态已更新");
  });

  // 删除礼品卡（仅限未使用）
  router.delete("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    const row = await ctx.db.db
      .prepare("SELECT used_count FROM gift_cards WHERE id = ?")
      .bind(id)
      .first<{ used_count?: number | string | null }>();

    if (!row) {
      return errorResponse(res, "礼品卡不存在", 404);
    }

    const usedCount = ensureNumber(row.used_count ?? 0);
    if (usedCount > 0) {
      return errorResponse(res, "已使用的礼品卡不能删除", 400);
    }

    await ctx.db.db.prepare("DELETE FROM gift_cards WHERE id = ?").bind(id).run();
    return successResponse(res, { id }, "礼品卡已删除");
  });

  // 指定礼品卡的兑换记录
  router.get("/:id/redemptions", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const cardId = Number(req.params.id);
    if (!cardId) return errorResponse(res, "ID 无效", 400);

    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const limitCandidate = Number(limitRaw) || 20;
    const limit = Math.min(Math.max(limitCandidate, 1), 100);
    const offset = (page - 1) * limit;

    const totalRow = await ctx.db.db
      .prepare("SELECT COUNT(*) as total FROM gift_card_redemptions WHERE card_id = ?")
      .bind(cardId)
      .first<{ total: number | string | null }>();
    const total = ensureNumber(totalRow?.total ?? 0);

    const listResult = await ctx.db.db
      .prepare(
        `
        SELECT gcr.*, u.email as user_email, u.username as user_name
        FROM gift_card_redemptions gcr
        LEFT JOIN users u ON gcr.user_id = u.id
        WHERE gcr.card_id = ?
        ORDER BY gcr.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(cardId, limit, offset)
      .all<{
        id: number;
        card_id: number;
        user_id: number;
        code: string;
        card_type: string;
        change_amount?: number | string | null;
        duration_days?: number | string | null;
        traffic_value_gb?: number | string | null;
        reset_traffic_gb?: number | string | null;
        package_id?: number | string | null;
        trade_no?: string | null;
        message?: string | null;
        created_at?: string | null;
        user_email?: string | null;
        user_name?: string | null;
      }>();

    const records = (listResult.results ?? []).map((record) => ({
      ...record,
      change_amount:
        record.change_amount !== undefined && record.change_amount !== null
          ? ensureNumber(record.change_amount)
          : null,
      duration_days:
        record.duration_days !== undefined && record.duration_days !== null
          ? ensureNumber(record.duration_days)
          : null,
      traffic_value_gb:
        record.traffic_value_gb !== undefined && record.traffic_value_gb !== null
          ? ensureNumber(record.traffic_value_gb)
          : null,
      reset_traffic_gb:
        record.reset_traffic_gb !== undefined && record.reset_traffic_gb !== null
          ? ensureNumber(record.reset_traffic_gb)
          : null
    }));

    return successResponse(res, {
      records,
      pagination: {
        total,
        page,
        limit,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0
      }
    });
  });

  return router;
}
