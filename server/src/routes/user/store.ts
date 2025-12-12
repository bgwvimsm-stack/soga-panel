import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { generateRandomString } from "../../utils/crypto";
import { ensureNumber } from "../../utils/d1";
import { createPaymentProviders } from "../../payment/factory";

export function createStoreRouter(ctx: AppContext) {
  const router = Router();
  const payment = createPaymentProviders(ctx.env);

  const normalizePaymentMethod = (method?: string | null) => {
    return payment.normalizeChannel(method) || null;
  };

  const buildReturnUrl = (req: Request, fallback = "/user/store") => {
    const origin = (req.get("origin") || ctx.env.SITE_URL || "").replace(/\/$/, "");
    if (!origin) return undefined;
    return `${origin}${fallback}`;
  };

  const listPackages = async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 200);
    const level = typeof req.query.level === "string" ? req.query.level : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "price";
    const order = (req.query.order as string) === "desc" ? "DESC" : "ASC";
    const offset = (page - 1) * limit;

    const filters: string[] = ["status = 1"];
    const values: any[] = [];
    if (level) {
      filters.push("level = ?");
      values.push(Number(level));
    }
    const where = `WHERE ${filters.join(" AND ")}`;
    const sortField = ["price", "traffic_quota", "validity_days", "level"].includes(sort) ? sort : "price";

    const totalRow = await ctx.db
      .prepare(`SELECT COUNT(*) as total FROM packages ${where}`)
      .bind(...values)
      .first<{ total?: number }>();
    const rows = await ctx.db
      .prepare(
        `
        SELECT id, name, price, traffic_quota, validity_days, speed_limit, device_limit, level, is_recommended, sort_weight, created_at
        FROM packages
        ${where}
        ORDER BY sort_weight DESC, ${sortField} ${order}
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, limit, offset)
      .all();

    const packages =
      rows.results?.map((pkg: any) => {
        const price = ensureNumber(pkg.price, 0);
        const trafficQuota = ensureNumber(pkg.traffic_quota, 0);
        const validityDays = ensureNumber(pkg.validity_days, 0);
        const speedLimit = ensureNumber(pkg.speed_limit, 0);
        const deviceLimit = ensureNumber(pkg.device_limit, 0);
        const levelNum = ensureNumber(pkg.level, 0);
        return {
          ...pkg,
          price,
          traffic_quota: trafficQuota,
          traffic_quota_gb: trafficQuota,
          traffic_quota_bytes: trafficQuota * 1024 * 1024 * 1024,
          validity_days: validityDays,
          speed_limit: speedLimit,
          device_limit: deviceLimit,
          level: levelNum,
          speed_limit_text: speedLimit ? `${speedLimit} Mbps` : "无限制",
          device_limit_text: deviceLimit ? `${deviceLimit} 个设备` : "无限制",
          validity_text: `${validityDays} 天`
        };
      }) || [];

    const total = Number(totalRow?.total ?? 0);
    return successResponse(res, {
      packages,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  };

  router.get("/packages", listPackages);
  // 兼容 /api/packages 挂载
  router.get("/", listPackages);

  router.get("/packages/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const pkg = await ctx.dbService.getPackageById(id);
    if (!pkg) return errorResponse(res, "套餐不存在或已下架", 404);
    return successResponse(res, pkg);
  });

  // 预览优惠券折扣
  router.post("/packages/coupon/preview", createAuthMiddleware(ctx), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { package_id, coupon_code } = req.body || {};
    if (!package_id || !coupon_code) return errorResponse(res, "缺少参数", 400);
    const pkg = await ctx.dbService.getPackageById(Number(package_id));
    if (!pkg) return errorResponse(res, "套餐不存在或已下架", 404);
    const coupon = await ctx.dbService.getCouponByCode(String(coupon_code));
    if (!coupon) return errorResponse(res, "优惠券无效", 400);
    const now = Math.floor(Date.now() / 1000);
    if (coupon.start_at && now < Number(coupon.start_at)) return errorResponse(res, "未到使用时间", 400);
    if (coupon.end_at && now > Number(coupon.end_at)) return errorResponse(res, "优惠券已过期", 400);
    const usage = await ctx.dbService.countCouponUsage(Number(coupon.id), Number(user.id));
    if (coupon.max_usage && usage.total >= Number(coupon.max_usage)) return errorResponse(res, "优惠券名额已用尽", 400);
    if (coupon.per_user_limit && usage.byUser >= Number(coupon.per_user_limit)) {
      return errorResponse(res, "您已达到使用次数上限", 400);
    }
    const price = ensureNumber(pkg.price, 0);
    let discount = 0;
    if (coupon.discount_type === "amount") {
      discount = ensureNumber(coupon.discount_value, 0);
    } else if (coupon.discount_type === "percentage") {
      discount = (price * ensureNumber(coupon.discount_value, 0)) / 100;
    }
    const finalPrice = Math.max(0, price - discount);
    return successResponse(res, {
      price,
      discount_amount: discount,
      final_price: finalPrice,
      coupon: {
        id: coupon.id,
        name: coupon.name,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        start_at: coupon.start_at,
        end_at: coupon.end_at,
        max_usage: coupon.max_usage,
        per_user_limit: coupon.per_user_limit,
        total_used: coupon.total_used
      }
    });
  });

  // 购买创建订单（不扣款，待支付/回调逻辑留待后续）
  router.post("/packages/purchase", createAuthMiddleware(ctx), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { package_id, coupon_code, payment_method, purchase_type } = req.body || {};
    const userId = Number(user.id);
    const pkg = await ctx.dbService.getPackageById(Number(package_id));
    if (!pkg) return errorResponse(res, "套餐不存在或已下架", 404);

    const originalPrice = ensureNumber(pkg.price, 0);
    let price = originalPrice;
    let discount = 0;
    let couponId: number | null = null;
    let couponCode: string | null = null;

    if (coupon_code) {
      const coupon = await ctx.dbService.getCouponByCode(String(coupon_code));
      if (!coupon) return errorResponse(res, "优惠券无效", 400);
      const now = Math.floor(Date.now() / 1000);
      if (coupon.start_at && now < Number(coupon.start_at)) return errorResponse(res, "未到使用时间", 400);
      if (coupon.end_at && now > Number(coupon.end_at)) return errorResponse(res, "优惠券已过期", 400);
      const usage = await ctx.dbService.countCouponUsage(Number(coupon.id), Number(user.id));
      if (coupon.max_usage && usage.total >= Number(coupon.max_usage)) return errorResponse(res, "优惠券名额已用尽", 400);
      if (coupon.per_user_limit && usage.byUser >= Number(coupon.per_user_limit)) {
        return errorResponse(res, "您已达到使用次数上限", 400);
      }

      if (coupon.discount_type === "amount") {
        discount = ensureNumber(coupon.discount_value, 0);
      } else if (coupon.discount_type === "percentage") {
        discount = (price * ensureNumber(coupon.discount_value, 0)) / 100;
      }
      price = Math.max(0, price - discount);
      couponId = Number(coupon.id);
      couponCode = String(coupon.code);
    }

    const userBalance = await ctx.dbService.getUserBalance(userId);
    const tradeNo = `P${Date.now().toString().slice(-8)}${generateRandomString(4).toUpperCase()}`;
    const requestedType = typeof purchase_type === "string" ? purchase_type.toLowerCase() : "balance";
    const normalizedChannel = normalizePaymentMethod(payment_method) || payment.getActiveChannels()[0] || null;
    const isFree = price <= 0;

    const getChannelOrFail = () => {
      if (!normalizedChannel) {
        throw new Error("支付未配置，请联系管理员");
      }
      const providerType = payment.getChannelProviderType(ctx.env, normalizedChannel);
      if (!providerType || !(payment.providers as any)[providerType]?.isConfigured()) {
        throw new Error("支付未配置，请联系管理员");
      }
      return normalizedChannel;
    };

    // 计算最终的购买类型与需要支付的金额
    let actualPurchaseType = requestedType || "balance";
    let paymentAmount = price;
    if (price <= 0) {
      actualPurchaseType = "balance";
      paymentAmount = 0;
    } else if (requestedType === "balance") {
      if (userBalance < price) {
        actualPurchaseType = "smart_topup";
        paymentAmount = Math.max(price - userBalance, 0);
      } else {
        paymentAmount = price;
      }
    } else if (requestedType === "direct") {
      if (userBalance > 0 && userBalance < price) {
        actualPurchaseType = "smart_topup";
        paymentAmount = Math.max(price - userBalance, 0);
      } else {
        actualPurchaseType = "direct";
        paymentAmount = price;
      }
    } else if (requestedType === "smart_topup") {
      actualPurchaseType = "smart_topup";
      paymentAmount = Math.max(price - userBalance, 0);
    } else {
      actualPurchaseType = "balance";
      paymentAmount = price;
    }

    // 如果补差后无需再支付，回退为余额支付
    if (paymentAmount <= 0) {
      actualPurchaseType = "balance";
    }

    // 决定存储的 purchase_type
    const channelForOnline = normalizePaymentMethod(payment_method) || normalizedChannel;
    const storedPurchaseType =
      actualPurchaseType === "balance"
        ? "balance"
        : actualPurchaseType === "smart_topup"
          ? `balance_${channelForOnline || "online"}`
          : channelForOnline || "online";

    // 免费套餐：直接激活
    if (isFree) {
      try {
        await ctx.dbService.createPurchaseRecord({
          userId,
          packageId: Number(pkg.id),
          price: 0,
          packagePrice: originalPrice,
          tradeNo,
          status: 0,
          purchaseType: "balance",
          couponId,
          couponCode,
          discountAmount: discount
        });
        await ctx.dbService.markPurchasePaid(tradeNo);
        return successResponse(
          res,
          {
            trade_no: tradeNo,
            package_name: pkg.name,
            price: originalPrice,
            final_price: price,
            discount_amount: discount,
            coupon_code: couponCode,
            purchase_type: "balance",
            status: 1,
            status_text: "购买成功"
          },
          "已自动激活套餐"
        );
      } catch (error: any) {
        return errorResponse(res, error?.message || "免费套餐激活失败", 500);
      }
    }

    // 纯余额支付
    if (actualPurchaseType === "balance") {
      const deduction = price;
      const ok = await ctx.dbService.deductUserBalance(userId, deduction);
      if (!ok) return errorResponse(res, "余额不足", 400);
      try {
        await ctx.dbService.createPurchaseRecord({
          userId,
          packageId: Number(pkg.id),
          price: deduction,
          packagePrice: originalPrice,
          tradeNo,
          status: 1,
          purchaseType: "balance",
          couponId,
          couponCode,
          discountAmount: discount
        });
        const applied = await ctx.dbService.markPurchasePaid(tradeNo);
        return successResponse(
          res,
          {
            trade_no: tradeNo,
            package_name: pkg.name,
            price: originalPrice,
            final_price: price,
            discount_amount: discount,
            coupon_code: couponCode,
            purchase_type: "balance",
            status: applied ? 1 : 0,
            status_text: applied ? "购买成功" : "待处理"
          },
          "已使用余额支付并激活套餐"
        );
      } catch (error: any) {
        // 回滚余额
        await ctx.db.db
          .prepare("UPDATE users SET money = money + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(deduction, userId)
          .run();
        return errorResponse(res, error?.message || "余额支付失败", 500);
      }
    }

    // 在线支付（包含 smart_topup 补差额）
    let channelToUse: string | null = null;
    try {
      channelToUse = getChannelOrFail();
    } catch (err: any) {
      return errorResponse(res, err?.message || "支付未配置，请联系管理员", 400);
    }

    if (!payment.hasAnyProvider()) {
      return errorResponse(res, "支付未配置，请联系管理员", 400);
    }

    // 记录订单（待支付）
    await ctx.dbService.createPurchaseRecord({
      userId,
      packageId: Number(pkg.id),
      price: paymentAmount,
      packagePrice: originalPrice,
      tradeNo,
      status: 0, // 待支付
      purchaseType: storedPurchaseType,
      couponId,
      couponCode,
      discountAmount: discount
    });

    const pay = await payment.create(
      {
        tradeNo,
        amount: paymentAmount,
        subject: String(pkg.name || "套餐购买"),
        notifyUrl: ctx.env.EPAY_NOTIFY_URL || ctx.env.EPUSDT_NOTIFY_URL,
        returnUrl: buildReturnUrl(req)
      },
      channelToUse
    );

    if (!pay.success || !pay.payUrl) {
      const msg = pay.message || "创建支付订单失败";
      return errorResponse(res, msg, 500);
    }

    const payUrl = pay.payUrl;

    const isMixed = storedPurchaseType.startsWith("balance_");
    const statusText = isMixed ? "待支付差额" : "待支付";
    const msg = isMixed
      ? `需要补差额 ¥${paymentAmount.toFixed(2)}，正在跳转到支付页面`
      : "购买订单创建成功，请完成支付";

    return successResponse(
      res,
      {
        trade_no: tradeNo,
        package_name: pkg.name,
        price: originalPrice,
        final_price: price,
        discount_amount: discount,
        coupon_code: couponCode,
        purchase_type: storedPurchaseType,
        status: 0,
        status_text: statusText,
        payment_url: payUrl,
        payment_amount: paymentAmount,
        user_balance: userBalance
      },
      msg
    );
  });

  const listPurchaseRecords = async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    const offset = (page - 1) * limit;
    const rows = await ctx.db
      .prepare(
        `
        SELECT 
          ppr.id,
          ppr.price,
          ppr.package_price,
          ppr.discount_amount,
          ppr.coupon_code,
          ppr.purchase_type,
          ppr.trade_no,
          ppr.status,
          ppr.created_at,
          ppr.paid_at,
          ppr.expires_at,
          p.name AS package_name,
          p.traffic_quota,
          p.validity_days,
          p.level,
          gcr.code AS gift_card_code
        FROM package_purchase_records ppr
        LEFT JOIN packages p ON ppr.package_id = p.id
        LEFT JOIN gift_card_redemptions gcr ON gcr.purchase_record_id = ppr.id
        WHERE ppr.user_id = ?
        ORDER BY ppr.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(user.id, limit, offset)
      .all();
    const totalRow = await ctx.db
      .prepare("SELECT COUNT(*) as total FROM package_purchase_records WHERE user_id = ?")
      .bind(user.id)
      .first<{ total?: number }>();

    const statusText: Record<number, string> = { 0: "待支付", 1: "已支付", 2: "已取消", 3: "支付失败" };
    const formatType = (type: string | null) => {
      if (!type) return "未知";
      const t = type.toLowerCase();
      if (t === "balance") return "余额支付";
      if (t === "gift_card") return "礼品卡";
      if (t === "free") return "免费";
      if (t === "balance_epay" || t === "balance_epusdt") return "混合支付";
      if (t === "epay" || t === "epusdt") return "在线支付";
      return type;
    };

    const records =
      rows.results?.map((r: any) => {
        const price = ensureNumber(r.price, 0);
        const packagePrice = r.package_price != null ? ensureNumber(r.package_price, 0) : price;
        const discount = r.discount_amount != null ? ensureNumber(r.discount_amount, 0) : 0;
        const finalPrice = Math.max(0, packagePrice - discount);
        const purchaseType = r.purchase_type || "";
        let displayTradeNo: string | null = r.trade_no;
        if (purchaseType === "gift_card") {
          if (r.gift_card_code) {
            displayTradeNo = String(r.gift_card_code);
          } else if (r.trade_no && String(r.trade_no).includes("-")) {
            displayTradeNo = String(r.trade_no).split("-")[0] || r.trade_no;
          }
        }
        return {
          ...r,
          trade_no: displayTradeNo,
          price,
          package_price: packagePrice,
          discount_amount: discount,
          final_price: finalPrice,
          purchase_type_text: formatType(purchaseType),
          status_text: statusText[Number(r.status)] || "未知状态",
          traffic_quota_gb: r.traffic_quota != null ? ensureNumber(r.traffic_quota, 0) : null
        };
      }) || [];

    const total = Number(totalRow?.total ?? 0);
    return successResponse(res, {
      records,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  };

  router.get("/purchase-records", createAuthMiddleware(ctx), listPurchaseRecords);
  // 兼容 /api/packages/purchase-records
  router.get("/packages/purchase-records", createAuthMiddleware(ctx), listPurchaseRecords);

  return router;
}
