import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ReferralService } from "../../services/referral";

export function createAdminRechargeRouter(ctx: AppContext) {
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

  router.get("/pending", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await ctx.dbService.listPendingRecharge(100);
    return successResponse(res, rows);
  });

  router.post("/create", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { user_id, amount, method, mark_paid } = req.body || {};
    const uid = Number(user_id);
    const amt = Number(amount);
    if (!uid || Number.isNaN(uid)) return errorResponse(res, "user_id 无效", 400);
    if (!amt || amt <= 0) return errorResponse(res, "金额无效", 400);
    const tradeNo = `adm_rc_${Date.now()}`;
    await ctx.dbService.createRechargeRecord(uid, amt, tradeNo, method || "manual");
    if (mark_paid) {
      const record = await ctx.dbService.markRechargePaid(tradeNo);
      if (record) {
        await referralService.awardRebate({
          inviteeId: Number(record.user_id),
          amount: Number(record.amount ?? 0),
          sourceType: "recharge",
          sourceId: Number(record.id ?? 0) || null,
          tradeNo,
          eventType: "recharge_rebate"
        });
      }
    }
    return successResponse(res, { trade_no: tradeNo, user_id: uid, amount: amt }, mark_paid ? "已创建并入账" : "充值单已创建");
  });

  router.post("/:tradeNo/mark-paid", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const tradeNo = req.params.tradeNo;
    const record = await ctx.dbService.markRechargePaid(tradeNo);
    if (!record) return errorResponse(res, "订单不存在", 404);
    await referralService.awardRebate({
      inviteeId: Number(record.user_id),
      amount: Number(record.amount ?? 0),
      sourceType: "recharge",
      sourceId: Number(record.id ?? 0) || null,
      tradeNo,
      eventType: "recharge_rebate"
    });
    return successResponse(res, { trade_no: tradeNo }, "已入账");
  });

  return router;
}
