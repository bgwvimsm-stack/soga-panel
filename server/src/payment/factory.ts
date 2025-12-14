import { EpayProvider } from "./epay";
import { EpusdtProvider } from "./epusdt";
import type { AppEnv } from "../config/env";
import type { PaymentOrder, PaymentCreateResult, PaymentCallbackResult, PaymentMethod } from "./types";

type Channel = "alipay" | "wxpay" | "crypto";
type ProviderKey = PaymentMethod; // "epay" | "epusdt"

const CHANNELS: Channel[] = ["alipay", "wxpay", "crypto"];

const METHOD_LABELS: Record<Channel, { label: string }> = {
  alipay: { label: "支付宝" },
  wxpay: { label: "微信支付" },
  crypto: { label: "USDT" }
};

function normalizeChannel(input?: string | null): Channel | null {
  const value = (input || "").toString().toLowerCase().trim();
  if (!value) return null;
  if (value === "alipay" || value === "ali") return "alipay";
  if (value === "wechat" || value === "wx" || value === "wxpay") return "wxpay";
  if (
    value === "crypto" ||
    value === "usdt" ||
    value === "usdt.trc20" ||
    value === "trc20" ||
    value === "epusdt"
  )
    return "crypto";
  return null;
}

function getChannelProviderType(env: AppEnv, channel: Channel): ProviderKey | null {
  const key = `PAYMENT_${channel.toUpperCase()}` as keyof AppEnv;
  const raw = (env as any)[key];
  if (!raw || typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "none") return null;
  if (normalized === "epay") return "epay";
  if (normalized === "epusdt") return "epusdt";
  return null;
}

export function createPaymentProviders(env: AppEnv) {
  const epay = new EpayProvider(env);
  const epusdt = new EpusdtProvider(env);

  const providers: Record<ProviderKey, EpayProvider | EpusdtProvider> = {
    epay,
    epusdt
  };

  const channelProviders: Partial<Record<Channel, { providerKey: ProviderKey }>> = {};
  for (const channel of CHANNELS) {
    const providerKey = getChannelProviderType(env, channel);
    if (providerKey) {
      channelProviders[channel] = { providerKey };
    }
  }

  const availableChannels = CHANNELS.filter(
    (ch) => channelProviders[ch] && providers[channelProviders[ch]!.providerKey]?.isConfigured()
  );

  const pickChannel = (prefer?: Channel | null): Channel => {
    if (prefer && availableChannels.includes(prefer)) return prefer;
    if (availableChannels[0]) return availableChannels[0];
    throw new Error("支付未配置，请先配置支付通道");
  };

  const getProviderByChannel = (channel?: Channel | null) => {
    if (!channel) return null;
    const info = channelProviders[channel];
    if (!info) return null;
    const provider = providers[info.providerKey];
    if (!provider?.isConfigured()) return null;
    return { providerKey: info.providerKey, provider };
  };

  return {
    providers,
    normalizeChannel,
    hasAnyProvider() {
      return availableChannels.length > 0;
    },
    isChannelConfigured(channel?: string | null) {
      const ch = normalizeChannel(channel);
      if (!ch) return false;
      return Boolean(getProviderByChannel(ch));
    },
    getActiveChannels() {
      return availableChannels;
    },
    async create(order: PaymentOrder, prefer?: string | null): Promise<PaymentCreateResult> {
      const channel = normalizeChannel(prefer);
      const pickedChannel = pickChannel(channel);
      const providerInfo = getProviderByChannel(pickedChannel);
      if (!providerInfo) {
        throw new Error("支付通道未配置");
      }
      const payload = { ...order, channel: pickedChannel, method: providerInfo.providerKey };
      return await providerInfo.provider.createPayment(payload);
    },
    verifyCallback(body: any): PaymentCallbackResult | null {
      if (body?.token || body?.payType === "epusdt") {
        const result = epusdt.verifyCallback(body);
        return { ...result, method: "epusdt" as PaymentMethod };
      }
      const epayResult = epay.verifyCallback(body);
      if (epayResult.ok) return { ...epayResult, method: "epay" as PaymentMethod };
      const epusdtResult = epusdt.verifyCallback(body);
      if (epusdtResult.ok) return { ...epusdtResult, method: "epusdt" as PaymentMethod };
      return null;
    },
    pickChannel,
    getChannelProviderType,
    getPaymentMethods() {
      return availableChannels.map((ch) => ({
        value: ch === "crypto" ? "usdt" : ch === "wxpay" ? "wechat" : ch,
        label: METHOD_LABELS[ch].label,
        provider: channelProviders[ch]?.providerKey
      }));
    }
  };
}
