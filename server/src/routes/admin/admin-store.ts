import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ReferralService } from "../../services/referral";
import { ensureNumber } from "../../utils/d1";

export function createAdminStoreRouter(ctx: AppContext) {
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

  // 套餐与销售统计概览
  router.get(["/", "/package-stats"], async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    // 套餐数量统计
    const packageStats = await ctx.db.db
      .prepare(
        `
        SELECT
          COUNT(*) as total_packages,
          COUNT(CASE WHEN status = 1 THEN 1 END) as active_packages,
          COUNT(CASE WHEN status = 0 THEN 1 END) as inactive_packages
        FROM packages
      `
      )
      .first<{
        total_packages: number | string | null;
        active_packages: number | string | null;
        inactive_packages: number | string | null;
      }>();

    // 套餐销售统计
    const salesStats = await ctx.db.db
      .prepare(
        `
        SELECT
          COUNT(*) as total_purchases,
          COUNT(CASE WHEN status = 1 THEN 1 END) as completed_purchases,
          COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) as total_revenue
        FROM package_purchase_records
      `
      )
      .first<{
        total_purchases: number | string | null;
        completed_purchases: number | string | null;
        total_revenue: number | string | null;
      }>();

    // 充值统计
    const rechargeStats = await ctx.db.db
      .prepare(
        `
        SELECT
          COUNT(*) as total_recharges,
          COUNT(CASE WHEN status = 1 THEN 1 END) as completed_recharges,
          COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as total_recharged
        FROM recharge_records
      `
      )
      .first<{
        total_recharges: number | string | null;
        completed_recharges: number | string | null;
        total_recharged: number | string | null;
      }>();

    // 最受欢迎的套餐
    const popularPackagesResult = await ctx.db.db
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.price,
          COUNT(ppr.id) as purchase_count,
          COALESCE(SUM(CASE WHEN ppr.status = 1 THEN ppr.price ELSE 0 END), 0) as revenue
        FROM packages p
        LEFT JOIN package_purchase_records ppr ON p.id = ppr.package_id
        GROUP BY p.id
        ORDER BY purchase_count DESC
        LIMIT 5
      `
      )
      .all<{
        id: number;
        name: string;
        price: number | string;
        purchase_count: number | string | null;
        revenue: number | string | null;
      }>();

    const packageStatsRow = packageStats ?? {
      total_packages: 0,
      active_packages: 0,
      inactive_packages: 0
    };

    const salesStatsRow = salesStats ?? {
      total_purchases: 0,
      completed_purchases: 0,
      total_revenue: 0
    };

    const rechargeStatsRow = rechargeStats ?? {
      total_recharges: 0,
      completed_recharges: 0,
      total_recharged: 0
    };

    const popularPackages = (popularPackagesResult.results ?? []).map((pkg) => {
      const priceValue = typeof pkg.price === "string" ? Number(pkg.price) : ensureNumber(pkg.price);
      const revenueValue =
        pkg.revenue !== null
          ? typeof pkg.revenue === "string"
            ? Number(pkg.revenue)
            : ensureNumber(pkg.revenue)
          : 0;
      return {
        ...pkg,
        price: priceValue,
        revenue: revenueValue,
        purchase_count: ensureNumber(pkg.purchase_count)
      };
    });

    return successResponse(res, {
      package_stats: {
        total: ensureNumber(packageStatsRow.total_packages),
        active: ensureNumber(packageStatsRow.active_packages),
        inactive: ensureNumber(packageStatsRow.inactive_packages)
      },
      sales_stats: {
        total_purchases: ensureNumber(salesStatsRow.total_purchases),
        completed_purchases: ensureNumber(salesStatsRow.completed_purchases),
        total_revenue:
          typeof salesStatsRow.total_revenue === "string"
            ? Number(salesStatsRow.total_revenue)
            : ensureNumber(salesStatsRow.total_revenue)
      },
      recharge_stats: {
        total_recharges: ensureNumber(rechargeStatsRow.total_recharges),
        completed_recharges: ensureNumber(rechargeStatsRow.completed_recharges),
        total_recharged:
          typeof rechargeStatsRow.total_recharged === "string"
            ? Number(rechargeStatsRow.total_recharged)
            : ensureNumber(rechargeStatsRow.total_recharged)
      },
      popular_packages: popularPackages
    });
  });

  router.get("/orders", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllPurchaseRecords(page, pageSize);
    return successResponse(res, data);
  });

  router.post("/orders/:tradeNo/mark-paid", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const tradeNo = req.params.tradeNo;
    try {
      const result: any = await ctx.dbService.markPurchasePaid(tradeNo);
      if (!result) return errorResponse(res, "订单不存在", 404);
      const record = result.record as any;
      if (result.applied) {
        await referralService.awardRebate({
          inviteeId: Number(record.user_id),
          amount: Number(record.price ?? record.package_price ?? 0),
          sourceType: "purchase",
          sourceId: Number(record.id ?? 0) || null,
          tradeNo,
          eventType: "purchase_rebate"
        });
        return successResponse(res, { trade_no: tradeNo }, "已标记支付并激活套餐");
      }
      if (result.alreadyPaid) {
        return successResponse(res, { trade_no: tradeNo }, "订单已是已支付");
      }
      return errorResponse(res, "订单状态不可标记", 400);
    } catch (error: any) {
      return errorResponse(res, error?.message || "处理失败", 500);
    }
  });

  router.get("/recharges", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const data = await ctx.dbService.listAllRechargeRecords(page, pageSize);
    return successResponse(res, data);
  });

  return router;
}
