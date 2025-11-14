import type { D1Database } from "@cloudflare/workers-types";
import { ensureNumber, ensureString, getChanges, toRunResult } from "../utils/d1";
import { fixMoneyPrecision } from "../utils/money";

type CouponRow = {
  id: number;
  name: string;
  code: string;
  discount_type: string;
  discount_value: number | string;
  start_at: number | string;
  end_at: number | string;
  max_usage?: number | string | null;
  per_user_limit?: number | string | null;
  total_used?: number | string | null;
  status?: number | string | null;
  description?: string | null;
};

type CouponValidationInput = {
  code: string;
  userId: number;
  packageId: number;
  packagePrice: number;
};

export type CouponCalculationResult = {
  coupon: CouponRow & { discount_value: number };
  discountAmount: number;
  finalPrice: number;
  applicablePackages: number[];
};

export class CouponService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async validateCouponForPurchase(
    params: CouponValidationInput
  ): Promise<CouponCalculationResult> {
    const code = ensureString(params.code).trim();
    if (!code) {
      throw new Error("优惠码不能为空");
    }

    const coupon = await this.db
      .prepare(
        `
        SELECT *
        FROM coupons
        WHERE code = ? COLLATE NOCASE
      `
      )
      .bind(code)
      .first<CouponRow>();

    if (!coupon) {
      throw new Error("优惠码不存在");
    }

    const status = ensureNumber(coupon.status ?? 0);
    if (status !== 1) {
      throw new Error("优惠码已被禁用");
    }

    const now = Math.floor(Date.now() / 1000);
    const startAt = ensureNumber(coupon.start_at);
    const endAt = ensureNumber(coupon.end_at);
    if (now < startAt) {
      throw new Error("优惠码尚未生效");
    }
    if (now > endAt) {
      throw new Error("优惠码已过期");
    }

    const maxUsage = coupon.max_usage !== null && coupon.max_usage !== undefined
      ? ensureNumber(coupon.max_usage)
      : null;
    const totalUsed = ensureNumber(coupon.total_used ?? 0);
    if (maxUsage !== null && totalUsed >= maxUsage) {
      throw new Error("优惠码已达到使用上限");
    }

    const perUserLimit =
      coupon.per_user_limit !== null && coupon.per_user_limit !== undefined
        ? ensureNumber(coupon.per_user_limit)
        : null;
    if (perUserLimit !== null && perUserLimit > 0) {
      const usageRow = await this.db
        .prepare(
          `
            SELECT COUNT(*) AS total
            FROM coupon_usages
            WHERE coupon_id = ? AND user_id = ?
          `
        )
        .bind(coupon.id, params.userId)
        .first<{ total: number | string | null }>();

      const userUsed = ensureNumber(usageRow?.total ?? 0);
      if (userUsed >= perUserLimit) {
        throw new Error("该优惠码每个用户使用次数已达上限");
      }
    }

    const packagesResult = await this.db
      .prepare(
        `
        SELECT package_id
        FROM coupon_packages
        WHERE coupon_id = ?
      `
      )
      .bind(coupon.id)
      .all<{ package_id: number | string }>();

    const allowedPackages =
      packagesResult.results?.map(row => ensureNumber(row.package_id)) ?? [];

    if (allowedPackages.length > 0 && !allowedPackages.includes(params.packageId)) {
      throw new Error("该优惠码不适用于当前套餐");
    }

    const discountValue = ensureNumber(coupon.discount_value);
    const { discountAmount, finalPrice } = this.calculateDiscount(
      coupon.discount_type,
      discountValue,
      params.packagePrice
    );

    if (finalPrice < 0) {
      throw new Error("优惠金额异常，请稍后再试");
    }

    return {
      coupon: { ...coupon, discount_value: discountValue },
      discountAmount,
      finalPrice,
      applicablePackages: allowedPackages,
    };
  }

  private calculateDiscount(
    discountType: string,
    discountValue: number,
    packagePrice: number
  ) {
    const priceCents = Math.round(packagePrice * 100);
    let discountCents = 0;

    if (discountType === "amount") {
      const couponCents = Math.round(discountValue * 100);
      discountCents = Math.min(priceCents, Math.max(couponCents, 0));
    } else if (discountType === "percentage") {
      const safePercent = Math.min(Math.max(discountValue, 0), 100);
      discountCents = Math.min(
        priceCents,
        Math.round(priceCents * (safePercent / 100))
      );
    } else {
      throw new Error("未知的优惠类型");
    }

    const finalCents = Math.max(priceCents - discountCents, 0);

    return {
      discountAmount: discountCents / 100,
      finalPrice: fixMoneyPrecision(finalCents / 100),
    };
  }

  async consumeCouponUsage(
    couponId: number,
    userId: number,
    orderId: number,
    tradeNo: string
  ) {
    if (!couponId || !userId) {
      return { success: false, message: "缺少优惠券信息" };
    }

    // 再次检查单人使用限制，避免并发状态下超限
    const couponRow = await this.db
      .prepare("SELECT per_user_limit FROM coupons WHERE id = ?")
      .bind(couponId)
      .first<{ per_user_limit?: number | string | null }>();

    if (couponRow?.per_user_limit !== null && couponRow?.per_user_limit !== undefined) {
      const perLimit = ensureNumber(couponRow.per_user_limit);
      if (perLimit > 0) {
        const usageRow = await this.db
          .prepare(
            `
              SELECT COUNT(*) AS total
              FROM coupon_usages
              WHERE coupon_id = ? AND user_id = ?
            `
          )
          .bind(couponId, userId)
          .first<{ total: number | string | null }>();

        const used = ensureNumber(usageRow?.total ?? 0);
        if (used >= perLimit) {
          return { success: false, message: "优惠码每人使用次数已达上限" };
        }
      }
    }

    const updateResult = toRunResult(
      await this.db
      .prepare(
        `
          UPDATE coupons
          SET total_used = total_used + 1,
              updated_at = datetime('now', '+8 hours')
          WHERE id = ?
            AND status = 1
            AND (max_usage IS NULL OR total_used < max_usage)
        `
      )
      .bind(couponId)
      .run()
    );

    if (getChanges(updateResult) === 0) {
      return { success: false, message: "优惠码剩余次数不足" };
    }

    await this.db
      .prepare(
        `
          INSERT INTO coupon_usages (coupon_id, user_id, order_id, order_trade_no)
          VALUES (?, ?, ?, ?)
        `
      )
      .bind(couponId, userId, orderId, tradeNo)
      .run();

    return { success: true };
  }
}
