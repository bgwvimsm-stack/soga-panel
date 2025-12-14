import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { TicketService } from "../../services/ticket";

export function createAdminTicketRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const service = new TicketService(ctx.dbService);

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
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 100);
    const status = typeof req.query.status === "string" ? (req.query.status as any) : undefined;
    const data = await service.listAdminTickets(page, pageSize, status);
    return successResponse(res, data);
  });

  router.get("/pending-count", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const count = await service.countAdminPending();
    return successResponse(res, { count });
  });

  router.get("/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "无效的工单ID", 400);
    const detail: any = await service.getAdminTicketDetailWithReplies(id);
    if (!detail) return errorResponse(res, "未找到工单", 404);

    // 保险：如果内容缺失，补充一次查询确保正文返回
    if (!detail.ticket.content) {
      const raw = await service.getTicketDetail(id);
      if (raw?.content) {
        detail.ticket.content = raw.content;
      }
    }

    return successResponse(res, detail);
  });

  router.post("/:id/replies", async (req: Request, res: Response) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "无效的工单ID", 400);
    const { content, status: statusRaw } = req.body || {};
    if (!content) return errorResponse(res, "回复内容不能为空", 400);
    const status =
      typeof statusRaw === "string" && ["open", "answered", "closed"].includes(statusRaw)
        ? (statusRaw as "open" | "answered" | "closed")
        : undefined;
    const exists = await service.getTicketDetail(id);
    if (!exists) return errorResponse(res, "未找到工单", 404);
    const nextStatus = await service.replyTicket(id, Number(admin.id), "admin", content, status ?? "answered");
    const replies = await service.listReplies(id);
    return successResponse(res, { replies, status: nextStatus }, "回复成功");
  });

  router.post("/:id/status", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "无效的工单ID", 400);
    const { status } = req.body || {};
    if (!["open", "answered", "closed"].includes(status)) return errorResponse(res, "状态无效", 400);
    await service.updateStatus(id, status);
    return successResponse(res, { status }, "状态已更新");
  });

  return router;
}
