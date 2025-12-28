import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createConfigRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  router.get("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const rows = await ctx.dbService.listSystemConfigs();
    const hasDocsUrl = rows.some((row) => row?.key === "docs_url");
    if (!hasDocsUrl) {
      rows.push({
        id: 0,
        key: "docs_url",
        value: "",
        description: "用户文档地址"
      } as any);
    }
    return successResponse(res, rows);
  });

  // 兼容 Worker：POST /api/admin/system-configs
  router.post("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { key, value, description } = req.body || {};
    const configKey = String(key || "").trim();
    if (!configKey) return errorResponse(res, "key 必填", 400);

    const existing = await ctx.dbService.db
      .prepare("SELECT id FROM system_configs WHERE `key` = ?")
      .bind(configKey)
      .first<{ id?: number | string }>();
    if (existing) return errorResponse(res, "配置项已存在", 400);

    await ctx.dbService.db
      .prepare(
        `
        INSERT INTO system_configs (\`key\`, value, description, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
      )
      .bind(configKey, String(value ?? ""), String(description ?? ""))
      .run();

    await ctx.cache.deleteByPrefix("system_config");
    await ctx.cache.deleteByPrefix("site_config");

    return successResponse(res, null, "配置添加成功");
  });

  router.put("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { key, value } = req.body || {};
    if (!key) return errorResponse(res, "key 必填", 400);
    await ctx.dbService.updateSystemConfig(String(key), String(value ?? ""));
    await ctx.cache.deleteByPrefix("system_config");
    await ctx.cache.deleteByPrefix("site_config");
    return successResponse(res, null, "已保存");
  });

  // 兼容 Worker：PUT /api/admin/system-configs/batch
  router.put("/batch", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { configs } = req.body || {};
    if (!Array.isArray(configs)) return errorResponse(res, "configs 格式错误", 400);

    let successCount = 0;
    let failedCount = 0;
    const results: Array<{ key: string; success: boolean; error?: string }> = [];

    for (const config of configs) {
      const configKey = String(config?.key || "").trim();
      if (!configKey) {
        results.push({ key: configKey, success: false, error: "配置键不能为空" });
        failedCount += 1;
        continue;
      }
      try {
        await ctx.dbService.updateSystemConfig(configKey, String(config?.value ?? ""));
        results.push({ key: configKey, success: true });
        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ key: configKey, success: false, error: message });
        failedCount += 1;
      }
    }

    await ctx.cache.deleteByPrefix("system_config");
    await ctx.cache.deleteByPrefix("site_config");

    return successResponse(res, {
      message: "批量更新完成",
      summary: {
        total: configs.length,
        success: successCount,
        failed: failedCount
      },
      details: results
    });
  });

  router.delete("/", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const { key } = req.body || {};
    if (!key) return errorResponse(res, "key 必填", 400);
    await ctx.dbService.deleteSystemConfig(String(key));
    await ctx.cache.deleteByPrefix("system_config");
    await ctx.cache.deleteByPrefix("site_config");
    return successResponse(res, null, "已删除");
  });

  // 兼容前端：DELETE /api/admin/system-configs/:key
  router.delete("/:key", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.is_admin) return errorResponse(res, "需要管理员权限", 403);
    const configKey = String(req.params.key || "").trim();
    if (!configKey) return errorResponse(res, "key 必填", 400);
    await ctx.dbService.deleteSystemConfig(configKey);
    await ctx.cache.deleteByPrefix("system_config");
    await ctx.cache.deleteByPrefix("site_config");
    return successResponse(res, null, "已删除");
  });

  return router;
}
