import { md5Hex } from "../utils/crypto";
import type { AppEnv } from "../config/env";
import type { PaymentOrder, PaymentCreateResult, PaymentCallbackResult } from "./types";

type EpayCallbackParams = {
  pid?: string;
  trade_no?: string;
  out_trade_no?: string;
  type?: string;
  name?: string;
  money?: string;
  trade_status?: string;
  sign?: string;
  [key: string]: any;
};

export class EpayProvider {
  private readonly env: AppEnv;

  constructor(env: AppEnv) {
    this.env = env;
  }

  isConfigured() {
    return !!(this.env.EPAY_API_URL && this.env.EPAY_PID && this.env.EPAY_KEY);
  }

  createPayment(order: PaymentOrder): PaymentCreateResult {
    const apiUrl = (this.env.EPAY_API_URL || "").replace(/\/$/, "");
    const channel = (order.channel || "").toLowerCase();
    const type = channel === "wechat" || channel === "wxpay" ? "wxpay" : "alipay";
    const payParams: Record<string, string> = {
      pid: this.env.EPAY_PID || "",
      type,
      out_trade_no: order.tradeNo,
      notify_url: order.notifyUrl || this.env.EPAY_NOTIFY_URL || "",
      return_url: order.returnUrl || this.env.EPAY_RETURN_URL || "",
      name: order.subject || "账户充值",
      money: order.amount.toString(),
      sitename: this.env.SITE_NAME || "Soga Panel"
    };

    const signStr =
      Object.keys(payParams)
        .sort()
        .map((k) => `${k}=${payParams[k] ?? ""}`)
        .join("&") + (this.env.EPAY_KEY || "");
    const sign = md5Hex(signStr);
    payParams.sign = sign;
    payParams.sign_type = "MD5";

    const payUrl = `${apiUrl}/submit.php?${new URLSearchParams(payParams).toString()}`;
    return { method: "epay", payUrl };
  }

  verifyCallback(body: EpayCallbackParams): PaymentCallbackResult {
    if (!this.isConfigured()) return { ok: false };
    const { sign, ...rest } = body || {};
    const sorted = Object.keys(rest)
      .filter((k) => k !== "sign")
      .sort()
      .map((k) => `${k}=${rest[k] ?? ""}`)
      .join("&");
    const expected = md5Hex(sorted + this.env.EPAY_KEY!).toLowerCase();
    if (String(sign || "").toLowerCase() !== expected) {
      return { ok: false };
    }
    const tradeNo = body.trade_no || body.out_trade_no;
    return {
      ok: true,
      tradeNo: tradeNo ? String(tradeNo) : undefined,
      amount: body.money ? Number(body.money) : undefined,
      raw: body
    };
  }
}
