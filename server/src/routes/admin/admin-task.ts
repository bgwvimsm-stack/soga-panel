import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createAdminTaskRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  const ensureAdmin = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) {
      errorResponse(res, "需要管理员权限", 403);
      return null;
    }
    return user;
  };

  router.get("/traffic-reset-preview", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const users = await ctx.dbService.listTrafficResetTasks();
    return successResponse(res, users);
  });

  router.post("/traffic-reset", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const ids = (req.body?.user_ids as number[]) || [];
    if (!Array.isArray(ids) || ids.length === 0) {
      await ctx.dbService.resetTodayBandwidth();
      return successResponse(res, null, "已重置全部用户今日流量");
    }
    await ctx.db.db
      .prepare(
        `
        UPDATE users 
        SET upload_today = 0, download_today = 0, transfer_today = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${ids.map(() => "?").join(",")})
      `
      )
      .bind(...ids)
      .run();
    return successResponse(res, null, `已重置 ${ids.length} 个用户今日流量`);
  });

  router.post("/traffic-aggregate", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { date } = req.body || {};
    const target = typeof date === "string" && date.trim() ? date.trim().slice(0, 10) : null;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const d = target
      ? target
      : (() => {
          const t = new Date(now);
          t.setDate(t.getDate() - 1);
          return t.toISOString().slice(0, 10);
        })();
    const result = await ctx.dbService.aggregateTrafficForDate(d);
    return successResponse(res, { record_date: d, ...result }, "汇总完成");
  });

  return router;
}
