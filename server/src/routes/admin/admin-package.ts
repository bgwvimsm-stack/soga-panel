import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { ensureNumber } from "../../utils/d1";

export function createAdminPackageRouter(ctx: AppContext) {
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
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const limitCandidate = Number(limitRaw) || 20;
    const limit = Math.min(limitCandidate > 0 ? limitCandidate : 20, 100);
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : req.query.status;
    const levelParam = typeof req.query.level === "string" ? req.query.level.trim() : req.query.level;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE 1=1";
    const params: Array<string | number> = [];

    if (statusParam !== null && statusParam !== undefined && statusParam !== "") {
      whereClause += " AND p.status = ?";
      params.push(Number(statusParam));
    }

    if (levelParam !== null && levelParam !== undefined && levelParam !== "") {
      whereClause += " AND p.level = ?";
      params.push(Number(levelParam));
    }

    const totalRow = await ctx.db.db
      .prepare(`SELECT COUNT(*) as total FROM packages p ${whereClause}`)
      .bind(...params)
      .first<{ total?: number | string | null }>();
    const total = ensureNumber(totalRow?.total ?? 0);

    const listResult = await ctx.db.db
      .prepare(
        `
        SELECT
          p.id,
          p.name,
          p.price,
          p.traffic_quota,
          p.validity_days,
          p.speed_limit,
          p.device_limit,
          p.level,
          p.status,
          p.is_recommended,
          p.sort_weight,
          p.created_at,
          p.updated_at,
          (
            SELECT COUNT(*)
            FROM package_purchase_records pr
            WHERE pr.package_id = p.id AND pr.status = 1
          ) as sales_count
        FROM packages p
        ${whereClause}
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...params, limit, offset)
      .all<{
        id: number;
        name: string;
        price: number | string;
        traffic_quota: number | string | null;
        validity_days: number | string | null;
        speed_limit: number | string | null;
        device_limit: number | string | null;
        level: number | string | null;
        status: number | string | null;
        is_recommended: number | string | null;
        sort_weight: number | string | null;
        sales_count: number | string | null;
        created_at: string | null;
        updated_at: string | null;
      }>();

    const packages = (listResult.results ?? []).map((row) => {
      const price = typeof row.price === "string" ? Number(row.price) : ensureNumber(row.price);
      const trafficQuota = ensureNumber(row.traffic_quota);
      const validityDays = ensureNumber(row.validity_days);
      const speedLimit = ensureNumber(row.speed_limit);
      const deviceLimit = ensureNumber(row.device_limit);
      const status = ensureNumber(row.status);
      const level = ensureNumber(row.level);
      const sortWeight = ensureNumber(row.sort_weight);
      const isRecommended = ensureNumber(row.is_recommended);
      const salesCount = ensureNumber(row.sales_count);

      return {
        ...row,
        price,
        traffic_quota: trafficQuota,
        validity_days: validityDays,
        speed_limit: speedLimit,
        device_limit: deviceLimit,
        level,
        status,
        is_recommended: isRecommended,
        sort_weight: sortWeight,
        sales_count: salesCount,
        status_text: status === 1 ? "启用" : "禁用",
        traffic_quota_text: `${trafficQuota} GB`,
        validity_text: `${validityDays} 天`,
        speed_limit_text: speedLimit === 0 ? "无限制" : `${speedLimit} Mbps`,
        device_limit_text: deviceLimit === 0 ? "无限制" : `${deviceLimit} 个设备`
      };
    });

    return successResponse(res, {
      packages,
      pagination: {
        total,
        page,
        limit,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0
      }
    });
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const {
      name,
      price,
      traffic_quota,
      validity_days,
      speed_limit,
      device_limit,
      level,
      status,
      is_recommended,
      sort_weight
    } = req.body || {};
    if (!name || price === undefined || traffic_quota === undefined || validity_days === undefined) {
      return errorResponse(res, "必填字段缺失", 400);
    }
    await ctx.dbService.createPackage({
      name,
      price: ensureNumber(price),
      trafficQuota: ensureNumber(traffic_quota),
      validityDays: ensureNumber(validity_days),
      speedLimit: ensureNumber(speed_limit, 0),
      deviceLimit: ensureNumber(device_limit, 0),
      level: ensureNumber(level, 1),
      status: status ?? 1,
      isRecommended: is_recommended ?? 0,
      sortWeight: sort_weight ?? 0
    });
    return successResponse(res, null, "套餐已创建");
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.updatePackage(id, {
      name: req.body?.name,
      price: req.body?.price !== undefined ? ensureNumber(req.body.price) : undefined,
      trafficQuota: req.body?.traffic_quota !== undefined ? ensureNumber(req.body.traffic_quota) : undefined,
      validityDays: req.body?.validity_days !== undefined ? ensureNumber(req.body.validity_days) : undefined,
      speedLimit: req.body?.speed_limit !== undefined ? ensureNumber(req.body.speed_limit) : undefined,
      deviceLimit: req.body?.device_limit !== undefined ? ensureNumber(req.body.device_limit) : undefined,
      level: req.body?.level !== undefined ? ensureNumber(req.body.level) : undefined,
      status: req.body?.status,
      isRecommended: req.body?.is_recommended,
      sortWeight: req.body?.sort_weight
    });
    return successResponse(res, null, "套餐已更新");
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.deletePackage(id);
    return successResponse(res, null, "套餐已删除");
  });

  return router;
}
