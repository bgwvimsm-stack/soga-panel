type ClashProxy = Record<string, unknown>;

function ensureArray<T>(value?: T[]): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 构建 Clash 默认模板，便于集中管理默认规则
 */
export function buildClashTemplate(
  proxyNames: string[] = [],
  proxies: ClashProxy[] = []
) {
  const safeProxyNames = ensureArray(proxyNames);

  return {
    "mixed-port": 7890,
    "allow-lan": true,
    mode: "rule",
    "log-level": "info",
    dns: {
      enable: true,
      ipv6: false,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      nameserver: ["114.114.114.114", "223.5.5.5"],
    },
    proxies,
    "proxy-groups": [
      {
        name: "🚀 节点选择",
        type: "select",
        proxies: ["♻️ 自动选择", "🎯 全球直连", ...safeProxyNames],
      },
      {
        name: "♻️ 自动选择",
        type: "url-test",
        proxies: safeProxyNames,
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
      },
      {
        name: "🎯 全球直连",
        type: "select",
        proxies: ["DIRECT"],
      },
    ],
    rules: [
      "DOMAIN-SUFFIX,cn,🎯 全球直连",
      "GEOIP,CN,🎯 全球直连",
      "MATCH,🚀 节点选择",
    ],
  };
}

