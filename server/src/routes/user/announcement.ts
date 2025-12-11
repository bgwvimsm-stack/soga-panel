import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { AnnouncementService } from "../../services/announcement";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createAnnouncementRouter(ctx: AppContext) {
  const router = Router();
  const service = new AnnouncementService(ctx.dbService);

  // 用户端
  router.get("/", async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 10) || 10;
    const offset = Number(req.query.offset ?? 0) || 0;
    const data = await service.listPublic(Math.min(limit, 100), Math.max(offset, 0));
    return successResponse(res, data);
  });

  // 管理员端
  router.use(createAuthMiddleware(ctx));
  router.get("/admin/list", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Number(req.query.limit ?? 20) || 20;
    const data = await service.listAdmin(page, Math.min(limit, 100));
    return successResponse(res, data);
  });

  router.post("/admin", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { title, content, type, status, is_pinned, priority } = req.body || {};
    if (!title || !content) return errorResponse(res, "标题和内容不能为空", 400);
    const created = await service.create({
      title,
      content,
      type,
      status,
      is_pinned,
      priority,
      created_by: Number(user.id)
    });
    return successResponse(res, created, "创建成功");
  });

  router.put("/admin/:id", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "参数错误", 400);
    const updated = await service.update(id, req.body || {});
    return successResponse(res, updated, "更新成功");
  });

  router.delete("/admin/:id", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "参数错误", 400);
    await service.delete(id);
    return successResponse(res, null, "删除成功");
  });

  return router;
}
