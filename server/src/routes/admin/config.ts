import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createConfigRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  router.get("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const rows = await ctx.dbService.listSystemConfigs();
    return successResponse(res, rows);
  });

  router.put("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { key, value } = req.body || {};
    if (!key) return errorResponse(res, "key 必填", 400);
    await ctx.dbService.updateSystemConfig(String(key), String(value ?? ""));
    return successResponse(res, null, "已保存");
  });

  router.delete("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { key } = req.body || {};
    if (!key) return errorResponse(res, "key 必填", 400);
    await ctx.dbService.deleteSystemConfig(String(key));
    return successResponse(res, null, "已删除");
  });

  return router;
}
