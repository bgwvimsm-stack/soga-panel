import { ensureNumber, ensureString } from "./d1";

export type SubscriptionUser = {
  id: number;
  uuid?: string;
  passwd?: string;
  transfer_enable?: number | string;
  transfer_total?: number | string;
  upload_traffic?: number | string;
  download_traffic?: number | string;
  expire_time?: string | Date | null;
};

export type SubscriptionNode = {
  id: number;
  name?: string;
  type?: string;
  node_config?: any;
  node_class?: number;
  status?: number;
  [key: string]: unknown;
};

export function generateV2rayConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  return nodes
    .map((node) => {
      const cfg = safeNodeConfig(node);
      return [
        `# ${node.name || "Node"}`,
        `v2ray://${cfg.uuid ?? user.uuid ?? ""}@${cfg.host}:${cfg.port}?security=${cfg.security || "auto"}`
      ].join("\n");
    })
    .join("\n\n");
}

export function generateClashConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  const proxies = nodes.map((node) => {
    const cfg = safeNodeConfig(node);
    return `  - { name: "${node.name || "Node"}", type: ${cfg.protocol || "vmess"}, server: ${cfg.host ||
      "example.com"}, port: ${cfg.port || 443}, uuid: "${cfg.uuid || user.uuid || ""}", alterId: 0, cipher: "auto", tls: ${
      cfg.tls ? "true" : "false"
    } }`;
  });

  return [
    "proxies:",
    proxies.join("\n"),
    "",
    "proxy-groups:",
    '  - { name: "auto", type: select, proxies: [] }'
  ].join("\n");
}

export function generateQuantumultXConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  return nodes
    .map((node) => {
      const cfg = safeNodeConfig(node);
      return `${cfg.protocol || "vmess"}=${cfg.host}:${cfg.port}, method=${cfg.method || "auto"}, password=${
        cfg.uuid || user.uuid || ""
      }, obfs=${cfg.obfs || "none"}, tag=${node.name || "Node"}`;
    })
    .join("\n");
}

export function generateShadowrocketConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  return nodes
    .map((node) => {
      const cfg = safeNodeConfig(node);
      return `${cfg.protocol || "vmess"}://${cfg.uuid || user.uuid || ""}@${cfg.host}:${cfg.port}#${encodeURIComponent(
        node.name || "Node"
      )}`;
    })
    .join("\n");
}

export function generateSurgeConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  const proxies = nodes.map((node) => {
    const cfg = safeNodeConfig(node);
    return `${node.name || "Node"} = vmess, ${cfg.host || "example.com"}, ${cfg.port || 443}, username="${
      cfg.uuid || user.uuid || ""
    }", tls=${cfg.tls ? "true" : "false"}`;
  });
  return ["[Proxy]", ...proxies].join("\n");
}

function safeNodeConfig(node: SubscriptionNode): Record<string, any> {
  const raw = ensureString(node.node_config, "{}") || "{}";
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}
