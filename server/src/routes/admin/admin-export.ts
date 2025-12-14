import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse } from "../../utils/response";

export function createAdminExportRouter(ctx: AppContext) {
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

  router.get("/users.csv", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const data = await ctx.dbService.listUsersForExport();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=users.csv");
    res.write("id,email,username,status,class,expire_time,transfer_total,transfer_enable,money,rebate_available,created_at\n");
    for (const row of data) {
      const line = [
        row.id,
        row.email,
        row.username,
        row.status,
        row.class,
        row.expire_time ?? "",
        row.transfer_total ?? 0,
        row.transfer_enable ?? 0,
        row.money ?? 0,
        row.rebate_available ?? 0,
        row.created_at ?? ""
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",");
      res.write(line + "\n");
    }
    res.end();
  });

  router.get("/recharges.csv", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT rr.id, rr.user_id, u.email, u.username, rr.amount, rr.payment_method, rr.trade_no, rr.status, rr.created_at, rr.paid_at
        FROM recharge_records rr
        LEFT JOIN users u ON rr.user_id = u.id
        ORDER BY rr.created_at DESC
      `
      )
      .all();
    const data = rows.results || [];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=recharges.csv");
    res.write("id,user_id,email,username,amount,payment_method,trade_no,status,created_at,paid_at\n");
    for (const row of data) {
      const line = [
        row.id,
        row.user_id,
        row.email,
        row.username,
        row.amount,
        row.payment_method,
        row.trade_no,
        row.status,
        row.created_at ?? "",
        row.paid_at ?? ""
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  });

  router.get("/rebates.csv", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT rt.*, u.email as inviter_email, u.username as inviter_username, iu.email as invitee_email, iu.username as invitee_username
        FROM rebate_transactions rt
        LEFT JOIN users u ON rt.inviter_id = u.id
        LEFT JOIN users iu ON rt.invitee_id = iu.id
        ORDER BY rt.created_at DESC
      `
      )
      .all();
    const data = rows.results || [];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=rebates.csv");
    res.write(
      "id,inviter_id,inviter_email,inviter_username,invitee_id,invitee_email,invitee_username,source_type,source_id,trade_no,event_type,amount,status,created_at\n"
    );
    for (const row of data) {
      const line = [
        row.id,
        row.inviter_id,
        row.inviter_email ?? "",
        row.inviter_username ?? "",
        row.invitee_id ?? "",
        row.invitee_email ?? "",
        row.invitee_username ?? "",
        row.source_type ?? "",
        row.source_id ?? "",
        row.trade_no ?? "",
        row.event_type ?? "",
        row.amount ?? 0,
        row.status ?? "",
        row.created_at ?? ""
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  });

  router.get("/orders.csv", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT pr.id, pr.user_id, u.email, u.username, pr.package_id, p.name as package_name,
               pr.price, pr.coupon_code, pr.discount_amount, pr.trade_no, pr.status, pr.created_at, pr.paid_at, pr.expires_at
        FROM package_purchase_records pr
        LEFT JOIN users u ON pr.user_id = u.id
        LEFT JOIN packages p ON pr.package_id = p.id
        ORDER BY pr.created_at DESC
      `
      )
      .all();
    const data = rows.results || [];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
    res.write(
      "id,user_id,email,username,package_id,package_name,price,coupon_code,discount_amount,trade_no,status,created_at,paid_at,expires_at\n"
    );
    for (const row of data) {
      const line = [
        row.id,
        row.user_id,
        row.email,
        row.username,
        row.package_id,
        row.package_name,
        row.price,
        row.coupon_code ?? "",
        row.discount_amount ?? 0,
        row.trade_no,
        row.status,
        row.created_at ?? "",
        row.paid_at ?? "",
        row.expires_at ?? ""
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  });

  router.get("/daily-traffic.csv", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const date = typeof req.query.date === "string" ? req.query.date.slice(0, 10) : null;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT dt.*, u.email, u.username
        FROM daily_traffic dt
        LEFT JOIN users u ON dt.user_id = u.id
        ${date ? "WHERE dt.record_date = ?" : ""}
        ORDER BY dt.record_date DESC, dt.user_id ASC
      `
      )
      .bind(...(date ? [date] : []))
      .all();
    const data = rows.results || [];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=daily_traffic.csv");
    res.write("record_date,user_id,email,username,upload_traffic,download_traffic,total_traffic,created_at\n");
    for (const row of data) {
      const line = [
        row.record_date ?? "",
        row.user_id,
        row.email ?? "",
        row.username ?? "",
        row.upload_traffic ?? 0,
        row.download_traffic ?? 0,
        row.total_traffic ?? 0,
        row.created_at ?? ""
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  });

  router.get("/system-traffic-summary.csv", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await ctx.dbService.db
      .prepare(
        `
        SELECT * FROM system_traffic_summary
        ORDER BY record_date DESC
      `
      )
      .all();
    const data = rows.results || [];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=system_traffic_summary.csv");
    res.write("record_date,total_users,total_upload,total_download,total_traffic,created_at\n");
    for (const row of data) {
      const line = [
        row.record_date ?? "",
        row.total_users ?? 0,
        row.total_upload ?? 0,
        row.total_download ?? 0,
        row.total_traffic ?? 0,
        row.created_at ?? ""
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  });

  return router;
}
