import type { Request, Response } from "express";

// 生成 ETag（与 Worker 版保持一致的简单哈希算法）
export function generateETag(content: unknown): string {
  const contentStr = typeof content === "string" ? content : JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < contentStr.length; i += 1) {
    const char = contentStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // 转为 32 位整数
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

// 检查请求中的 If-None-Match 是否与当前 ETag 匹配
export function isETagMatch(req: Request, etag: string): boolean {
  const ifNoneMatchHeader =
    (req.headers["if-none-match"] as string | undefined) ||
    (req.headers["IF-NONE-MATCH"] as string | undefined);
  if (!ifNoneMatchHeader) return false;

  if (ifNoneMatchHeader === "*") return true;

  const normalize = (tag: string) => tag.replace(/^W\//, "").trim();
  const normalizedServer = normalize(etag);

  const tags = ifNoneMatchHeader
    .split(",")
    .map((t) => normalize(t))
    .filter((t) => t.length > 0);

  return tags.includes(normalizedServer) || tags.includes(etag);
}

export function sendNotModified(res: Response, etag: string) {
  res
    .status(304)
    .set("ETag", etag)
    .set("Cache-Control", "max-age=3600")
    .end();
}

export function sendETagJson(res: Response, data: unknown, etag: string) {
  res
    .status(200)
    .set("Content-Type", "application/json")
    .set("ETag", etag)
    .set("Cache-Control", "max-age=3600")
    .send(JSON.stringify(data));
}

