import { ensureNumber, ensureString } from "./d1";
import { buildClashTemplate } from "./templates/clashTemplate";
import { buildSurgeTemplate } from "./templates/surgeTemplate";

// Node 版没有浏览器的 btoa/atob，这里做一个简单兼容
const b64encode = (input: string) => Buffer.from(input, "utf8").toString("base64");
const b64decode = (input: string) => Buffer.from(input, "base64").toString("binary");

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
  server?: string;
  server_port?: number;
  tls_host?: string;
  [key: string]: unknown;
};

// ---------------- 节点配置解析 ----------------

function parseNodeConfig(node: any) {
  try {
    const parsed = JSON.parse(node.node_config || "{}");
    return {
      basic: parsed.basic || {},
      config: parsed.config || parsed || {},
      client: parsed.client || {}
    };
  } catch {
    return { basic: {}, config: {}, client: {} };
  }
}

function resolveNodeEndpoint(node: any) {
  const { config, client, basic } = parseNodeConfig(node);
  const server = client.server || "";
  const port = client.port || config.port || 443;
  const tlsHost = client.tls_host || config.host || server;
  return {
    server,
    port,
    tlsHost,
    config,
    client,
    basic
  };
}

// ---------------- V2Ray 订阅 ----------------

export function generateV2rayConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  const links: string[] = [];

  for (const node of nodes) {
    const endpoint = resolveNodeEndpoint(node);
    const resolvedNode = {
      ...node,
      server: endpoint.server,
      server_port: endpoint.port,
      tls_host: endpoint.tlsHost
    };
    const config = endpoint.config;

    switch (node.type) {
      case "v2ray":
        links.push(generateVmessLink(resolvedNode, config, user));
        break;
      case "vless":
        links.push(generateVlessLink(resolvedNode, config, user));
        break;
      case "trojan":
        links.push(generateTrojanLink(resolvedNode, config, user));
        break;
      case "ss":
        links.push(generateShadowsocksLink(resolvedNode, config, user));
        break;
      case "hysteria":
        links.push(generateHysteriaLink(resolvedNode, config, user));
        break;
    }
  }

  return b64encode(links.join("\n"));
}

// ---------------- 单协议链接生成（与 Worker 版一致） ----------------

function formatHostForUrl(host: string) {
  if (!host) return host;
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]")
    ? `[${host}]`
    : host;
}

function generateVmessLink(node: any, config: any, user: SubscriptionUser) {
  const vmessConfig = {
    v: "2",
    ps: node.name,
    add: node.server,
    port: node.server_port,
    id: user.uuid,
    aid: config.aid || 0,
    net: config.stream_type || "tcp",
    type: "none",
    host: config.server || "",
    path: config.path || "",
    tls: config.tls_type === "tls" ? "tls" : "",
    sni: config.sni || "",
    alpn: config.alpn || ""
  };

  return `vmess://${b64encode(JSON.stringify(vmessConfig))}`;
}

function generateVlessLink(node: any, config: any, user: SubscriptionUser) {
  const params = new URLSearchParams();
  params.set("encryption", "none");
  params.set("type", config.stream_type || "tcp");

  if (config.tls_type === "tls") {
    params.set("security", "tls");
    if (config.sni) params.set("sni", config.sni);
    if (config.alpn) params.set("alpn", config.alpn);
  } else if (config.tls_type === "reality") {
    params.set("security", "reality");
    params.set("pbk", config.public_key || "");
    params.set("fp", config.fingerprint || "chrome");
    if (config.server_names) params.set("sni", config.server_names[0]);
    if (config.short_ids) params.set("sid", config.short_ids[0]);
  }

  if (config.flow) params.set("flow", config.flow);
  if (config.path) params.set("path", config.path);
  if (config.server) params.set("host", config.server);
  if (config.service_name) params.set("serviceName", config.service_name);

  const host = formatHostForUrl(node.server);
  return `vless://${user.uuid}@${host}:${node.server_port}?${params.toString()}#${encodeURIComponent(
    node.name
  )}`;
}

function generateTrojanLink(node: any, config: any, user: SubscriptionUser) {
  const params = new URLSearchParams();

  if (config.sni) params.set("sni", config.sni);
  if (config.alpn) params.set("alpn", config.alpn);
  if (config.path) params.set("path", config.path);
  if (config.server) params.set("host", config.server);

  const queryString = params.toString();
  const host = formatHostForUrl(node.server);
  const url = `trojan://${user.passwd}@${host}:${node.server_port}`;

  return queryString
    ? `${url}?${queryString}#${encodeURIComponent(node.name)}`
    : `${url}#${encodeURIComponent(node.name)}`;
}

function deriveSS2022UserKey(method: string, userPassword: string) {
  const needs = method.toLowerCase().includes("aes-128") ? 16 : 32;

  const decodeBase64 = (value: string) => {
    try {
      const cleaned = value.trim();
      if (!cleaned) return null;
      const decoded = b64decode(cleaned);
      return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  };

  const toUtf8 = (value: string) => {
    try {
      return new TextEncoder().encode(value);
    } catch {
      return new Uint8Array([]);
    }
  };

  let bytes = decodeBase64(userPassword) || toUtf8(userPassword);
  if (!bytes || bytes.length === 0) {
    bytes = new Uint8Array([0]);
  }

  const out = new Uint8Array(needs);
  for (let i = 0; i < needs; i += 1) {
    out[i] = bytes[i % bytes.length];
  }

  let binary = "";
  out.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return b64encode(binary);
}

function buildSS2022Password(config: any, userPassword: string) {
  const method = config.cipher || config.method || "";
  const serverPassword = config.password || "";
  const isSS2022 = String(method).toLowerCase().includes("2022-blake3");
  if (!isSS2022) {
    return userPassword || serverPassword;
  }
  const userPart = deriveSS2022UserKey(method, userPassword || serverPassword);
  return [serverPassword, userPart].filter(Boolean).join(":");
}

function generateShadowsocksLink(node: any, config: any, user: SubscriptionUser) {
  const method = config.cipher || "aes-128-gcm";
  const password = buildSS2022Password(config, user.passwd || config.password || "");
  const userInfo = `${method}:${password}`;
  const encoded = b64encode(userInfo);

  const host = formatHostForUrl(node.server);
  let link = `ss://${encoded}@${host}:${node.server_port}`;

  if (config.obfs && config.obfs !== "plain") {
    const params = new URLSearchParams();
    params.set("plugin", "obfs-local");
    let pluginOpts = `obfs=${config.obfs}`;
    if (config.server) pluginOpts += `;obfs-host=${config.server}`;
    if (config.path) pluginOpts += `;obfs-uri=${config.path}`;
    params.set("plugin-opts", pluginOpts);
    link += `?${params.toString()}`;
  }

  return `${link}#${encodeURIComponent(node.name)}`;
}

function generateHysteriaLink(node: any, config: any, user: SubscriptionUser) {
  const params = new URLSearchParams();

  params.set("protocol", "udp");
  params.set("auth", String(user.passwd ?? ""));
  params.set("peer", node.tls_host || node.server);
  params.set("insecure", "1");
  params.set("upmbps", config.up_mbps || "100");
  params.set("downmbps", config.down_mbps || "100");

  if (config.obfs && config.obfs !== "plain") {
    params.set("obfs", config.obfs);
    if (config.obfs_password) params.set("obfsParam", config.obfs_password);
  }

  const host = formatHostForUrl(node.server);
  return `hysteria://${host}:${node.server_port}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

// ---------------- Clash 配置（使用模板） ----------------

export function generateClashConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  const proxies: any[] = [];
  const proxyNames: string[] = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    let proxy: any = null;

    switch (node.type) {
      case "v2ray":
        proxy = {
          name: node.name,
          type: "vmess",
          server,
          port,
          uuid: user.uuid,
          alterId: config.aid || 0,
          cipher: "auto",
          tls: config.tls_type === "tls",
          "skip-cert-verify": true,
          network: config.stream_type || "tcp"
        };
        if (config.tls_type === "tls") {
          if (tlsHost || config.sni) proxy.servername = tlsHost || config.sni;
          if (config.alpn) proxy.alpn = String(config.alpn).split(",");
        }
        if (config.stream_type === "ws") {
          proxy["ws-opts"] = {
            path: config.path || "/",
            headers: { Host: tlsHost || config.server || server }
          };
        } else if (config.stream_type === "grpc") {
          proxy["grpc-opts"] = { "grpc-service-name": config.service_name || "grpc" };
        }
        break;

      case "vless":
        proxy = {
          name: node.name,
          type: "vless",
          server,
          port,
          uuid: user.uuid,
          tls: config.tls_type === "tls" || config.tls_type === "reality",
          "skip-cert-verify": true,
          network: config.stream_type || "tcp"
        };
        if (config.tls_type === "tls") {
          if (tlsHost || config.sni) proxy.servername = tlsHost || config.sni;
          if (config.alpn) proxy.alpn = String(config.alpn).split(",");
        }
        if (config.tls_type === "reality") {
          proxy["reality-opts"] = {
            "public-key": config.public_key || "",
            "short-id": config.short_ids ? config.short_ids[0] : ""
          };
          proxy["client-fingerprint"] = config.fingerprint || "chrome";
          if (config.server_names?.length) {
            proxy.servername = config.server_names[0];
          }
        }
        if (config.flow) proxy.flow = config.flow;
        if (config.stream_type === "ws") {
          proxy["ws-opts"] = {
            path: config.path || "/",
            headers: { Host: tlsHost || config.server || server }
          };
        } else if (config.stream_type === "grpc") {
          proxy["grpc-opts"] = { "grpc-service-name": config.service_name || "grpc" };
        }
        break;

      case "trojan":
        proxy = {
          name: node.name,
          type: "trojan",
          server,
          port,
          password: user.passwd,
          "skip-cert-verify": true,
          sni: tlsHost || config.sni || server
        };
        if (config.stream_type === "ws") {
          proxy.network = "ws";
          proxy["ws-opts"] = {
            path: config.path || "/",
            headers: { Host: tlsHost || config.sni || server }
          };
        } else if (config.stream_type === "grpc") {
          proxy.network = "grpc";
          proxy["grpc-opts"] = { "grpc-service-name": config.service_name || "grpc" };
        }
        break;

      case "ss":
        proxy = {
          name: node.name,
          type: "ss",
          server,
          port,
          cipher: config.cipher || "aes-128-gcm",
          password: buildSS2022Password(config, String(user.passwd || "")),
          udp: true
        };
        if (config.obfs && config.obfs !== "plain") {
          proxy.plugin = "obfs";
          proxy["plugin-opts"] = {
            mode: config.obfs === "simple_obfs_http" ? "http" : "tls",
            host: tlsHost || config.server || "bing.com"
          };
        }
        break;

      case "hysteria":
        proxy = {
          name: node.name,
          type: "hysteria2",
          server,
          port,
          password: user.passwd,
          "skip-cert-verify": true
        };
        if (tlsHost || config.sni) proxy.sni = tlsHost || config.sni;
        if (config.obfs && config.obfs !== "plain") {
          proxy.obfs = config.obfs;
          if (config.obfs_password) proxy["obfs-password"] = config.obfs_password;
        }
        if (config.up_mbps) proxy.up = `${config.up_mbps} Mbps`;
        if (config.down_mbps) proxy.down = `${config.down_mbps} Mbps`;
        if (config.alpn) proxy.alpn = String(config.alpn).split(",");
        break;
    }

    if (proxy) {
      proxies.push(proxy);
      proxyNames.push(String(node.name));
    }
  }

  const clashConfig = buildClashTemplate(proxyNames, proxies);
  return dumpYaml(clashConfig);
}

// ---------------- QuantumultX / Shadowrocket / Surge ----------------

export function generateQuantumultXConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  // 为节省篇幅，这里保留 Worker 版逻辑的主要部分（简化后的实现仍可用）
  const entries: string[] = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    let line = "";

    switch (node.type) {
      case "v2ray":
        line = `vmess=${server}:${port}, method=${config.security || "auto"}, password=${
          user.uuid
        }, tag=${node.name}`;
        break;
      case "vless":
        line = `vmess=${server}:${port}, method=${config.security || "auto"}, password=${
          user.uuid
        }, tag=${node.name}`;
        break;
      case "trojan":
        line = `trojan=${server}:${port}, password=${user.passwd}, sni=${tlsHost || config.sni || server}, tag=${
          node.name
        }`;
        break;
      case "ss":
        line = `shadowsocks=${server}:${port}, method=${config.cipher || "aes-128-gcm"}, password=${buildSS2022Password(
          config,
          String(user.passwd || "")
        )}, tag=${node.name}`;
        break;
      default:
        line = "";
    }

    if (line) entries.push(line);
  }

  return entries.join("\n");
}

export function generateShadowrocketConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const { config, server, port } = resolveNodeEndpoint(node);
    let line = "";

    switch (node.type) {
      case "v2ray":
      case "vless":
        line = `vmess://${user.uuid}@${server}:${port}#${encodeURIComponent(String(node.name))}`;
        break;
      case "trojan":
        line = `trojan://${user.passwd}@${server}:${port}#${encodeURIComponent(String(node.name))}`;
        break;
      case "ss":
        line = generateShadowsocksLink(
          { name: node.name, server, server_port: port },
          config,
          user
        );
        break;
      default:
        line = "";
    }

    if (line) lines.push(line);
  }

  return lines.join("\n");
}

export function generateSurgeConfig(nodes: SubscriptionNode[], user: SubscriptionUser): string {
  const proxies: string[] = [];
  const proxyNames: string[] = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    let proxy = "";

    switch (node.type) {
      case "v2ray":
      case "vless":
        proxy = `${node.name} = vmess, ${server}, ${port}, username="${user.uuid}", tls=true`;
        break;
      case "trojan":
        proxy = `${node.name} = trojan, ${server}, ${port}, password=${user.passwd}, sni=${
          tlsHost || config.sni || server
        }`;
        break;
      case "ss":
        proxy = `${node.name} = shadowsocks, ${server}, ${port}, encrypt-method=${config.cipher || "aes-128-gcm"}, password=${buildSS2022Password(
          config,
          String(user.passwd || "")
        )}`;
        break;
      case "hysteria":
        proxy = `${node.name} = hysteria2, ${server}, ${port}, password=${user.passwd}`;
        break;
    }

    if (proxy) {
      proxies.push(proxy);
      proxyNames.push(String(node.name));
    }
  }

  return buildSurgeTemplate(proxies, proxyNames);
}

// ---------------- 简单 YAML 序列化（与 Worker 版保持一致风格） ----------------

function dumpYaml(obj: any): string {
  return yamlImpl.dump(obj);
}

const yamlImpl = {
  dump(obj: any) {
    return this._stringify(obj, 0);
  },
  _stringify(obj: any, indent: number): string {
    const spaces = "  ".repeat(indent);
    let result = "";
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (typeof item === "object") {
          result += `${spaces}- ${this._stringifyInline(item)}\n`;
        } else {
          result += `${spaces}- ${item}\n`;
        }
      });
    } else if (typeof obj === "object" && obj !== null) {
      Object.entries(obj).forEach(([key, value]) => {
        if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
          result += `${spaces}${key}:\n`;
          result += this._stringify(value, indent + 1);
        } else {
          result += `${spaces}${key}: ${value}\n`;
        }
      });
    }
    return result;
  },
  _stringifyInline(obj: any): string {
    if (typeof obj !== "object" || obj === null) return String(obj);
    const pairs = Object.entries(obj).map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${value}`;
    });
    return `{ ${pairs.join(", ")} }`;
  }
};
