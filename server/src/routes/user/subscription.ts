import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { errorResponse, successResponse } from "../../utils/response";
import {
  generateClashConfig,
  generateQuantumultXConfig,
  generateShadowrocketConfig,
  generateSurgeConfig,
  generateV2rayConfig,
  type SubscriptionUser,
  type SubscriptionNode
} from "../../utils/subscription";
import { ensureNumber } from "../../utils/d1";

const GENERATORS = {
  v2ray: generateV2rayConfig,
  clash: generateClashConfig,
  quantumultx: generateQuantumultXConfig,
  shadowrocket: generateShadowrocketConfig,
  surge: generateSurgeConfig
};

const CONTENT_TYPES = {
  v2ray: "text/plain",
  clash: "text/yaml",
  quantumultx: "text/plain",
  shadowrocket: "text/plain",
  surge: "text/plain"
};

const FILE_EXTENSIONS = {
  v2ray: "txt",
  clash: "yaml",
  quantumultx: "txt",
  shadowrocket: "txt",
  surge: "conf"
};

type SubscriptionType = keyof typeof GENERATORS;

export function createSubscriptionRouter(ctx: AppContext) {
  const router = Router();

  router.get("/v2ray", (req, res) => handleSubscription(ctx, "v2ray", req, res));
  router.get("/clash", (req, res) => handleSubscription(ctx, "clash", req, res));
  router.get("/quantumultx", (req, res) => handleSubscription(ctx, "quantumultx", req, res));
  router.get("/shadowrocket", (req, res) => handleSubscription(ctx, "shadowrocket", req, res));
  router.get("/surge", (req, res) => handleSubscription(ctx, "surge", req, res));

  return router;
}

async function handleSubscription(ctx: AppContext, type: SubscriptionType, req: Request, res: Response) {
  try {
    const token = req.query.token as string | undefined;
    if (!token) return errorResponse(res, "缺少订阅 token", 400);

    const userRow = await ctx.dbService.db
      .prepare("SELECT * FROM users WHERE token = ? AND status = 1")
      .bind(token)
      .first<SubscriptionUser>();

    if (!userRow) return errorResponse(res, "订阅 token 无效", 401);

    // 过期检查
    if (userRow.expire_time) {
      const expireDate = userRow.expire_time instanceof Date ? userRow.expire_time : new Date(userRow.expire_time);
      if (Number.isFinite(expireDate.getTime()) && expireDate.getTime() < Date.now()) {
        return errorResponse(res, "账号已过期", 403);
      }
    }

    // 流量检查
    const totalTraffic = ensureNumber(userRow.transfer_total);
    const trafficQuota = ensureNumber(userRow.transfer_enable);
    if (trafficQuota > 0 && totalTraffic >= trafficQuota) {
      return errorResponse(res, "流量已用完", 403);
    }

    await ctx.dbService.db
      .prepare(
        `
        INSERT INTO subscriptions (user_id, type, request_ip, request_user_agent)
        VALUES (?, ?, ?, ?)
      `
      )
      .bind(userRow.id, type, req.ip || "", req.headers["user-agent"] || "")
      .run();

    const nodes = (await ctx.dbService.getUserAccessibleNodes(Number(userRow.id))) as any as SubscriptionNode[];
    if (!nodes.length) return errorResponse(res, "暂无可用节点", 404);

    const generator = GENERATORS[type];
    const contentType = CONTENT_TYPES[type];
    const extension = FILE_EXTENSIONS[type];
    const config = generator(nodes, userRow);
    const filename = `${type}_subscription.${extension}`;
    const uploadTraffic = ensureNumber(userRow.upload_traffic);
    const downloadTraffic = ensureNumber(userRow.download_traffic);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename=${filename}`,
      "Profile-Update-Interval": "24",
      "Subscription-Userinfo": `upload=${uploadTraffic}; download=${downloadTraffic}; total=${trafficQuota}; expire=${getExpireTimestamp(
        userRow.expire_time
      )}`
    };

    return res.status(200).set(headers).send(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(res, message, 500);
  }
}

function getExpireTimestamp(expireTime: SubscriptionUser["expire_time"]): number {
  if (!expireTime) return 0;
  const date = expireTime instanceof Date ? expireTime : new Date(expireTime);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}
