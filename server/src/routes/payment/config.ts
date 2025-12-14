import { Router, type Request, type Response } from "express";
import type { AppContext } from "../../types";
import { createPaymentProviders } from "../../payment/factory";
import { successResponse } from "../../utils/response";

export function createPaymentConfigRouter(ctx: AppContext) {
  const router = Router();
  const payment = createPaymentProviders(ctx.env);

  router.get("/", (_req: Request, res: Response) => {
    const methods = payment.getPaymentMethods();
    return successResponse(res, {
      enabled: methods.length > 0,
      methods: methods.map((m) => m.value),
      payment_methods: methods
    });
  });

  return router;
}
