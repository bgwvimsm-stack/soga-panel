import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { AnnouncementService } from "../../services/announcement";

export function createAdminAnnouncementRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const service = new AnnouncementService(ctx.dbService);

  const requireAdmin = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) {
      errorResponse(res, "需要管理员权限", 403);
      return null;
    }
    return user;
  };

  router.get("/", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    const data = await service.listAdmin(page, limit);
    return successResponse(res, data);
  });

  router.post("/", async (req: Request, res: Response) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { title, content, type, status, is_pinned, priority } = req.body || {};
    if (!title || !content) return errorResponse(res, "标题和内容不能为空", 400);
    const created = await service.create({
      title,
      content,
      type,
      status,
      is_pinned,
      priority,
      created_by: Number(admin.id)
    });
    return successResponse(res, created, "创建成功");
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "参数错误", 400);
    const updated = await service.update(id, req.body || {});
    return successResponse(res, updated, "更新成功");
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "参数错误", 400);
    await service.delete(id);
    return successResponse(res, null, "删除成功");
  });

  return router;
}
