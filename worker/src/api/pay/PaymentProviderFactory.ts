import type { Env } from "../../types";
import type { PaymentProvider } from "./types";
import { EpayProvider } from "./epay/EpayProvider";
import { EpusdtProvider } from "./epusdt/EpusdtProvider";
import type { Logger } from "../../utils/logger";

interface ProviderInfo {
  type: string;
  name: string;
  description: string;
}

export type PaymentMethod = "alipay" | "wxpay" | "crypto";

export type MethodProviderMap = Partial<
  Record<PaymentMethod, { providerType: string; provider: PaymentProvider }>
>;

export class PaymentProviderFactory {
  static createProvider(providerType: string, env: Env): PaymentProvider {
    switch (providerType) {
      case "epay":
        return new EpayProvider(env);
      case "epusdt":
        return new EpusdtProvider(env);
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

    if (env.EPUSDT_API_URL && env.EPUSDT_TOKEN) {
      providers.push({
        type: "epusdt",
        name: "Epusdt",
        description: "数字货币支付 (USDT)",
      });
    }

    return providers;
  }

  static normalizeMethod(method: string | null | undefined): PaymentMethod | null {
    const value = (method ?? "").toString().toLowerCase().trim();
    if (!value) return null;
    if (value === "wechat" || value === "wxpay") return "wxpay";
    if (value === "alipay") return "alipay";
    if (
      value === "crypto" ||
      value === "usdt" ||
      value === "usdt.trc20" ||
      value === "usdt-trc20" ||
      value === "usdt_trc20" ||
      value === "trc20"
    ) {
      return "crypto";
    }
    return null;
  }

  private static getMethodEnvKey(method: PaymentMethod): string {
    return `PAYMENT_${method}`;
  }

  private static getMethodProviderType(
    env: Env,
    method: PaymentMethod
  ): string | null {
    const key = this.getMethodEnvKey(method);
    const value =
      (env as Record<string, unknown>)[key] ??
      (env as Record<string, unknown>)[key.toUpperCase()];
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "none") return null;
    return normalized;
  }

  static createMethodProviderMap(
    env: Env,
    logger?: Logger
  ): MethodProviderMap {
    const providerCache = new Map<string, PaymentProvider>();
    const methodProviders: MethodProviderMap = {} as MethodProviderMap;
    const methods: PaymentMethod[] = ["alipay", "wxpay", "crypto"];

    for (const method of methods) {
      const providerType = this.getMethodProviderType(env, method);
      if (!providerType) continue;

      try {
        let provider = providerCache.get(providerType);
        if (!provider) {
          provider = this.createProvider(providerType, env);
          providerCache.set(providerType, provider);
        }

        methodProviders[method] = {
          providerType,
          provider,
        };
      } catch (error) {
        logger?.error?.("初始化支付通道失败", { method, providerType, error });
      }
    }

    return methodProviders;
  }

  static getDefaultMethod(methodProviders: MethodProviderMap): PaymentMethod | null {
    if (methodProviders.alipay) return "alipay";
    if (methodProviders.wxpay) return "wxpay";
    if (methodProviders.crypto) return "crypto";
    const firstMethod = Object.keys(methodProviders)[0] as PaymentMethod | undefined;
    return firstMethod ?? null;
  }

  static getProviderByMethod(
    method: string | null | undefined,
    methodProviders: MethodProviderMap
  ):
    | {
        providerType: string;
        provider: PaymentProvider;
        method: PaymentMethod;
      }
    | null {
    const normalizedMethod = this.normalizeMethod(method);
    if (!normalizedMethod) return null;
    const providerInfo = methodProviders[normalizedMethod];
    if (!providerInfo) return null;
    return { ...providerInfo, method: normalizedMethod };
  }
}
