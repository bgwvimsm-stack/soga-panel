// src/middleware/auth.js - 认证中间件

import type { Env } from "../types";
import { CacheService } from "../services/cache";
import { verifyToken } from "../utils/crypto";

export async function validateSogaAuth(request: Request, env: Env) {
  const headers = request.headers;
  const apiKey = headers.get("API-KEY");
  const nodeId = headers.get("NODE-ID");
  const nodeType = headers.get("NODE-TYPE");

  if (!apiKey || !nodeId || !nodeType) {
    return {
      success: false,
      message: "Missing required headers",
    };
  }

  if (apiKey !== env.WEBAPI_KEY) {
    return {
      success: false,
      message: "Invalid API key",
    };
  }

  return {
    success: true,
    nodeId: parseInt(nodeId),
    nodeType: nodeType.toLowerCase(),
  };
}

export async function validateUserAuth(request: Request, env: Env) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      message: "Missing or invalid authorization header",
    };
  }

  const token = authHeader.substring(7);

  try {
    // 验证 JWT Token
    const payload = await verifyToken(token, env.JWT_SECRET);

    if (!payload) {
      return { success: false, message: "Invalid or expired token" };
    }

    // 从缓存获取会话信息
    const cacheService = new CacheService(env.DB);
    const userSession = await cacheService.get(`session_${token}`);

    if (!userSession || typeof userSession !== "string") {
      return { success: false, message: "Session not found" };
    }

    const user = JSON.parse(userSession);
    return { success: true, user };
  } catch (error) {
    console.error("Token validation error:", error);
    return { success: false, message: "Token validation failed" };
  }
}

export async function validateAdminAuth(request: Request, env: Env) {
  const authResult = await validateUserAuth(request, env);

  if (!authResult.success) {
    return authResult;
  }

  if (!authResult.user.is_admin) {
    return {
      success: false,
      message: "Admin access required",
    };
  }

  return authResult;
}
