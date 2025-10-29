// src/api/subscription.js - 订阅 API

import type { Env } from "../types";
import { DatabaseService } from "../services/database";
import { errorResponse } from "../utils/response";
import {
  generateV2rayConfig,
  generateClashConfig,
  generateQuantumultConfig,
  generateShadowrocketConfig,
  generateSurgeConfig,
} from "../utils/subscription";
import { ensureNumber } from "../utils/d1";

type SubscriptionType = "v2ray" | "clash" | "quantumult" | "shadowrocket" | "surge";

type SubscriptionUserRow = {
  id: number;
  expire_time: string | number | Date | null;
  transfer_total: number | string;
  transfer_enable: number | string;
  upload_traffic: number | string;
  download_traffic: number | string;
  [key: string]: unknown;
};

type SubscriptionNode = Record<string, unknown>;

type SubscriptionGenerator = (nodes: SubscriptionNode[], user: SubscriptionUserRow) => string;

const GENERATORS: Record<SubscriptionType, SubscriptionGenerator> = {
  v2ray: generateV2rayConfig,
  clash: generateClashConfig,
  quantumult: generateQuantumultConfig,
  shadowrocket: generateShadowrocketConfig,
  surge: generateSurgeConfig,
};

const CONTENT_TYPES: Record<SubscriptionType, string> = {
  v2ray: "text/plain",
  clash: "text/yaml",
  quantumult: "text/plain",
  shadowrocket: "text/plain",
  surge: "text/plain",
};

const FILE_EXTENSIONS: Record<SubscriptionType, string> = {
  v2ray: "txt",
  clash: "yaml",
  quantumult: "txt",
  shadowrocket: "txt",
  surge: "txt",
};

function isSupportedType(value: string | null): value is SubscriptionType {
  return value !== null && (value as SubscriptionType) in GENERATORS;
}

function getExpireTimestamp(expireTime: SubscriptionUserRow["expire_time"]): number {
  if (!expireTime) return 0;
  const date = expireTime instanceof Date ? expireTime : new Date(expireTime);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

export class SubscriptionAPI {
  private readonly db: DatabaseService;
  private readonly env: Env;

  constructor(env: Env) {
    this.db = new DatabaseService(env.DB);
    this.env = env;
  }

  async getSubscription(request: Request) {
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");
      const typeCandidate = url.pathname.split("/").pop() ?? null;

      if (!token) {
        return errorResponse("Missing subscription token", 400);
      }

      if (!isSupportedType(typeCandidate)) {
        return errorResponse("Unsupported format", 400);
      }

      return this._getSubscriptionByType(request, typeCandidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 500);
    }
  }

  // V2Ray订阅
  async getV2RaySubscription(request) {
    return this._getSubscriptionByType(request, "v2ray");
  }

  // Clash订阅
  async getClashSubscription(request) {
    return this._getSubscriptionByType(request, "clash");
  }

  // Quantumult订阅
  async getQuantumultSubscription(request) {
    return this._getSubscriptionByType(request, "quantumult");
  }

  // Shadowrocket订阅
  async getShadowrocketSubscription(request) {
    return this._getSubscriptionByType(request, "shadowrocket");
  }

  // Surge订阅
  async getSurgeSubscription(request) {
    return this._getSubscriptionByType(request, "surge");
  }

  // 通用订阅获取方法
  async _getSubscriptionByType(request: Request, type: SubscriptionType) {
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");

      if (!token) {
        return errorResponse("Missing subscription token", 400);
      }

      // 通过订阅令牌查找用户
      const userRow = await this.db.db
        .prepare("SELECT * FROM users WHERE token = ? AND status = 1")
        .bind(token)
        .first<SubscriptionUserRow>();

      if (!userRow) {
        return errorResponse("Invalid subscription token", 401);
      }

      const user = userRow as SubscriptionUserRow;

      // 检查用户是否过期
      if (user.expire_time) {
        const expireDate = user.expire_time instanceof Date ? user.expire_time : new Date(user.expire_time);
        if (Number.isFinite(expireDate.getTime()) && expireDate.getTime() < Date.now()) {
          return errorResponse("Account has expired", 403);
        }
      }

      // 检查流量是否用完
      const totalTraffic = ensureNumber(user.transfer_total);
      const trafficQuota = ensureNumber(user.transfer_enable);
      if (trafficQuota > 0 && totalTraffic >= trafficQuota) {
        return errorResponse("Account has expired", 403);
      }

      // 记录订阅请求
      await this.db.db
        .prepare(
          `
        INSERT INTO subscriptions (user_id, type, request_ip, request_user_agent)
        VALUES (?, ?, ?, ?)
      `
        )
        .bind(
          user.id,
          type,
          request.headers.get("CF-Connecting-IP") || "",
          request.headers.get("User-Agent") || ""
        )
        .run();

      // 获取用户可访问的节点
      const nodes = (await this.db.getUserAccessibleNodes(user.id)) as SubscriptionNode[];

      if (!nodes.length) {
        return errorResponse("No accessible nodes found", 404);
      }

      const generator = GENERATORS[type];
      const contentType = CONTENT_TYPES[type];
      const extension = FILE_EXTENSIONS[type];
      const config = generator(nodes, user);

      const uploadTraffic = ensureNumber(user.upload_traffic);
      const downloadTraffic = ensureNumber(user.download_traffic);

      return new Response(config, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${type}.${extension}"`,
          "Profile-Update-Interval": "24",
          "Subscription-Userinfo": `upload=${uploadTraffic}; download=${downloadTraffic}; total=${trafficQuota}; expire=${getExpireTimestamp(
            user.expire_time
          )}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 500);
    }
  }
}
