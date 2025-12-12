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

async function resolveSiteName(ctx: AppContext): Promise<string> {
  try {
    const configs = await ctx.dbService.listSystemConfigsMap();
    if (configs.site_name && typeof configs.site_name === "string") {
      return configs.site_name;
    }
  } catch {
    // 忽略异常，回退到环境变量
  }
  if (ctx.env.SITE_NAME && typeof ctx.env.SITE_NAME === "string") {
    return ctx.env.SITE_NAME;
  }
  return "Soga Panel";
}

async function resolveSiteUrl(ctx: AppContext): Promise<string> {
  try {
    const configs = await ctx.dbService.listSystemConfigsMap();
    if (configs.site_url && typeof configs.site_url === "string") {
      return configs.site_url;
    }
  } catch {
    // 忽略异常，回退到环境变量
  }
  if (ctx.env.SITE_URL && typeof ctx.env.SITE_URL === "string") {
    return ctx.env.SITE_URL;
  }
  return "";
}

function sanitizeFilename(value: string): string {
  const cleaned = String(value)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "soga_panel";
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]*$/.test(value);
}

function forceAsciiFilename(value: string): string {
  const sanitized = sanitizeFilename(value);
  const ascii = sanitized
    .replace(/[^\x00-\x7F]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii.length > 0 ? ascii : "soga_panel";
}

function buildContentDisposition(filename: string): string {
  const fallback = forceAsciiFilename(filename);
  if (isAscii(filename)) {
    return `attachment; filename=${fallback}`;
  }
  const encoded = encodeURIComponent(filename);
  return `attachment; filename=${fallback}; filename*=UTF-8''${encoded}`;
}

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
    let filename: string;
    const siteUrl = await resolveSiteUrl(ctx);

    if (type === "clash" || type === "surge") {
      const siteName = await resolveSiteName(ctx);
      const safeSiteName = sanitizeFilename(siteName);
      filename = `${safeSiteName}.${extension}`;
    } else {
      filename = `${type}.${extension}`;
    }

    const config = generator(nodes, userRow);
    const uploadTraffic = ensureNumber(userRow.upload_traffic);
    const downloadTraffic = ensureNumber(userRow.download_traffic);

    const headers: Record<string, string> = {
      "content-type": contentType,
      "content-disposition": buildContentDisposition(filename),
      "profile-update-interval": "24",
      "subscription-userinfo": `upload=${uploadTraffic}; download=${downloadTraffic}; total=${trafficQuota}; expire=${getExpireTimestamp(
        userRow.expire_time
      )}`
    };

    if (siteUrl) {
      headers["profile-web-page-url"] = siteUrl;
    }

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
