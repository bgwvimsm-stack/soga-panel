import type { Request, Response, NextFunction } from "express";
import type { AppContext } from "../types";
import { errorResponse } from "../utils/response";

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
