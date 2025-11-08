function formatList(items?: string[]): string {
  return Array.isArray(items) ? items.join(", ") : "";
}

/**
 * 根据代理与分组生成 Surge 默认模板
 */
export function buildSurgeTemplate(proxies: string[] = [], proxyNames: string[] = []) {
  const proxySection = proxies.join("\n");
  const nameList = formatList(proxyNames);

  return `#!MANAGED-CONFIG

[General]
loglevel = notify
skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, localhost, *.local
dns-server = 114.114.114.114, 223.5.5.5

[Proxy]
${proxySection}

[Proxy Group]
🚀 节点选择 = select, ${nameList}
♻️ 自动选择 = url-test, ${nameList}, url = http://www.gstatic.com/generate_204, interval = 300

[Rule]
DOMAIN-SUFFIX,cn,DIRECT
GEOIP,CN,DIRECT
FINAL,🚀 节点选择`;
}
