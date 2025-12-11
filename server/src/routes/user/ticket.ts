import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { TicketService } from "../../services/ticket";

export function createTicketRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const service = new TicketService(ctx.dbService);

  router.get("/user", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Number(req.query.pageSize ?? 10) || 10;
    const status = typeof req.query.status === "string" ? (req.query.status as any) : undefined;
    const data = await service.listUserTickets(Number(user.id), page, Math.min(pageSize, 50), status);
    return successResponse(res, data);
  });

  router.post("/user", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { title, content } = req.body || {};
    if (!title || !content) return errorResponse(res, "标题和内容不能为空", 400);
    const ticket = await service.createTicket(Number(user.id), title, content);
    return successResponse(res, ticket, "工单已提交");
  });

  router.get("/user/:id", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const detail = await service.getUserTicketDetailWithReplies(id, Number(user.id));
    if (!detail) return errorResponse(res, "未找到工单", 404);
    return successResponse(res, detail);
  });

  router.get("/user/unread-count", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const count = await service.countUserUnread(Number(user.id));
    return successResponse(res, { unread: count });
  });

  router.post("/user/:id/replies", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const ticket = await service.getTicketDetail(id);
    if (!ticket || Number(ticket.user_id) !== Number(user.id)) return errorResponse(res, "未找到工单", 404);
    const { content } = req.body || {};
    if (!content) return errorResponse(res, "回复内容不能为空", 400);
    const result = await service.replyTicket(id, Number(user.id), "user", content);
    return successResponse(res, result, "回复成功");
  });

  router.post("/user/:id/close", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const id = Number(req.params.id);
    const result = await service.closeTicketByUser(id, Number(user.id));
    if (!result.success) return errorResponse(res, result.message || "关闭失败", 400);
    return successResponse(res, { status: result.status }, "工单已关闭");
  });

  // 管理员
  router.get("/admin", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Number(req.query.pageSize ?? 20) || 20;
    const data = await service.listAdminTickets(page, Math.min(pageSize, 100));
    return successResponse(res, data);
  });

  router.get("/admin/:id", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const id = Number(req.params.id);
    const detail = await service.getAdminTicketDetailWithReplies(id);
    if (!detail) return errorResponse(res, "未找到工单", 404);
    return successResponse(res, detail);
  });

  router.post("/admin/:id/replies", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const id = Number(req.params.id);
    const { content } = req.body || {};
    if (!content) return errorResponse(res, "回复内容不能为空", 400);
    const result = await service.replyTicket(id, Number(user.id), "admin", content);
    return successResponse(res, result, "回复成功");
  });

  router.post("/admin/:id/status", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!["open", "answered", "closed"].includes(status)) return errorResponse(res, "状态无效", 400);
    await service.updateStatus(id, status);
    return successResponse(res, null, "状态已更新");
  });

  return router;
}
