import type { Env } from "../types";
import { encryptText, decryptText, sha256Hex } from "../utils/crypto";
import {
  generateTotpSecret,
  verifyTotpCode,
  createOtpAuthURL,
  generateBackupCodes,
} from "../utils/totp";

export class TwoFactorService {
  private readonly env: Env;

  constructor(env: Env) {
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
    throw new Error("Missing TWO_FACTOR_SECRET_KEY or JWT_SECRET");
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

  async verifyTotp(secret: string, code: string): Promise<boolean> {
    return verifyTotpCode(secret, code);
  }

  generateBackupCodes(count = 8): string[] {
    return generateBackupCodes(count);
  }

  normalizeBackupCodeInput(code: string): string {
    return code.replace(/\s+/g, "").toUpperCase();
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
