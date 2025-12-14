import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";

export function createAdminSharedIdRouter(ctx: AppContext) {
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
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limitRaw = req.query.limit ?? req.query.pageSize ?? 20;
    const limitCandidate = Number(limitRaw) || 20;
    const limit = Math.min(limitCandidate > 0 ? limitCandidate : 20, 100);
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : req.query.status;

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (keyword) {
      conditions.push("name LIKE ?");
      params.push(`%${keyword}%`);
    }

    if (statusParam !== undefined && statusParam !== null && statusParam !== "") {
      conditions.push("status = ?");
      params.push(Number(statusParam));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = await ctx.db.db
      .prepare(`SELECT COUNT(*) as total FROM shared_ids ${whereClause}`)
      .bind(...params)
      .first<{ total?: number | string | null }>();
    const total = totalRow?.total != null ? Number(totalRow.total) || 0 : 0;
    const offset = (page - 1) * limit;

    const listResult = await ctx.db.db
      .prepare(
        `
        SELECT id, name, fetch_url, remote_account_id, status, created_at, updated_at
        FROM shared_ids
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(...params, limit, offset)
      .all<Record<string, unknown>>();

    const records = listResult.results ?? [];

    return successResponse(res, {
      records,
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
    const { name, fetch_url, remote_account_id, status } = req.body || {};
    if (!name || !fetch_url || !remote_account_id) return errorResponse(res, "参数缺失", 400);
    await ctx.dbService.createSharedId({
      name,
      fetchUrl: fetch_url,
      remoteAccountId: Number(remote_account_id),
      status: status ?? 1
    });
    return successResponse(res, null, "已创建");
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.updateSharedId(id, {
      name: req.body?.name,
      fetchUrl: req.body?.fetch_url,
      remoteAccountId: req.body?.remote_account_id ? Number(req.body.remote_account_id) : undefined,
      status: req.body?.status
    });
    return successResponse(res, null, "已更新");
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    await ctx.dbService.deleteSharedId(id);
    return successResponse(res, null, "已删除");
  });

  return router;
}
