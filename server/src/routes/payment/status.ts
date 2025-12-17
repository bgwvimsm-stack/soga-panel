import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createPaymentProviders } from "../../payment/factory";
import { errorResponse, successResponse } from "../../utils/response";

export function createPaymentStatusRouter(ctx: AppContext) {
  const router = Router();
  const payment = createPaymentProviders(ctx.env);

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

  // 兼容 Worker：GET /api/payment/status/:trade_no
  router.get("/status/:trade_no", async (req: Request, res: Response) => {
    const tradeNo = req.params.trade_no;
    if (!tradeNo) return errorResponse(res, "缺少 trade_no", 400);

    const recharge = await ctx.dbService.db
      .prepare("SELECT status, paid_at FROM recharge_records WHERE trade_no = ?")
      .bind(tradeNo)
      .first<{ status?: number; paid_at?: string | null }>();

    if (recharge) {
      return successResponse(res, {
        trade_no: tradeNo,
        status: recharge.status,
        paid_at: recharge.paid_at ?? null,
        type: "recharge"
      });
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

  // 兼容 Worker：GET /api/payment/create?trade_no=xxx&payment_method=alipay|wechat|usdt
  router.get("/create", async (req: Request, res: Response) => {
    const tradeNo = typeof req.query.trade_no === "string" ? req.query.trade_no.trim() : "";
    const paymentMethod =
      typeof req.query.payment_method === "string" ? req.query.payment_method.trim() : "";
    if (!tradeNo) return errorResponse(res, "缺少交易号", 400);

    const recharge = await ctx.dbService.db
      .prepare("SELECT trade_no, amount, status, payment_method FROM recharge_records WHERE trade_no = ?")
      .bind(tradeNo)
      .first<{ trade_no: string; amount: number | string; status: number | string; payment_method?: string | null }>();

    const purchase = recharge
      ? null
      : await ctx.dbService.db
          .prepare(
            "SELECT trade_no, price, status, purchase_type FROM package_purchase_records WHERE trade_no = ?"
          )
          .bind(tradeNo)
          .first<{ trade_no: string; price: number | string; status: number | string; purchase_type?: string | null }>();

    if (!recharge && !purchase) return errorResponse(res, "订单不存在或状态异常", 404);

    const rawPrefer =
      paymentMethod ||
      (recharge ? String(recharge.payment_method || "") : String(purchase?.purchase_type || ""));

    if (rawPrefer.startsWith("balance")) {
      return errorResponse(res, "该订单为余额支付，无需创建第三方支付订单", 400);
    }

    const amount = recharge ? Number(recharge.amount) : Number(purchase?.price ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return errorResponse(res, "订单金额异常", 400);

    const channel = payment.normalizeChannel(rawPrefer);
    const envReturnUrl = channel
      ? channel === "crypto"
        ? ctx.env.EPUSDT_RETURN_URL
        : ctx.env.EPAY_RETURN_URL
      : "";
    const envNotifyUrl = channel
      ? channel === "crypto"
        ? ctx.env.EPUSDT_NOTIFY_URL
        : ctx.env.EPAY_NOTIFY_URL
      : "";

    try {
      const created = await payment.create(
        {
          tradeNo,
          amount,
          subject: recharge ? "账户充值" : "购买套餐",
          notifyUrl: envNotifyUrl || "",
          notify_url: envNotifyUrl || "",
          returnUrl: envReturnUrl || "",
          return_url: envReturnUrl || ""
        },
        rawPrefer
      );

      if (!created.success || !created.payUrl) {
        return errorResponse(res, created.message || "创建支付订单失败", 500);
      }

      return successResponse(res, created, "支付订单创建成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message || "创建支付订单失败", 500);
    }
  });

  return router;
}
