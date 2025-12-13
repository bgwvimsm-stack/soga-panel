import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createAuthMiddleware } from "../../middleware/auth";
import { errorResponse, successResponse } from "../../utils/response";
import { generateRandomString } from "../../utils/crypto";

export function createAdminCommandRouter(ctx: AppContext) {
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

  // 重置所有用户订阅 token
  router.post("/reset-all-subscription-tokens", async (req: Request, res: Response) => {
    if (!ensureAdmin(req, res)) return;
    const users = await ctx.dbService.db.prepare("SELECT id FROM users").all<{ id: number }>();
    let count = 0;
    for (const row of users.results || []) {
      const token = generateRandomString(32);
      await ctx.dbService.db
        .prepare("UPDATE users SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(token, row.id)
        .run();
      count++;
    }
    return successResponse(res, { count }, "已重置所有用户订阅令牌");
  });

  return router;
}
