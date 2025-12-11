import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ensureNumber } from "../../utils/d1";

export function createAdminRebateRouter(ctx: AppContext) {
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

  router.get("/users", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const data = await ctx.dbService.listUsersWithBalance(page, pageSize);
    return successResponse(res, data);
  });

  router.get("/transactions", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const inviterId = req.query.inviter_id ? Number(req.query.inviter_id) : null;
    const data = await ctx.dbService.listRebateTransactions(page, pageSize, inviterId || undefined);
    return successResponse(res, data);
  });

  router.post("/transfer", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { user_id, amount } = req.body || {};
    const uid = Number(user_id);
    const amt = ensureNumber(amount, 0);
    if (!uid || amt <= 0) return errorResponse(res, "参数无效", 400);
    try {
      const userRow = await ctx.dbService.db
        .prepare("SELECT money, rebate_available FROM users WHERE id = ?")
        .bind(uid)
        .first<{ money?: number; rebate_available?: number }>();
      if (!userRow) return errorResponse(res, "用户不存在", 404);
      const balanceBefore = Number(userRow.money ?? 0);
      const rebateBefore = Number(userRow.rebate_available ?? 0);
      await ctx.dbService.transferRebateToBalance(uid, amt);
      await ctx.dbService.insertRebateTransfer({
        userId: uid,
        amount: amt,
        balanceBefore,
        balanceAfter: balanceBefore + amt,
        rebateBefore,
        rebateAfter: rebateBefore - amt
      });
      return successResponse(res, null, "划转成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }
  });

  router.get("/transfers", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const userId = Number(req.query.user_id ?? 0);
    if (!userId) return errorResponse(res, "user_id 必填", 400);
    const limit = Number(req.query.limit ?? 20) || 20;
    const rows = await ctx.dbService.listRebateTransfers(userId, Math.min(limit, 200));
    return successResponse(res, rows);
  });

  return router;
}
