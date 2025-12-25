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

const REGION_TAGS = REGION_MATCHERS.map((matcher) => matcher.tag);
const REGION_TAG_SET = new Set(REGION_TAGS);

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

function filterRegionTags(values: string[], availableRegionTags: Set<string>): string[] {
  return values.filter((item) => !REGION_TAG_SET.has(item) || availableRegionTags.has(item));
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
  const availableRegionTags = REGION_TAGS.filter((tag) => regionMatches[tag]?.length);
  const availableRegionSet = new Set(availableRegionTags);

  const groups: Record<string, unknown>[] = [];

  groups.push({
    name: "🚀 节点选择",
    type: "select",
    proxies: ["🚀 手动切换", ...availableRegionTags, "DIRECT"]
  });
  groups.push({
    name: "🚀 手动切换",
    type: "select",
    proxies: manualList
  });
  groups.push({
    name: "📲 电报消息",
    type: "select",
    proxies: filterRegionTags(
      [
        "🚀 节点选择",
        "🇸🇬 狮城节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇯🇵 日本节点",
        "🇺🇲 美国节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换",
        "DIRECT"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "💬 Ai平台",
    type: "select",
    proxies: filterRegionTags(
      [
        "🚀 节点选择",
        "🇸🇬 狮城节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇯🇵 日本节点",
        "🇺🇲 美国节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换",
        "DIRECT"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "📹 油管视频",
    type: "select",
    proxies: filterRegionTags(
      [
        "🚀 节点选择",
        "🇸🇬 狮城节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇯🇵 日本节点",
        "🇺🇲 美国节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换",
        "DIRECT"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "🎥 奈飞视频",
    type: "select",
    proxies: filterRegionTags(
      [
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
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "📺 巴哈姆特",
    type: "select",
    proxies: filterRegionTags(["🇨🇳 台湾节点", "🚀 节点选择", "🚀 手动切换", "DIRECT"], availableRegionSet)
  });
  groups.push({
    name: "📺 哔哩哔哩",
    type: "select",
    proxies: filterRegionTags(["🎯 全球直连", "🇨🇳 台湾节点", "🇭🇰 香港节点"], availableRegionSet)
  });
  groups.push({
    name: "🌍 国外媒体",
    type: "select",
    proxies: filterRegionTags(
      [
        "🚀 节点选择",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇺🇲 美国节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换",
        "DIRECT"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "🌏 国内媒体",
    type: "select",
    proxies: filterRegionTags(
      ["DIRECT", "🇭🇰 香港节点", "🇨🇳 台湾节点", "🇸🇬 狮城节点", "🇯🇵 日本节点", "🚀 手动切换"],
      availableRegionSet
    )
  });
  groups.push({
    name: "📢 谷歌FCM",
    type: "select",
    proxies: filterRegionTags(
      [
        "DIRECT",
        "🚀 节点选择",
        "🇺🇲 美国节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "Ⓜ️ 微软Bing",
    type: "select",
    proxies: filterRegionTags(
      [
        "DIRECT",
        "🚀 节点选择",
        "🇺🇲 美国节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "Ⓜ️ 微软云盘",
    type: "select",
    proxies: filterRegionTags(
      [
        "DIRECT",
        "🚀 节点选择",
        "🇺🇲 美国节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "Ⓜ️ 微软服务",
    type: "select",
    proxies: filterRegionTags(
      [
        "DIRECT",
        "🚀 节点选择",
        "🇺🇲 美国节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "🍎 苹果服务",
    type: "select",
    proxies: filterRegionTags(
      [
        "DIRECT",
        "🚀 节点选择",
        "🇺🇲 美国节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "🎮 游戏平台",
    type: "select",
    proxies: filterRegionTags(
      [
        "DIRECT",
        "🚀 节点选择",
        "🇺🇲 美国节点",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });
  groups.push({
    name: "🎶 网易音乐",
    type: "select",
    proxies: ["DIRECT", "🚀 节点选择"]
  });
  groups.push({
    name: "🎯 全球直连",
    type: "select",
    proxies: ["DIRECT", "🚀 节点选择"]
  });
  groups.push({
    name: "🛑 广告拦截",
    type: "select",
    proxies: ["REJECT", "DIRECT"]
  });
  groups.push({
    name: "🍃 应用净化",
    type: "select",
    proxies: ["REJECT", "DIRECT"]
  });
  groups.push({
    name: "🐟 漏网之鱼",
    type: "select",
    proxies: filterRegionTags(
      [
        "🚀 节点选择",
        "DIRECT",
        "🇭🇰 香港节点",
        "🇨🇳 台湾节点",
        "🇸🇬 狮城节点",
        "🇯🇵 日本节点",
        "🇺🇲 美国节点",
        "🇰🇷 韩国节点",
        "🚀 手动切换"
      ],
      availableRegionSet
    )
  });

  for (const tag of availableRegionTags) {
    const matched = uniqueNames(regionMatches[tag]);
    if (!matched.length) continue;
    groups.push({
      name: tag,
      type: "select",
      proxies: matched
    });
  }

  return {
    "mixed-port": 7890,
    "socks-port": 7891,
    "allow-lan": true,
    "bind-address": "*",
    mode: "rule",
    "log-level": "info",
    "external-controller": "127.0.0.1:9090",
    dns: {
      enable: true,
      ipv6: false,
      "default-nameserver": ["223.5.5.5", "119.29.29.29", "114.114.114.114"],
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "use-hosts": true,
      "respect-rules": true,
      "proxy-server-nameserver": ["223.5.5.5", "119.29.29.29", "114.114.114.114"],
      nameserver: ["223.5.5.5", "119.29.29.29", "114.114.114.114"],
      fallback: ["1.1.1.1", "8.8.8.8"],
      "fallback-filter": {
        geoip: true,
        "geoip-code": "CN",
        geosite: ["gfw"],
        ipcidr: ["240.0.0.0/4"],
        domain: ["+.google.com", "+.facebook.com", "+.youtube.com"]
      }
    },
    proxies,
    "proxy-groups": groups,
    rules: ensureArray(clashRules)
  };
}
