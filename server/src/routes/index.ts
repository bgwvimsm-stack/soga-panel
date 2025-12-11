import type { Express, Request, Response } from "express";
import type { AppEnv } from "../config/env";
import type { AppContext } from "../types";
import { createAuthRouter } from "./auth";
import { createUserRouter } from "./user/user";
import { createSubscriptionRouter } from "./user/subscription";
import { createNodeRouter } from "./node";
import { createTrafficRouter } from "./user/traffic";
import { createAnnouncementRouter } from "./user/announcement";
import { createTicketRouter } from "./user/ticket";
import { createAdminRouter } from "./admin";
import { createStoreRouter } from "./user/store";
import { createWalletRouter } from "./user/wallet";
import { createAdminRebateRouter } from "./admin/admin-rebate";
import { createAdminTrafficRouter } from "./admin/admin-traffic";
import { createAdminSharedIdRouter } from "./admin/admin-sharedid";
import { createAdminExportRouter } from "./admin/admin-export";
import { createAdminTaskRouter } from "./admin/admin-task";
import { createPaymentCallbackRouter } from "./payment/callback";
import { createAdminWithdrawalRouter } from "./admin/admin-withdrawal";
import { createAdminCommandRouter } from "./admin/admin-command";
import { createAdminLogRouter } from "./admin/admin-log";
import { createAdminStoreRouter } from "./admin/admin-store";
import { createRebateRouter } from "./user/rebate";
import { createAdminRechargeRouter } from "./admin/admin-recharge";
import { createPaymentStatusRouter } from "./payment/status";
import { createAdminCouponRouter } from "./admin/admin-coupon";
import { createAdminGiftCardRedemptionRouter } from "./admin/admin-giftcard-redemption";
import { createAdminPackageRouter } from "./admin/admin-package";
import { createPaymentConfigRouter } from "./payment/config";
import { createAdminTicketRouter } from "./admin/admin-ticket";
import { createAdminAnnouncementRouter } from "./admin/admin-announcement";

type RouteDeps = AppContext;

export function registerRoutes(app: Express, deps: RouteDeps) {
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      message: "Soga Panel server is running",
      health: "/api/health",
      version: deps.env.SITE_NAME || "soga-panel-server"
    });
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      message: "Node server is running",
      timestamp: new Date().toISOString(),
      version: deps.env.SITE_NAME || "soga-panel-server",
      redis: deps.redis ? (deps.redis.status === "ready" ? "ready" : deps.redis.status) : "disabled"
    });
  });

  app.get("/api/database/test", async (_req: Request, res: Response) => {
    try {
      const start = Date.now();
      const result = await deps.db.prepare("SELECT 1 AS test").first();
      res.json({
        status: "connected",
        latency_ms: Date.now() - start,
        result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/api/site/settings", async (_req: Request, res: Response) => {
    try {
      const configs = await deps.dbService.listSystemConfigsMap();
      res.json({
        code: 0,
        message: "ok",
        data: {
          siteName: configs["site_name"] || deps.env.SITE_NAME || "Soga Panel",
          siteUrl: configs["site_url"] || deps.env.SITE_URL || ""
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ code: 500, message });
    }
  });

  // Auth routes (partial, Node 版逐步迁移)
  app.use("/api/auth", createAuthRouter(deps));
  app.use("/api/user", createUserRouter(deps));
  app.use("/api/subscription", createSubscriptionRouter(deps));
  app.use("/api/api/subscription", createSubscriptionRouter(deps)); // 兼容被二次代理的 /api/api/subscription
  app.use("/subscription", createSubscriptionRouter(deps)); // 兼容裸路径订阅
  app.use("/api/v1", createNodeRouter(deps));
  app.use("/api/traffic", createTrafficRouter(deps));
  app.use("/api/announcement", createAnnouncementRouter(deps));
  app.use("/api/announcements", createAnnouncementRouter(deps));
  app.use("/api/ticket", createTicketRouter(deps));
  app.use("/api/admin", createAdminRouter(deps));
  app.use("/api/admin/rebate", createAdminRebateRouter(deps));
  app.use("/api/admin/traffic", createAdminTrafficRouter(deps));
  app.use("/api/admin/shared-ids", createAdminSharedIdRouter(deps));
  app.use("/api/admin/export", createAdminExportRouter(deps));
  app.use("/api/admin/task", createAdminTaskRouter(deps));
  app.use("/api/payment/callback", createPaymentCallbackRouter(deps));
  app.use("/api/payment", createPaymentCallbackRouter(deps)); // 兼容 /api/payment/notify
  app.use("/api/payment", createPaymentStatusRouter(deps));
  app.use("/api/payment/config", createPaymentConfigRouter(deps));
  app.use("/api/admin/withdrawal", createAdminWithdrawalRouter(deps));
  app.use("/api/admin/recharge", createAdminRechargeRouter(deps));
  app.use("/api/admin/coupons", createAdminCouponRouter(deps));
  app.use("/api/admin/gift-card-redemptions", createAdminGiftCardRedemptionRouter(deps));
  app.use("/api/admin/packages", createAdminPackageRouter(deps));
  app.use("/api/admin/command", createAdminCommandRouter(deps));
  app.use("/api/admin/log", createAdminLogRouter(deps));
  app.use("/api/admin/store", createAdminStoreRouter(deps));
  app.use("/api/admin/tickets", createAdminTicketRouter(deps));
  app.use("/api/admin/announcements", createAdminAnnouncementRouter(deps));
  app.use("/api/rebate", createRebateRouter(deps));
  app.use("/api/user/rebate", createRebateRouter(deps)); // 兼容前端路径
  app.use("/api/store", createStoreRouter(deps));
  app.use("/api/packages", createStoreRouter(deps));
  app.use("/api", createStoreRouter(deps)); // 兼容 /api/packages*
  app.use("/api/wallet", createWalletRouter(deps));
  app.use("/api/user/wallet", createWalletRouter(deps)); // 兼容前端 /user/wallet*

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      code: 404,
      message: "Endpoint not implemented in Node server yet"
    });
  });
}
