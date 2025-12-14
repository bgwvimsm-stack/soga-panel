import type { AppEnv } from "../config/env";
import { ensureNumber, ensureString } from "../utils/d1";
import { md5Hex } from "../utils/crypto";
import type { PaymentOrder, PaymentCreateResult, PaymentCallbackResult } from "./types";

type EpusdtCallbackParams = {
  trade_no?: string;
  out_trade_no?: string;
  order_id?: string;
  amount?: string | number;
  actual_amount?: string | number;
  token?: string;
  signature?: string;
  sign?: string;
  status?: string | number;
  [key: string]: any;
};

type EpusdtTradeType = string;

interface CreateOrderPayload {
  order_id: string;
  amount: number;
  trade_type?: EpusdtTradeType;
  address?: string;
  notify_url: string;
  redirect_url?: string;
  timeout?: number;
  rate?: number | string;
  signature?: string;
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

export class EpusdtProvider {
  private readonly env: AppEnv;

  constructor(env: AppEnv) {
    this.env = env;
  }

  isConfigured() {
    return !!(this.env.EPUSDT_API_URL && this.env.EPUSDT_TOKEN && this.env.EPUSDT_NOTIFY_URL);
  }

  private generateSign(params: Record<string, unknown>): string {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === "signature" || key === "sign") continue;
      if (value === null || value === undefined || value === "") continue;
      filtered[key] = value;
    }
    const sortedKeys = Object.keys(filtered).sort();
    const baseStr = sortedKeys.map((k) => `${k}=${filtered[k]}`).join("&");
    const signStr = `${baseStr}${this.env.EPUSDT_TOKEN || ""}`;
    return md5Hex(signStr);
  }

  async createPayment(order: PaymentOrder): Promise<PaymentCreateResult> {
    if (!this.isConfigured()) {
      return { method: "epusdt", success: false, message: "USDT 支付未配置" };
    }

    const tradeNo = order.tradeNo;
    const amount = order.amount;
    if (!tradeNo) {
      return { method: "epusdt", success: false, message: "缺少订单编号" };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { method: "epusdt", success: false, message: "金额异常" };
    }

    const rawReturnUrl =
      typeof order.returnUrl === "string" && order.returnUrl.trim().length > 0
        ? order.returnUrl.trim()
        : typeof order.return_url === "string"
          ? order.return_url.trim()
          : "";
    const redirectUrl = ensureString(rawReturnUrl || this.env.EPUSDT_RETURN_URL || "");
    const notifyUrl = ensureString(
      order.notifyUrl ||
        (typeof order.notify_url === "string" ? order.notify_url : "") ||
        this.env.EPUSDT_NOTIFY_URL ||
        ""
    );
    const tradeType = ensureString(this.env.EPUSDT_TRADE_TYPE) || "usdt.trc20";
    const timeout = Math.max(60, ensureNumber(this.env.EPUSDT_TIMEOUT, 600));

    const payload: CreateOrderPayload = {
      order_id: tradeNo,
      amount,
      trade_type: tradeType,
      notify_url: notifyUrl,
      redirect_url: redirectUrl,
      timeout
    };

    payload.signature = this.generateSign({ ...payload });

    const apiBase = ensureString(this.env.EPUSDT_API_URL);
    const url = `${apiBase.replace(/\/$/, "")}/api/v1/order/create-transaction`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        method: "epusdt",
        success: false,
        message: `USDT 支付请求失败: ${message}`
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        method: "epusdt",
        success: false,
        message: `USDT 支付接口错误: ${response.status} ${text}`
      };
    }

    let data: CreateOrderResponse;
    try {
      data = (await response.json()) as CreateOrderResponse;
    } catch (error) {
      return {
        method: "epusdt",
        success: false,
        message: "USDT 支付解析响应失败"
      };
    }

    if (data.status_code !== 200 || !data.data?.payment_url) {
      return {
        method: "epusdt",
        success: false,
        message: data.message || "创建 USDT 支付订单失败"
      };
    }

    const payUrl = ensureString(data.data.payment_url);
    return { method: "epusdt", payUrl, success: true };
  }

  verifyCallback(body: EpusdtCallbackParams): PaymentCallbackResult {
    if (!this.isConfigured()) return { ok: false };
    const providedSignature =
      (typeof body.signature === "string" && body.signature.trim()) ||
      (typeof body.sign === "string" && body.sign.trim()) ||
      "";
    if (!providedSignature) return { ok: false };
    const expectedSignature = this.generateSign(body);
    if (providedSignature.toLowerCase() !== expectedSignature.toLowerCase()) {
      return { ok: false };
    }
    const tradeNo = body.trade_no || body.out_trade_no || body.order_id;
    const rawAmount = body.actual_amount ?? body.amount;
    const statusValue =
      body.status !== undefined && body.status !== null ? Number(body.status) : undefined;
    // 按 BEpusdt 文档，仅在 status === 2（支付成功）时视为有效支付回调
    if (statusValue !== undefined && Number.isFinite(statusValue) && statusValue !== 2) {
      return {
        ok: false,
        tradeNo: tradeNo ? String(tradeNo) : undefined,
        amount: rawAmount != null ? Number(rawAmount) : undefined,
        raw: body
      };
    }
    return {
      ok: true,
      tradeNo: tradeNo ? String(tradeNo) : undefined,
      amount: rawAmount != null ? Number(rawAmount) : undefined,
      raw: body
    };
  }
}
