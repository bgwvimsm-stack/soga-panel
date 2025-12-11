export type PaymentMethod = "epay" | "epusdt";

export type PaymentOrder = {
  tradeNo: string;
  amount: number;
  subject: string;
  notifyUrl?: string;
  returnUrl?: string;
  channel?: string;
  method?: PaymentMethod;
};

export type PaymentCreateResult = {
  method: PaymentMethod;
  payUrl?: string;
};

export type PaymentCallbackResult = {
  ok: boolean;
  tradeNo?: string;
  amount?: number;
  type?: "recharge" | "purchase";
  method?: PaymentMethod;
  raw?: any;
};
