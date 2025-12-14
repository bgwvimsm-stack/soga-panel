import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ensureNumber } from "../../utils/d1";
import { fixMoneyPrecision } from "../../utils/money";
import { ReferralService } from "../../services/referral";

export function createRebateRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));
  const referralService = new ReferralService(ctx.dbService);

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
    const { amount, method, account, accountPayload } = req.body || {};
    try {
      const amtRaw = ensureNumber(amount, 0);
      const fixedAmount = fixMoneyPrecision(amtRaw);
      if (fixedAmount <= 0) return errorResponse(res, "金额无效", 400);

      // 读取提现配置
      const configs = await ctx.dbService.listSystemConfigsMap();
      const minRaw = configs["rebate_withdraw_min_amount"] ?? "200";
      const feeRaw = configs["rebate_withdraw_fee_rate"] ?? "0";

      const parsedMin = Number.parseFloat(String(minRaw));
      const minAmount = fixMoneyPrecision(
        Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 200
      );

      let parsedFee = Number.parseFloat(String(feeRaw));
      if (!Number.isFinite(parsedFee)) parsedFee = 0;
      const feeRate = Math.min(Math.max(parsedFee, 0), 1);

      if (fixedAmount + 1e-6 < minAmount) {
        return errorResponse(res, `单次提现金额需不少于 ${minAmount.toFixed(2)} 元`, 400);
      }

      const userRow = await ctx.dbService.db
        .prepare("SELECT rebate_available FROM users WHERE id = ?")
        .bind(Number(user.id))
        .first<{ rebate_available?: number | string | null } | null>();
      const available = ensureNumber(userRow?.rebate_available, 0);
      if (available + 1e-6 < minAmount) {
        return errorResponse(res, `返利余额满 ${minAmount.toFixed(2)} 元才允许提现`, 400);
      }
      if (available + 1e-6 < fixedAmount) {
        return errorResponse(res, "返利余额不足", 400);
      }

      await ctx.dbService.reduceRebateOnWithdrawal(Number(user.id), fixedAmount);
      const feeAmount = fixMoneyPrecision(fixedAmount * feeRate);

      const withdrawalId = await ctx.dbService.createWithdrawalRequest({
        userId: Number(user.id),
        amount: fixedAmount,
        method: method || "manual",
        accountPayload: accountPayload ?? account,
        feeRate,
        feeAmount
      });

      await referralService.insertUserTransaction({
        userId: Number(user.id),
        amount: -fixedAmount,
        eventType: "withdraw",
        sourceType: "withdraw",
        sourceId: withdrawalId || null,
        tradeNo: null,
        remark: method || "manual"
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
    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const limit = Math.max(Math.min(Number(req.query.limit ?? 10) || 10, 200), 1);
    const offset = (page - 1) * limit;

    const totalRow = await ctx.dbService.db
      .prepare("SELECT COUNT(*) as total FROM rebate_withdrawals WHERE user_id = ?")
      .bind(Number(user.id))
      .first<{ total?: number | string | null } | null>();

    const records = await ctx.dbService.db
      .prepare(
        `
        SELECT id, amount, method, status, account_payload, review_note, fee_rate, fee_amount, created_at, updated_at, processed_at
        FROM rebate_withdrawals
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(Number(user.id), limit, offset)
      .all();

    const rows = records.results || [];
    const total = Number((totalRow && totalRow.total) ?? 0);

    const mapped =
      rows.map((row: any) => ({
        id: Number(row.id),
        amount: Number(row.amount ?? 0),
        method: String(row.method ?? ""),
        status: String(row.status ?? ""),
        accountPayload: row.account_payload ? (() => {
          try {
            return JSON.parse(String(row.account_payload));
          } catch {
            return null;
          }
        })() : null,
        reviewNote: row.review_note != null ? String(row.review_note) : "",
        feeRate: Number(row.fee_rate ?? 0),
        feeAmount: Number(row.fee_amount ?? 0),
        createdAt: row.created_at != null ? String(row.created_at) : "",
        updatedAt: row.updated_at != null ? String(row.updated_at) : "",
        processedAt: row.processed_at != null ? String(row.processed_at) : ""
      })) || [];

    return successResponse(res, {
      records: mapped,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
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
    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const limit = Math.max(Math.min(Number(req.query.limit ?? 20) || 20, 200), 1);
    const offset = (page - 1) * limit;
    const eventType = typeof req.query.event_type === "string" ? req.query.event_type : undefined;

    const filters: string[] = ["inviter_id = ?"];
    const bindings: Array<number | string> = [Number(user.id)];
    let whereClause = "WHERE inviter_id = ?";
    let ledgerWhereClause = "WHERE rt.inviter_id = ?";

    if (eventType) {
      whereClause += " AND event_type = ?";
      ledgerWhereClause += " AND rt.event_type = ?";
      bindings.push(eventType);
    }

    const totalRow = await ctx.dbService.db
      .prepare(`SELECT COUNT(*) as total FROM rebate_transactions ${whereClause}`)
      .bind(...bindings)
      .first<{ total?: number | string | null } | null>();

    const ledger = await ctx.dbService.db
      .prepare(
        `
        SELECT 
          rt.id,
          rt.event_type,
          rt.amount,
          rt.source_type,
          rt.source_id,
          rt.trade_no,
          rt.status,
          rt.created_at,
          rt.invitee_id,
          u.email AS invitee_email
        FROM rebate_transactions rt
        LEFT JOIN users u ON rt.invitee_id = u.id
        ${ledgerWhereClause}
        ORDER BY rt.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...bindings, limit, offset)
      .all();

    const rows = ledger.results || [];
    const total = Number((totalRow && totalRow.total) ?? 0);

    const records =
      rows.map((row: any) => ({
        id: Number(row.id),
        eventType: String(row.event_type ?? ""),
        amount: Number(row.amount ?? 0),
        sourceType: String(row.source_type ?? ""),
        sourceId: row.source_id ?? null,
        tradeNo: row.trade_no != null ? String(row.trade_no) : "",
        status: String(row.status ?? ""),
        createdAt: row.created_at != null ? String(row.created_at) : "",
        inviteeEmail: row.invitee_email != null ? String(row.invitee_email) : ""
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

  // 兼容前端：返利转余额
  router.post("/transfer", async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { amount } = req.body || {};
    try {
      const amtRaw = ensureNumber(amount, 0);
      const fixedAmount = fixMoneyPrecision(amtRaw);
      if (fixedAmount <= 0) return errorResponse(res, "金额无效", 400);

      const userRow = await ctx.dbService.db
        .prepare("SELECT money, rebate_available FROM users WHERE id = ?")
        .bind(Number(user.id))
        .first<{ money?: number | string | null; rebate_available?: number | string | null } | null>();
      if (!userRow) return errorResponse(res, "用户不存在", 404);
      const balanceBefore = ensureNumber(userRow.money, 0);
      const rebateBefore = ensureNumber(userRow.rebate_available, 0);
      if (rebateBefore + 1e-6 < fixedAmount) {
        return errorResponse(res, "返利余额不足", 400);
      }

      await ctx.dbService.transferRebateToBalance(Number(user.id), fixedAmount);

      await referralService.insertUserTransaction({
        userId: Number(user.id),
        amount: -fixedAmount,
        eventType: "transfer",
        sourceType: "balance"
      });

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
