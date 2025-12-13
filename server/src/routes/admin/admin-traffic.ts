import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { TrafficService } from "../../services/traffic";

export function createAdminTrafficRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const trafficService = new TrafficService(ctx.dbService);

  const ensureAdmin = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) {
      errorResponse(res, "需要管理员权限", 403);
      return null;
    }
    return user;
  };

  router.get("/overview", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const days = Number(req.query.days ?? 30) || 30;
    const data = await trafficService.getSystemTrafficOverview(Math.min(days, 365));
    return successResponse(res, data);
  });

  router.get("/trends", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const days = Number(req.query.days ?? 30) || 30;
    const data = await trafficService.getSystemTrafficOverview(Math.min(days, 365));
    return successResponse(res, data);
  });

  router.post("/daily-reset", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    await ctx.dbService.resetTodayBandwidth();
    return successResponse(res, null, "已执行每日流量重置");
  });

  router.get("/daily", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const date = typeof req.query.date === "string" ? req.query.date.slice(0, 10) : undefined;
    const data = await ctx.dbService.listDailyTraffic({ date: date ?? null, page, pageSize });
    return successResponse(res, data);
  });

  router.get("/system-summary", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 365);
    const days = req.query.days ? Number(req.query.days) : undefined;
    const data = await ctx.dbService.listSystemTrafficSummaryPaged({ days, page, pageSize });
    return successResponse(res, data);
  });

  router.post("/reset-today", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    await ctx.dbService.resetTodayBandwidth();
    return successResponse(res, null, "已重置今日流量");
  });

  return router;
}
