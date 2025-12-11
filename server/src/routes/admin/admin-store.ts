import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ReferralService } from "../../services/referral";

export function createAdminStoreRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const referralService = new ReferralService(ctx.dbService);

  const ensureAdmin = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) {
      errorResponse(res, "需要管理员权限", 403);
      return null;
    }
    return user;
  };

  router.get("/package-stats", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const stats = await ctx.dbService.listPackageStats();
    return successResponse(res, stats);
  });

  router.get("/orders", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllPurchaseRecords(page, pageSize);
    return successResponse(res, data);
  });

  router.post("/orders/:tradeNo/mark-paid", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const tradeNo = req.params.tradeNo;
    try {
      const record = await ctx.dbService.markPurchasePaid(tradeNo);
      if (!record) return errorResponse(res, "订单不存在", 404);
      await referralService.awardRebate({
        inviteeId: Number(record.user_id),
        amount: Number(record.price ?? record.package_price ?? 0),
        sourceType: "purchase",
        sourceId: Number(record.id ?? 0) || null,
        tradeNo,
        eventType: "purchase_rebate"
      });
      return successResponse(res, { trade_no: tradeNo }, "已标记支付并激活套餐");
    } catch (error: any) {
      return errorResponse(res, error?.message || "处理失败", 500);
    }
  });

  router.get("/recharges", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllRechargeRecords(page, pageSize);
    return successResponse(res, data);
  });

  return router;
}
