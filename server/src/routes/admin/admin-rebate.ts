import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ensureNumber } from "../../utils/d1";
import { fixMoneyPrecision } from "../../utils/money";
import { ReferralService } from "../../services/referral";

export function createAdminRebateRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const referralService = new ReferralService(ctx.dbService);

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

  // 提现申请列表（管理员查看）
  router.get("/withdrawals", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const limit = Math.max(Math.min(Number(req.query.limit ?? 20) || 20, 200), 1);
    const status =
      typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;

    const data = await ctx.dbService.listWithdrawals({ page, pageSize: limit, status });
    const total = data.total ?? 0;
    const records =
      (data.data || []).map((row: any) => ({
        id: Number(row.id),
        userId: Number(row.user_id),
        email: row.email ?? "",
        username: row.username ?? "",
        amount: fixMoneyPrecision(Number(row.amount ?? 0)),
        method: String(row.method ?? ""),
        status: String(row.status ?? ""),
        accountPayload: row.account_payload
          ? (() => {
              try {
                return JSON.parse(String(row.account_payload));
              } catch {
                return null;
              }
            })()
          : null,
        reviewNote: row.review_note != null ? String(row.review_note) : "",
        feeRate: Number(row.fee_rate ?? 0),
        feeAmount: fixMoneyPrecision(Number(row.fee_amount ?? 0)),
        createdAt: row.created_at != null ? String(row.created_at) : "",
        updatedAt: row.updated_at != null ? String(row.updated_at) : "",
        processedAt: row.processed_at != null ? String(row.processed_at) : ""
      })) || [];

    return successResponse(res, {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  });

  // 管理员审核提现
  router.post("/withdrawals/review", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { id, status, note } = req.body || {};
    const withdrawalId = Number(id);
    if (!withdrawalId) return errorResponse(res, "缺少提现申请 ID", 400);
    const allowed = new Set(["approved", "rejected", "paid"]);
    if (!allowed.has(String(status))) return errorResponse(res, "状态无效", 400);

    await ctx.dbService.updateWithdrawalStatus(
      withdrawalId,
      String(status),
      note ?? null,
      (req as any).user?.id ?? null
    );

    if (status === "rejected") {
      const row = await ctx.dbService.db
        .prepare("SELECT user_id, amount FROM rebate_withdrawals WHERE id = ?")
        .bind(withdrawalId)
        .first<{ user_id?: number; amount?: number }>();
      if (row?.user_id && row.amount) {
        const amountNum = Number(row.amount);
        await ctx.dbService.db
          .prepare(
            `
            UPDATE users
            SET rebate_available = rebate_available + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
          )
          .bind(amountNum, Number(row.user_id))
          .run();

        await referralService.insertUserTransaction({
          userId: Number(row.user_id),
          amount: amountNum,
          eventType: "withdraw_revert",
          sourceType: "withdraw",
          sourceId: withdrawalId,
          tradeNo: null,
          remark: "withdraw_revert"
        });
      }
    }

    return successResponse(res, { id: withdrawalId, status }, "已更新状态");
  });

  return router;
}
