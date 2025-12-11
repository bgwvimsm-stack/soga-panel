import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createAdminCouponRouter(ctx: AppContext) {
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
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const data = await ctx.dbService.listCoupons(page, pageSize);
    return successResponse(res, data);
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { name, code, discount_type, discount_value, start_at, end_at, max_usage, per_user_limit, status, description } =
      req.body || {};
    if (!name || !code || !discount_type || !discount_value || !start_at || !end_at) {
      return errorResponse(res, "参数缺失", 400);
    }
    await ctx.dbService.createCoupon({
      name,
      code,
      discountType: discount_type,
      discountValue: Number(discount_value),
      startAt: Number(start_at),
      endAt: Number(end_at),
      maxUsage: max_usage ?? null,
      perUserLimit: per_user_limit ?? null,
      status: status ?? 1,
      description: description ?? null
    });
    return successResponse(res, null, "优惠券已创建");
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);
    const payload = req.body || {};
    await ctx.dbService.updateCoupon(id, {
      name: payload.name,
      code: payload.code,
      discount_type: payload.discount_type,
      discount_value: payload.discount_value,
      start_at: payload.start_at,
      end_at: payload.end_at,
      max_usage: payload.max_usage ?? null,
      per_user_limit: payload.per_user_limit ?? null,
      status: payload.status,
      description: payload.description ?? null
    });
    return successResponse(res, null, "优惠券已更新");
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
