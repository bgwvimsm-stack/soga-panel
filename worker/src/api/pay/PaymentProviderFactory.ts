import type { Env } from "../../types";
import type { PaymentProvider } from "./types";
import { EpayProvider } from "./epay/EpayProvider";

interface ProviderInfo {
  type: string;
  name: string;
  description: string;
}

export class PaymentProviderFactory {
  static createProvider(providerType: string, env: Env): PaymentProvider {
    switch (providerType) {
      case "epay":
        return new EpayProvider(env);
      default:
        throw new Error(`不支持的支付提供者: ${providerType}`);
    }
  }

  static getAvailableProviders(env: Env): ProviderInfo[] {
    const providers: ProviderInfo[] = [];

    if (env.EPAY_PID && env.EPAY_KEY && env.EPAY_API_URL) {
      providers.push({
        type: "epay",
        name: "易支付",
        description: "第三方易支付平台",
      });
    }

    return providers;
  }
}
