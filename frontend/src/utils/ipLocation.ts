// IP 地理位置查询工具（使用 ip-api.io）

interface IpSbResponse {
  ip?: string;
  country?: string;
  city?: string;
}

// IP地址缓存，避免重复请求
const ipLocationCache = new Map<string, string>();

function isPrivateIP(ip: string): boolean {
  if (!ip) return true;
  const lowered = ip.toLowerCase();

  if (lowered === "localhost" || lowered === "::1") {
    return true;
  }

  if (lowered.startsWith("192.168.") || lowered.startsWith("10.")) {
    return true;
  }

  if (lowered.startsWith("172.")) {
    // RFC1918 私有网段 172.16.0.0 – 172.31.255.255
    const parts = lowered.split(".");
    if (parts.length >= 2) {
      const second = Number(parts[1]);
      if (second >= 16 && second <= 31) {
        return true;
      }
    }
  }

  if (lowered.startsWith("fc") || lowered.startsWith("fd")) {
    // IPv6 私有前缀
    return true;
  }

  return false;
}

function buildLocationLabel(data: IpSbResponse): string {
  const country = data.country || "";
  const city = data.city || "";

  const parts = [country, city].filter(Boolean);
  const label = parts.join(" ").trim();
  return label || "未知";
}

/**
 * 查询 IP 地理位置信息
 * @param ip IP 地址
 * @returns 地理位置字符串
 */
export async function getIPLocation(ip: string): Promise<string> {
  if (!ip || isPrivateIP(ip)) {
    return "本地";
  }

  if (ipLocationCache.has(ip)) {
    return ipLocationCache.get(ip)!;
  }

  try {
    const url =
      ip && ip.trim().length > 0
        ? `https://api.ip.sb/geoip/${encodeURIComponent(ip)}`
        : "https://api.ip.sb/geoip/";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: IpSbResponse = await response.json();
    const location = buildLocationLabel(data);
    ipLocationCache.set(ip, location);
    return location;
  } catch (error) {
    console.warn(`查询 IP ${ip} 地理位置失败:`, error);
    ipLocationCache.set(ip, "未知");
    return "未知";
  }
}

/**
 * 批量查询 IP 地理位置
 * @param ips IP 地址数组
 * @returns IP 地址到地理位置的映射
 */
export async function batchGetIPLocation(
  ips: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  const batchSize = 5;
  for (let index = 0; index < ips.length; index += batchSize) {
    const batch = ips.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (ip) => {
        const location = await getIPLocation(ip);
        results.set(ip, location);
      })
    );

    if (index + batchSize < ips.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * 清除 IP 地理位置缓存
 */
export function clearIPLocationCache(): void {
  ipLocationCache.clear();
}

/**
 * 获取缓存统计信息
 */
export function getIPLocationCacheStats(): { size: number; entries: string[] } {
  return {
    size: ipLocationCache.size,
    entries: Array.from(ipLocationCache.keys()),
  };
}
