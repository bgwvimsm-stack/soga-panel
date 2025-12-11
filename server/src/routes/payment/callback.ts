import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { errorResponse, successResponse } from "../../utils/response";
import { createPaymentProviders } from "../../payment/factory";
import { ReferralService } from "../../services/referral";

export function createPaymentCallbackRouter(ctx: AppContext) {
  const router = Router();
  const referralService = new ReferralService(ctx.dbService);
  const payment = createPaymentProviders(ctx.env);

  const settleTrade = async (tradeNo: string) => {
    const rechargeRecord = await ctx.dbService.markRechargePaid(String(tradeNo));
    if (rechargeRecord) {
      await referralService.awardRebate({
        inviteeId: Number(rechargeRecord.user_id),
        amount: Number(rechargeRecord.amount ?? 0),
        sourceType: "recharge",
        sourceId: Number(rechargeRecord.id ?? 0) || null,
        tradeNo: String(tradeNo),
        eventType: "recharge_rebate"
      });
      return { type: "recharge" as const };
    }

    try {
      const purchaseRecord: any = await ctx.dbService.markPurchasePaid(String(tradeNo));
      if (purchaseRecord) {
        await referralService.awardRebate({
          inviteeId: Number(purchaseRecord.user_id),
          amount: Number(purchaseRecord.price ?? purchaseRecord.package_price ?? 0),
          sourceType: "purchase",
          sourceId: Number(purchaseRecord.id ?? 0) || null,
          tradeNo: String(tradeNo),
          eventType: "purchase_rebate"
        });
        return { type: "purchase" as const, expires_at: purchaseRecord.expires_at ?? null };
      }
    } catch (error) {
      console.error("处理套餐订单失败", error);
      throw error;
    }

    return null;
  };

  // Epay 回调：校验 sign（简化版），再入账
  router.post("/epay", async (req: Request, res: Response) => {
    const body = req.body || {};
    const outTradeNo = body.out_trade_no || body.trade_no;
    if (!outTradeNo) return errorResponse(res, "缺少 trade_no", 400);

    const verified = payment.providers.epay.verifyCallback(body);
    if (!verified.ok) return errorResponse(res, "签名错误", 400);

    const result = await settleTrade(String(outTradeNo));
    if (result) return successResponse(res, { trade_no: outTradeNo, ...result }, "ok");
    return errorResponse(res, "订单不存在", 404);
  });

  // Epusdt 回调：校验 token（若配置），再入账
  router.post("/epusdt", async (req: Request, res: Response) => {
    const body = req.body || {};
    const outTradeNo = body.out_trade_no || body.trade_no;
    if (!outTradeNo) return errorResponse(res, "缺少 trade_no", 400);

    const verified = payment.providers.epusdt.verifyCallback(body);
    if (!verified.ok) return errorResponse(res, "签名错误", 400);

    const result = await settleTrade(String(outTradeNo));
    if (result) return successResponse(res, { trade_no: outTradeNo, ...result }, "ok");
    return errorResponse(res, "订单不存在", 404);
  });

  // 通用回调：兼容 /api/payment/notify（易支付/epusdt 均可）
  router.all("/notify", async (req: Request, res: Response) => {
    const body = req.method === "GET" ? req.query : req.body || {};
    const outTradeNo = (body as any).out_trade_no || (body as any).trade_no;
    if (!outTradeNo) return errorResponse(res, "缺少 trade_no", 400);

    // 优先 epay 验签，其次 epusdt
    const epayVerified = payment.providers.epay.verifyCallback(body as any);
    if (epayVerified.ok) {
      const result = await settleTrade(String(outTradeNo));
      if (result) return successResponse(res, { trade_no: outTradeNo, ...result }, "ok");
      return errorResponse(res, "订单不存在", 404);
    }

    const epusdtVerified = payment.providers.epusdt.verifyCallback(body as any);
    if (epusdtVerified.ok) {
      const result = await settleTrade(String(outTradeNo));
      if (result) return successResponse(res, { trade_no: outTradeNo, ...result }, "ok");
      return errorResponse(res, "订单不存在", 404);
    }

    return errorResponse(res, "签名错误", 400);
  });

  return router;
}
