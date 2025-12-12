import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { generateRandomString } from "../../utils/crypto";
import { ensureNumber, getLastRowId, toRunResult } from "../../utils/d1";
import { createPaymentProviders } from "../../payment/factory";
import { ReferralService } from "../../services/referral";

export function createWalletRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const referralService = new ReferralService(ctx.dbService);
  const payment = createPaymentProviders(ctx.env);

  const buildGiftCardTradeNo = (code: string, usageIndex: number) => {
    const cleanCode = String(code || "").trim();
    const suffix = Date.now().toString().slice(-6);
    return `${cleanCode}-${usageIndex}-${suffix}`;
  };

  // 兼容前端 /user/wallet 获取余额
  router.get("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const row = await ctx.dbService.db
      .prepare("SELECT money FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ money?: number | string | null }>();
    const money = ensureNumber(row?.money, 0);
    const rechargeStats = await ctx.dbService.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as total_recharged,
          COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) as total_spent
        FROM recharge_records
        WHERE user_id = ?
      `
      )
      .bind(user.id)
      .first<{ total_recharged?: number | string | null; total_spent?: number | string | null }>();

    return successResponse(res, {
      balance: money,
      money,
      total_recharge: ensureNumber(rechargeStats?.total_recharged, 0),
      total_consume: ensureNumber(rechargeStats?.total_spent, 0)
    });
  });

  router.get("/money", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const balance = await ctx.dbService.getUserBalance(Number(user.id));
    const records = await ctx.dbService.listRechargeRecords(Number(user.id), 10);
    return successResponse(res, { money: balance, recent_recharges: records });
  });

  router.get("/recharge-records", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    const offset = (page - 1) * limit;
    const records = await ctx.dbService.listRechargeRecords(Number(user.id), limit, offset);
    const totalRow = await ctx.dbService.db
      .prepare("SELECT COUNT(*) as total FROM recharge_records WHERE user_id = ?")
      .bind(user.id)
      .first<{ total?: number | string | null }>();
    const total = ensureNumber(totalRow?.total, 0);
    const statusText: Record<number, string> = { 0: "待支付", 1: "已支付", 2: "已取消", 3: "支付失败" };
    const mapped = (records || []).map((r: any) => {
      const rawMethod = String(r.payment_method || "");
      const pm = rawMethod.toLowerCase();
      const method =
        pm === "epay"
          ? "alipay"
          : pm === "epusdt"
            ? "usdt"
            : pm || "alipay";
      let displayTradeNo = String(r.trade_no || "");
      if (method === "gift_card") {
        if (r.gift_card_code) {
          displayTradeNo = String(r.gift_card_code);
        } else if (displayTradeNo.includes("-")) {
          displayTradeNo = displayTradeNo.split("-")[0] || displayTradeNo;
        }
      }
      return {
        ...r,
        trade_no: displayTradeNo,
        payment_method: method,
        amount: ensureNumber(r.amount, 0),
        status_text: statusText[Number(r.status)] || "未知状态"
      };
    });
    return successResponse(res, {
      records: mapped,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  });

  router.get("/stats", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const uid = Number(user.id);
    const balanceRow = await ctx.dbService.db
      .prepare("SELECT money FROM users WHERE id = ?")
      .bind(uid)
      .first<{ money?: number }>();
    const rechargeStats = await ctx.dbService.db
      .prepare(
        `
        SELECT
          COUNT(*) as total_recharges,
          COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as total_recharged,
          COALESCE(SUM(CASE WHEN status = 0 THEN amount ELSE 0 END), 0) as pending_amount
        FROM recharge_records
        WHERE user_id = ?
      `
      )
      .bind(uid)
      .first<{ total_recharges?: number | string | null; total_recharged?: number | string | null; pending_amount?: number | string | null }>();
    const purchaseStats = await ctx.dbService.db
      .prepare(
        `
        SELECT
          COUNT(*) as total_purchases,
          COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) as total_spent
        FROM package_purchase_records
        WHERE user_id = ?
      `
      )
      .bind(uid)
      .first<{ total_purchases?: number | string | null; total_spent?: number | string | null }>();

    return successResponse(res, {
      current_balance: ensureNumber(balanceRow?.money ?? 0),
      total_recharged: ensureNumber(rechargeStats?.total_recharged ?? 0),
      total_spent: ensureNumber(purchaseStats?.total_spent ?? 0),
      pending_recharge: ensureNumber(rechargeStats?.pending_amount ?? 0),
      total_recharge_count: ensureNumber(rechargeStats?.total_recharges ?? 0),
      total_purchase_count: ensureNumber(purchaseStats?.total_purchases ?? 0)
    });
  });

  // 创建充值订单
  router.post("/recharge", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { amount, method, payment_method } = req.body || {};
    const amt = ensureNumber(amount, 0);
    if (amt <= 0) return errorResponse(res, "金额无效", 400);
    const tradeNo = `R${Date.now().toString().slice(-8)}${generateRandomString(4).toUpperCase()}`;
    const rawChannel = typeof payment_method === "string" && payment_method.trim() ? payment_method : method;
    const channel = payment.normalizeChannel(rawChannel) || payment.getActiveChannels()[0] || null;
    if (!channel) return errorResponse(res, "支付方式不可用", 400);
    const providerType = payment.getChannelProviderType(ctx.env, channel);
    if (!providerType || !(payment.providers as any)[providerType]?.isConfigured()) {
      return errorResponse(res, "支付方式未配置", 400);
    }
    // 记录用户选择的支付渠道（alipay / wxpay / crypto）
    await ctx.dbService.createRechargeRecord(Number(user.id), amt, tradeNo, channel);

    let returnUrl = ctx.env.EPAY_RETURN_URL || ctx.env.EPUSDT_RETURN_URL || "";
    if (!returnUrl) {
      const origin = (req.headers.origin as string) || (req.headers.referer as string);
      if (origin) {
        try {
          const originUrl = new URL(origin);
          returnUrl = `${originUrl.protocol}//${originUrl.host}/user/wallet`;
        } catch {
          returnUrl = ctx.env.SITE_URL ? `${ctx.env.SITE_URL.replace(/\/$/, "")}/user/wallet` : "";
        }
      } else if (ctx.env.SITE_URL) {
        returnUrl = `${ctx.env.SITE_URL.replace(/\/$/, "")}/user/wallet`;
      }
    }

    const created = payment.create(
      {
        tradeNo,
        amount: amt,
        subject: "账户充值",
        notifyUrl: ctx.env.EPAY_NOTIFY_URL || ctx.env.EPUSDT_NOTIFY_URL,
        returnUrl
      },
      channel
    );
    return successResponse(
      res,
      { trade_no: tradeNo, amount: amt, status: 0, method: created.method, pay_url: created.payUrl },
      "充值订单已创建"
    );
  });

  // 模拟回调：将充值标记为已支付并增加余额
  router.post("/recharge/callback", async (req: Request, res: Response) => {
    const { trade_no } = req.body || {};
    if (!trade_no) return errorResponse(res, "缺少 trade_no", 400);
    const record = await ctx.dbService.markRechargePaid(trade_no);
    if (!record) return errorResponse(res, "订单不存在", 404);
    await referralService.awardRebate({
      inviteeId: Number(record.user_id),
      amount: Number(record.amount ?? 0),
      sourceType: "recharge",
      sourceId: Number(record.id ?? 0) || null,
      tradeNo: trade_no,
      eventType: "recharge_rebate"
    });
    return successResponse(res, { trade_no }, "已入账");
  });

  // 礼品卡兑换（支持余额/时长/流量/重置/套餐）
  router.post("/gift-card/redeem", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { code } = req.body || {};
    if (!code) return errorResponse(res, "缺少卡密", 400);

    const card = await ctx.dbService.getGiftCardByCode(String(code));
    if (!card) return errorResponse(res, "卡密无效或已停用", 404);

    if (card.status !== 1) return errorResponse(res, "礼品卡不可用", 400);
    if (card.start_at && new Date(card.start_at).getTime() > Date.now()) {
      return errorResponse(res, "未到使用时间", 400);
    }
    if (card.end_at && new Date(card.end_at).getTime() < Date.now()) {
      return errorResponse(res, "礼品卡已过期", 400);
    }
    const maxUsage = card.max_usage ? Number(card.max_usage) : 1;
    const usedCount = Number(card.used_count || 0);
    if (usedCount >= maxUsage) return errorResponse(res, "礼品卡已用完", 400);

    const usageIndex = usedCount + 1;
    const tradeNo = buildGiftCardTradeNo(String(code), usageIndex);

    const ensurePositive = (value: any) => {
      const n = ensureNumber(value, 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    const userInfo = await ctx.db.db
      .prepare("SELECT class_expire_time FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ class_expire_time?: string | null }>();

    const updateExpireTime = async (days: number) => {
      const duration = Math.max(1, Math.floor(days));
      const now = new Date();
      let base = now;
      if (userInfo?.class_expire_time) {
        const existing = new Date(userInfo.class_expire_time);
        if (!Number.isNaN(existing.getTime()) && existing > now) {
          base = existing;
        }
      }
      base.setDate(base.getDate() + duration);
      const formatted = base.toISOString().slice(0, 19).replace("T", " ");
      await ctx.db.db
        .prepare(
          `
          UPDATE users
          SET class_expire_time = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(formatted, user.id)
        .run();
      return formatted;
    };

    let changeAmount: number | null = null;
    let durationDays: number | null = null;
    let trafficValueGb: number | null = null;
    let resetTrafficGb: number | null = null;
    let rechargeRecordId: number | null = null;
    let purchaseRecordId: number | null = null;
    let packageId: number | null = null;
    let expiresAt: string | null = null;
    let message = "";

    try {
      if (card.card_type === "balance") {
        const amount = ensurePositive(card.balance_amount);
        if (amount <= 0) return errorResponse(res, "卡面值无效", 400);
        await ctx.dbService.createRechargeRecord(Number(user.id), amount, tradeNo, "gift_card");
        const paid = await ctx.dbService.markRechargePaid(tradeNo);
        if (!paid) return errorResponse(res, "充值记录创建失败", 500);
        rechargeRecordId = Number(paid.id);
        changeAmount = amount;
        message = `成功充值 ¥${amount.toFixed(2)}`;
      } else if (card.card_type === "duration") {
        const duration = ensurePositive(card.duration_days);
        if (duration <= 0) return errorResponse(res, "礼品卡未设置有效期天数", 400);
        expiresAt = await updateExpireTime(duration);
        durationDays = duration;
        message = `等级有效期延长 ${duration} 天`;
      } else if (card.card_type === "traffic") {
        const trafficGb = ensurePositive(card.traffic_value_gb);
        if (trafficGb <= 0) return errorResponse(res, "礼品卡未配置流量数值", 400);
        const bytes = Math.round(trafficGb * 1024 * 1024 * 1024);
        await ctx.db.db
          .prepare(
            `
            UPDATE users
            SET transfer_enable = transfer_enable + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
          )
          .bind(bytes, user.id)
          .run();
        trafficValueGb = trafficGb;
        message = `已增加 ${trafficGb} GB 流量`;
      } else if (card.card_type === "reset_traffic") {
        const resetGb = ensurePositive(card.reset_traffic_gb);
        await ctx.db.db
          .prepare(
            `
            UPDATE users
            SET transfer_total = 0,
                upload_traffic = 0,
                download_traffic = 0,
                upload_today = 0,
                download_today = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
          )
          .bind(user.id)
          .run();
        resetTrafficGb = resetGb || null;
        message = "已重置已用流量";
      } else if (card.card_type === "package") {
        const pkgId = card.package_id ? Number(card.package_id) : 0;
        if (!pkgId) return errorResponse(res, "礼品卡未绑定可兑换的套餐", 400);
        const pkg = await ctx.dbService.getPackageByIdAny(pkgId);
        if (!pkg || pkg.status !== 1) return errorResponse(res, "绑定的套餐不存在或已下架", 404);

        const purchaseResult = toRunResult(
          await ctx.db.db
            .prepare(
              `
              INSERT INTO package_purchase_records
              (user_id, package_id, price, package_price, discount_amount, purchase_type, trade_no, status, created_at, paid_at)
              VALUES (?, ?, 0, ?, ?, 'gift_card', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `
            )
            .bind(user.id, pkg.id, ensureNumber(pkg.price, 0), ensureNumber(pkg.price, 0), tradeNo)
            .run()
        );
        purchaseRecordId = getLastRowId(purchaseResult);
        packageId = Number(pkg.id);
        const applyResult = await ctx.dbService.updateUserAfterPackagePurchase(Number(user.id), pkg);
        expiresAt = applyResult.newExpireTime ?? null;
        if (expiresAt && purchaseRecordId) {
          await ctx.db.db
            .prepare("UPDATE package_purchase_records SET expires_at = ? WHERE id = ?")
            .bind(expiresAt, purchaseRecordId)
            .run();
        }
        durationDays = ensureNumber(pkg.validity_days ?? 0, 0) || null;
        trafficValueGb = ensureNumber(pkg.traffic_quota ?? 0, 0) || null;
        message = `已成功兑换套餐 ${pkg.name}`;
      } else {
        return errorResponse(res, "暂不支持该礼品卡类型", 400);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message || "兑换失败", 500);
    }

    await ctx.dbService.markGiftCardUsed(Number(card.id), usedCount, maxUsage);
    await ctx.dbService.insertGiftCardRedemption({
      cardId: Number(card.id),
      userId: Number(user.id),
      code: String(code),
      cardType: card.card_type,
      changeAmount,
      durationDays,
      trafficValueGb,
      resetTrafficGb,
      packageId,
      rechargeRecordId,
      purchaseRecordId,
      tradeNo,
      message
    });

    return successResponse(
      res,
      {
        code: String(code),
        card_type: card.card_type,
        change_amount: changeAmount,
        duration_days: durationDays,
        traffic_value_gb: trafficValueGb,
        reset_traffic_gb: resetTrafficGb,
        usage: { used_count: usageIndex, max_usage: maxUsage },
        message,
        trade_no: tradeNo,
        package_id: packageId,
        expires_at: expiresAt
      },
      "兑换成功"
    );
  });

  return router;
}
