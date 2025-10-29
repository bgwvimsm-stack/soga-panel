// src/api/wallet.js - 钱包相关API

import type { Env } from "../types";
import type { Logger } from "../utils/logger";
import type { SystemConfigManager } from "../utils/systemConfig";
import type { PaymentProvider } from "./pay/types";
import { DatabaseService } from "../services/database";
import { validateUserAuth } from "../middleware/auth";
import { errorResponse, successResponse } from "../utils/response";
import { getLogger } from "../utils/logger";
import { createSystemConfigManager } from "../utils/systemConfig";
import { PaymentProviderFactory } from "./pay/PaymentProviderFactory";
import { ensureNumber, ensureString } from "../utils/d1";

type AuthenticatedUser = {
  id: number;
  email?: string | null;
  is_admin?: boolean;
  [key: string]: unknown;
};

type MoneyRow = {
  money: number | string | null;
};

type CountRow = {
  total: number | string | null;
};

type RechargeRecordRow = {
  id: number;
  amount: number | string;
  payment_method: string | null;
  trade_no: string;
  status: number;
  created_at: string;
  paid_at: string | null;
};

type RechargeRecordResult = {
  records: RechargeRecordRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

type CreateRechargeBody = {
  amount: number;
  payment_method?: string;
};

type RechargeRecordFullRow = {
  amount: number | string;
  payment_method: string | null;
  trade_no: string;
  status: number;
  created_at: string;
  paid_at?: string | null;
};

type PaymentResult = {
  code?: number;
  message?: string;
  pay_url?: string;
};

type PaymentProviderResult = {
  success: boolean;
  trade_no: string;
  amount: number;
  status: string;
  [key: string]: unknown;
};

type RechargeRecordEntity = {
  id: number;
  user_id: number;
  amount: number;
  status: number;
  trade_no: string;
  package_price?: number;
  purchase_type?: string | null;
};

type UserBalanceRow = {
  money: number | string;
  class: number | string;
  class_expire_time: string | null;
};

type PackageRow = {
  id: number;
  name: string;
  price: number | string;
  level: number | string;
  validity_days: number | string;
  traffic_quota: number | string;
  speed_limit: number | string;
  device_limit: number | string;
};

type PurchaseRecordRow = {
  trade_no: string;
  package_id: number;
  status: number;
  package_price?: number | string | null;
  purchase_type?: string | null;
};

type WalletStatsRow = {
  money?: number | string | null;
};

type RechargeStatsRow = {
  total_recharges: number | string | null;
  total_recharged: number | string | null;
  pending_amount: number | string | null;
};

type PurchaseStatsRow = {
  total_purchases: number | string | null;
  total_spent: number | string | null;
};

export class WalletAPI {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly logger: Logger;
  private readonly configManager: SystemConfigManager;
  private readonly paymentProvider: PaymentProvider | null;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.logger = getLogger(env);
    this.configManager = createSystemConfigManager(env);

    let provider: PaymentProvider | null = null;
    try {
      const providerType = (this.env.PAYMENT_PROVIDER as string) || "epay";
      provider = PaymentProviderFactory.createProvider(providerType, this.env);
    } catch (error) {
      this.logger.error("初始化支付提供者失败", error);
    }
    this.paymentProvider = provider;
  }

  // 获取用户余额
  async getMoney(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message || "用户认证失败", 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return errorResponse("用户信息异常", 500);
      }

      // 获取用户余额
      const userInfo = await this.db.db
        .prepare("SELECT money FROM users WHERE id = ?")
        .bind(userId)
        .first<MoneyRow>();

      if (!userInfo) {
        return errorResponse("用户不存在", 404);
      }

      return successResponse({
        money: ensureNumber(userInfo.money, 0)
      });
    } catch (error) {
      this.logger.error("获取用户余额失败", error);
      return errorResponse("获取余额失败", 500);
    }
  }

  // 获取充值记录
  async getRechargeRecords(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message || "用户认证失败", 401);
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

      // 获取充值记录总数
      const totalResult = await this.db.db
        .prepare("SELECT COUNT(*) as total FROM recharge_records WHERE user_id = ?")
        .bind(userId)
        .first<CountRow>();

      const total = ensureNumber(totalResult?.total);

      // 获取充值记录列表
      const recordsResult = await this.db.db
        .prepare(`
          SELECT
            id,
            amount,
            payment_method,
            trade_no,
            status,
            created_at,
            paid_at
          FROM recharge_records
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `)
        .bind(userId, limit, offset)
        .all<RechargeRecordRow>();

      // 状态映射
      const statusMap = {
        0: '待支付',
        1: '已支付',
        2: '已取消',
        3: '支付失败'
      };

      const formattedRecords = (recordsResult.results ?? []).map((record) => ({
        ...record,
        amount: ensureNumber(record.amount),
        status_text: statusMap[record.status as keyof typeof statusMap] || '未知状态'
      }));

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
      this.logger.error("获取充值记录失败", error);
      return errorResponse("获取充值记录失败", 500);
    }
  }

  // 创建充值订单
  async createRecharge(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message || "用户认证失败", 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return errorResponse("用户信息异常", 500);
      }

      const body = (await request.json()) as CreateRechargeBody;
      const amount = ensureNumber(body.amount);
      const payment_method = ensureString(body.payment_method ?? 'alipay') || 'alipay';

      // 验证充值金额
      if (amount <= 0) {
        return errorResponse("充值金额必须大于0", 400);
      }

      if (amount > 10000) {
        return errorResponse("单次充值金额不能超过10000元", 400);
      }

      // 生成交易号 - 简化格式：R + 时间戳后8位 + 4位随机字符
      const trade_no = `R${Date.now().toString().slice(-8)}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      // 创建充值记录
      const insertResult = await this.db.db
        .prepare(`
          INSERT INTO recharge_records (user_id, amount, payment_method, trade_no, status)
          VALUES (?, ?, ?, ?, 0)
        `)
        .bind(userId, amount, payment_method, trade_no)
        .run();

      if (!insertResult.success) {
        return errorResponse("创建充值订单失败", 500);
      }

      this.logger.info(`用户 ${user.email ?? "unknown"} 创建充值订单`, {
        user_id: userId,
        amount,
        payment_method,
        trade_no
      });

      if (!this.paymentProvider || !this.paymentProvider.isConfigured()) {
        this.logger.error("支付提供者未正确配置", { provider: this.env.PAYMENT_PROVIDER });
        // 删除充值记录
        await this.db.db
          .prepare("DELETE FROM recharge_records WHERE trade_no = ?")
          .bind(trade_no)
          .run();
        return errorResponse("支付通道配置异常，请联系管理员", 500);
      }

      let returnUrl = ensureString(this.env.EPAY_RETURN_URL, "").trim();

      if (!returnUrl) {
        const originHeader = request.headers.get('Origin') || request.headers.get('Referer');
        if (originHeader) {
          try {
            const originUrl = new URL(originHeader);
            returnUrl = `${originUrl.protocol}//${originUrl.host}/user/wallet`;
          } catch (e) {
            this.logger.warn("解析请求来源失败，无法生成返回地址", {
              origin: originHeader,
              error: e.message
            });
          }
        }
      }

      if (!returnUrl && this.env.SITE_URL) {
        try {
          const siteUrl = new URL(ensureString(this.env.SITE_URL));
          returnUrl = `${siteUrl.protocol}//${siteUrl.host}/user/wallet`;
        } catch (e) {
          this.logger.warn("解析SITE_URL失败，无法生成返回地址", {
            site_url: this.env.SITE_URL,
            error: e.message
          });
        }
      }

      const paymentParams = {
        payment_method,
        ...(returnUrl ? { return_url: returnUrl } : {})
      };

      const paymentResult = await this.paymentProvider.createPayment(
        {
          trade_no,
          amount,
          user_id: userId,
          user_email: user.email
        },
        'recharge',
        paymentParams
      ) as PaymentResult & { success?: boolean };

      if (!paymentResult?.success) {
        this.logger.error("支付订单创建失败", {
          user_id: userId,
          trade_no,
          amount,
          payment_method,
          error: paymentResult?.message
        });

        // 如果支付订单创建失败，删除充值记录
        await this.db.db
          .prepare("DELETE FROM recharge_records WHERE trade_no = ?")
          .bind(trade_no)
          .run();

        const msg = paymentResult?.message ?? "未知错误";
        return errorResponse(`创建支付订单失败: ${msg}`, 500);
      }

      return successResponse(
        {
          trade_no,
          amount,
          payment_method,
          status: 0,
          status_text: '待支付',
          payment_url: paymentResult.pay_url,
          pay_url: paymentResult.pay_url,
          created_at: new Date().toISOString()
        },
        "充值订单创建成功"
      );
    } catch (error) {
      this.logger.error("创建充值订单失败", error);
      return errorResponse("创建充值订单失败", 500);
    }
  }

  // 充值回调处理
  async rechargeCallback(request: Request) {
    try {
      // 易支付使用GET请求发送回调
      const url = new URL(request.url);
      const params: Record<string, string> = {};

      // 获取所有查询参数
      for (const [key, value] of url.searchParams) {
        params[key] = value;
      }

      this.logger.info("收到易支付回调", { params });

      const outTradeNo = params["out_trade_no"];
      const tradeStatus = params["trade_status"];

      if (!outTradeNo || !tradeStatus) {
        return errorResponse("缺少必要参数", 400);
      }

      if (!this.paymentProvider || !this.paymentProvider.isConfigured()) {
        this.logger.error("支付提供者未配置，无法验证回调");
        return new Response('fail');
      }

      const verified = await this.paymentProvider.verifyCallback(params);
      if (!verified) {
        this.logger.warn("易支付回调签名验证失败", { out_trade_no: outTradeNo });
        return new Response('fail');
      }

      const callbackResult = this.paymentProvider.processCallback(params) as PaymentProviderResult;

      // 查找充值记录
      const rechargeRecord = await this.db.db
        .prepare("SELECT * FROM recharge_records WHERE trade_no = ?")
        .bind(outTradeNo)
        .first<RechargeRecordEntity>();

      if (!rechargeRecord) {
        this.logger.error("充值记录不存在", { out_trade_no: outTradeNo });
        return new Response('fail');
      }

      if (rechargeRecord.status === 1) {
        this.logger.info("订单已处理", { out_trade_no: outTradeNo });
        return new Response('success');
      }

      // 更新充值记录状态
      const newStatus = callbackResult.success ? 1 : 3; // 1-已支付，3-支付失败
      const updateResult = await this.db.db
        .prepare(`
          UPDATE recharge_records
          SET status = ?, paid_at = datetime('now', '+8 hours')
          WHERE trade_no = ?
        `)
        .bind(newStatus, outTradeNo)
        .run();

      if (!updateResult.success) {
        return errorResponse("更新充值状态失败", 500);
      }

      // 如果支付成功，更新用户余额
      if (newStatus === 1) {
        const updateBalanceResult = await this.db.db
          .prepare(`
            UPDATE users
            SET money = money + ?, updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `)
          .bind(rechargeRecord.amount, rechargeRecord.user_id)
          .run();

        if (!updateBalanceResult.success) {
          this.logger.error("更新用户余额失败", {
            out_trade_no: outTradeNo,
            user_id: rechargeRecord.user_id,
            amount: rechargeRecord.amount
          });
          return new Response('fail');
        }

        // 检查是否为智能补差额的套餐购买
        if (outTradeNo.startsWith('purchase_')) {
          const purchaseRecord = await this.db.db
            .prepare("SELECT * FROM package_purchase_records WHERE trade_no = ? AND status = 0")
            .bind(outTradeNo)
            .first<PurchaseRecordRow>();

          if (!purchaseRecord) {
            this.logger.warn("未找到对应的套餐购买记录", { out_trade_no: outTradeNo });
          } else {
            const purchaseType = ensureString(purchaseRecord.purchase_type);
            if (purchaseType === 'smart_topup' || purchaseType.startsWith('balance_')) {
              const packageInfo = await this.db.db
                .prepare("SELECT * FROM packages WHERE id = ?")
                .bind(purchaseRecord.package_id)
                .first<PackageRow>();

              if (!packageInfo) {
                this.logger.warn("套餐信息不存在", { package_id: purchaseRecord.package_id });
              } else {
                const userInfo = await this.db.db
                  .prepare("SELECT money, class, class_expire_time FROM users WHERE id = ?")
                  .bind(rechargeRecord.user_id)
                  .first<UserBalanceRow>();

                if (!userInfo) {
                  this.logger.warn("用户信息不存在，无法完成套餐扣款", { user_id: rechargeRecord.user_id });
                } else {
                  const packagePrice = ensureNumber(purchaseRecord.package_price ?? packageInfo.price);
                  const userMoney = ensureNumber(userInfo.money);

                  if (userMoney >= packagePrice) {
                    const deductResult = await this.db.db
                      .prepare(`
                      UPDATE users
                      SET money = money - ?, updated_at = datetime('now', '+8 hours')
                      WHERE id = ?
                    `)
                      .bind(packagePrice, rechargeRecord.user_id)
                      .run();

                    if (deductResult.success) {
                      const currentTime = new Date();
                      const packageValidity = ensureNumber(packageInfo.validity_days);

                      let newExpireTime: string;
                      if (userInfo.class_expire_time && new Date(userInfo.class_expire_time) > currentTime) {
                        const currentExpire = new Date(userInfo.class_expire_time);
                        currentExpire.setDate(currentExpire.getDate() + packageValidity);
                        newExpireTime = currentExpire.toISOString().replace('T', ' ').substring(0, 19);
                      } else {
                        const expire = new Date(currentTime.getTime() + 8 * 60 * 60 * 1000); // UTC+8
                        expire.setDate(expire.getDate() + packageValidity);
                        newExpireTime = expire.toISOString().replace('T', ' ').substring(0, 19);
                      }

                      const trafficQuotaBytes = ensureNumber(packageInfo.traffic_quota) * 1024 * 1024 * 1024;

                      const updateUserResult = await this.db.db
                        .prepare(`
                        UPDATE users
                        SET
                          class = ?,
                          class_expire_time = ?,
                          transfer_enable = transfer_enable + ?,
                          speed_limit = ?,
                          device_limit = ?,
                          updated_at = datetime('now', '+8 hours')
                        WHERE id = ?
                      `)
                        .bind(
                          ensureNumber(packageInfo.level),
                          newExpireTime,
                          trafficQuotaBytes,
                          ensureNumber(packageInfo.speed_limit),
                          ensureNumber(packageInfo.device_limit),
                          rechargeRecord.user_id
                        )
                        .run();

                      if (updateUserResult.success) {
                        await this.db.db
                          .prepare(`
                          UPDATE package_purchase_records
                          SET status = 1
                          WHERE trade_no = ?
                        `)
                          .bind(outTradeNo)
                          .run();

                        this.logger.info("智能补差额套餐购买成功", {
                          out_trade_no: outTradeNo,
                          user_id: rechargeRecord.user_id,
                          package_id: purchaseRecord.package_id,
                          package_name: packageInfo.name,
                          topup_amount: rechargeRecord.amount,
                          package_price: packagePrice
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }

        this.logger.info("充值成功", {
          out_trade_no: outTradeNo,
          user_id: rechargeRecord.user_id,
          amount: rechargeRecord.amount
        });
      }

      this.logger.info("易支付回调处理完成", {
        out_trade_no: outTradeNo,
        status: newStatus,
        trade_status: tradeStatus
      });

      // 易支付要求返回success或fail
      return new Response(newStatus === 1 ? 'success' : 'fail');
    } catch (error) {
      this.logger.error("充值回调处理失败", error);
      return new Response('fail');
    }
  }

  // 获取钱包统计信息
  async getWalletStats(request: Request) {
    try {
      // 验证用户身份
      const authResult = await validateUserAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message || "用户认证失败", 401);
      }

      const user = authResult.user as AuthenticatedUser;
      const userId = ensureNumber(user.id);
      if (userId <= 0) {
        return errorResponse("用户信息异常", 500);
      }

      // 获取用户当前余额
      const userInfo = await this.db.db
        .prepare("SELECT money FROM users WHERE id = ?")
        .bind(userId)
        .first<WalletStatsRow>();

      // 获取充值统计
      const rechargeStats = await this.db.db
        .prepare(`
          SELECT
            COUNT(*) as total_recharges,
            COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as total_recharged,
            COALESCE(SUM(CASE WHEN status = 0 THEN amount ELSE 0 END), 0) as pending_amount
          FROM recharge_records
          WHERE user_id = ?
        `)
        .bind(userId)
        .first<RechargeStatsRow>();

      // 获取套餐购买统计
      const purchaseStats = await this.db.db
        .prepare(`
          SELECT
            COUNT(*) as total_purchases,
            COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) as total_spent
          FROM package_purchase_records
          WHERE user_id = ?
        `)
        .bind(userId)
        .first<PurchaseStatsRow>();

      return successResponse({
        current_balance: ensureNumber(userInfo?.money, 0),
        total_recharged: ensureNumber(rechargeStats?.total_recharged, 0),
        total_spent: ensureNumber(purchaseStats?.total_spent, 0),
        pending_recharge: ensureNumber(rechargeStats?.pending_amount, 0),
        total_recharge_count: ensureNumber(rechargeStats?.total_recharges, 0),
        total_purchase_count: ensureNumber(purchaseStats?.total_purchases, 0)
      });
    } catch (error) {
      this.logger.error("获取钱包统计失败", error);
      return errorResponse("获取钱包统计失败", 500);
    }
  }
}
