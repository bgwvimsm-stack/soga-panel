import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createAdminSharedIdRouter(ctx: AppContext) {
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

  router.get("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const data = await ctx.dbService.listSharedIds();
    return successResponse(res, data);
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { name, fetch_url, remote_account_id, status } = req.body || {};
    if (!name || !fetch_url || !remote_account_id) return errorResponse(res, "参数缺失", 400);
    await ctx.dbService.createSharedId({
      name,
      fetchUrl: fetch_url,
      remoteAccountId: Number(remote_account_id),
      status: status ?? 1
    });
    return successResponse(res, null, "已创建");
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.updateSharedId(id, {
      name: req.body?.name,
      fetchUrl: req.body?.fetch_url,
      remoteAccountId: req.body?.remote_account_id ? Number(req.body.remote_account_id) : undefined,
      status: req.body?.status
    });
    return successResponse(res, null, "已更新");
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.deleteSharedId(id);
    return successResponse(res, null, "已删除");
  });

  return router;
}
