import type { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  res.on("close", () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} closed ${res.statusCode} ${duration}ms`);
  });
  next();
}
