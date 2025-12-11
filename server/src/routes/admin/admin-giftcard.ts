import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { generateRandomString } from "../../utils/crypto";

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
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const data = await ctx.dbService.listGiftCards(page, pageSize);
    return successResponse(res, data);
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { name, code, card_type, balance_amount, duration_days, traffic_value_gb, reset_traffic_gb, package_id, max_usage, start_at, end_at } =
      req.body || {};
    if (!name) return errorResponse(res, "名称必填", 400);
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
      startAt: start_at ? new Date(start_at) : null,
      endAt: end_at ? new Date(end_at) : null
    });
    return successResponse(res, { code: finalCode }, "礼品卡已创建");
  });

  return router;
}
