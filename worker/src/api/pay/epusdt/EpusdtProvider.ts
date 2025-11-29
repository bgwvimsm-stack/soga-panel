import type { Env } from "../../../types";
import { ensureNumber, ensureString } from "../../../utils/d1";
import { getLogger, type Logger } from "../../../utils/logger";
import {
  createSystemConfigManager,
  type SystemConfigManager,
} from "../../../utils/systemConfig";
import type { PaymentParams, PaymentProvider, PaymentCreateResult, PaymentMethodOption } from "../types";

type EpusdtTradeType = string;

interface EpusdtRuntimeConfig {
  apiUrl: string;
  token: string;
  notifyUrl: string;
  returnUrl: string;
  tradeType: EpusdtTradeType;
  timeout: number;
}

interface CreateOrderPayload {
  address?: string;
  trade_type?: EpusdtTradeType;
  order_id: string;
  amount: number;
  signature?: string;
  notify_url: string;
  redirect_url?: string;
  timeout?: number;
  rate?: number | string;
}

interface CreateOrderResponse {
  status_code: number;
  message?: string;
  data?: {
    trade_id?: string;
    order_id?: string;
    amount?: string;
    actual_amount?: string;
    token?: string;
    expiration_time?: number;
    payment_url?: string;
  };
  request_id?: string;
}

interface CallbackPayload {
  trade_id?: string;
  order_id?: string;
  amount?: number | string;
  actual_amount?: number | string;
  token?: string;
  block_transaction_id?: string;
  signature?: string;
  status?: number | string;
  [key: string]: unknown;
}

export class EpusdtProvider implements PaymentProvider {
  private readonly config: EpusdtRuntimeConfig;
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly configManager: SystemConfigManager;

  constructor(env: Env) {
    this.env = env;
    this.config = {
      apiUrl: ensureString(env.EPUSDT_API_URL),
      token: ensureString(env.EPUSDT_TOKEN),
      notifyUrl: ensureString(env.EPUSDT_NOTIFY_URL),
      returnUrl: ensureString(env.EPUSDT_RETURN_URL),
      tradeType: ensureString(env.EPUSDT_TRADE_TYPE) || "usdt.trc20",
      timeout: Math.max(60, ensureNumber(env.EPUSDT_TIMEOUT, 600)),
    };
    this.logger = getLogger(env);
    this.configManager = createSystemConfigManager(env);
  }

  isConfigured(): boolean {
    return (
      this.config.apiUrl.length > 0 &&
      this.config.token.length > 0 &&
      this.config.notifyUrl.length > 0
    );
  }

  getSupportedMethods(availableMethods = "crypto"): PaymentMethodOption[] {
    const methods = availableMethods.split(",").map((item) => item.trim().toLowerCase());
    if (!methods.includes("crypto")) {
      return [];
    }
    return [
      {
        value: "crypto",
        label: "USDT",
        icon: "Wallet",
      },
    ];
  }

  private async generateSign(params: Record<string, unknown>): Promise<string> {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === "signature") continue;
      if (value === null || value === undefined || value === "") continue;
      filtered[key] = value;
    }
    const sortedKeys = Object.keys(filtered).sort();
    const baseStr = sortedKeys.map((k) => `${k}=${filtered[k]}`).join("&");
    const signStr = `${baseStr}${this.config.token}`;

    const encoder = new TextEncoder();
    const data = encoder.encode(signStr);
    const hashBuffer = await crypto.subtle.digest("MD5", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async createPayment(
    orderInfo: Record<string, unknown>,
    orderType = "recharge",
    paymentParams: PaymentParams = {}
  ): Promise<PaymentCreateResult> {
    const tradeNo = ensureString(orderInfo.trade_no);
    const amount = ensureNumber(orderInfo.amount ?? orderInfo.price, 0);
    const packageName = ensureString(orderInfo.package_name);

    if (!this.isConfigured()) {
      return { success: false, error: "Epusdt 未配置", trade_no: tradeNo };
    }

    if (!tradeNo) {
      return { success: false, error: "缺少订单编号", trade_no: "" };
    }
    if (amount <= 0) {
      return { success: false, error: "金额异常", trade_no: tradeNo };
    }

    const payload: CreateOrderPayload = {
      order_id: tradeNo,
      amount,
      trade_type: ensureString(paymentParams.trade_type) || this.config.tradeType,
      address: ensureString(paymentParams.address || paymentParams.payment_address),
      notify_url: ensureString(paymentParams.notify_url) || this.config.notifyUrl,
      redirect_url:
        ensureString(paymentParams.return_url) ||
        ensureString(this.config.returnUrl) ||
        ensureString(paymentParams.redirect_url),
      timeout: ensureNumber(paymentParams.timeout) || this.config.timeout,
    };

    // 防止过低的超时时间
    if (payload.timeout && payload.timeout < 60) {
      payload.timeout = 60;
    }

    // 可选强制汇率
    if (paymentParams.rate !== undefined) {
      payload.rate = paymentParams.rate as number;
    } else if (this.env.EPUSDT_RATE) {
      payload.rate = ensureString(this.env.EPUSDT_RATE);
    }

    payload.signature = await this.generateSign({ ...payload });

    const url = `${this.config.apiUrl.replace(/\/$/, "")}/api/v1/order/create-transaction`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error("Epusdt 创建订单失败", { status: response.status, body: text });
      return { success: false, error: `请求失败: ${response.status}`, trade_no: tradeNo };
    }

    const data = (await response.json()) as CreateOrderResponse;

    if (data.status_code !== 200 || !data.data?.payment_url) {
      this.logger.error("Epusdt 返回异常", data);
      return {
        success: false,
        error: data.message || "创建订单失败",
        trade_no: tradeNo,
      };
    }

    const payUrl = ensureString(data.data.payment_url);

    this.logger.info("Epusdt 订单创建", {
      trade_no: tradeNo,
      order_type: orderType,
      amount,
      payment_url: payUrl,
    });

    const siteName = await this.configManager.getSystemConfig(
      "site_name",
      ensureString(this.env.SITE_NAME) || "Soga面板"
    );

    return {
      success: true,
      trade_no: tradeNo,
      pay_url: payUrl,
      amount,
      order_type: orderType,
      status: "pending",
      site_name: siteName,
      token: data.data.token,
      trade_id: data.data.trade_id,
    };
  }

  async verifyCallback(params: Record<string, unknown>): Promise<boolean> {
    const expected = await this.generateSign(params);
    return ensureString(params.signature).toLowerCase() === expected.toLowerCase();
  }

  processCallback(params: CallbackPayload) {
    const status = ensureNumber(params.status);
    const amountValue = ensureNumber(params.amount ?? params.actual_amount);
    return {
      success: status === 2,
      trade_no: ensureString(params.order_id),
      amount: amountValue,
      status: status.toString(),
    };
  }
}
