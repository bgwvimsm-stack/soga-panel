import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createPaymentProviders } from "../../payment/factory";
import { ReferralService } from "../../services/referral";

export function createPaymentCallbackRouter(ctx: AppContext) {
  const router = Router();
  const referralService = new ReferralService(ctx.dbService);
  const payment = createPaymentProviders(ctx.env);
  const extractTradeNo = (payload: any) =>
    payload?.out_trade_no || payload?.trade_no || payload?.order_id;
  const normalizePayload = (payload: any): Record<string, any> => {
    if (!payload) return {};
    if (typeof payload === "string") {
      const trimmed = payload.trim();
      if (!trimmed) return {};
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || trimmed.startsWith("[")) {
        try {
          return JSON.parse(trimmed);
        } catch {
          // ignore and try urlencoded
        }
      }
      try {
        const params = new URLSearchParams(trimmed);
        const obj: Record<string, string> = {};
        for (const [key, value] of params) {
          obj[key] = value;
        }
        if (Object.keys(obj).length > 0) {
          return obj;
        }
      } catch {
        // ignore malformed payload
      }
      return {};
    }
    return payload;
  };

  const sendText = (res: Response, text: string) => {
    res.status(200).type("text/plain").send(text);
  };

  const settleTrade = async (tradeNo: string) => {
    const rechargeResult = await ctx.dbService.markRechargePaid(String(tradeNo));
    if (rechargeResult) {
      if (rechargeResult.applied) {
        const record = rechargeResult.record as any;
        await referralService.awardRebate({
          inviteeId: Number(record.user_id),
          amount: Number(record.amount ?? 0),
          sourceType: "recharge",
          sourceId: Number(record.id ?? 0) || null,
          tradeNo: String(tradeNo),
          eventType: "recharge_rebate"
        });
      }
      if (rechargeResult.applied || rechargeResult.alreadyPaid) {
        return { type: "recharge" as const, already_paid: rechargeResult.alreadyPaid };
      }
    }

    try {
      const purchaseResult: any = await ctx.dbService.markPurchasePaid(String(tradeNo));
      if (purchaseResult) {
        const record = purchaseResult.record as any;
        if (purchaseResult.applied) {
          await referralService.awardRebate({
            inviteeId: Number(record.user_id),
            amount: Number(record.price ?? record.package_price ?? 0),
            sourceType: "purchase",
            sourceId: Number(record.id ?? 0) || null,
            tradeNo: String(tradeNo),
            eventType: "purchase_rebate"
          });
        }
        if (purchaseResult.applied || purchaseResult.alreadyPaid) {
          return { type: "purchase" as const, expires_at: record.expires_at ?? null, already_paid: purchaseResult.alreadyPaid };
        }
      }
    } catch (error) {
      console.error("处理套餐订单失败", error);
      throw error;
    }

    return null;
  };

  // 通用回调（兼容 Worker 的 /api/payment/callback）
  // 自动识别易支付 / epusdt，并根据签名与状态入账
  router.post("/", async (req: Request, res: Response) => {
    const body = normalizePayload(req.body);
    const verified = payment.verifyCallback(body);

    if (!verified || !verified.ok || !verified.tradeNo) {
      sendText(res, "fail");
      return;
    }

    const result = await settleTrade(String(verified.tradeNo));
    if (result) {
      const successBody = verified.method === "epusdt" ? "ok" : "success";
      sendText(res, successBody);
      return;
    }

    sendText(res, "fail");
  });

  // Epay 回调：校验 sign（简化版），再入账
  router.post("/epay", async (req: Request, res: Response) => {
    const body = normalizePayload(req.body);
    const verified = payment.providers.epay.verifyCallback(body);
    const tradeNo = extractTradeNo(body) || verified.tradeNo;
    if (!tradeNo || !verified.ok) {
      sendText(res, "fail");
      return;
    }

    const result = await settleTrade(String(tradeNo));
    if (result) {
      sendText(res, "success");
      return;
    }
    sendText(res, "fail");
  });

  // Epusdt 回调：校验 token（若配置），再入账
  router.post("/epusdt", async (req: Request, res: Response) => {
    const body = normalizePayload(req.body);
    const verified = payment.providers.epusdt.verifyCallback(body);
    const tradeNo = extractTradeNo(body) || verified.tradeNo;
    if (!tradeNo || !verified.ok) {
      sendText(res, "fail");
      return;
    }

    const result = await settleTrade(String(tradeNo));
    if (result) {
      sendText(res, "ok");
      return;
    }
    sendText(res, "fail");
  });

  // 通用回调：兼容 /api/payment/notify（易支付/epusdt 均可）
  router.all("/notify", async (req: Request, res: Response) => {
    const body =
      req.method === "GET"
        ? (req.query as Record<string, any>)
        : normalizePayload(req.body);
    const epayVerified = payment.providers.epay.verifyCallback(body as any);
    const epusdtVerified = payment.providers.epusdt.verifyCallback(body as any);
    const tradeNo =
      extractTradeNo(body) || epayVerified.tradeNo || epusdtVerified.tradeNo;
    if (!tradeNo) {
      sendText(res, "fail");
      return;
    }

    if (epayVerified.ok) {
      const result = await settleTrade(String(tradeNo));
      sendText(res, result ? "success" : "fail");
      return;
    }

    if (epusdtVerified.ok) {
      const result = await settleTrade(String(tradeNo));
      sendText(res, result ? "ok" : "fail");
      return;
    }

    sendText(res, "fail");
  });

  return router;
}
