import crypto from "crypto";

const BASE64URL_REGEX = /=+$/;

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateRandomString(length = 32): string {
  if (length <= 0) throw new Error("Invalid length");
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

export function generateBase64Random(length = 32): string {
  if (length <= 0) throw new Error("Invalid random byte length");
  return crypto.randomBytes(length).toString("base64");
}

export function generateNumericCode(length = 6): string {
  if (length <= 0) throw new Error("Invalid code length");
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += (bytes[i] % 10).toString();
  }
  return out;
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec = 60 * 60 * 24 * 2
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = getUtc8Timestamp();
  const data = {
    ...payload,
    iat: now,
    exp: now + expiresInSec
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(data));
  const message = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmacSignature(message, secret);

  return `${message}.${signature}`;
}

export function verifyToken(token: string, secret: string): Record<string, unknown> | null {
  try {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) return null;

    const message = `${header}.${payload}`;
    const expectedSignature = createHmacSignature(message, secret);
    if (expectedSignature !== signature) return null;

    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = getUtc8Timestamp();
    if (decodedPayload.exp && decodedPayload.exp < now) return null;
    return decodedPayload;
  } catch (error) {
    console.error("[jwt] verify error:", error);
    return null;
  }
}

export function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8").toString("base64url").replace(BASE64URL_REGEX, "");
}

export function base64UrlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

export function getUtc8Timestamp(): number {
  return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / 1000);
}

function createHmacSignature(message: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("base64url");
}

export function md5Hex(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// 对称加解密（AES-256-GCM）
function deriveKey(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptText(plain: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString("base64");
}

export function decryptText(encrypted: string, secret: string): string {
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
