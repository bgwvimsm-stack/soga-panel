import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { getChanges, toRunResult } from "../../utils/d1";

export function createAdminNodeRouter(ctx: AppContext) {
  const router = Router();
  router.use(createAuthMiddleware(ctx));

  const parseNodeConfig = (raw: unknown): { client: Record<string, any>; config: Record<string, any> } => {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
      return {
        client: (parsed as any).client || {},
        config: (parsed as any).config || (parsed as any) || {}
      };
    } catch {
      return { client: {}, config: {} };
    }
  };

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
    const pageSize = Math.min(Number(limitRaw) || 20, 200);
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : req.query.status;
    const status =
      statusParam === undefined || statusParam === null || statusParam === ""
        ? null
        : Number(statusParam);

    const data = await ctx.dbService.listNodes({
      page,
      pageSize,
      keyword: keyword || undefined,
      status: typeof status === "number" && !Number.isNaN(status) ? status : null
    });

    return successResponse(res, {
      data: data.data ?? [],
      total: data.total ?? 0,
      page,
      limit: pageSize
    });
  });

  // 创建节点
  router.post("/", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const nodeData = req.body || {};

    if (!nodeData.name || !nodeData.type) {
      return errorResponse(res, "Name and type are required", 400);
    }

    let configValue = "{}";
    if (nodeData.node_config) {
      if (typeof nodeData.node_config === "string") {
        try {
          const parsed = JSON.parse(nodeData.node_config);
          configValue = JSON.stringify(parsed);
        } catch {
          configValue = nodeData.node_config;
        }
      } else {
        configValue = JSON.stringify(nodeData.node_config);
      }
    }

    await ctx.db.db
      .prepare(
        `
        INSERT INTO nodes (
          name,
          type,
          node_class,
          node_bandwidth_limit,
          traffic_multiplier,
          bandwidthlimit_resetday,
          node_config,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .bind(
        nodeData.name,
        nodeData.type,
        nodeData.node_class ?? 1,
        nodeData.node_bandwidth_limit ?? 0,
        nodeData.traffic_multiplier && Number(nodeData.traffic_multiplier) > 0
          ? Number(nodeData.traffic_multiplier)
          : 1,
        nodeData.bandwidthlimit_resetday ?? 1,
        configValue,
        nodeData.status ?? 1
      )
      .run();

    return successResponse(res, null, "节点已创建");
  });

  // 更新节点
  router.put("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    const updateData = req.body || {};
    const allowedFields = [
      "name",
      "type",
      "node_class",
      "node_bandwidth_limit",
      "traffic_multiplier",
      "bandwidthlimit_resetday",
      "status"
    ];

    const updates: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        updates.push(`${field} = ?`);
        if (field === "traffic_multiplier") {
          const normalized = Number(updateData[field]);
          values.push(normalized > 0 ? normalized : 1);
        } else {
          values.push(updateData[field]);
        }
      }
    }

    if (updateData.node_config !== undefined) {
      updates.push("node_config = ?");
      let configValue: string;
      if (typeof updateData.node_config === "string") {
        try {
          const parsed = JSON.parse(updateData.node_config);
          configValue = JSON.stringify(parsed);
        } catch {
          configValue = updateData.node_config;
        }
      } else {
        configValue = JSON.stringify(updateData.node_config);
      }
      values.push(configValue);
    }

    if (!updates.length) {
      return errorResponse(res, "没有需要更新的字段", 400);
    }

    values.push(id);
    const result = toRunResult(
      await ctx.db.db
        .prepare(
          `
          UPDATE nodes
          SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(...values)
        .run()
    );

    if (getChanges(result) === 0) {
      return errorResponse(res, "节点不存在或未更新任何字段", 404);
    }

    return successResponse(res, null, "节点已更新");
  });

  // 兼容 Worker：POST /api/admin/nodes/:id/traffic
  router.post("/:id/traffic", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    await ctx.db.db
      .prepare("UPDATE nodes SET node_bandwidth = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(id)
      .run();

    await ctx.cache.deleteByPrefix(`node_config_${id}`);
    return successResponse(res, { message: "Node traffic reset successfully" });
  });

  // 兼容 Worker：GET /api/admin/nodes/export
  router.get("/export", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;

    const nodesResult = await ctx.db.db
      .prepare(
        `
        SELECT id, name, type, node_class, status, node_bandwidth, node_bandwidth_limit,
               traffic_multiplier, bandwidthlimit_resetday, node_config, created_at, updated_at
        FROM nodes
        ORDER BY id DESC
      `
      )
      .all<{
        id: number;
        name: string;
        type: string;
        node_class: number | string;
        status: number | string;
        node_bandwidth: number | string;
        node_bandwidth_limit: number | string;
        traffic_multiplier: number | string;
        bandwidthlimit_resetday: number | string;
        node_config: any;
        created_at?: string | null;
        updated_at?: string | null;
      }>();

    const headers = [
      "Name",
      "Type",
      "Server",
      "Server Port",
      "Class",
      "Status",
      "Bandwidth Used",
      "Bandwidth Limit",
      "Traffic Multiplier",
      "Reset Day",
      "Created At",
      "Updated At"
    ];

    const escape = (value: unknown) => `"${String(value ?? "").replace(/\"/g, '\"\"')}"`;
    let csv = `${headers.join(",")}\n`;

    for (const node of nodesResult.results || []) {
      const parsed = parseNodeConfig(node.node_config);
      const client = parsed.client || {};
      const cfg = parsed.config || {};
      const row = [
        node.name || "",
        node.type || "",
        client.server || "",
        client.port || cfg.port || 0,
        node.node_class ?? 0,
        Number(node.status) === 1 ? "Online" : "Offline",
        node.node_bandwidth ?? 0,
        node.node_bandwidth_limit ?? 0,
        node.traffic_multiplier ?? 1,
        node.bandwidthlimit_resetday ?? 1,
        node.created_at || "",
        node.updated_at || ""
      ];
      csv += `${row.map(escape).join(",")}\n`;
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=nodes-${new Date().toISOString().slice(0, 10)}.csv`
    );
    res.status(200).send(csv);
  });

  // 删除节点
  router.delete("/:id", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, "ID 无效", 400);

    const result = toRunResult(
      await ctx.db.db
        .prepare("DELETE FROM nodes WHERE id = ?")
        .bind(id)
        .run()
    );

    if (getChanges(result) === 0) {
      return errorResponse(res, "节点不存在", 404);
    }

    return successResponse(res, null, "节点已删除");
  });

  // 批量操作节点（启用 / 禁用 / 删除）
  router.post("/batch", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const { action, node_ids } = req.body || {};

    if (!action || !Array.isArray(node_ids) || node_ids.length === 0) {
      return errorResponse(res, "action 和 node_ids 必填", 400);
    }

    const ids = node_ids
      .map((id: unknown) => Number(id))
      .filter((id: number) => Number.isFinite(id));
    if (!ids.length) {
      return errorResponse(res, "节点 ID 无效", 400);
    }

    let sql = "";
    let message = "";

    if (action === "enable") {
      sql = `UPDATE nodes SET status = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ids
        .map(() => "?")
        .join(",")})`;
      message = `${ids.length} 个节点已启用`;
    } else if (action === "disable") {
      sql = `UPDATE nodes SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ids
        .map(() => "?")
        .join(",")})`;
      message = `${ids.length} 个节点已禁用`;
    } else if (action === "delete") {
      sql = `DELETE FROM nodes WHERE id IN (${ids.map(() => "?").join(",")})`;
      message = `${ids.length} 个节点已删除`;
    } else {
      return errorResponse(res, "无效的 action 参数", 400);
    }

    const result = toRunResult(await ctx.db.db.prepare(sql).bind(...ids).run());
    const affected = getChanges(result);

    return successResponse(res, {
      message,
      affected_count: affected,
      processed_ids: ids
    });
  });

  router.post("/:id/status", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (![0, 1].includes(Number(status))) return errorResponse(res, "状态无效", 400);
    await ctx.dbService.updateNodeStatus(id, Number(status));
    return successResponse(res, null, "状态已更新");
  });

  return router;
}
