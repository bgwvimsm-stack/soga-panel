// src/utils/crypto.js - 加密工具

/**
 * 生成密码哈希
 * @param {string} password - 原始密码
 * @returns {Promise<string>} - 密码哈希
 */
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 验证密码
 * @param {string} password - 原始密码
 * @param {string} hash - 密码哈希
 * @returns {Promise<boolean>} - 验证结果
 */
export async function verifyPassword(password, hash) {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

/**
 * 生成 JWT Token
 * @param {object} payload - Token 载荷
 * @param {string} secret - 密钥
 * @param {number} expiresIn - 过期时间（秒）
 * @returns {Promise<string>} - JWT Token
 */
export async function generateToken(payload, secret, expiresIn = 86400) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const now = getUtc8Timestamp();
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "");
  const encodedPayload = btoa(JSON.stringify(tokenPayload)).replace(/=/g, "");

  const message = `${encodedHeader}.${encodedPayload}`;
  const signature = await createHmacSignature(message, secret);

  return `${message}.${signature}`;
}

/**
 * 验证 JWT Token
 * @param {string} token - JWT Token
 * @param {string} secret - 密钥
 * @returns {Promise<object|null>} - 解析后的载荷或 null
 */
export async function verifyToken(token, secret) {
  try {
    const [header, payload, signature] = token.split(".");

    if (!header || !payload || !signature) {
      return null;
    }

    const message = `${header}.${payload}`;
    const expectedSignature = await createHmacSignature(message, secret);

    if (signature !== expectedSignature) {
      return null;
    }

    const decodedPayload = JSON.parse(atob(payload));

    // 检查是否过期
    const now = getUtc8Timestamp();
    if (decodedPayload.exp && decodedPayload.exp < now) {
      return null;
    }

    return decodedPayload;
  } catch (error) {
    console.error("Token verification error:", error);
    return null;
  }
}

/**
 * 创建 HMAC 签名
 * @param {string} message - 消息
 * @param {string} secret - 密钥
 * @returns {Promise<string>} - 签名
 */
async function createHmacSignature(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * 生成随机字符串
 * @param {number} length - 长度
 * @returns {string} - 随机字符串
 */
export function generateRandomString(length = 32) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }

  return result;
}

/**
 * 生成数字验证码
 * @param {number} length - 验证码长度
 * @returns {string} - 数字验证码
 */
export function generateNumericCode(length = 6) {
  if (length <= 0) {
    throw new Error("Invalid code length");
  }

  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += (randomValues[i] % 10).toString();
  }

  return result;
}

/**
 * 生成 UUID
 * @returns {string} - UUID
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Base64 URL 编码
 * @param {string} str - 字符串
 * @returns {string} - Base64 URL 编码结果
 */
export function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64 URL 解码
 * @param {string} str - Base64 URL 编码字符串
 * @returns {string} - 解码结果
 */
export function base64UrlDecode(str) {
  str = (str + "===").slice(0, str.length + (str.length % 4));
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * 获取 UTC+8 时区的时间戳（秒）
 * @returns {number} - UTC+8 时区时间戳
 */
export function getUtc8Timestamp() {
  return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / 1000);
}

/**
 * 获取 UTC+8 时区的 ISO 字符串
 * @returns {string} - UTC+8 时区 ISO 字符串
 */
export function getUtc8IsoString() {
  const utc8Time = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return utc8Time.toISOString().replace('Z', '+08:00');
}

/**
 * 获取 UTC+8 时区的日期字符串 (YYYY-MM-DD)
 * @returns {string} - UTC+8 时区日期字符串
 */
export function getUtc8DateString() {
  const utc8Time = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return utc8Time.toISOString().split('T')[0];
}

/**
 * 计算字符串的 SHA-256 十六进制哈希
 */
export async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const AES_ALGORITHM = "AES-GCM";
const AES_IV_LENGTH = 12;

async function importAesKey(secret) {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    throw new Error("Missing encryption key");
  }
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hashBuffer, { name: AES_ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 使用 AES-GCM 加密文本
 */
export async function encryptText(plainText, secret) {
  const encoder = new TextEncoder();
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    key,
    encoder.encode(plainText)
  );
  return `${arrayBufferToBase64(iv)}:${arrayBufferToBase64(cipherBuffer)}`;
}

/**
 * 解密 AES-GCM 文本
 */
export async function decryptText(payload, secret) {
  if (!payload) return "";
  const [ivPart, dataPart] = payload.split(":");
  if (!ivPart || !dataPart) {
    throw new Error("Invalid encrypted payload");
  }
  const key = await importAesKey(secret);
  const iv = base64ToUint8Array(ivPart);
  const cipherBytes = base64ToUint8Array(dataPart);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv },
    key,
    cipherBytes
  );
  const decoder = new TextDecoder();
  return decoder.decode(plainBuffer);
}
