import { Router, type Request, type Response } from "express";
import type { AppContext } from "../types";
import { errorResponse } from "../utils/response";
import { ensureNumber, ensureString } from "../utils/d1";
import { generateETag, isETagMatch, sendETagJson, sendNotModified } from "../utils/etag";

export function createNodeRouter(ctx: AppContext) {
  const router = Router();

  // 获取节点信息
  router.get("/v1/node", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);

    const node = await ctx.dbService.getNode(auth.nodeId);
    if (!node) return errorResponse(res, "节点不存在", 404);

    const bandwidthLimit = ensureNumber(node.node_bandwidth_limit, 0);
    if (bandwidthLimit > 0 && ensureNumber(node.node_bandwidth, 0) > bandwidthLimit) {
      return errorResponse(res, "节点流量限制", 404);
    }

    const nodeConfigRaw = ensureString(node.node_config, "{}") || "{}";
    const nodeConfigJson = safeJson(nodeConfigRaw, {});
    const responseConfig = {
      basic: nodeConfigJson.basic || { pull_interval: 60, push_interval: 60, speed_limit: 0 },
      config: nodeConfigJson.config || {}
    };

    return res.status(200).json(responseConfig);
  });

  // 获取节点用户
  router.get("/v1/users", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);

    const users = await ctx.dbService.getNodeUsers(auth.nodeId);
    // 格式化 password 字段兼容 SS/Trojan
    const formatted = users.map((u) => ({
      id: u.id,
      uuid: u.uuid,
      password: u.password ?? u.passwd,
      speed_limit: u.speed_limit || 0,
      device_limit: u.device_limit || 0,
      tcp_limit: u.tcp_limit || 0
    }));
    return res.json(formatted);
  });

  // 审计规则
  router.get("/v1/audit_rules", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);
    const cacheKey = "audit_rules";
    let rulesJson: string | null = null;
    let rules: Array<{ id: number; rule: string | null }> = [];

    try {
      // 尝试从缓存读取
      rulesJson = await ctx.cache.get(cacheKey);
    } catch {
      rulesJson = null;
    }

    if (rulesJson) {
      try {
        rules = JSON.parse(rulesJson);
      } catch {
        rules = [];
      }
    }

    if (!rules.length) {
      const dbRows = (await ctx.dbService.getAuditRules()) as Array<{ id: number; rule?: string | null }>;
      rules = dbRows.map((row) => ({
        id: row.id,
        rule: typeof row.rule === "string" ? row.rule : null
      }));
      try {
        await ctx.cache.set(cacheKey, JSON.stringify(rules), 86400);
      } catch {
        // 忽略缓存失败
      }
    }

    const etag = generateETag(rules);
    if (isETagMatch(req, etag)) {
      return sendNotModified(res, etag);
    }

    return sendETagJson(res, rules, etag);
  });

  // 白名单
  router.get("/v1/white_list", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);
    const cacheKey = "white_list";
    let whiteListJson: string | null = null;
    let whiteList: string[] = [];

    try {
      whiteListJson = await ctx.cache.get(cacheKey);
    } catch {
      whiteListJson = null;
    }

    if (whiteListJson) {
      try {
        whiteList = JSON.parse(whiteListJson);
      } catch {
        whiteList = [];
      }
    }

    if (!whiteList.length) {
      const dbRows = (await ctx.dbService.getWhiteList()) as Array<{ rule?: string | null }>;
      const flattened: string[] = [];
      for (const row of dbRows) {
        const rule = typeof row.rule === "string" ? row.rule : "";
        if (!rule) continue;
        if (rule.includes("\n") || rule.includes("\r")) {
          const parts = rule
            .split(/\r?\n/)
            .map((r) => r.trim())
            .filter((r) => r.length > 0);
          flattened.push(...parts);
        } else {
          flattened.push(rule);
        }
      }
      whiteList = flattened;
      try {
        await ctx.cache.set(cacheKey, JSON.stringify(whiteList), 86400);
      } catch {
        // 忽略缓存失败
      }
    }

    const etag = generateETag(whiteList);
    if (isETagMatch(req, etag)) {
      return sendNotModified(res, etag);
    }

    return sendETagJson(res, whiteList, etag);
  });

  // 流量上报
  router.post("/v1/traffic", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);
    const data = Array.isArray(req.body) ? req.body : [];
    await ctx.dbService.updateUserTraffic(data, auth.nodeId);
    return res.json({ code: 0, message: "ok" });
  });

  // 在线 IP 上报
  router.post("/v1/alive_ip", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);
    const data = Array.isArray(req.body) ? req.body : [];
    await ctx.dbService.updateUserAliveIPs(data, auth.nodeId);
    return res.json({ code: 0, message: "ok" });
  });

  // 审计日志
  router.post("/v1/audit_log", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);
    const data = Array.isArray(req.body) ? req.body : [];
    await ctx.dbService.insertAuditLogs(data, auth.nodeId);
    return res.json({ code: 0, message: "ok" });
  });

  // 节点状态
  router.post("/v1/status", async (req: Request, res: Response) => {
    const auth = validateSogaAuth(req, ctx.env.NODE_API_KEY);
    if (!auth.success) return errorResponse(res, auth.message, 401);
    const body = typeof req.body === "object" && req.body ? req.body : {};
    await ctx.dbService.insertNodeStatus(body, auth.nodeId);
    return res.json({ code: 0, message: "ok" });
  });

  return router;
}

function validateSogaAuth(
  req: Request,
  expectedKey?: string
): { success: true; nodeId: number } | { success: false; message: string } {
  const apiKey =
    (req.headers["api-key"] as string | undefined) ||
    (req.headers["x-api-key"] as string | undefined);
  const nodeId =
    (req.headers["node-id"] as string | undefined) ||
    (req.headers["x-node-id"] as string | undefined);
  if (!apiKey || !nodeId) return { success: false, message: "缺少认证信息" };

  if (expectedKey && apiKey !== expectedKey) {
    return { success: false, message: "认证失败" };
  }

  return { success: true, nodeId: Number(nodeId) || 0 };
}

function safeJson(raw: string, fallback: any) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
