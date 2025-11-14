// src/api/pay/PaymentAPI.ts - 重构后的支付接口API

import type { Env } from "../../types";
import type { D1Database } from "@cloudflare/workers-types";
import { DatabaseService } from "../../services/database";
import { CouponService } from "../../services/couponService";
import { errorResponse, successResponse } from "../../utils/response";
import { getLogger, type Logger } from "../../utils/logger";
import { PaymentProviderFactory } from "./PaymentProviderFactory";
import type { PaymentProvider, PaymentCreateResult, PaymentParams } from "./types";
import { ensureNumber, ensureString, getChanges, toRunResult } from "../../utils/d1";

interface RechargeRecordRow {
  trade_no: string;
  status: number;
  user_id: number;
  amount?: number;
  price?: number;
  created_at?: string;
}

interface PurchaseRecordRow {
  id?: number;
  trade_no: string;
  status: number;
  user_id: number;
  package_id?: number;
  price?: number;
  amount?: number;
  package_price?: number;
  discount_amount?: number | string | null;
  coupon_id?: number | string | null;
  coupon_code?: string | null;
  purchase_type?: string;
  created_at?: string;
  paid_at?: string;
  expires_at?: string;
  package_name?: string;
}

interface UserBalanceRow {
  money?: number | string;
}

interface UserPackageInfoRow {
  class: number | string;
  class_expire_time?: string | null;
  transfer_enable: number;
  transfer_total: number;
  speed_limit?: number | null;
  device_limit?: number | null;
}

interface PackageInfoRow {
  id?: number;
  name?: string;
  level: number | string;
  traffic_quota: number;
  validity_days: number;
  speed_limit?: number | null;
  device_limit?: number | null;
}

interface OrderLookupResult {
  found: boolean;
  type?: "recharge" | "purchase";
  data?: RechargeRecordRow | PurchaseRecordRow;
}

export class PaymentAPI {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly dbRaw: D1Database;
  private readonly logger: Logger;
  private readonly currentProvider: string;
  private readonly paymentProvider: PaymentProvider | null;
  private readonly couponService: CouponService;

  constructor(env: Env) {
    this.env = env;
    this.dbRaw = env.DB as D1Database;
    this.db = new DatabaseService(this.dbRaw);
    this.couponService = new CouponService(this.dbRaw);
    this.logger = getLogger(env);

    this.currentProvider = ensureString(env.PAYMENT_PROVIDER) || "epay";

    try {
      this.paymentProvider = PaymentProviderFactory.createProvider(
        this.currentProvider,
        env
      );
    } catch (error) {
      this.logger.error("支付提供者初始化失败", error);
      this.paymentProvider = null;
    }
  }

  // 获取支付配置
  async getPaymentConfig() {
    try {
      const availableProviders = PaymentProviderFactory.getAvailableProviders(this.env);

      if (!this.paymentProvider || !this.paymentProvider.isConfigured()) {
        return successResponse({
          payment_methods: [],
          available_providers: availableProviders,
          current_provider: this.currentProvider,
          enabled: false,
          message: "支付功能未配置或配置不完整"
        });
      }

      const availableMethods =
        ensureString((this.env as Record<string, unknown>).EPAY_PAYMENT_METHODS) ||
        "alipay,wxpay";
      const paymentMethods = this.paymentProvider.getSupportedMethods(availableMethods);

      return successResponse({
        payment_methods: paymentMethods,
        available_providers: availableProviders,
        current_provider: this.currentProvider,
        enabled: true
      });
    } catch (error) {
      this.logger.error("获取支付配置失败", error);
      return errorResponse("获取支付配置失败", 500);
    }
  }

  // 直接创建支付订单（内部调用，无需HTTP请求）
  async createPaymentDirect(
    tradeNo: string,
    paymentParams: PaymentParams = {},
    request: Request | null = null
  ) {
    try {
      if (!this.paymentProvider) {
        return { code: 1, message: "支付服务未配置" };
      }

      if (!tradeNo) {
        return { code: 1, message: "缺少交易号" };
      }

      // 如果没有指定 return_url，尝试从请求头中提取前端地址
      if (!paymentParams.return_url && request) {
        const origin = request.headers.get('Origin') || request.headers.get('Referer');
        if (origin) {
          try {
            const url = new URL(origin);
            // 构建返回URL: 协议://域名:端口/user/wallet
            paymentParams.return_url = `${url.protocol}//${url.host}/user/wallet`;
            this.logger.info("自动提取支付返回URL", {
              origin,
              return_url: paymentParams.return_url
            });
          } catch (e) {
            this.logger.warn("解析前端地址失败", { origin, error: e.message });
          }
        }
      }

      // 查找交易记录（充值或购买）
      const orderInfo = await this.findOrderInfo(tradeNo);

      if (!orderInfo.found) {
        return { code: 1, message: "订单不存在或状态异常" };
      }

      // 创建支付订单，传递支付参数（如 payment_method, return_url）
      const orderPayload: Record<string, unknown> = orderInfo.data
        ? { ...(orderInfo.data as any) }
        : {};

      const result = await this.paymentProvider.createPayment(
        orderPayload,
        orderInfo.type ?? "recharge",
        paymentParams
      );

      if (result.success) {
        return { code: 0, data: result };
      } else {
        return { code: 1, message: result.error || result.message };
      }

    } catch (error) {
      this.logger.error("创建支付订单失败", error);
      const message = error instanceof Error ? error.message : String(error);
      return { code: 1, message };
    }
  }

  // 创建支付订单（HTTP接口，保持向后兼容）
  async createPayment(request) {
    try {
      if (!this.paymentProvider) {
        return errorResponse("支付服务未配置", 500);
      }

      const url = new URL(request.url);
      const tradeNo = ensureString(url.searchParams.get('trade_no'));

      if (!tradeNo) {
        return errorResponse("缺少交易号", 400);
      }

      // 查找交易记录（充值或购买）
      const orderInfo = await this.findOrderInfo(tradeNo);

      if (!orderInfo.found) {
        return errorResponse("订单不存在或状态异常", 404);
      }

      // 使用支付提供者创建支付订单
      const orderPayload: Record<string, unknown> = orderInfo.data
        ? { ...(orderInfo.data as any) }
        : {};

      const paymentResult = await this.paymentProvider.createPayment(
        orderPayload,
        orderInfo.type ?? "recharge"
      );

      return successResponse(paymentResult, "支付订单创建成功");

    } catch (error) {
      this.logger.error("创建支付订单失败", error);
      return errorResponse("创建支付订单失败", 500);
    }
  }

  // 支付回调处理
  async paymentCallback(request) {
    try {
      if (!this.paymentProvider) {
        return new Response('fail');
      }

      const body = await request.json();

      // 验证回调签名
      if (!(await this.paymentProvider.verifyCallback(body))) {
        return new Response('fail');
      }

      // 处理支付结果
      const callbackResult = this.paymentProvider.processCallback(body);

      if (callbackResult.success) {
        await this.processSuccessPayment(callbackResult.trade_no, callbackResult.amount);
        return new Response('success');
      } else {
        await this.processFailedPayment(callbackResult.trade_no);
        return new Response('fail');
      }

    } catch (error) {
      this.logger.error("支付回调处理失败", error);
      return new Response('fail');
    }
  }

  // 支付通知处理（GET/POST方式）
  async paymentNotify(request) {
    try {
      if (!this.paymentProvider) {
        return new Response('fail');
      }

      let params: Record<string, unknown> = {};

      if (request.method === 'GET') {
        // GET请求：从查询参数获取
        const url = new URL(request.url);
        for (const [key, value] of url.searchParams) {
          params[key] = value;
        }
      } else if (request.method === 'POST') {
        // POST请求：从JSON body获取
        params = await request.json();
      }

      // 验证必要参数
      const outTradeNo = ensureString(params.out_trade_no);
      const tradeStatus = ensureString(params.trade_status);
      const sign = ensureString(params.sign);

      if (!outTradeNo || !tradeStatus || !sign) {
        return new Response('fail');
      }

      // 验证回调签名
      if (!(await this.paymentProvider.verifyCallback(params))) {
        return new Response('fail');
      }

      // 处理支付结果
      const callbackResult = this.paymentProvider.processCallback(params);

      if (callbackResult.success) {
        await this.processSuccessPayment(
          callbackResult.trade_no,
          callbackResult.amount
        );
        return new Response('success');
      } else {
        await this.processFailedPayment(callbackResult.trade_no);
        return new Response('fail');
      }

    } catch (error) {
      this.logger.error("支付通知处理失败", error);
      return new Response('fail');
    }
  }

  // 查询支付状态
  async getPaymentStatus(request) {
    try {
      const url = new URL(request.url);
      const tradeNo = ensureString(url.pathname.split("/").pop());

      if (!tradeNo) {
        return errorResponse("缺少交易号", 400);
      }

      const orderInfo = await this.findOrderInfo(tradeNo);

      if (!orderInfo.found) {
        return errorResponse("订单不存在", 404);
      }

      const record = (orderInfo.data ?? {}) as Record<string, unknown>;
      const statusMap: Record<number, string> = {
        0: '待支付',
        1: '已支付',
        2: '已取消',
        3: '支付失败'
      };
      const statusValue = ensureNumber(record.status);

      return successResponse({
        trade_no: tradeNo,
        order_type: orderInfo.type,
        status: statusValue,
        status_text: statusMap[statusValue] ?? "未知状态",
        amount: ensureNumber(record.amount ?? record.price),
        created_at: ensureString(record.created_at),
      });

    } catch (error) {
      this.logger.error("查询支付状态失败", error);
      return errorResponse("查询支付状态失败", 500);
    }
  }

  // 查找订单信息
  async findOrderInfo(tradeNo: string): Promise<OrderLookupResult> {
    // 先查充值记录
    const rechargeRecord = await this.db.db
      .prepare("SELECT * FROM recharge_records WHERE trade_no = ?")
      .bind(tradeNo)
      .first<RechargeRecordRow>();

    if (rechargeRecord) {
      return {
        found: true,
        type: 'recharge',
        data: rechargeRecord
      };
    }

    // 再查购买记录
    const purchaseRecord = await this.db.db
      .prepare(`
        SELECT ppr.*, p.name as package_name
        FROM package_purchase_records ppr
        LEFT JOIN packages p ON ppr.package_id = p.id
        WHERE ppr.trade_no = ?
      `)
      .bind(tradeNo)
      .first<PurchaseRecordRow>();

    if (purchaseRecord) {
      return {
        found: true,
        type: 'purchase',
        data: purchaseRecord
      };
    }

    return { found: false };
  }

  // 处理支付成功
  async processSuccessPayment(tradeNo: string, amount: number) {
    try {
      const orderInfo = await this.findOrderInfo(tradeNo);

      if (!orderInfo.found || !orderInfo.data) {
        this.logger.error("支付成功但订单不存在", { trade_no: tradeNo });
        return;
      }

      if (orderInfo.type === 'recharge') {
        await this.processRechargeSuccess(orderInfo.data as RechargeRecordRow, amount);
      } else {
        await this.processPurchaseSuccess(orderInfo.data as PurchaseRecordRow, amount);
      }

    } catch (error) {
      this.logger.error("处理支付成功失败", error, { trade_no: tradeNo });
      throw error;
    }
  }

  // 处理充值成功
  async processRechargeSuccess(rechargeRecord: RechargeRecordRow, amount: number) {
    // 使用原子操作防止重复处理
    const updateResult = toRunResult(
      await this.db.db
      .prepare(`
        UPDATE recharge_records
        SET status = 1, paid_at = datetime('now', '+8 hours')
        WHERE trade_no = ? AND status = 0
      `)
      .bind(rechargeRecord.trade_no)
      .run()
    );

    // 如果没有更新任何行，说明订单已经被处理过了
    if (getChanges(updateResult) === 0) {
      this.logger.info("充值订单已处理或状态异常", {
        trade_no: rechargeRecord.trade_no,
        current_status: rechargeRecord.status,
        changes: getChanges(updateResult)
      });
      return;
    }

    // 更新用户余额
    const balanceUpdateResult = toRunResult(
      await this.db.db
      .prepare(`
        UPDATE users
        SET money = money + ?, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `)
      .bind(amount, rechargeRecord.user_id)
      .run()
    );

    if (getChanges(balanceUpdateResult) === 0) {
      this.logger.error("更新用户余额失败", {
        trade_no: rechargeRecord.trade_no,
        user_id: rechargeRecord.user_id,
        amount
      });
      // 这里可以考虑回滚充值状态，但通常记录错误即可
    }

    this.logger.info("充值成功", {
      trade_no: rechargeRecord.trade_no,
      user_id: rechargeRecord.user_id,
      amount,
      changes: getChanges(updateResult)
    });
  }

  // 处理购买成功
  async processPurchaseSuccess(purchaseRecord: PurchaseRecordRow, amount: number) {
    // 使用原子操作防止重复处理
    const updateResult = toRunResult(
      await this.db.db
      .prepare(`
        UPDATE package_purchase_records
        SET status = 1, paid_at = datetime('now', '+8 hours')
        WHERE trade_no = ? AND status = 0
      `)
      .bind(purchaseRecord.trade_no)
      .run()
    );

    // 如果没有更新任何行，说明订单已经被处理过了
    if (getChanges(updateResult) === 0) {
      this.logger.info("购买订单已处理或状态异常", {
        trade_no: purchaseRecord.trade_no,
        current_status: purchaseRecord.status,
        changes: getChanges(updateResult)
      });
      return;
    }

    // 如果是智能补差额支付，需要先扣除用户余额
    const paidAmount = ensureNumber(amount);
    const purchaseType = ensureString(purchaseRecord.purchase_type);

    const isHybridPayment = purchaseType === 'smart_topup' || purchaseType.startsWith('balance_');

    if (isHybridPayment) {
      // 获取用户当前余额
      const userInfo = await this.db.db
        .prepare("SELECT money FROM users WHERE id = ?")
        .bind(purchaseRecord.user_id)
        .first<UserBalanceRow>();

      const currentBalance = ensureNumber(userInfo?.money);

      if (currentBalance > 0) {
        // 计算需要扣除的余额（套餐价格 - 在线支付金额）
        const basePrice = ensureNumber(
          purchaseRecord.package_price ?? purchaseRecord.price ?? paidAmount
        );
        const discountAmount =
          purchaseRecord.discount_amount != null
            ? ensureNumber(purchaseRecord.discount_amount)
            : 0;
        const finalPrice = Math.max(basePrice - discountAmount, 0);
        const balanceToDeduct = Math.max(Number((finalPrice - paidAmount).toFixed(2)), 0);

        if (balanceToDeduct > 0 && currentBalance + 1e-6 >= balanceToDeduct) {
          // 扣除用户余额
          const balanceUpdateResult = toRunResult(
            await this.db.db
            .prepare(`
              UPDATE users
              SET money = money - ?, updated_at = datetime('now', '+8 hours')
              WHERE id = ? AND money >= ?
            `)
            .bind(balanceToDeduct, purchaseRecord.user_id, balanceToDeduct)
            .run()
          );

          if (getChanges(balanceUpdateResult) > 0) {
            this.logger.info("智能补差额支付：扣除用户余额", {
              trade_no: purchaseRecord.trade_no,
              user_id: purchaseRecord.user_id,
              balance_deducted: balanceToDeduct,
              online_payment: paidAmount,
              total_package_price: finalPrice
            });
          } else {
            this.logger.error("扣除用户余额失败", {
              trade_no: purchaseRecord.trade_no,
              user_id: purchaseRecord.user_id,
              balance_to_deduct: balanceToDeduct,
              user_balance: currentBalance
            });
          }
        }
      }
    }

    // 激活套餐
    try {
      await this.activatePackage(purchaseRecord);
      await this.handleCouponUsage(purchaseRecord);
    } catch (error) {
      this.logger.error("激活套餐失败", {
        trade_no: purchaseRecord.trade_no,
        user_id: purchaseRecord.user_id,
        package_id: purchaseRecord.package_id,
        error: error.message
      });
      // 套餐激活失败，但支付状态已更新，需要人工处理
    }

    this.logger.info("套餐购买成功", {
      trade_no: purchaseRecord.trade_no,
      user_id: purchaseRecord.user_id,
      package_id: purchaseRecord.package_id,
      purchase_type: purchaseRecord.purchase_type,
      amount,
      changes: getChanges(updateResult)
    });
  }

  // 处理支付失败
  async processFailedPayment(tradeNo: string) {
    try {
      // 更新充值记录状态
      await toRunResult(
        await this.db.db
          .prepare("UPDATE recharge_records SET status = 3 WHERE trade_no = ?")
          .bind(tradeNo)
          .run()
      );

      // 更新购买记录状态
      await toRunResult(
        await this.db.db
          .prepare("UPDATE package_purchase_records SET status = 3 WHERE trade_no = ?")
          .bind(tradeNo)
          .run()
      );

      this.logger.info("支付失败处理完成", { trade_no: tradeNo });

    } catch (error) {
      this.logger.error("处理支付失败失败", error, { trade_no: tradeNo });
      throw error;
    }
  }

  // 激活套餐
  async activatePackage(purchaseRecord) {
    try {
      const userId = purchaseRecord.user_id;

      // 获取套餐详细信息
      const packageInfo = await this.db.db
        .prepare("SELECT * FROM packages WHERE id = ?")
        .bind(purchaseRecord.package_id)
        .first<PackageInfoRow>();

      if (!packageInfo) {
        throw new Error(`套餐 ${purchaseRecord.package_id} 不存在`);
      }

      // 使用与 StoreAPI 相同的逻辑更新用户数据
      const result = await this.updateUserAfterPackagePurchase(userId, packageInfo);

      if (!result.success) {
        throw new Error(result.error || "更新用户套餐数据失败");
      }

      this.logger.info("套餐激活成功", {
        user_id: userId,
        package_id: purchaseRecord.package_id,
        new_expire_time: result.newExpireTime
      });

    } catch (error) {
      this.logger.error("激活套餐失败", error);
      throw error;
    }
  }

  private async handleCouponUsage(purchaseRecord: PurchaseRecordRow) {
    const couponIdRaw = purchaseRecord.coupon_id;
    if (couponIdRaw === null || couponIdRaw === undefined) {
      return;
    }

    const couponId = ensureNumber(couponIdRaw);
    if (!couponId) {
      return;
    }

    try {
      const consumeResult = await this.couponService.consumeCouponUsage(
        couponId,
        purchaseRecord.user_id,
        ensureNumber(purchaseRecord.id ?? 0),
        ensureString(purchaseRecord.trade_no)
      );

      if (!consumeResult.success) {
        this.logger.error("优惠码使用计数失败", {
          coupon_id: couponId,
          trade_no: purchaseRecord.trade_no,
          message: consumeResult.message
        });
      }
    } catch (error) {
      this.logger.error("优惠码扣减失败", {
        coupon_id: couponId,
        trade_no: purchaseRecord.trade_no,
        error: (error as Error).message
      });
    }
  }

  // 套餐购买后更新用户数据的核心逻辑（与 StoreAPI 保持一致）
  async updateUserAfterPackagePurchase(userId: number, packageInfo: PackageInfoRow) {
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
        .first<UserPackageInfoRow>();

      if (!userInfo) {
        throw new Error("用户不存在");
      }

      const currentTime = new Date();
      const currentUserLevel = ensureNumber(userInfo.class);
      const packageLevel = ensureNumber(packageInfo.level);
      const classExpireRaw = ensureString(userInfo.class_expire_time);
      const currentTransferEnable = ensureNumber(userInfo.transfer_enable);
      const currentTransferTotal = ensureNumber(userInfo.transfer_total);

      // 添加详细的调试日志
      this.logger.info("套餐激活详细信息", {
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
      const newSpeedLimit = ensureNumber(packageInfo.speed_limit);
      const newDeviceLimit = ensureNumber(packageInfo.device_limit);
      let newLevel = packageLevel;
      let shouldResetUsedTraffic = false;

      // 套餐流量转换为字节
      const packageTrafficBytes = ensureNumber(packageInfo.traffic_quota) * 1024 * 1024 * 1024;

      // 判断套餐购买逻辑
      const validityDays = ensureNumber(packageInfo.validity_days, 30);

      if (currentUserLevel === packageLevel) {
        // 同等级套餐：叠加流量和时间，速度和设备限制使用新套餐的
        this.logger.info("同等级套餐购买", {
          user_id: userId,
          current_level: currentUserLevel,
          package_level: packageLevel
        });

        // 计算新的过期时间（在现有基础上增加）
        if (classExpireRaw && new Date(classExpireRaw) > currentTime) {
          const currentExpire = new Date(classExpireRaw);
          currentExpire.setDate(currentExpire.getDate() + validityDays);
          newExpireTime = currentExpire.toISOString().replace('T', ' ').substr(0, 19);
        } else {
          // 如果已过期，从当前时间开始计算
          const expire = new Date(currentTime.getTime() + 8 * 60 * 60 * 1000);
          expire.setDate(expire.getDate() + validityDays);
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
        const expire = new Date(currentTime.getTime() + 8 * 60 * 60 * 1000);
        expire.setDate(expire.getDate() + validityDays);
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
        updateParams = [
          newLevel,
          newExpireTime,
          newTrafficQuota,
          newSpeedLimit,
          newDeviceLimit,
          userId,
        ];
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
        updateParams = [
          newLevel,
          newExpireTime,
          newTrafficQuota,
          newSpeedLimit,
          newDeviceLimit,
          userId,
        ];
      }

      const updateResult = toRunResult(
        await this.db.db
          .prepare(updateQuery)
          .bind(...updateParams)
          .run()
      );
      const changes = getChanges(updateResult);

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
        success: changes > 0,
        newExpireTime,
        changes,
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error("更新用户套餐数据失败", err);
      return { success: false, error: err.message };
    }
  }
}
