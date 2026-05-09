// src/api/pay/epay/EpayProvider.ts - 易支付提供者实现

import type { Env } from "../../../types";
import { getLogger, type Logger } from "../../../utils/logger";
import {
  createSystemConfigManager,
  type SystemConfigManager,
} from "../../../utils/systemConfig";
import { ensureNumber, ensureString } from "../../../utils/d1";

interface EpayRuntimeConfig {
  pid: string;
  key: string;
  apiUrl: string;
  notifyUrl: string;
  returnUrl: string;
  paymentMode: "redirect" | "api";
}

import type { PaymentParams } from "../types";

interface CallbackParams {
  pid?: string;
  trade_no?: string;
  out_trade_no?: string;
  type?: string;
  name?: string;
  money?: string;
  trade_status?: string;
  sign?: string;
  [key: string]: unknown;
}

interface ApiResult {
  code: number;
  msg: string;
  trade_no?: string;
  payurl?: string;
  qrcode?: string;
  urlscheme?: string;
}

export class EpayProvider {
  private readonly config: EpayRuntimeConfig;
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly configManager: SystemConfigManager;

  constructor(env: Env) {
    this.env = env;
    this.config = {
      pid: ensureString(env.EPAY_PID),
      key: ensureString(env.EPAY_KEY),
      apiUrl: ensureString(env.EPAY_API_URL) || "https://pay.example.com",
      notifyUrl: ensureString(env.EPAY_NOTIFY_URL),
      returnUrl: ensureString(env.EPAY_RETURN_URL),
      paymentMode: (ensureString(env.EPAY_PAYMENT_MODE).toLowerCase() as "redirect" | "api") || "redirect",
    };

    this.logger = getLogger(env);
    this.configManager = createSystemConfigManager(env);
  }

  // 检查配置是否完整
  isConfigured(): boolean {
    return (
      this.config.pid.length > 0 &&
      this.config.key.length > 0 &&
      this.config.apiUrl.length > 0
    );
  }

  // 获取支持的支付方式
  getSupportedMethods(availableMethods = "alipay,wxpay") {
    const methods = availableMethods.split(",").map((method) => method.trim());
    const paymentMethods: Array<{ value: string; label: string; icon: string }> = [];

    for (const method of methods) {
      switch (method) {
        case "alipay":
          paymentMethods.push({
            value: "alipay",
            label: "支付宝",
            icon: "CreditCard",
          });
          break;
        case "wxpay":
        case "wechat":
          paymentMethods.push({
            value: "wechat",
            label: "微信支付",
            icon: "Money",
          });
          break;
        case "qqpay":
          paymentMethods.push({
            value: "qqpay",
            label: "QQ支付",
            icon: "ChatLineSquare",
          });
          break;
        default:
          break;
      }
    }

    return paymentMethods;
  }

  // 生成MD5签名（Cloudflare Workers 提供 `crypto.subtle`）
  async generateSign(
    params: Record<string, unknown>,
    key: string
  ): Promise<string> {
    const sortedKeys = Object.keys(params).sort();
    const signStr =
      sortedKeys
        .filter(k => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] !== null && params[k] !== undefined)
        .map((k) => `${k}=${params[k]}`)
        .join("&") + key;

    const encoder = new TextEncoder();
    const data = encoder.encode(signStr);
    const hashBuffer = await crypto.subtle.digest("MD5", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // 创建支付订单
  async createPayment(
    orderInfo: Record<string, unknown>,
    orderType = "recharge",
    paymentParams: PaymentParams = {}
  ) {
    const info = orderInfo as Record<string, unknown>;
    const tradeNo = ensureString(info.trade_no);
    const orderAmount = ensureNumber(info.amount ?? info.price, 0);
    const packageName = ensureString(info.package_name);

    if (!tradeNo) {
      throw new Error("缺少订单编号");
    }

    const paymentMethodMap: Record<string, string> = {
      alipay: "alipay",
      wechat: "wxpay",
      wxpay: "wxpay",
      qqpay: "qqpay",
    };

    const methodKey = ensureString(paymentParams.payment_method).toLowerCase();
    const paymentType = paymentMethodMap[methodKey] || "alipay";
    const returnUrl =
      ensureString(paymentParams.return_url) || this.config.returnUrl;

    const amountValue = orderAmount;

    const payParams: Record<string, any> = {
      pid: this.config.pid,
      type: paymentType,
      out_trade_no: tradeNo,
      notify_url: this.config.notifyUrl,
      return_url: returnUrl,
      name:
        orderType === "recharge"
          ? "账户充值"
          : `套餐购买-${packageName}`,
      money: amountValue.toString(),
      clientip: paymentParams.clientip || "127.0.0.1",
      sitename: await this.configManager.getSystemConfig(
        "site_name",
        ensureString(this.env.SITE_NAME) || "Soga面板"
      ),
    };

    payParams.sign = await this.generateSign(payParams, this.config.key);
    payParams.sign_type = "MD5";

    try {
      if (this.config.paymentMode === "api") {
        const apiUrl = `${this.config.apiUrl.replace(/\/$/, "")}/mapi.php`;
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(payParams).toString(),
        });

        const text = await response.text();
        let data: ApiResult;
        try {
          data = JSON.parse(text) as ApiResult;
        } catch (e) {
          this.logger.error("易支付 API 响应解析失败", { text });
          return {
            success: false,
            trade_no: tradeNo,
            error: "支付接口响应解析失败",
            amount: amountValue,
            order_type: orderType,
          };
        }

        if (data.code === 1) {
          return {
            success: true,
            trade_no: tradeNo,
            pay_url: data.payurl || data.qrcode || data.urlscheme,
            type: data.payurl ? "url" : data.qrcode ? "qrcode" : "scheme",
            amount: amountValue,
            order_type: orderType,
            status: "pending",
          };
        } else {
          return {
            success: false,
            trade_no: tradeNo,
            error: data.msg || "支付发起失败",
            amount: amountValue,
            order_type: orderType,
          };
        }
      }

      const payUrl = `${this.config.apiUrl.replace(/\/$/, "")}/submit.php?${new URLSearchParams(
        payParams
      ).toString()}`;

      this.logger.info("易支付订单创建", {
        trade_no: tradeNo,
        order_type: orderType,
        amount: amountValue,
      });

      return {
        success: true,
        trade_no: tradeNo,
        pay_url: payUrl,
        amount: amountValue,
        order_type: orderType,
        status: "pending",
      };
    } catch (error) {
      this.logger.error("易支付订单创建异常", error);
      return {
        success: false,
        trade_no: tradeNo,
        error: "系统繁忙，请稍后再试",
        amount: amountValue,
        order_type: orderType,
      };
    }
  }

  // 验证回调签名
  async verifyCallback(params: CallbackParams): Promise<boolean> {
    const signParams: Record<string, string | undefined> = {
      pid: ensureString(params.pid),
      trade_no: ensureString(params.trade_no),
      out_trade_no: ensureString(params.out_trade_no),
      type: ensureString(params.type),
      name: ensureString(params.name),
      money: ensureString(params.money),
      trade_status: ensureString(params.trade_status),
    };

    const expectedSign = await this.generateSign(signParams, this.config.key);

    if (ensureString(params.sign) !== expectedSign) {
      this.logger.warn("易支付回调签名验证失败", {
        trade_no: params.out_trade_no,
      });
      return false;
    }

    return true;
  }

  // 处理支付回调
  processCallback(params: CallbackParams) {
    const status = ensureString(params.trade_status);
    const amountValue = ensureNumber(params.money);

    return {
      success: status === "TRADE_SUCCESS",
      trade_no: ensureString(params.out_trade_no),
      amount: amountValue,
      status,
    };
  }
}
