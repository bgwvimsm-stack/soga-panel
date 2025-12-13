import type { Response } from "express";

export function successResponse(
  res: Response,
  data: unknown = null,
  message = "Success",
  status = 200
) {
  return res.status(status).json({ code: 0, message, data });
}

export function errorResponse(
  res: Response,
  message = "Error",
  status = 400,
  data: unknown = null
) {
  return res.status(status).json({ code: status, message, data });
}
