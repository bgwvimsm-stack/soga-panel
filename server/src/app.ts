import cors from "cors";
import express from "express";
import type { AppContext } from "./types";
import { registerRoutes } from "./routes";

export function createApp(ctx: AppContext) {
  const app = express();

  // 禁用 ETag/缓存，避免前端收到 304 后拿不到业务响应体
  app.set("etag", false);
  app.use((_, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  // 兼容部分代理重复追加 /api 前缀的情况（例如将 /api/health 转发到 /api/api/health）
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/api/")) {
      req.url = req.url.replace(/^\/api\/api\//, "/api/");
    }
    next();
  });

  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "API-KEY",
        "NODE-ID",
        "NODE-TYPE",
        "IF-NONE-MATCH",
        "X-API-Secret",
        "X-Frontend-Auth",
        "X-Cloudflare-Service-Binding"
      ],
      maxAge: 86400
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));

  // 简易请求日志
  app.use((req, _res, next) => {
    const start = Date.now();
    resOnFinish(_res, () => {
      const duration = Date.now() - start;
      console.log(`[http] ${req.method} ${req.originalUrl} ${_res.statusCode} ${duration}ms`);
    });
    next();
  });

  registerRoutes(app, ctx);

  // 全局错误处理
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[error]", err);
    res.status(500).json({ code: 500, message: "Internal Server Error" });
  });

  return app;
}

function resOnFinish(res: express.Response, cb: () => void) {
  res.on("finish", cb);
  res.on("close", cb);
}
