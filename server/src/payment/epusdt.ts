import type { AppEnv } from "../config/env";
import type { PaymentOrder, PaymentCreateResult, PaymentCallbackResult } from "./types";

type EpusdtCallbackParams = {
  trade_no?: string;
  out_trade_no?: string;
  amount?: string | number;
  token?: string;
  [key: string]: any;
};

export class EpusdtProvider {
  private readonly env: AppEnv;

  constructor(env: AppEnv) {
    this.env = env;
  }

  isConfigured() {
    return !!(this.env.EPUSDT_API_URL && this.env.EPUSDT_TOKEN);
  }

  createPayment(order: PaymentOrder): PaymentCreateResult {
    const apiUrl = this.env.EPUSDT_API_URL!;
    const params: Record<string, string> = {
      trade_no: order.tradeNo,
      amount: order.amount.toString(),
      notify_url: order.notifyUrl || this.env.EPUSDT_NOTIFY_URL || "",
      return_url: order.returnUrl || this.env.EPUSDT_RETURN_URL || ""
    };
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return { method: "epusdt", payUrl: `${apiUrl}?${query}` };
  }

  verifyCallback(body: EpusdtCallbackParams): PaymentCallbackResult {
    if (!this.isConfigured()) return { ok: false };
    if (this.env.EPUSDT_TOKEN && body.token && body.token !== this.env.EPUSDT_TOKEN) {
      return { ok: false };
    }
    const tradeNo = body.trade_no || body.out_trade_no;
    return {
      ok: true,
      tradeNo: tradeNo ? String(tradeNo) : undefined,
      amount: body.amount ? Number(body.amount) : undefined,
      raw: body
    };
  }
}
