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

function formatList(items?: string[]): string {
  return Array.isArray(items) ? items.join(",") : "";
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
 * 根据代理与分组生成 Surge 默认模板
 */
export function buildSurgeTemplate(proxies: string[] = [], proxyNames: string[] = []) {
  const safeProxyNames = uniqueNames(proxyNames);
  const manualList = withFallback(safeProxyNames);
  const regionMatches = collectRegionMatches(safeProxyNames);
  const proxyLines = ["DIRECT = direct", ...proxies].filter(Boolean);
  const proxySection = proxyLines.join("\n");

  const groups: string[] = [
    `🚀 节点选择 = select,${formatList([
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇺🇲 美国节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换",
      "DIRECT"
    ])}`,
    `🚀 手动切换 = select,${formatList(manualList)}`,
    `📲 电报消息 = select,${formatList([
      "🚀 节点选择",
      "🇸🇬 狮城节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇯🇵 日本节点",
      "🇺🇲 美国节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换",
      "DIRECT"
    ])}`,
    `💬 Ai平台 = select,${formatList([
      "🚀 节点选择",
      "🇸🇬 狮城节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇯🇵 日本节点",
      "🇺🇲 美国节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换",
      "DIRECT"
    ])}`,
    `📹 油管视频 = select,${formatList([
      "🚀 节点选择",
      "🇸🇬 狮城节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇯🇵 日本节点",
      "🇺🇲 美国节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换",
      "DIRECT"
    ])}`,
    `🎥 奈飞视频 = select,${formatList([
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
    ])}`,
    `📺 巴哈姆特 = select,${formatList(["🇨🇳 台湾节点", "🚀 节点选择", "🚀 手动切换", "DIRECT"])}`,
    `📺 哔哩哔哩 = select,${formatList(["🎯 全球直连", "🇨🇳 台湾节点", "🇭🇰 香港节点"])}`,
    `🌍 国外媒体 = select,${formatList([
      "🚀 节点选择",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇺🇲 美国节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换",
      "DIRECT"
    ])}`,
    `🌏 国内媒体 = select,${formatList([
      "DIRECT",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🚀 手动切换"
    ])}`,
    `📢 谷歌FCM = select,${formatList([
      "DIRECT",
      "🚀 节点选择",
      "🇺🇲 美国节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `Ⓜ️ 微软Bing = select,${formatList([
      "DIRECT",
      "🚀 节点选择",
      "🇺🇲 美国节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `Ⓜ️ 微软云盘 = select,${formatList([
      "DIRECT",
      "🚀 节点选择",
      "🇺🇲 美国节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `Ⓜ️ 微软服务 = select,${formatList([
      "DIRECT",
      "🚀 节点选择",
      "🇺🇲 美国节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `🍎 苹果服务 = select,${formatList([
      "DIRECT",
      "🚀 节点选择",
      "🇺🇲 美国节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `🎮 游戏平台 = select,${formatList([
      "DIRECT",
      "🚀 节点选择",
      "🇺🇲 美国节点",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `🎶 网易音乐 = select,${formatList(["DIRECT", "🚀 节点选择"])}`,
    `🎯 全球直连 = select,${formatList(["DIRECT", "🚀 节点选择"])}`,
    `🛑 广告拦截 = select,${formatList(["REJECT", "DIRECT"])}`,
    `🍃 应用净化 = select,${formatList(["REJECT", "DIRECT"])}`,
    `🐟 漏网之鱼 = select,${formatList([
      "🚀 节点选择",
      "DIRECT",
      "🇭🇰 香港节点",
      "🇨🇳 台湾节点",
      "🇸🇬 狮城节点",
      "🇯🇵 日本节点",
      "🇺🇲 美国节点",
      "🇰🇷 韩国节点",
      "🚀 手动切换"
    ])}`,
    `🇭🇰 香港节点 = select,${formatList(withFallback(regionMatches["🇭🇰 香港节点"]))}`,
    `🇨🇳 台湾节点 = select,${formatList(withFallback(regionMatches["🇨🇳 台湾节点"]))}`,
    `🇸🇬 狮城节点 = select,${formatList(withFallback(regionMatches["🇸🇬 狮城节点"]))}`,
    `🇯🇵 日本节点 = select,${formatList(withFallback(regionMatches["🇯🇵 日本节点"]))}`,
    `🇺🇲 美国节点 = select,${formatList(withFallback(regionMatches["🇺🇲 美国节点"]))}`,
    `🇰🇷 韩国节点 = select,${formatList(withFallback(regionMatches["🇰🇷 韩国节点"]))}`,
    `🎥 奈飞节点 = select,${formatList(withFallback(regionMatches["🎥 奈飞节点"]))}`
  ];

  return `#!MANAGED-CONFIG

[General]
loglevel = notify
bypass-system = true
skip-proxy = 127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,100.64.0.0/10,localhost,*.local,e.crashlytics.com,captive.apple.com,::ffff:0:0:0:0/1,::ffff:128:0:0:0/1
#DNS设置或根据自己网络情况进行相应设置
bypass-tun = 192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
dns-server = 119.29.29.29,223.5.5.5,218.30.19.40,61.134.1.4
external-controller-access = password@0.0.0.0:6170
http-api = password@0.0.0.0:6171
test-timeout = 5
http-api-web-dashboard = true
exclude-simple-hostnames = true
allow-wifi-access = true
http-listen = 0.0.0.0:6152
socks5-listen = 0.0.0.0:6153
wifi-access-http-port = 6152
wifi-access-socks5-port = 6153

[Script]
http-request https?:\\/\\/.*\\.iqiyi\\.com\\/.*authcookie= script-path=https://raw.githubusercontent.com/NobyDa/Script/master/iQIYI-DailyBonus/iQIYI.js

[Proxy]
${proxySection}

[Proxy Group]
${groups.join("\n")}

[Rule]
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list,🎯 全球直连,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/UnBan.list,🎯 全球直连,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list,🛑 广告拦截,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list,🍃 应用净化,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list,📢 谷歌FCM,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list,🎯 全球直连,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list,🎯 全球直连,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Bing.list,Ⓜ️ 微软Bing,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/OneDrive.list,Ⓜ️ 微软云盘,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list,Ⓜ️ 微软服务,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Apple.list,🍎 苹果服务,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list,📲 电报消息,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/AI.list,💬 Ai平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list,💬 Ai平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/NetEaseMusic.list,🎶 网易音乐,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Epic.list,🎮 游戏平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Origin.list,🎮 游戏平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Sony.list,🎮 游戏平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Steam.list,🎮 游戏平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Nintendo.list,🎮 游戏平台,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list,📹 油管视频,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list,🎥 奈飞视频,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Bahamut.list,📺 巴哈姆特,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/BilibiliHMT.list,📺 哔哩哔哩,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Bilibili.list,📺 哔哩哔哩,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaMedia.list,🌏 国内媒体,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list,🌍 国外媒体,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyGFWlist.list,🚀 节点选择,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list,🎯 全球直连,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list,🎯 全球直连,update-interval=86400
RULE-SET,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Download.list,🎯 全球直连,update-interval=86400
GEOIP,CN,🎯 全球直连
FINAL,🐟 漏网之鱼`;
}
