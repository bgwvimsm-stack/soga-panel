import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { errorResponse, successResponse } from "../../utils/response";

export function createPaymentStatusRouter(ctx: AppContext) {
  const router = Router();

  router.get("/status", async (req: Request, res: Response) => {
    const tradeNo = req.query.trade_no as string | undefined;
    if (!tradeNo) return errorResponse(res, "缺少 trade_no", 400);

    const recharge = await ctx.dbService.db
      .prepare("SELECT status, paid_at FROM recharge_records WHERE trade_no = ?")
      .bind(tradeNo)
      .first<{ status?: number; paid_at?: string | null }>();

    if (recharge) {
      return successResponse(res, { trade_no: tradeNo, status: recharge.status, paid_at: recharge.paid_at ?? null, type: "recharge" });
    }

    const purchase = await ctx.dbService.db
      .prepare("SELECT status, paid_at, expires_at FROM package_purchase_records WHERE trade_no = ?")
      .bind(tradeNo)
      .first<{ status?: number; paid_at?: string | null; expires_at?: string | null }>();

    if (!purchase) return errorResponse(res, "订单不存在", 404);

    return successResponse(res, {
      trade_no: tradeNo,
      status: purchase.status,
      paid_at: purchase.paid_at ?? null,
      expires_at: purchase.expires_at ?? null,
      type: "purchase"
    });
  });

  return router;
}
