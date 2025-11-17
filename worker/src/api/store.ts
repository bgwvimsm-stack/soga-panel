// src/api/store.js - 商店相关API

import type { Env } from "../types";
import type { Logger } from "../utils/logger";
import type { SystemConfigManager } from "../utils/systemConfig";
import { DatabaseService } from "../services/database";
import { CouponService } from "../services/couponService";
import { validateUserAuth } from "../middleware/auth";
import { errorResponse, successResponse } from "../utils/response";
import { getLogger } from "../utils/logger";
import { createSystemConfigManager } from "../utils/systemConfig";
import { ensureNumber, ensureString, ensureDate, getChanges, toRunResult } from "../utils/d1";
import { fixMoneyPrecision } from "../utils/money";
import type { PaymentCreateResult } from "./pay/types";

type PackageRow = {
  id: number;
  name: string;
  price: number | string;
  traffic_quota: number | string;
  validity_days: number | string;
  speed_limit: number | string;
  device_limit: number | string;
  level: number | string;
  is_recommended: number | null;
  sort_weight: number | string;
  created_at: string | null;
  updated_at?: string | null;
};

type UserRow = {
  id: number;
  email?: string;
  money: number | string;
  class: number | string;
  class_expire_time: string | null;
  token?: string | null;
  transfer_enable?: number | string;
  transfer_used?: number | string;
};

type PurchaseRecordRow = {
  id: number;
  trade_no: string;
  package_price: number | string | null;
  package_id: number;
  user_id: number;
  purchase_type: string | null;
};

type PurchaseRecordListRow = {
  id: number;
  price: number | string;
  package_price: number | string | null;
  discount_amount?: number | string | null;
  coupon_code?: string | null;
  coupon_id?: number | string | null;
  final_price?: number | string | null;
  purchase_type: string | null;
  trade_no: string;
  status: number;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
  package_name: string | null;
  traffic_quota: number | string | null;
  validity_days: number | string | null;
  level: number | string | null;
};

type UserBalanceRow = {
  money: number | string;
  class: number | string;
  class_expire_time: string | null;
};

type PaymentDirectResult = {
  code: number;
  message?: string;
  data?: PaymentCreateResult;
};

type AuthenticatedUser = {
  id: number;
  email?: string | null;
  is_admin?: boolean;
  [key: string]: unknown;
};

type PurchaseRequestBody = {
  package_id: number;
  purchase_type?: string;
  payment_method?: string;
  coupon_code?: string;
};

type NormalizedPackageRow = Omit<
  PackageRow,
  "price" | "traffic_quota" | "validity_days" | "speed_limit" | "device_limit" | "level"
> & {
  price: number;
  traffic_quota: number;
  validity_days: number;
  speed_limit: number;
  device_limit: number;
  level: number;
};

type NormalizedUserRow = Omit<UserRow, "money" | "class"> & {
  money: number;
  class: number;
};

function normalizePackageRow(pkg: PackageRow): NormalizedPackageRow {
  return {
    ...pkg,
    price: ensureNumber(pkg.price),
    traffic_quota: ensureNumber(pkg.traffic_quota),
    validity_days: ensureNumber(pkg.validity_days),
    speed_limit: ensureNumber(pkg.speed_limit),
    device_limit: ensureNumber(pkg.device_limit),
    level: ensureNumber(pkg.level),
  };
}

function normalizeUserRow(user: UserRow): NormalizedUserRow {
  return {
    ...user,
    money: ensureNumber(user.money),
    class: ensureNumber(user.class),
  };
}

export class StoreAPI {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly logger: Logger;
  private readonly configManager: SystemConfigManager;
  private readonly couponService: CouponService;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.logger = getLogger(env);
    this.configManager = createSystemConfigManager(env);
    this.couponService = new CouponService(this.db.db);
  }

  // 获取套餐列表
  async getPackages(request: Request) {
    try {
      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1);
      const limit = Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "", 10) || 10);
      const level = url.searchParams.get("level");
      const sortBy = url.searchParams.get("sort") || "price"; // price, traffic_quota, validity_days
      const order = url.searchParams.get("order") || "asc"; // asc, desc
      const offset = (page - 1) * limit;

      // 构建查询条件
      let whereClause = "WHERE status = 1";
      const params: number[] = [];

      if (level) {
        const parsedLevel = Number.parseInt(level, 10);
        if (!Number.isNaN(parsedLevel)) {
          whereClause += " AND level = ?";
          params.push(parsedLevel);
        }
      }

      // 构建排序条件
      const validSortFields = ["price", "traffic_quota", "validity_days", "level"];
      const sortField = validSortFields.includes(sortBy) ? sortBy : "price";
      const sortOrder = order === "desc" ? "DESC" : "ASC";

      // 获取套餐总数
      const totalResult = await this.db.db
        .prepare(`SELECT COUNT(*) as total FROM packages ${whereClause}`)
        .bind(...params)
        .first<{ total: number | string | null }>();

      const total = ensureNumber(totalResult?.total);

      // 获取套餐列表
      const packages = await this.db.db
        .prepare(`
          SELECT
            id,
            name,
            price,
            traffic_quota,
            validity_days,
            speed_limit,
            device_limit,
            level,
            is_recommended,
            sort_weight,
            created_at
          FROM packages
          ${whereClause}
          ORDER BY sort_weight DESC, ${sortField} ${sortOrder}
          LIMIT ? OFFSET ?
        `)
        .bind(...params, limit, offset)
        .all();

      const packageRows = (packages.results ?? []) as PackageRow[];
      const formattedPackages = packageRows.map(pkg => {
        const normalized = normalizePackageRow(pkg);
        return {
          ...normalized,
          traffic_quota_gb: normalized.traffic_quota,
          traffic_quota_bytes: normalized.traffic_quota * 1024 * 1024 * 1024,
          speed_limit_text: normalized.speed_limit === 0 ? '无限制' : `${normalized.speed_limit} Mbps`,
          device_limit_text: normalized.device_limit === 0 ? '无限制' : `${normalized.device_limit} 个设备`,
          validity_text: `${normalized.validity_days} 天`
        };
      });

      return successResponse({
        packages: formattedPackages,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      this.logger.error("获取套餐列表失败", error);
      return errorResponse("获取套餐列表失败", 500);
    }
  }

  // 获取套餐详情
  async getPackageDetail(request) {
    try {
      const url = new URL(request.url);
      const packageIdParam = url.pathname.split("/").pop();
      const packageId = packageIdParam ? Number(packageIdParam) : Number.NaN;

      if (!Number.isFinite(packageId)) {
        return errorResponse("无效的套餐ID", 400);
      }

      const packageInfo = await this.db.db
        .prepare(`
          SELECT
            id,
            name,
            price,
            traffic_quota,
            validity_days,
            speed_limit,
            device_limit,
            level,
            status,
            is_recommended,
            sort_weight,
            created_at,
            updated_at
          FROM packages
          WHERE id = ? AND status = 1
        `)
        .bind(packageId)
        .first<PackageRow>();

      if (!packageInfo) {
        return errorResponse("套餐不存在或已下架", 404);
      }

      const normalized = normalizePackageRow(packageInfo);
      const formattedPackage = {
        ...normalized,
        traffic_quota_gb: normalized.traffic_quota,
        traffic_quota_bytes: normalized.traffic_quota * 1024 * 1024 * 1024,
        speed_limit_text: normalized.speed_limit === 0 ? '无限制' : `${normalized.speed_limit} Mbps`,
        device_limit_text: normalized.device_limit === 0 ? '无限制' : `${normalized.device_limit} 个设备`,
        validity_text: `${normalized.validity_days} 天`
      };

      return successResponse(formattedPackage);
    } catch (error) {
      this.logger.error("获取套餐详情失败", error);
      return errorResponse("获取套餐详情失败", 500);
    }
  }

  // 购买套餐
  async purchasePackage(request: Request) {
    try {
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return errorResponse("用户信息异常", 500);
      }

      const body = (await request.json()) as PurchaseRequestBody;
      const packageIdRaw = body.package_id;
      if (packageIdRaw === undefined || packageIdRaw === null) {
        return errorResponse("缺少套餐ID", 400);
      }

      const purchaseTypeRaw = body.purchase_type ?? "balance";
      const paymentMethodRaw = body.payment_method ?? "alipay";
      const couponCodeInput = ensureString(body.coupon_code ?? "").trim();

      const purchase_type = ensureString(purchaseTypeRaw) || "balance";
      const payment_method = ensureString(paymentMethodRaw) || "alipay";

      const packageInfo = await this.db.db
        .prepare("SELECT * FROM packages WHERE id = ? AND status = 1")
        .bind(packageIdRaw)
        .first<PackageRow>();

      if (!packageInfo) {
        return errorResponse("套餐不存在或已下架", 404);
      }

      const normalizedPackage = normalizePackageRow(packageInfo);

      const userInfo = await this.db.db
        .prepare("SELECT money, class, class_expire_time FROM users WHERE id = ?")
        .bind(userId)
        .first<UserBalanceRow>();

      if (!userInfo) {
        return errorResponse("用户不存在", 404);
      }

      const normalizePaymentMethod = (method: string) => {
        const lower = method.toLowerCase();
        if (lower === "wechat" || lower === "wxpay") return "wxpay";
        if (lower === "alipay") return "alipay";
        if (lower === "qqpay") return "qqpay";
        return lower;
      };

      const userBalance = ensureNumber(userInfo.money);
      const originalPrice = normalizedPackage.price;
      let finalPrice = originalPrice;
      let discountAmount = 0;
      let appliedCouponId: number | null = null;
      let appliedCouponCode: string | null = null;

      if (couponCodeInput) {
        try {
          const couponResult = await this.couponService.validateCouponForPurchase({
            code: couponCodeInput,
            packageId: ensureNumber(packageIdRaw),
            packagePrice: originalPrice,
            userId,
          });

          finalPrice = couponResult.finalPrice;
          discountAmount = couponResult.discountAmount;
          appliedCouponId = couponResult.coupon.id;
          appliedCouponCode = couponResult.coupon.code;
        } catch (couponError) {
          const message =
            couponError instanceof Error ? couponError.message : "优惠码验证失败";
          return errorResponse(message, 400);
        }
      }

      finalPrice = fixMoneyPrecision(Math.max(finalPrice, 0));
      discountAmount = fixMoneyPrecision(Math.min(Math.max(discountAmount, 0), originalPrice));

      let actualPurchaseType = purchase_type;
      let paymentAmount = finalPrice;

      if (finalPrice <= 0) {
        actualPurchaseType = "balance";
        paymentAmount = 0;
      } else if (purchase_type === "balance") {
        if (userBalance < finalPrice) {
          actualPurchaseType = "smart_topup";
          paymentAmount = fixMoneyPrecision(Math.max(finalPrice - userBalance, 0));
        } else {
          paymentAmount = finalPrice;
        }
      } else if (purchase_type === "direct") {
        if (userBalance > 0 && userBalance < finalPrice) {
          actualPurchaseType = "smart_topup";
          paymentAmount = fixMoneyPrecision(Math.max(finalPrice - userBalance, 0));
        } else {
          actualPurchaseType = "direct";
          paymentAmount = finalPrice;
        }
      } else if (purchase_type === "smart_topup") {
        actualPurchaseType = "smart_topup";
        paymentAmount = fixMoneyPrecision(Math.max(finalPrice - userBalance, 0));
      }

      const normalizedPaymentMethod = normalizePaymentMethod(payment_method);
      let storedPurchaseType = "balance";
      if (actualPurchaseType === "smart_topup") {
        storedPurchaseType = `balance_${normalizedPaymentMethod}`;
      } else if (actualPurchaseType === "direct") {
        storedPurchaseType = normalizedPaymentMethod;
      }

      const trade_no = `${Date.now().toString().slice(-8)}${Math.random()
        .toString(36)
        .substr(2, 4)
        .toUpperCase()}`;

      if (actualPurchaseType === "balance") {
        const deduction = fixMoneyPrecision(finalPrice);
        const deductResult = toRunResult(
          await this.db.db
            .prepare(`
            UPDATE users
            SET money = money - ?, updated_at = datetime('now', '+8 hours')
            WHERE id = ? AND money >= ?
          `)
            .bind(deduction, userId, deduction)
            .run()
        );

        if (!deductResult.success || getChanges(deductResult) === 0) {
          return errorResponse("余额扣除失败，请重试", 500);
        }

        const purchaseResult = await this.db.db
          .prepare(`
            INSERT INTO package_purchase_records
            (user_id, package_id, price, package_price, coupon_id, coupon_code, discount_amount, purchase_type, trade_no, status, paid_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+8 hours'))
          `)
          .bind(
            userId,
            packageIdRaw,
            deduction,
            normalizedPackage.price,
            appliedCouponId,
            appliedCouponCode,
            discountAmount,
            storedPurchaseType,
            trade_no
          )
          .run();

        if (!purchaseResult.success) {
          await this.db.db
            .prepare(`
              UPDATE users
              SET money = money + ?, updated_at = datetime('now', '+8 hours')
              WHERE id = ?
            `)
            .bind(deduction, userId)
            .run();

          return errorResponse("创建购买记录失败", 500);
        }

        const purchaseRecordId = ensureNumber(purchaseResult.meta?.last_row_id ?? 0);
        const updateResult = await this.updateUserAfterPackagePurchase(userId, normalizedPackage);

        if (!updateResult.success) {
          this.logger.error("更新用户等级失败", {
            user_id: userId,
            package_id: packageIdRaw,
            trade_no,
          });
        }

        if (appliedCouponId) {
          const consumeResult = await this.couponService.consumeCouponUsage(
            appliedCouponId,
            userId,
            purchaseRecordId,
            trade_no
          );
          if (!consumeResult.success) {
            this.logger.error("优惠码使用计数失败", {
              coupon_id: appliedCouponId,
              trade_no,
              reason: consumeResult.message,
            });
          }
        }

        return successResponse(
          {
            trade_no,
            package_name: normalizedPackage.name,
            price: deduction,
            original_price: normalizedPackage.price,
            discount_amount: discountAmount,
            coupon_code: appliedCouponCode,
            purchase_type: storedPurchaseType,
            status: 1,
            status_text: "购买成功",
            validity_days: packageInfo.validity_days,
            new_expire_time: updateResult.newExpireTime,
          },
          "套餐购买成功"
        );
      } else if (actualPurchaseType === "smart_topup") {
        const orderResult = await this.db.db
          .prepare(`
            INSERT INTO package_purchase_records
            (user_id, package_id, price, package_price, coupon_id, coupon_code, discount_amount, purchase_type, trade_no, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `)
          .bind(
            userId,
            packageIdRaw,
            paymentAmount,
            normalizedPackage.price,
            appliedCouponId,
            appliedCouponCode,
            discountAmount,
            storedPurchaseType,
            trade_no
          )
          .run();

        if (!orderResult.success) {
          return errorResponse("创建购买订单失败", 500);
        }

        const { PaymentAPI } = await import("./pay/PaymentAPI");
        const paymentAPI = new PaymentAPI(this.env);
        const paymentData = (await paymentAPI.createPaymentDirect(
          trade_no,
          { payment_method },
          request
        )) as PaymentDirectResult;

        if (paymentData.code !== 0) {
          return errorResponse(paymentData.message || "创建支付订单失败", 500);
        }

        const payUrl = paymentData.data?.pay_url;
        if (!payUrl) {
          return errorResponse("支付订单创建失败，缺少支付链接", 500);
        }

        return successResponse(
          {
            trade_no,
            package_name: normalizedPackage.name,
            price: normalizedPackage.price,
            final_price: finalPrice,
            discount_amount: discountAmount,
            coupon_code: appliedCouponCode,
            payment_amount: paymentAmount,
            user_balance: userBalance,
            purchase_type: storedPurchaseType,
            status: 0,
            status_text: "待支付差额",
            payment_url: payUrl,
          },
          `需要补差额 ¥${paymentAmount.toFixed(2)}，正在跳转到支付页面`
        );
      } else {
        const orderResult = await this.db.db
          .prepare(`
            INSERT INTO package_purchase_records
            (user_id, package_id, price, package_price, coupon_id, coupon_code, discount_amount, purchase_type, trade_no, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `)
          .bind(
            userId,
            packageIdRaw,
            finalPrice,
            normalizedPackage.price,
            appliedCouponId,
            appliedCouponCode,
            discountAmount,
            storedPurchaseType,
            trade_no
          )
          .run();

        if (!orderResult.success) {
          return errorResponse("创建购买订单失败", 500);
        }

        const { PaymentAPI } = await import("./pay/PaymentAPI");
        const paymentAPI = new PaymentAPI(this.env);
        const paymentData = (await paymentAPI.createPaymentDirect(
          trade_no,
          { payment_method },
          request
        )) as PaymentDirectResult;

        if (paymentData.code !== 0) {
          return errorResponse(paymentData.message || "创建支付订单失败", 500);
        }

        const payUrl = paymentData.data?.pay_url;
        if (!payUrl) {
          return errorResponse("支付订单创建失败，缺少支付链接", 500);
        }

        return successResponse(
          {
            trade_no,
            package_name: normalizedPackage.name,
            price: normalizedPackage.price,
            final_price: finalPrice,
            discount_amount: discountAmount,
            coupon_code: appliedCouponCode,
            purchase_type: storedPurchaseType,
            status: 0,
            status_text: "待支付",
            payment_url: payUrl,
          },
          "购买订单创建成功，请完成支付"
        );
      }
    } catch (error) {
      this.logger.error("购买套餐失败", error);
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(`购买套餐失败: ${message}`, 500);
    }
  }

  async previewCoupon(request: Request) {
    try {
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const body = (await request.json()) as {
        package_id?: number | string;
        coupon_code?: string;
      };
      const packageId = ensureNumber(body.package_id);
      const couponCode = ensureString(body.coupon_code ?? "").trim();

      if (!packageId || !couponCode) {
        return errorResponse("缺少套餐或优惠码信息", 400);
      }

      const packageInfo = await this.db.db
        .prepare("SELECT * FROM packages WHERE id = ? AND status = 1")
        .bind(packageId)
        .first<PackageRow>();

      if (!packageInfo) {
        return errorResponse("套餐不存在或已下架", 404);
      }

      const normalizedPackage = normalizePackageRow(packageInfo);
      const couponResult = await this.couponService.validateCouponForPurchase({
        code: couponCode,
        packageId,
        packagePrice: normalizedPackage.price,
        userId: ensureNumber(user.id),
      });

      return successResponse({
        original_price: normalizedPackage.price,
        final_price: couponResult.finalPrice,
        discount_amount: couponResult.discountAmount,
        coupon: {
          id: couponResult.coupon.id,
          name: couponResult.coupon.name,
          code: couponResult.coupon.code,
          discount_type: couponResult.coupon.discount_type,
          discount_value: couponResult.coupon.discount_value,
          start_at: couponResult.coupon.start_at,
          end_at: couponResult.coupon.end_at,
          max_usage: couponResult.coupon.max_usage,
          per_user_limit: couponResult.coupon.per_user_limit,
          total_used: couponResult.coupon.total_used,
        },
      }, "优惠码可用");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  }

  // 获取购买记录
  async getPurchaseRecords(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message, 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return errorResponse("用户信息异常", 500);
      }
      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1);
      const limit = Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "", 10) || 10);
      const offset = (page - 1) * limit;

      // 获取购买记录总数
      const totalResult = await this.db.db
        .prepare("SELECT COUNT(*) as total FROM package_purchase_records WHERE user_id = ?")
        .bind(userId)
        .first<{ total: number | string | null }>();

      const total = ensureNumber(totalResult?.total);

      // 获取购买记录列表
      const records = await this.db.db
        .prepare(`
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
            p.name as package_name,
            p.traffic_quota,
            p.validity_days,
            p.level
          FROM package_purchase_records ppr
          LEFT JOIN packages p ON ppr.package_id = p.id
          WHERE ppr.user_id = ?
          ORDER BY ppr.created_at DESC
          LIMIT ? OFFSET ?
        `)
        .bind(userId, limit, offset)
        .all<PurchaseRecordListRow>();

      // 状态映射
      const statusMap = {
        0: '待支付',
        1: '已支付',
        2: '已取消',
        3: '支付失败'
      };

      const formatPurchaseTypeText = (type: string | null) => {
        if (!type) return '未知';
        const normalized = type.toLowerCase();
        if (normalized === 'balance') return '余额支付';
        if (normalized === 'smart_topup') return '混合支付';
        if (normalized === 'direct') return '在线支付';
        if (normalized === 'alipay' || normalized === 'wxpay' || normalized === 'qqpay') return '在线支付';
        if (normalized === 'gift_card') return '礼品卡';
        if (normalized.startsWith('balance_')) return '混合支付';
        return type;
      };

      const formattedRecords = (records.results ?? []).map(record => {
        const price = ensureNumber(record.price);
        const packagePrice = record.package_price != null ? ensureNumber(record.package_price) : null;
        const discountAmount = record.discount_amount != null ? ensureNumber(record.discount_amount) : 0;
        const purchaseType = ensureString(record.purchase_type);
        const trafficQuota = record.traffic_quota != null ? ensureNumber(record.traffic_quota) : null;
        const finalPrice = packagePrice !== null
          ? fixMoneyPrecision(Math.max(packagePrice - discountAmount, 0))
          : price;
        const displayTradeNo =
          purchaseType === "gift_card" && record.trade_no
            ? record.trade_no.split("-")[0]
            : record.trade_no;
        return {
          ...record,
          trade_no: displayTradeNo,
          price,
          package_price: packagePrice,
          discount_amount: discountAmount,
          final_price: finalPrice,
          status_text: statusMap[record.status as keyof typeof statusMap] || '未知状态',
          purchase_type_text: formatPurchaseTypeText(purchaseType),
          traffic_quota_gb: trafficQuota
        };
      });

      return successResponse({
        records: formattedRecords,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      this.logger.error("获取购买记录失败", error);
      return errorResponse("获取购买记录失败", 500);
    }
  }

  // 套餐购买后更新用户数据的核心逻辑
  async updateUserAfterPackagePurchase(userId: number, packageInfo: NormalizedPackageRow) {
    try {
      // 获取用户当前详细信息
      const userInfo = await this.db.db
        .prepare(`
          SELECT
            class,
            class_expire_time,
            transfer_enable,
            transfer_total,
            speed_limit,
            device_limit
          FROM users
          WHERE id = ?
        `)
        .bind(userId)
        .first<UserRow>();

      if (!userInfo) {
        throw new Error("用户不存在");
      }

      const currentTime = new Date();
      const currentUserLevel = ensureNumber(userInfo.class);
      const packageLevel = packageInfo.level;

      // 添加详细的调试日志
      this.logger.info("套餐购买详细信息", {
        user_id: userId,
        current_user_level: currentUserLevel,
        current_user_level_type: typeof userInfo.class,
        current_user_level_raw: userInfo.class,
        package_level: packageLevel,
        package_level_type: typeof packageInfo.level,
        package_level_raw: packageInfo.level,
        comparison_equal: currentUserLevel === packageLevel,
        comparison_greater: packageLevel > currentUserLevel,
        comparison_less: packageLevel < currentUserLevel
      });

      let newExpireTime: string;
      let newTrafficQuota: number;
      let newSpeedLimit = packageInfo.speed_limit;
      let newDeviceLimit = packageInfo.device_limit;
      let newLevel = packageLevel;
      let shouldResetUsedTraffic = false;

      const currentTransferEnable = ensureNumber(userInfo.transfer_enable);

      // 套餐流量转换为字节
      const packageTrafficBytes = packageInfo.traffic_quota * 1024 * 1024 * 1024;

      // 判断套餐购买逻辑
      if (currentUserLevel === packageLevel) {
        // 同等级套餐：叠加流量和时间，速度和设备限制使用新套餐的
        this.logger.info("同等级套餐购买", {
          user_id: userId,
          current_level: currentUserLevel,
          package_level: packageLevel
        });

        // 计算新的过期时间（在现有基础上增加）
        if (userInfo.class_expire_time && new Date(userInfo.class_expire_time) > currentTime) {
          const currentExpire = new Date(userInfo.class_expire_time);
          currentExpire.setDate(currentExpire.getDate() + packageInfo.validity_days);
          newExpireTime = currentExpire.toISOString().replace('T', ' ').substr(0, 19);
        } else {
          // 如果已过期，从当前时间开始计算
          const expire = new Date(currentTime.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
          expire.setDate(expire.getDate() + packageInfo.validity_days);
          newExpireTime = expire.toISOString().replace('T', ' ').substr(0, 19);
        }

        // 叠加流量配额
        newTrafficQuota = currentTransferEnable + packageTrafficBytes;

      } else {
        // 不同等级套餐：重置为新套餐的配置，清空已使用流量
        this.logger.info("不同等级套餐购买", {
          user_id: userId,
          current_level: currentUserLevel,
          package_level: packageLevel,
          action: packageLevel > currentUserLevel ? "升级" : "降级"
        });

        // 重置为新套餐的流量配额
        newTrafficQuota = packageTrafficBytes;

        // 重置为新套餐的时间（从当前时间开始）
        const expire = new Date(currentTime.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
        expire.setDate(expire.getDate() + packageInfo.validity_days);
        newExpireTime = expire.toISOString().replace('T', ' ').substr(0, 19);

        // 需要清空已使用流量
        shouldResetUsedTraffic = true;
      }

      // 执行数据库更新
      let updateQuery: string;
      let updateParams: Array<number | string>;

      if (shouldResetUsedTraffic) {
        // 升级套餐：重置已使用流量
        updateQuery = `
          UPDATE users
          SET
            class = ?,
            class_expire_time = ?,
            transfer_enable = ?,
            transfer_total = 0,
            upload_traffic = 0,
            download_traffic = 0,
            upload_today = 0,
            download_today = 0,
            speed_limit = ?,
            device_limit = ?,
            updated_at = datetime('now', '+8 hours')
          WHERE id = ?
        `;
        updateParams = [newLevel, newExpireTime, newTrafficQuota, newSpeedLimit, newDeviceLimit, userId];
      } else {
        // 同等级或降级：不重置已使用流量
        updateQuery = `
          UPDATE users
          SET
            class = ?,
            class_expire_time = ?,
            transfer_enable = ?,
            speed_limit = ?,
            device_limit = ?,
            updated_at = datetime('now', '+8 hours')
          WHERE id = ?
        `;
        updateParams = [newLevel, newExpireTime, newTrafficQuota, newSpeedLimit, newDeviceLimit, userId];
      }

      const updateResult = toRunResult(
        await this.db.db
          .prepare(updateQuery)
          .bind(...updateParams)
          .run()
      );

      this.logger.info("用户套餐数据更新完成", {
        user_id: userId,
        old_level: currentUserLevel,
        new_level: newLevel,
        new_expire_time: newExpireTime,
        new_traffic_quota_gb: Math.round(newTrafficQuota / (1024 * 1024 * 1024)),
        speed_limit: newSpeedLimit,
        device_limit: newDeviceLimit,
        reset_used_traffic: shouldResetUsedTraffic
      });

      return {
        success: updateResult.success,
        newExpireTime,
        changes: getChanges(updateResult)
      };

    } catch (error) {
      this.logger.error("更新用户套餐数据失败", error);
      return { success: false, error: error.message };
    }
  }
}
