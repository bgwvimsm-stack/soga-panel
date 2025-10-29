export interface PaymentMethodOption {
  value: string;
  label: string;
  icon: string;
}

export interface PaymentCreateResult {
  success: boolean;
  trade_no: string;
  pay_url?: string;
  amount?: number;
  order_type?: string;
  status?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export interface PaymentParams {
  payment_method?: string;
  return_url?: string;
  [key: string]: unknown;
}

export interface PaymentProvider {
  isConfigured(): boolean;
  getSupportedMethods(availableMethods?: string): PaymentMethodOption[];
  createPayment(
    orderInfo: Record<string, unknown>,
    orderType: string,
    paymentParams?: PaymentParams
  ): Promise<PaymentCreateResult>;
  verifyCallback(params: Record<string, unknown>): Promise<boolean>;
  processCallback(params: Record<string, unknown>): {
    success: boolean;
    trade_no: string;
    amount: number;
    status: string;
    [key: string]: unknown;
  };
}
