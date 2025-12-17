// src/utils/subscription.js - 订阅配置生成工具
import { buildClashTemplate } from "./templates/clashTemplate";
import { buildSurgeTemplate } from "./templates/surgeTemplate";

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
  const server = client.server || '';
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

/**
 * 生成 V2Ray 订阅配置
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} - Base64 编码的 V2Ray 链接
 */
export function generateV2rayConfig(nodes, user) {
  const links = [];

  for (const node of nodes) {
    const endpoint = resolveNodeEndpoint(node);
    const nodeResolved = { ...node, server: endpoint.server, server_port: endpoint.port, tls_host: endpoint.tlsHost };
    const config = endpoint.config;

    switch (node.type) {
      case "v2ray":
        links.push(generateVmessLink(nodeResolved, config, user));
        break;
      case "vless":
        links.push(generateVlessLink(nodeResolved, config, user));
        break;
      case "trojan":
        links.push(generateTrojanLink(nodeResolved, config, user));
        break;
      case "ss":
        links.push(generateShadowsocksLink(nodeResolved, config, user));
        break;
      case "hysteria":
        links.push(generateHysteriaLink(nodeResolved, config, user));
        break;
    }
  }

  return btoa(links.join("\n"));
}

/**
 * 生成 VMess 链接
 */
function generateVmessLink(node, config, user) {
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
    alpn: config.alpn || "",
  };

  return `vmess://${btoa(JSON.stringify(vmessConfig))}`;
}

/**
 * 生成 VLESS 链接
 */
function generateVlessLink(node, config, user) {
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
  return `vless://${user.uuid}@${host}:${node.server_port}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

/**
 * 生成 Trojan 链接
 */
function generateTrojanLink(node, config, user) {
  const params = new URLSearchParams();

  if (config.sni) params.set("sni", config.sni);
  if (config.alpn) params.set("alpn", config.alpn);
  if (config.path) params.set("path", config.path);
  if (config.server) params.set("host", config.server);

  const queryString = params.toString();
  const host = formatHostForUrl(node.server);
  const password = encodeURIComponent(String(user.passwd ?? ""));
  const url = `trojan://${password}@${host}:${node.server_port}`;

  return queryString
    ? `${url}?${queryString}#${encodeURIComponent(node.name)}`
    : `${url}#${encodeURIComponent(node.name)}`;
}

/**
 * 生成 Shadowsocks 链接
 */
function deriveSS2022UserKey(method: string, userPassword: string) {
  const needs = method.toLowerCase().includes('aes-128') ? 16 : 32;
  const decodeBase64 = (value: string) => {
    try {
      const cleaned = value.trim();
      if (!cleaned) return null;
      const decoded = atob(cleaned);
      return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  };
  const toUtf8 = (value: string) => {
    try {
      return new TextEncoder().encode(value);
    } catch {
      return Uint8Array.from([]);
    }
  };

  let bytes = decodeBase64(userPassword) || toUtf8(userPassword);
  if (!bytes || bytes.length === 0) {
    bytes = Uint8Array.from([0]);
  }

  const out = new Uint8Array(needs);
  for (let i = 0; i < needs; i++) {
    out[i] = bytes[i % bytes.length];
  }

  let binary = '';
  out.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function generateShadowsocksLink(node, config, user) {
  const method = config.cipher || 'aes-128-gcm';
  const password = buildSS2022Password(config, user.passwd || config.password || "");
  const userInfo = `${method}:${password}`;
  const encoded = btoa(userInfo);

  const host = formatHostForUrl(node.server);
  let link = `ss://${encoded}@${host}:${node.server_port}`;

  // 添加混淆参数
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

function buildSS2022Password(config: any, userPassword: string) {
  const method = config.cipher || config.method || '';
  const serverPassword = config.password || '';
  const isSS2022 = String(method).toLowerCase().includes('2022-blake3');
  if (!isSS2022) {
    return userPassword || serverPassword;
  }
  const userPart = deriveSS2022UserKey(method, userPassword || serverPassword);
  return [serverPassword, userPart].filter(Boolean).join(':');
}

/**
 * 生成 Hysteria 链接
 */
function generateHysteriaLink(node, config, user) {
  const params = new URLSearchParams();

  params.set("protocol", "udp");
  params.set("auth", user.passwd);
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

/**
 * 生成 Clash 配置
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} - YAML 格式的 Clash 配置
 */
export function generateClashConfig(nodes, user) {
  const proxies = [];
  const proxyNames = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    let proxy = null;

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
          network: config.stream_type || "tcp",
        };

        // 添加 TLS 相关配置
        if (config.tls_type === "tls") {
          if (tlsHost || config.sni) {
            proxy.servername = tlsHost || config.sni;
          }
          if (config.alpn) {
            proxy.alpn = config.alpn.split(',');
          }
        }

        // WebSocket 配置
        if (config.stream_type === "ws") {
          proxy["ws-opts"] = {
            path: config.path || "/",
            headers: { Host: tlsHost || config.server || server },
          };
        } 
        // gRPC 配置
        else if (config.stream_type === "grpc") {
          proxy["grpc-opts"] = {
            "grpc-service-name": config.service_name || "grpc",
          };
        }
        // HTTP 配置
        else if (config.stream_type === "http") {
          proxy["http-opts"] = {
            method: "GET",
            path: [config.path || "/"],
          };
          if (config.server) {
            proxy["http-opts"].headers = {
              Connection: ["keep-alive"],
              Host: [node.tls_host || config.server]
            };
          }
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
          network: config.stream_type || "tcp",
        };

        // TLS 配置
        if (config.tls_type === "tls") {
          if (tlsHost || config.sni) {
            proxy.servername = tlsHost || config.sni;
          }
          if (config.alpn) {
            proxy.alpn = config.alpn.split(',');
          }
        }

        // Reality 配置
        if (config.tls_type === "reality") {
          proxy["reality-opts"] = {
            "public-key": config.public_key || "",
            "short-id": config.short_ids ? config.short_ids[0] : "",
          };
          proxy["client-fingerprint"] = config.fingerprint || "chrome";
          if (config.server_names && config.server_names.length > 0) {
            proxy.servername = config.server_names[0];
          }
        }

        if (config.flow) {
          proxy.flow = config.flow;
        }

        // WebSocket 配置
        if (config.stream_type === "ws") {
          proxy["ws-opts"] = {
            path: config.path || "/",
            headers: { Host: tlsHost || config.server || server },
          };
        }
        // gRPC 配置
        else if (config.stream_type === "grpc") {
          proxy["grpc-opts"] = {
            "grpc-service-name": config.service_name || "grpc",
          };
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
          sni: tlsHost || config.sni || server,
        };

        // 添加 WebSocket 支持
        if (config.stream_type === "ws") {
          proxy.network = "ws";
          proxy["ws-opts"] = {
            path: config.path || "/",
            headers: {
              Host: tlsHost || config.sni || server
            }
          };
        }

        // 添加 gRPC 支持
        if (config.stream_type === "grpc") {
          proxy.network = "grpc";
          proxy["grpc-opts"] = {
            "grpc-service-name": config.service_name || "grpc"
          };
        }
        break;

      case "ss":
        proxy = {
          name: node.name,
          type: "ss",
          server,
          port,
          cipher: config.cipher || "aes-128-gcm",
          password: buildSS2022Password(config, user.passwd || ""),
          udp: true,
        };

        // 混淆插件配置
        if (config.obfs && config.obfs !== "plain") {
          proxy.plugin = "obfs";
          proxy["plugin-opts"] = {
            mode: config.obfs === "simple_obfs_http" ? "http" : "tls",
            host: tlsHost || config.server || "bing.com",
          };
        }
        break;

      case "ssr":
      case "shadowsocksr":
        proxy = {
          name: node.name,
          type: "ssr",
          server,
          port,
          cipher: config.method || config.cipher || "aes-256-cfb",
          password: String(config.password || ""),
          protocol: config.protocol || "origin",
          obfs: config.obfs || "plain",
          udp: true,
        };
        {
          const protocolParam =
            config.protocol_param || config["protocol-param"] || config.protocolparam || user.passwd || "";
          const obfsParam =
            config.obfs_param || config["obfs-param"] || config.obfsparam || tlsHost || config.server || "";
          if (protocolParam) proxy["protocol-param"] = protocolParam;
          if (obfsParam) proxy["obfs-param"] = obfsParam;
        }
        break;

      case "anytls":
        proxy = {
          name: node.name,
          type: "anytls",
          server,
          port,
          password: String(user.passwd || config.password || ""),
          "client-fingerprint": config.fingerprint || "chrome",
          udp: true,
          "idle-session-check-interval": config.idle_session_check_interval ?? 30,
          "idle-session-timeout": config.idle_session_timeout ?? 30,
          "min-idle-session": config.min_idle_session ?? 0,
          "skip-cert-verify": true,
        };
        {
          const sni = tlsHost || config.sni || config.server;
          if (sni) proxy.sni = sni;
          const alpnRaw = config.alpn;
          if (Array.isArray(alpnRaw) && alpnRaw.length) proxy.alpn = alpnRaw;
          else if (typeof alpnRaw === "string" && alpnRaw.trim()) {
            proxy.alpn = alpnRaw.split(",").map((v: string) => v.trim()).filter(Boolean);
          }
        }
        break;

      case "hysteria":
        proxy = {
          name: node.name,
          type: "hysteria2",
          server,
          port,
          password: user.passwd,
          "skip-cert-verify": true,
        };

        // 添加 SNI 配置
        if (tlsHost || config.sni) {
          proxy.sni = tlsHost || config.sni;
        }

        // 添加混淆配置
        if (config.obfs && config.obfs !== "plain") {
          proxy.obfs = config.obfs;
          if (config.obfs_password) {
            proxy["obfs-password"] = config.obfs_password;
          }
        }

        // 添加带宽配置
        if (config.up_mbps) {
          proxy.up = `${config.up_mbps} Mbps`;
        }
        if (config.down_mbps) {
          proxy.down = `${config.down_mbps} Mbps`;
        }

        // 添加 ALPN 配置
        if (config.alpn) {
          proxy.alpn = config.alpn.split(',');
        }
        break;
    }

    if (proxy) {
      proxies.push(proxy);
      proxyNames.push(node.name);
    }
  }

  const clashConfig = buildClashTemplate(proxyNames, proxies);

  return yaml.dump(clashConfig);
}

/**
 * 生成 Quantumult X 配置
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} - Quantumult X 格式配置
 */
export function generateQuantumultXConfig(nodes, user) {
  const entries = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    let line = "";

    switch (node.type) {
      case "v2ray":
        line = buildQuantumultXVmessEntry({ ...node, server, server_port: port, tls_host: tlsHost }, config, user);
        break;
      case "vless":
        line = buildQuantumultXVlessEntry({ ...node, server, server_port: port, tls_host: tlsHost }, config, user);
        break;
      case "trojan":
        line = buildQuantumultXTrojanEntry({ ...node, server, server_port: port, tls_host: tlsHost }, config, user);
        break;
      case "ss":
        line = buildQuantumultXSSEntry({ ...node, server, server_port: port, tls_host: tlsHost }, config, user);
        break;
      default:
        line = "";
    }

    if (line) {
      entries.push(line);
    }
  }

  return entries.join("\n");
}

function buildQuantumultXSSEntry(node, config, user) {
  const options = [];
  pushOption(options, "method", config.cipher || "aes-128-gcm");
  const ssPassword = buildSS2022Password(config, user.passwd || "");
  pushOption(options, "password", ssPassword);
  pushOption(options, "fast-open", false);
  pushOption(options, "udp-relay", true);

  const obfs = normalizeObfs(config.obfs);
  if (obfs && obfs !== "plain") {
    pushOption(options, "obfs", obfs);
    pushOption(options, "obfs-host", getHeaderHost(node, config));
    pushOption(options, "obfs-uri", normalizePath(config.path));
  }

  pushOption(options, "tag", node.name);
  return formatQuantumultXEntry("shadowsocks", node.server, node.server_port, options);
}

function buildQuantumultXVmessEntry(node, config, user) {
  const streamType = String(config.stream_type || "tcp").toLowerCase();
  if (streamType === "grpc") {
    return "";
  }

  const options = [];
  pushOption(options, "method", config.security || "auto");
  pushOption(options, "password", user.uuid);
  pushOption(options, "fast-open", false);
  pushOption(options, "udp-relay", false);
  if (typeof config.aead === "boolean") {
    pushOption(options, "aead", config.aead);
  }

  applyStreamOptions(options, node, config);
  pushOption(options, "tag", node.name);
  return formatQuantumultXEntry("vmess", node.server, node.server_port, options);
}

function buildQuantumultXVlessEntry(node, config, user) {
  const streamType = String(config.stream_type || "tcp").toLowerCase();
  if (streamType === "grpc" || config.tls_type === "reality") {
    return "";
  }

  const options = [];
  pushOption(options, "method", "none");
  pushOption(options, "password", user.uuid);
  pushOption(options, "fast-open", false);
  pushOption(options, "udp-relay", false);

  applyStreamOptions(options, node, config);
  pushOption(options, "tag", node.name);
  return formatQuantumultXEntry("vless", node.server, node.server_port, options);
}

function buildQuantumultXTrojanEntry(node, config, user) {
  const options = [];
  const streamType = String(config.stream_type || "tcp").toLowerCase();
  if (streamType === "grpc") {
    // Quantumult X 尚不支持 Trojan gRPC，直接跳过避免生成无效节点
    return "";
  }
  const isWebsocket = streamType === "ws";
  const tlsEnabled = config.tls_type === "tls" || isWebsocket;
  const host = getHeaderHost(node, config);

  pushOption(options, "password", user.passwd);
  pushOption(options, "fast-open", false);
  pushOption(options, "tls-verification", false);

  if (isWebsocket) {
    pushOption(options, "obfs", tlsEnabled ? "wss" : "ws");
    pushOption(options, "obfs-host", host);
    pushOption(options, "obfs-uri", normalizePath(config.path));
    pushOption(options, "udp-relay", true);
  } else {
    if (tlsEnabled) {
      pushOption(options, "over-tls", true);
      pushOption(options, "tls-host", host);
    }
    pushOption(options, "udp-relay", false);
  }

  pushOption(options, "tag", node.name);
  return formatQuantumultXEntry("trojan", node.server, node.server_port, options);
}

function applyStreamOptions(options, node, config) {
  const streamType = String(config.stream_type || "tcp").toLowerCase();
  const isTLS = config.tls_type === "tls";
  const host = getHeaderHost(node, config);

  if (streamType === "ws") {
    pushOption(options, "obfs", isTLS ? "wss" : "ws");
    pushOption(options, "obfs-host", host);
    pushOption(options, "obfs-uri", normalizePath(config.path));
  } else if (streamType === "http") {
    pushOption(options, "obfs", "http");
    pushOption(options, "obfs-host", host);
    pushOption(options, "obfs-uri", normalizePath(config.path));
  } else if (isTLS) {
    pushOption(options, "obfs", "over-tls");
    pushOption(options, "obfs-host", host);
  }
}

function getHeaderHost(node, config) {
  return node.tls_host || config.sni || config.host || config.server || node.server;
}

function normalizePath(path) {
  if (!path || typeof path !== "string") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeObfs(obfs) {
  if (!obfs) return "";
  const value = String(obfs);
  const lower = value.toLowerCase();
  if (lower === "simple_obfs_http") return "http";
  if (lower === "simple_obfs_tls") return "tls";
  return value;
}

function pushOption(options, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (typeof value === "boolean") {
    options.push(`${key}=${value ? "true" : "false"}`);
  } else {
    options.push(`${key}=${value}`);
  }
}

function formatQuantumultXEntry(protocol, server, port, options) {
  const endpoint = `${formatHostForUrl(server)}:${port}`;
  return options.length ? `${protocol}=${endpoint}, ${options.join(", ")}` : `${protocol}=${endpoint}`;
}

function formatHostForUrl(host) {
  if (!host) return "";
  const value = String(host).trim();
  if (value.includes(":") && !value.startsWith("[") && !value.endsWith("]")) {
    return `[${value}]`;
  }
  return value;
}

/**
 * 生成 Shadowrocket 配置
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} - Shadowrocket 格式配置
 */
export function generateShadowrocketConfig(nodes, user) {
  const links = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    const nodeResolved = { ...node, server, server_port: port, tls_host: tlsHost };

    switch (nodeResolved.type) {
      case "v2ray":
        links.push(generateVmessLink(nodeResolved, config, user));
        break;
      case "vless":
        links.push(generateVlessLink(nodeResolved, config, user));
        break;
      case "trojan":
        links.push(generateTrojanLink(nodeResolved, config, user));
        break;
      case "ss":
        links.push(generateShadowsocksLink(nodeResolved, config, user));
        break;
      case "hysteria":
        links.push(generateHysteriaLink(nodeResolved, config, user));
        break;
    }
  }

  return links.join("\n");
}

/**
 * 生成 Surge 配置
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} - Surge 格式配置
 */
export function generateSurgeConfig(nodes, user) {
  const proxies = [];
  const proxyNames = [];

  for (const node of nodes) {
    const { config, server, port, tlsHost } = resolveNodeEndpoint(node);
    let proxy = "";

    switch (node.type) {
      case "v2ray":
        proxy = `${node.name} = vmess, ${server}, ${port}, username=${user.uuid}`;
        if (config.tls_type === "tls") {
          proxy += ", tls=true, skip-cert-verify=true";
          if (tlsHost || config.sni) proxy += `, sni=${tlsHost || config.sni}`;
        }
        if (config.stream_type === "ws") {
          proxy += `, ws=true, ws-path=${config.path || "/"}`;
          if (config.server || tlsHost) proxy += `, ws-headers=Host:${config.server || tlsHost}`;
        }
        break;

      case "trojan":
        proxy = `${node.name} = trojan, ${server}, ${port}, password=${user.passwd}`;
        proxy += ", tls=true, skip-cert-verify=true";
        if (tlsHost || config.sni) proxy += `, sni=${tlsHost || config.sni}`;
        break;

      case "ss":
        const ssPassword = buildSS2022Password(config, user.passwd || "");
        proxy = `${node.name} = ss, ${server}, ${port}, encrypt-method=${config.cipher || "aes-128-gcm"}, password=${ssPassword}`;
        if (config.obfs && config.obfs !== "plain") {
          const obfsMode = config.obfs === "simple_obfs_http" ? "http" : "tls";
          proxy += `, obfs=${obfsMode}`;
          if (config.server || tlsHost) proxy += `, obfs-host=${config.server || tlsHost}`;
        }
        break;

      case "hysteria":
        proxy = `${node.name} = hysteria2, ${server}, ${port}, password=${user.passwd}`;
        proxy += ", skip-cert-verify=true";
        if (tlsHost || config.sni) proxy += `, sni=${tlsHost || config.sni}`;
        break;
    }

    if (proxy) {
      proxies.push(proxy);
      proxyNames.push(node.name);
    }
  }

  return buildSurgeTemplate(proxies, proxyNames);
}

// 简单的 YAML 转换函数（用于 Clash 配置）
const yaml = {
  dump: function (obj) {
    return this._stringify(obj, 0);
  },

  _stringify: function (obj, indent) {
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
    } else if (typeof obj === "object") {
      Object.entries(obj).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          result += `${spaces}${key}:\n`;
          result += this._stringify(value, indent + 1);
        } else if (typeof value === "object") {
          result += `${spaces}${key}:\n`;
          result += this._stringify(value, indent + 1);
        } else {
          result += `${spaces}${key}: ${value}\n`;
        }
      });
    }

    return result;
  },

  _stringifyInline: function (obj) {
    if (typeof obj !== "object") return obj;

    const pairs = Object.entries(obj).map(([key, value]) => {
      if (typeof value === "object") {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${value}`;
    });

    return `{ ${pairs.join(", ")} }`;
  },
};
