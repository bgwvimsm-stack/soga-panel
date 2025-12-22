import clashRules from "./clashRules.json";

type ClashProxy = Record<string, unknown>;

type GroupMatcher = { tag: string; patterns: RegExp[] };

const REGION_MATCHERS: GroupMatcher[] = [
  { tag: "🇭🇰 香港节点", patterns: [/香港/, /hong\s*kong/i, /\bHK\b/i, /🇭🇰/] },
  { tag: "🇨🇳 台湾节点", patterns: [/台湾/, /台北/, /taiwan/i, /taipei/i, /\bTW\b/i, /🇹🇼/] },
  { tag: "🇸🇬 狮城节点", patterns: [/狮城/, /新加坡/, /singapore/i, /\bSG\b/i, /🇸🇬/] },
  { tag: "🇯🇵 日本节点", patterns: [/日本/, /东京/, /大阪/, /japan/i, /\bJP\b/i, /🇯🇵/] },
  { tag: "🇺🇲 美国节点", patterns: [/美国/, /洛杉矶/, /纽约/, /硅谷/, /united\s*states/i, /\bUSA?\b/i, /🇺🇸|🇺🇲/] },
  { tag: "🇰🇷 韩国节点", patterns: [/韩国/, /首尔/, /korea/i, /\bKR\b/i, /🇰🇷/] },
  { tag: "🎥 奈飞节点", patterns: [/奈飞/, /netflix/i, /\bNF\b/i] }
];

function ensureArray<T>(value?: T[]): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueNames(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((item) => {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  });
  return result;
}

function collectRegionMatches(proxyNames: string[]): Record<string, string[]> {
  const matches: Record<string, string[]> = {};
  REGION_MATCHERS.forEach((matcher) => {
    matches[matcher.tag] = [];
  });
  proxyNames.forEach((name) => {
    REGION_MATCHERS.forEach((matcher) => {
      if (matcher.patterns.some((pattern) => pattern.test(name))) {
        matches[matcher.tag].push(name);
      }
    });
  });
  return matches;
}

function withFallback(values: string[], fallback: string[] = ["DIRECT"]): string[] {
  return values.length ? values : fallback;
}

/**
 * 构建 Clash 默认模板，便于集中管理默认规则
 */
export function buildClashTemplate(
  proxyNames: string[] = [],
  proxies: ClashProxy[] = []
) {
  const safeProxyNames = uniqueNames(ensureArray(proxyNames));
  const manualList = withFallback(safeProxyNames);
  const regionMatches = collectRegionMatches(safeProxyNames);

  return {
    port: 7890,
    "socks-port": 7891,
    "allow-lan": true,
    mode: "Rule",
    "log-level": "info",
    "external-controller": ":9090",
    dns: {
      enable: true,
      nameserver: ["119.29.29.29", "223.5.5.5"],
      fallback: ["8.8.8.8", "8.8.4.4", "1.1.1.1", "tls://1.0.0.1:853", "tls://dns.google:853"]
    },
    proxies,
    "proxy-groups": [
      {
        name: "🚀 节点选择",
        type: "select",
        proxies: [
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换",
          "DIRECT"
        ]
      },
      {
        name: "🚀 手动切换",
        type: "select",
        proxies: manualList
      },
      {
        name: "📲 电报消息",
        type: "select",
        proxies: [
          "🚀 节点选择",
          "🇸🇬 狮城节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换",
          "DIRECT"
        ]
      },
      {
        name: "💬 Ai平台",
        type: "select",
        proxies: [
          "🚀 节点选择",
          "🇸🇬 狮城节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换",
          "DIRECT"
        ]
      },
      {
        name: "📹 油管视频",
        type: "select",
        proxies: [
          "🚀 节点选择",
          "🇸🇬 狮城节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换",
          "DIRECT"
        ]
      },
      {
        name: "🎥 奈飞视频",
        type: "select",
        proxies: [
          "🎥 奈飞节点",
          "🚀 节点选择",
          "🇸🇬 狮城节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换",
          "DIRECT"
        ]
      },
      {
        name: "📺 巴哈姆特",
        type: "select",
        proxies: ["🇨🇳 台湾节点", "🚀 节点选择", "🚀 手动切换", "DIRECT"]
      },
      {
        name: "📺 哔哩哔哩",
        type: "select",
        proxies: ["🎯 全球直连", "🇨🇳 台湾节点", "🇭🇰 香港节点"]
      },
      {
        name: "🌍 国外媒体",
        type: "select",
        proxies: [
          "🚀 节点选择",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换",
          "DIRECT"
        ]
      },
      {
        name: "🌏 国内媒体",
        type: "select",
        proxies: ["DIRECT", "🇭🇰 香港节点", "🇨🇳 台湾节点", "🇸🇬 狮城节点", "🇯🇵 日本节点", "🚀 手动切换"]
      },
      {
        name: "📢 谷歌FCM",
        type: "select",
        proxies: [
          "DIRECT",
          "🚀 节点选择",
          "🇺🇲 美国节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "Ⓜ️ 微软Bing",
        type: "select",
        proxies: [
          "DIRECT",
          "🚀 节点选择",
          "🇺🇲 美国节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "Ⓜ️ 微软云盘",
        type: "select",
        proxies: [
          "DIRECT",
          "🚀 节点选择",
          "🇺🇲 美国节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "Ⓜ️ 微软服务",
        type: "select",
        proxies: [
          "DIRECT",
          "🚀 节点选择",
          "🇺🇲 美国节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "🍎 苹果服务",
        type: "select",
        proxies: [
          "DIRECT",
          "🚀 节点选择",
          "🇺🇲 美国节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "🎮 游戏平台",
        type: "select",
        proxies: [
          "DIRECT",
          "🚀 节点选择",
          "🇺🇲 美国节点",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "🎶 网易音乐",
        type: "select",
        proxies: ["DIRECT", "🚀 节点选择"]
      },
      {
        name: "🎯 全球直连",
        type: "select",
        proxies: ["DIRECT", "🚀 节点选择"]
      },
      {
        name: "🛑 广告拦截",
        type: "select",
        proxies: ["REJECT", "DIRECT"]
      },
      {
        name: "🍃 应用净化",
        type: "select",
        proxies: ["REJECT", "DIRECT"]
      },
      {
        name: "🐟 漏网之鱼",
        type: "select",
        proxies: [
          "🚀 节点选择",
          "DIRECT",
          "🇭🇰 香港节点",
          "🇨🇳 台湾节点",
          "🇸🇬 狮城节点",
          "🇯🇵 日本节点",
          "🇺🇲 美国节点",
          "🇰🇷 韩国节点",
          "🚀 手动切换"
        ]
      },
      {
        name: "🇭🇰 香港节点",
        type: "select",
        proxies: withFallback(regionMatches["🇭🇰 香港节点"])
      },
      {
        name: "🇯🇵 日本节点",
        type: "select",
        proxies: withFallback(regionMatches["🇯🇵 日本节点"])
      },
      {
        name: "🇺🇲 美国节点",
        type: "select",
        proxies: withFallback(regionMatches["🇺🇲 美国节点"])
      },
      {
        name: "🇸🇬 狮城节点",
        type: "select",
        proxies: withFallback(regionMatches["🇸🇬 狮城节点"])
      },
      {
        name: "🇨🇳 台湾节点",
        type: "select",
        proxies: withFallback(regionMatches["🇨🇳 台湾节点"])
      },
      {
        name: "🇰🇷 韩国节点",
        type: "select",
        proxies: withFallback(regionMatches["🇰🇷 韩国节点"])
      },
      {
        name: "🎥 奈飞节点",
        type: "select",
        proxies: withFallback(regionMatches["🎥 奈飞节点"])
      }
    ],
    rules: ensureArray(clashRules)
  };
}
