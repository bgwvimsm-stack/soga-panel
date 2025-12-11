import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ensureNumber } from "../../utils/d1";

export function createRebateRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  router.get("/balance", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const row = await ctx.dbService.db
      .prepare("SELECT rebate_available, rebate_total, money FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ rebate_available?: number; rebate_total?: number; money?: number }>();
    return successResponse(res, {
      rebate_available: Number(row?.rebate_available ?? 0),
      rebate_total: Number(row?.rebate_total ?? 0),
      balance: Number(row?.money ?? 0)
    });
  });

  router.post("/withdraw", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { amount, method, account } = req.body || {};
    const amt = ensureNumber(amount, 0);
    if (amt <= 0) return errorResponse(res, "金额无效", 400);
    if (amt < 10) return errorResponse(res, "单次提现需大于等于 10", 400);
    try {
      await ctx.dbService.reduceRebateOnWithdrawal(Number(user.id), amt);
      await ctx.dbService.createWithdrawalRequest({
        userId: Number(user.id),
        amount: amt,
        method: method || "manual",
        accountPayload: account
      });
      return successResponse(res, null, "提现申请已提交");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }
  });

  router.get("/transfers", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const limit = Number(req.query.limit ?? 20) || 20;
    const rows = await ctx.dbService.listRebateTransfers(Number(user.id), Math.min(limit, 200));
    return successResponse(res, rows);
  });

  router.get("/withdrawals", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const limit = Number(req.query.limit ?? 20) || 20;
    const rows = await ctx.dbService.listUserWithdrawals(Number(user.id), Math.min(limit, 200));
    return successResponse(res, rows);
  });

  router.get("/transactions", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 20) || 20, 200);
    const data = await ctx.dbService.listRebateTransactions(page, pageSize, Number(user.id));
    return successResponse(res, data);
  });

  // 兼容前端：返利流水
  router.get("/ledger", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const page = Number(req.query.page ?? 1) || 1;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 200);
    const eventType = typeof req.query.event_type === "string" ? req.query.event_type : undefined;
    const filters: string[] = ["rt.inviter_id = ?"];
    const values: any[] = [Number(user.id)];
    if (eventType) {
      filters.push("rt.event_type = ?");
      values.push(eventType);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const offset = (page - 1) * limit;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT rt.*, iu.email as invitee_email
        FROM rebate_transactions rt
        LEFT JOIN users iu ON rt.invitee_id = iu.id
        ${where}
        ORDER BY rt.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...values, limit, offset)
      .all();
    const totalRow = await ctx.dbService.db
      .prepare(`SELECT COUNT(*) as total FROM rebate_transactions rt ${where}`)
      .bind(...values)
      .first<{ total?: number }>();
    return successResponse(res, {
      data: rows.results || [],
      total: Number(totalRow?.total ?? 0),
      page,
      limit,
      pagination: {
        total: Number(totalRow?.total ?? 0),
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(Number(totalRow?.total ?? 0) / limit))
      }
    });
  });

  // 兼容前端：返利转余额
  router.post("/transfer", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { amount } = req.body || {};
    const amt = ensureNumber(amount, 0);
    if (amt <= 0) return errorResponse(res, "金额无效", 400);
    try {
      await ctx.dbService.transferRebateToBalance(Number(user.id), amt);
      const balance = await ctx.dbService.getUserBalance(Number(user.id));
      const row = await ctx.dbService.db
        .prepare("SELECT rebate_available FROM users WHERE id = ?")
        .bind(user.id)
        .first<{ rebate_available?: number }>();
      return successResponse(res, {
        money: balance,
        rebateAvailable: Number(row?.rebate_available ?? 0)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }
  });

  return router;
}
