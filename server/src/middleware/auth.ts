import type { Request, Response, NextFunction } from "express";
import type { AppContext } from "../types";
import { errorResponse } from "../utils/response";
import { ensureNumber } from "../utils/d1";

export function createAuthMiddleware(ctx: AppContext) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const tokenFromHeader =
      typeof req.headers.authorization === "string"
        ? parseAuthHeader(req.headers.authorization)
        : null;
    const tokenFromBody = typeof req.body?.token === "string" ? req.body.token : null;
    const token = tokenFromHeader || tokenFromBody;

    if (!token) {
      return errorResponse(res, "未登录", 401);
    }

    const session = await ctx.cache.get(`session_${token}`);
    if (!session) {
      return errorResponse(res, "登录已过期", 401);
    }

    try {
      const payload = JSON.parse(session);
      (req as any).user = payload;
      (req as any).sessionToken = token;

      // 附加的等级到期检查：如果 class 已过期，立即重置
      const userId = ensureNumber(payload.id);
      if (userId > 0) {
        const userRow = await ctx.dbService.getUserById(userId);
        if (!userRow || Number(userRow.status ?? 0) !== 1) {
          await ctx.cache.delete(`session_${token}`);
          return errorResponse(res, "账户已禁用或不存在", 401);
        }
        if (userRow.class_expire_time && Number(userRow.class ?? 0) > 0) {
          const expireAt = new Date(userRow.class_expire_time);
          if (Number.isFinite(expireAt.getTime()) && expireAt.getTime() <= Date.now()) {
            await ctx.dbService.resetUserLevel(userId, userRow as any);
          }
        }
      }
    } catch {
      return errorResponse(res, "会话无效", 401);
    }

    return next();
  };
}

function parseAuthHeader(header?: string) {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return null;
}
