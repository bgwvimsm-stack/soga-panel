import { encryptText, decryptText, sha256Hex } from "../utils/crypto";
import {
  createOtpAuthURL,
  generateBackupCodes,
  generateQrDataURL,
  generateTotpSecret,
  verifyTotpCode
} from "../utils/totp";
import type { AppEnv } from "../config/env";
import { ensureString } from "../utils/d1";

export class TwoFactorService {
  private readonly env: AppEnv;

  constructor(env: AppEnv) {
    this.env = env;
  }

  private getEncryptionKey(): string {
    const envKey =
      typeof this.env.TWO_FACTOR_SECRET_KEY === "string"
        ? this.env.TWO_FACTOR_SECRET_KEY.trim()
        : "";
    if (envKey) return envKey;
    const jwtKey =
      typeof this.env.JWT_SECRET === "string" ? this.env.JWT_SECRET.trim() : "";
    if (jwtKey) return jwtKey;
    // 开发兜底，避免缺少配置直接抛错；生产务必配置 TWO_FACTOR_SECRET_KEY 或 JWT_SECRET
    console.warn("[two-factor] 缺少 TWO_FACTOR_SECRET_KEY/JWT_SECRET，已使用默认密钥，仅供开发测试");
    return "default-two-factor-secret";
  }

  async encryptSecret(secret: string): Promise<string> {
    return encryptText(secret, this.getEncryptionKey());
  }

  async decryptSecret(encrypted?: string | null): Promise<string | null> {
    if (!encrypted) return null;
    return decryptText(encrypted, this.getEncryptionKey());
  }

  generateSecret(length = 32): string {
    return generateTotpSecret(length);
  }

  createOtpAuthUrl(secret: string, accountName: string, issuer: string): string {
    return createOtpAuthURL({ secret, accountName, issuer });
  }

  async generateQr(secret: string, accountName: string, issuer: string) {
    const url = this.createOtpAuthUrl(secret, accountName, issuer);
    const qr = await generateQrDataURL(url);
    return { url, qr };
  }

  async verifyTotp(secret: string, code: string): Promise<boolean> {
    return verifyTotpCode(secret, code);
  }

  generateBackupCodes(count = 8): string[] {
    return generateBackupCodes(count);
  }

  normalizeBackupCodeInput(code: string): string {
    return ensureString(code).replace(/\s+/g, "").toUpperCase();
  }

  async hashBackupCode(code: string): Promise<string> {
    return sha256Hex(this.normalizeBackupCodeInput(code));
  }

  async hashBackupCodes(codes: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const code of codes) {
      results.push(await this.hashBackupCode(code));
    }
    return results;
  }

  parseBackupCodes(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => typeof item === "string");
    } catch {
      return [];
    }
  }
}
