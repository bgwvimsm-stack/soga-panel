// src/api/soga.js - Soga 后端 API 完整实现

import type { Env } from "../types";
import { DatabaseService } from "../services/database";
import { CacheService } from "../services/cache";
import { validateSogaAuth } from "../middleware/auth";
import { errorResponse } from "../utils/response";
import { generateETag, isETagMatch, createNotModifiedResponse, createETagResponse } from "../utils/etag";
import { ensureNumber, ensureString } from "../utils/d1";

type NodeRecord = {
  status?: number | string | null;
  node_bandwidth_limit?: number | string | null;
  node_bandwidth?: number | string | null;
  node_config?: string | null;
  [key: string]: unknown;
};

type AuditRuleRow = {
  id: number;
  rule: string | null;
};

type WhiteListRow = {
  rule: string | null;
};

export class SogaAPI {
  private readonly db: DatabaseService;
  private readonly cache: CacheService;
  private readonly env: Env;

  constructor(env: Env) {
    this.db = new DatabaseService(env.DB);
    this.cache = new CacheService(env.DB);
    this.env = env;
  }

  // 获取节点信息
  async getNode(request) {
    try {
      // 验证 Soga 后端认证
      const authResult = await validateSogaAuth(request, this.env);
      if (!authResult.success) {
        return errorResponse(authResult.message, 401);
      }

      const nodeId = authResult.nodeId;
      
      // 每次都从数据库获取最新的节点信息
      const node = (await this.db.getNode(nodeId)) as NodeRecord | null;
      if (!node) {
        return errorResponse("Node not found", 404);
      }

      // 检查节点流量限制：如果已用流量超过限制，返回404
      const bandwidthLimit = ensureNumber(node.node_bandwidth_limit, 0);
      if (bandwidthLimit > 0) {
        const usedTraffic = ensureNumber(node.node_bandwidth, 0);
        if (usedTraffic > bandwidthLimit) {
          return errorResponse("Node traffic limit exceeded", 404);
        }
      }

      // 解析节点配置
      const nodeConfigRaw = ensureString(node.node_config, "{}") || "{}";
      let nodeConfigJson: Record<string, any> = {};
      try {
        nodeConfigJson = JSON.parse(nodeConfigRaw);
      } catch {
        nodeConfigJson = {};
      }

      // 从 node_config 中提取 basic 和 config
      const responseConfig = {
        basic: nodeConfigJson.basic || {
          pull_interval: 60,
          push_interval: 60,
          speed_limit: 0,
        },
        config: nodeConfigJson.config || {}
      };

      // 直接返回响应，不使用缓存和ETag
      return new Response(JSON.stringify(responseConfig), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  private decodeBase64Safe(value: string | null | undefined) {
    try {
      if (!value) return null;
      const cleaned = value.trim();
      if (!cleaned) return null;
      const decoded = atob(cleaned);
      return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }

  private deriveSS2022UserKey(cipher: string, userPassword: string) {
    const lower = cipher.toLowerCase();
    const needs = lower.includes("aes-128") ? 16 : 32;
    const decoded = this.decodeBase64Safe(userPassword);
    let bytes = decoded;

    if (!bytes || bytes.length === 0) {
      try {
        bytes = new TextEncoder().encode(userPassword);
      } catch {
        bytes = new Uint8Array([0]);
      }
    }

    const out = new Uint8Array(needs);
    for (let i = 0; i < needs; i++) {
      out[i] = bytes[i % bytes.length];
    }

    let binary = "";
    out.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  private buildSSPassword(nodeConfig: any, userPassword: string) {
    const cipher = (nodeConfig?.cipher || nodeConfig?.method || "").toLowerCase();
    const nodePassword = nodeConfig?.password || "";
    if (cipher.includes("2022-blake3")) {
      const userPart = this.deriveSS2022UserKey(cipher, userPassword || nodePassword);
      // Soga 仅需要用户段，节点端密码已在节点配置中
      return userPart;
    }
    return userPassword || nodePassword;
  }

  // 获取用户信息
  async getUsers(request) {
    try {
      const authResult = await validateSogaAuth(request, this.env);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({
            code: 401,
            message: authResult.message,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const nodeId = authResult.nodeId;
      const nodeType = authResult.nodeType;
      const nodeRecord = (await this.db.getNode(nodeId)) as NodeRecord | null;
      const nodeConfigRaw = ensureString(nodeRecord?.node_config, "{}") || "{}";
      let nodeConfigJson: Record<string, any> = {};
      try {
        nodeConfigJson = JSON.parse(nodeConfigRaw);
      } catch {
        nodeConfigJson = {};
      }
      const ssConfig = (nodeConfigJson as any).config || nodeConfigJson || {};

      // 直接查询有权限访问此节点的用户（不使用缓存）
      const users = await this.db.getNodeUsers(nodeId);

      // 根据节点类型格式化用户数据
      const formattedUsers = users.map((user) => {
        const baseUser = {
          id: user.id,
          speed_limit: user.speed_limit || 0,
          device_limit: user.device_limit || 0,
          tcp_limit: user.tcp_limit || 0,
        };

        // 根据节点类型返回不同字段
        if (nodeType === "v2ray" || nodeType === "vmess" || nodeType === "vless") {
          return { ...baseUser, uuid: user.uuid };
        } else if (nodeType === "ss" || nodeType === "shadowsocks") {
          const password = this.buildSSPassword(
            ssConfig,
            String(user.password ?? user.passwd ?? "")
          );
          return { ...baseUser, password };
        } else {
          // trojan, ss, hysteria 使用 password
          return { ...baseUser, password: user.password };
        }
      });

      // 直接返回用户数据（不使用 ETAG 机制）
      return new Response(JSON.stringify(formattedUsers), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // 获取审计规则
  async getAuditRules(request) {
    try {
      const cacheKey = 'audit_rules';
      
      // 尝试从缓存获取
      const cachedData = await this.cache.get(cacheKey);
      let formattedRules;
      
      if (typeof cachedData === "string") {
        formattedRules = JSON.parse(cachedData) as AuditRuleRow[];
      } else {
        // 从数据库查询
        const rules = (await this.db.getAuditRules()) as AuditRuleRow[];
        formattedRules = rules.map((rule) => ({
          id: rule.id,
          rule: ensureString(rule.rule),
        }));
        
        // 24小时缓存，只在数据修改时主动清除
        await this.cache.set(cacheKey, JSON.stringify(formattedRules), 86400);
      }

      // 生成 ETAG
      const etag = generateETag(formattedRules);
      
      // 检查 IF-NONE-MATCH 头
      if (isETagMatch(request, etag)) {
        return createNotModifiedResponse(etag);
      }

      // 返回带 ETAG 的响应
      return createETagResponse(formattedRules, etag);
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // 获取白名单
  async getWhiteList(request) {
    try {
      const cacheKey = 'white_list';
      
      // 尝试从缓存获取
      const cachedData = await this.cache.get(cacheKey);
      let whiteList;
      
      if (typeof cachedData === "string") {
        whiteList = JSON.parse(cachedData) as string[];
      } else {
        // 从数据库查询
        const rules = (await this.db.getWhiteList()) as WhiteListRow[];
        
        // 拆分包含换行符的规则，每行作为独立规则
        whiteList = [] as string[];
        for (const ruleItem of rules) {
          const rule = ensureString(ruleItem.rule);
          if (!rule) {
            continue;
          }
          // 检查是否包含换行符
          if (rule.includes('\n') || rule.includes('\r')) {
            // 拆分成多行，去除空行和前后空格
            const splitRules = rule.split(/\r?\n/)
                                  .map(r => r.trim())
                                  .filter(r => r.length > 0);
            whiteList.push(...splitRules);
          } else {
            // 单行规则直接添加
            whiteList.push(rule);
          }
        }
        
        // 24小时缓存，只在数据修改时主动清除
        await this.cache.set(cacheKey, JSON.stringify(whiteList), 86400);
      }

      // 生成 ETAG
      const etag = generateETag(whiteList);
      
      // 检查 IF-NONE-MATCH 头
      if (isETagMatch(request, etag)) {
        return createNotModifiedResponse(etag);
      }

      // 返回带 ETAG 的响应
      return createETagResponse(whiteList, etag);
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // 提交流量数据
  async submitTraffic(request) {
    try {
      const authResult = await validateSogaAuth(request, this.env);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({
            code: 401,
            message: authResult.message,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const trafficData = await request.json();
      const nodeId = authResult.nodeId;

      // 批量更新用户流量
      await this.db.updateUserTraffic(trafficData, nodeId);

      // 清除相关缓存
      for (const traffic of trafficData) {
        await this.cache.delete(`user_${traffic.id}_traffic`);
      }

      return new Response(
        JSON.stringify({
          code: 0,
          message: "Success",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // 提交在线 IP
  async submitAliveIP(request) {
    try {
      const authResult = await validateSogaAuth(request, this.env);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({
            code: 401,
            message: authResult.message,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const aliveData = await request.json();
      const nodeId = authResult.nodeId;

      // 更新用户在线IP
      await this.db.updateUserAliveIPs(aliveData, nodeId);

      return new Response(
        JSON.stringify({
          code: 0,
          message: "Success",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // 提交审计日志
  async submitAuditLog(request) {
    try {
      const authResult = await validateSogaAuth(request, this.env);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({
            code: 401,
            message: authResult.message,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const auditData = await request.json();
      const nodeId = authResult.nodeId;

      // 记录审计日志
      await this.db.insertAuditLogs(auditData, nodeId);

      return new Response(
        JSON.stringify({
          code: 0,
          message: "Success",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // 提交节点状态
  async submitNodeStatus(request) {
    try {
      const authResult = await validateSogaAuth(request, this.env);
      if (!authResult.success) {
        return new Response(
          JSON.stringify({
            code: 401,
            message: authResult.message,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const statusData = await request.json();
      const nodeId = authResult.nodeId;

      // 记录节点状态
      await this.db.insertNodeStatus(statusData, nodeId);

      // 更新节点状态缓存
      const cacheKey = `node_status_${nodeId}`;
      await this.cache.set(cacheKey, JSON.stringify(statusData), 300);

      return new Response(
        JSON.stringify({
          code: 0,
          message: "Success",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}
