import type { Request, Response, NextFunction } from "express";
import { errorResponse } from "../utils/response";

export function require2fa(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return errorResponse(res, "未登录", 401);
  // 预留：如果需要强制校验 2FA 状态，可以在 user 上附带标记
  return next();
}
