import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { AnnouncementService } from "../../services/announcement";

export function createAdminAnnouncementRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const service = new AnnouncementService(ctx.dbService, ctx.env);

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
    const { title, content, type, status, is_pinned, priority, notification_channels, notification_min_class } = req.body || {};
    if (!title || !content) return errorResponse(res, "标题和内容不能为空", 400);
    const normalizedChannels = normalizeNotificationChannels(notification_channels);
    if (
      hasNotificationChannelInput(notification_channels) &&
      normalizedChannels.length === 0
    ) {
      return errorResponse(res, "通知方式无效", 400);
    }
    try {
      const created = await service.create({
        title,
        content,
        type,
        status,
        is_pinned,
        priority,
        notification_channels: normalizedChannels,
        notification_min_class,
        created_by: Number(admin.id)
      });
      return successResponse(res, created, "创建成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message.includes("通知方式无效") || message.includes("VIP等级无效") ? 400 : 500;
      return errorResponse(res, message || "创建失败", statusCode);
    }
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

function hasNotificationChannelInput(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function normalizeNotificationChannels(value: unknown) {
  const supported = new Set(["email", "bark"]);
  const source = extractChannelList(value);
  const normalized = source
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter((item) => supported.has(item));
  return Array.from(new Set(normalized));
}

function extractChannelList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? ""));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item ?? ""));
        }
      } catch {
        // ignore parse error and fallback to comma split
      }
    }
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}
