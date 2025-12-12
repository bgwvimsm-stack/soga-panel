import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ensureNumber, ensureString, getChanges, getLastRowId, toRunResult } from "../../utils/d1";
import { fixMoneyPrecision } from "../../utils/money";
import { generateRandomString } from "../../utils/crypto";

export function createAdminCouponRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  const normalizeTimestampValue = (value: unknown, field: string): number => {
    if (value === undefined || value === null) {
      throw new Error(`${field} 不能为空`);
    }
    let timestamp = Number(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`${field} 格式不正确`);
    }
    if (timestamp > 1e12) {
      timestamp = Math.floor(timestamp / 1000);
    } else {
      timestamp = Math.floor(timestamp);
    }
    return timestamp;
  };

  const sanitizePackageIds = (packageIds?: unknown): number[] => {
    if (!Array.isArray(packageIds)) {
      return [];
    }
    const normalized = packageIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    return Array.from(new Set(normalized));
  };

  const replaceCouponPackages = async (couponId: number, packageIds: number[]) => {
    await ctx.db.db.prepare("DELETE FROM coupon_packages WHERE coupon_id = ?").bind(couponId).run();
    if (!packageIds.length) return;
    const sql = `
      INSERT IGNORE INTO coupon_packages (coupon_id, package_id)
      VALUES (?, ?)
    `;
    for (const pkgId of packageIds) {
      await ctx.db.db.prepare(sql).bind(couponId, pkgId).run();
    }
  };

  const generateCouponCode = () => generateRandomString(10).toUpperCase();

  const ensureCouponCodeUnique = async (code: string, excludeId?: number) => {
    const row = await ctx.db.db
      .prepare(
        excludeId
          ? "SELECT id FROM coupons WHERE code = ? AND id != ?"
          : "SELECT id FROM coupons WHERE code = ?"
      )
      .bind(code, ...(excludeId ? [excludeId] : []))
      .first<{ id: number }>();
    if (row) {
      throw new Error("优惠码已存在，请重新输入");
    }
  };

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
    const keywordParam = (req.query.keyword ?? req.query.search) as string | undefined;
    const keyword = keywordParam ? keywordParam.trim() : "";
    const offset = (page - 1) * limit;

    let whereClause = "WHERE 1=1";
    const params: Array<string | number> = [];

    if (statusParam !== undefined && statusParam !== null && String(statusParam) !== "" && String(statusParam) !== "-1") {
      whereClause += " AND c.status = ?";
      params.push(Number(statusParam));
    }

    if (keyword) {
      whereClause += " AND (c.name LIKE ? OR c.code LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const totalRow = await ctx.db.db
      .prepare(`SELECT COUNT(*) as total FROM coupons c ${whereClause}`)
      .bind(...params)
      .first<{ total: number | string | null }>();
    const total = ensureNumber(totalRow?.total ?? 0);

    const listResult = await ctx.db.db
      .prepare(
        `
        SELECT
          c.*,
          (
            SELECT COUNT(*)
            FROM coupon_packages cp
            WHERE cp.coupon_id = c.id
          ) as package_count
        FROM coupons c
        ${whereClause}
        ORDER BY c.id DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...params, limit, offset)
      .all<
        {
          id: number;
          name: string;
          code: string;
          discount_type: string;
          discount_value: number | string;
          start_at: number | string;
          end_at: number | string;
          max_usage?: number | string | null;
          per_user_limit?: number | string | null;
          total_used?: number | string | null;
          status: number | string | null;
          description?: string | null;
          package_count: number | string | null;
        }
      >();

    const coupons = (listResult.results ?? []).map((row) => {
      const discountValue = ensureNumber(row.discount_value);
      const maxUsage =
        row.max_usage !== undefined && row.max_usage !== null ? ensureNumber(row.max_usage) : null;
      const perUserLimit =
        row.per_user_limit !== undefined && row.per_user_limit !== null
          ? ensureNumber(row.per_user_limit)
          : null;
      const totalUsed = ensureNumber(row.total_used ?? 0);

      return {
        ...row,
        discount_value: discountValue,
        max_usage: maxUsage,
        per_user_limit: perUserLimit,
        total_used: totalUsed,
        remaining_usage: maxUsage === null ? null : Math.max(maxUsage - totalUsed, 0),
        package_count: ensureNumber(row.package_count ?? 0)
      };
    });

    return successResponse(res, {
      coupons,
      pagination: {
        total,
        page,
        limit,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0
      }
    });
  });

  // 获取优惠券详情
  router.get("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    const coupon = await ctx.db.db
      .prepare("SELECT * FROM coupons WHERE id = ?")
      .bind(id)
      .first<{
        id: number;
        name: string;
        code: string;
        discount_type: string;
        discount_value: number | string;
        start_at: number | string;
        end_at: number | string;
        max_usage?: number | string | null;
        per_user_limit?: number | string | null;
        total_used?: number | string | null;
        status: number | string | null;
        description?: string | null;
      }>();

    if (!coupon) {
      return errorResponse(res, "优惠券不存在", 404);
    }

    const packagesResult = await ctx.db.db
      .prepare("SELECT package_id FROM coupon_packages WHERE coupon_id = ?")
      .bind(id)
      .all<{ package_id: number | string }>();

    const packageIds =
      packagesResult.results?.map((item) => ensureNumber(item.package_id)) ?? [];
    const maxUsage =
      coupon.max_usage !== null && coupon.max_usage !== undefined
        ? ensureNumber(coupon.max_usage)
        : null;
    const totalUsed = ensureNumber(coupon.total_used ?? 0);

    return successResponse(res, {
      ...coupon,
      discount_value: ensureNumber(coupon.discount_value),
      max_usage: maxUsage,
      per_user_limit:
        coupon.per_user_limit !== null && coupon.per_user_limit !== undefined
          ? ensureNumber(coupon.per_user_limit)
          : null,
      total_used: totalUsed,
      remaining_usage: maxUsage === null ? null : Math.max(maxUsage - totalUsed, 0),
      package_ids: packageIds
    });
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const body = req.body || {};

    const name = ensureString(body.name).trim();
    if (!name) {
      return errorResponse(res, "请输入优惠券名称", 400);
    }

    const discountType = body.discount_type === "percentage" ? "percentage" : "amount";
    let discountValue = Number(body.discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return errorResponse(res, "优惠值必须大于0", 400);
    }

    if (discountType === "amount") {
      discountValue = fixMoneyPrecision(discountValue);
    } else if (discountValue > 100) {
      return errorResponse(res, "折扣比例不能大于100%", 400);
    }

    let startAt: number;
    let endAt: number;
    try {
      startAt = normalizeTimestampValue(body.start_at, "开始时间");
      endAt = normalizeTimestampValue(body.end_at, "结束时间");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }

    if (endAt <= startAt) {
      return errorResponse(res, "结束时间必须大于开始时间", 400);
    }

    const codeInput = ensureString(body.code ?? "").trim();
    const code = (codeInput || generateCouponCode()).toUpperCase();
    try {
      await ensureCouponCodeUnique(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }

    const normalizeLimit = (value: unknown, field: string) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      const parsed = Math.floor(Number(value));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${field} 必须为正整数`);
      }
      return parsed;
    };

    let maxUsage: number | null;
    let perUserLimit: number | null;
    try {
      maxUsage = normalizeLimit(body.max_usage, "最大使用次数");
      perUserLimit = normalizeLimit(body.per_user_limit, "每用户使用次数");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }

    const status = body.status !== undefined ? Number(body.status) : 1;
    const description = body.description ? ensureString(body.description) : null;
    const packageIds = sanitizePackageIds(body.package_ids);

    const insertResult = toRunResult(
      await ctx.db.db
        .prepare(
          `
          INSERT INTO coupons
          (name, code, discount_type, discount_value, start_at, end_at, max_usage, per_user_limit, total_used, status, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `
        )
        .bind(
          name,
          code,
          discountType,
          discountValue,
          startAt,
          endAt,
          maxUsage,
          perUserLimit,
          status,
          description
        )
        .run()
    );

    const couponId = getLastRowId(insertResult);
    if (!couponId) {
      return errorResponse(res, "优惠券创建失败", 500);
    }

    await replaceCouponPackages(couponId, packageIds);

    return successResponse(res, {
      id: couponId,
      name,
      code,
      discount_type: discountType,
      discount_value: discountValue,
      start_at: startAt,
      end_at: endAt,
      max_usage: maxUsage,
      per_user_limit: perUserLimit,
      status,
      description,
      package_ids: packageIds
    });
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    const existing = await ctx.db.db
      .prepare("SELECT * FROM coupons WHERE id = ?")
      .bind(id)
      .first<{
        name: string;
        code: string;
        discount_type: string;
        discount_value: number | string;
        start_at: number | string;
        end_at: number | string;
        max_usage?: number | string | null;
        per_user_limit?: number | string | null;
        status: number | string | null;
        description?: string | null;
      }>();

    if (!existing) {
      return errorResponse(res, "优惠券不存在", 404);
    }

    const body = req.body || {};
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (body.name !== undefined) {
      const name = ensureString(body.name).trim();
      if (!name) {
        return errorResponse(res, "请输入优惠券名称", 400);
      }
      updateFields.push("name = ?");
      updateValues.push(name);
    }

    let discountType = existing.discount_type;
    let discountValue = ensureNumber(existing.discount_value);
    if (body.discount_type !== undefined) {
      discountType = body.discount_type === "percentage" ? "percentage" : "amount";
    }
    if (body.discount_value !== undefined) {
      discountValue = Number(body.discount_value);
    }
    if (body.discount_type !== undefined || body.discount_value !== undefined) {
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return errorResponse(res, "优惠值必须大于0", 400);
      }
      if (discountType === "amount") {
        discountValue = fixMoneyPrecision(discountValue);
      } else if (discountValue > 100) {
        return errorResponse(res, "折扣比例不能大于100%", 400);
      }
      updateFields.push("discount_type = ?");
      updateValues.push(discountType);
      updateFields.push("discount_value = ?");
      updateValues.push(discountValue);
    }

    let startAt = ensureNumber(existing.start_at);
    let endAt = ensureNumber(existing.end_at);
    let hasTimeChange = false;
    if (body.start_at !== undefined) {
      startAt = normalizeTimestampValue(body.start_at, "开始时间");
      hasTimeChange = true;
    }
    if (body.end_at !== undefined) {
      endAt = normalizeTimestampValue(body.end_at, "结束时间");
      hasTimeChange = true;
    }
    if (hasTimeChange) {
      if (endAt <= startAt) {
        return errorResponse(res, "结束时间必须大于开始时间", 400);
      }
      updateFields.push("start_at = ?");
      updateValues.push(startAt);
      updateFields.push("end_at = ?");
      updateValues.push(endAt);
    }

    const normalizeLimit = (value: unknown, field: string) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      const parsed = Math.floor(Number(value));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${field} 必须为正整数`);
      }
      return parsed;
    };

    if (body.max_usage !== undefined) {
      try {
        const value = normalizeLimit(body.max_usage, "最大使用次数");
        updateFields.push("max_usage = ?");
        updateValues.push(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(res, message, 400);
      }
    }

    if (body.per_user_limit !== undefined) {
      try {
        const value = normalizeLimit(body.per_user_limit, "每用户使用次数");
        updateFields.push("per_user_limit = ?");
        updateValues.push(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(res, message, 400);
      }
    }

    if (body.code !== undefined) {
      const code = ensureString(body.code).trim().toUpperCase();
      if (!code) {
        return errorResponse(res, "优惠码不能为空", 400);
      }
      try {
        await ensureCouponCodeUnique(code, id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(res, message, 400);
      }
      updateFields.push("code = ?");
      updateValues.push(code);
    }

    if (body.status !== undefined) {
      updateFields.push("status = ?");
      updateValues.push(Number(body.status));
    }

    if (body.description !== undefined) {
      const desc = body.description ? ensureString(body.description) : null;
      updateFields.push("description = ?");
      updateValues.push(desc);
    }

    if (!updateFields.length && body.package_ids === undefined) {
      return errorResponse(res, "没有需要更新的内容", 400);
    }

    if (updateFields.length) {
      updateFields.push("updated_at = CURRENT_TIMESTAMP");
      updateValues.push(id);

      const updateResult = toRunResult(
        await ctx.db.db
          .prepare(
            `
            UPDATE coupons
            SET ${updateFields.join(", ")}
            WHERE id = ?
          `
          )
          .bind(...updateValues)
          .run()
      );

      if (getChanges(updateResult) === 0) {
        return errorResponse(res, "优惠券更新失败", 500);
      }
    }

    if (body.package_ids !== undefined) {
      const packageIds = sanitizePackageIds(body.package_ids);
      await replaceCouponPackages(id, packageIds);
    }

    return successResponse(res, { id }, "优惠券已更新");
  });

  router.post("/:id/status", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (![0, 1].includes(Number(status))) return errorResponse(res, "状态无效", 400);
    await ctx.dbService.updateCouponStatus(id, Number(status));
    return successResponse(res, null, "状态已更新");
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.deleteCoupon(id);
    return successResponse(res, null, "已删除");
  });

  return router;
}
