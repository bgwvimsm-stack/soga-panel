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
    const data = await ctx.dbService.listPackagesAll();
    return successResponse(res, data);
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
