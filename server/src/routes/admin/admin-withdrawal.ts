import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createAdminWithdrawalRouter(ctx: AppContext) {
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
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const data = await ctx.dbService.listWithdrawals({ page, pageSize, status });
    return successResponse(res, data);
  });

  router.get("/pending", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await ctx.dbService.listPendingWithdrawals(200);
    return successResponse(res, rows);
  });

  router.post("/:id/review", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { status, note } = req.body || {};
    if (!["approved", "rejected", "paid"].includes(status)) return errorResponse(res, "状态无效", 400);

    await ctx.dbService.updateWithdrawalStatus(id, status, note, (req as any).user?.id ?? null);

    if (status === "rejected") {
      const row = await ctx.dbService.db
        .prepare("SELECT user_id, amount FROM rebate_withdrawals WHERE id = ?")
        .bind(id)
        .first<{ user_id?: number; amount?: number }>();
      if (row?.user_id && row.amount) {
        await ctx.dbService.db
          .prepare(
            `
            UPDATE users
            SET rebate_available = rebate_available + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
          )
          .bind(Number(row.amount), Number(row.user_id))
          .run();
      }
    }

    return successResponse(res, null, "已更新状态");
  });

  return router;
}
