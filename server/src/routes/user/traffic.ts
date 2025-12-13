import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { TrafficService } from "../../services/traffic";
import { errorResponse, successResponse } from "../../utils/response";

export function createTrafficRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const trafficService = new TrafficService(ctx.dbService);

  router.get("/user/trends", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const days = Number(req.query.days ?? 7) || 7;
    const data = await trafficService.getUserTrafficTrends(Number(user.id), Math.min(days, 90));
    return successResponse(res, data);
  });

  router.get("/user/summary", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const data = await trafficService.getUserTrafficSummary(Number(user.id));
    return successResponse(res, data);
  });

  router.get("/admin/overview", async (req: Request, res: Response) => {
    // 简易：仅管理员可用
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const days = Number(req.query.days ?? 30) || 30;
    const data = await trafficService.getSystemTrafficOverview(Math.min(days, 365));
    return successResponse(res, data);
  });

  return router;
}
