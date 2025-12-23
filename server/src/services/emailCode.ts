import { DatabaseService } from "./database";
import { generateNumericCode, sha256Hex } from "../utils/crypto";
import { ensureString } from "../utils/d1";

const DEFAULT_TTL_SECONDS = 15 * 60;

export class EmailCodeService {
  private readonly db: DatabaseService;
  private readonly ttl: number;

  constructor(db: DatabaseService, ttl = DEFAULT_TTL_SECONDS) {
    this.db = db;
    this.ttl = ttl;
  }

  async issueCode(email: string, purpose: string, meta?: { ip?: string | null; ua?: string | null }) {
    const code = generateNumericCode(6);
    const hash = sha256Hex(code);
    const expires = new Date(Date.now() + this.ttl * 1000);
    await this.db.upsertEmailCode({
      email: email.toLowerCase(),
      purpose,
      code_hash: hash,
      expires_at: expires,
      request_ip: ensureString(meta?.ip || undefined),
      user_agent: ensureString(meta?.ua || undefined)
    });

    return { code, expires_at: expires.toISOString() };
  }

  async verifyCode(
    email: string,
    purpose: string,
    code: string,
    options: { attemptLimit?: number } = {}
  ) {
    const entry = await this.db.getValidEmailCode(email.toLowerCase(), purpose);
    if (!entry) return { success: false, message: "验证码不存在或已过期" };
    const hash = sha256Hex(code);
    if (hash !== entry.code_hash) {
      const attemptLimit = options.attemptLimit ?? 0;
      const currentAttempts = Number(entry.attempts ?? 0);
      const nextAttempts = currentAttempts + 1;
      const reachLimit = attemptLimit > 0 && nextAttempts >= attemptLimit;

      await this.db.db
        .prepare(
          `
          UPDATE email_verification_codes
          SET attempts = ?, used_at = ${reachLimit ? "CURRENT_TIMESTAMP" : "used_at"}
          WHERE id = ?
        `
        )
        .bind(nextAttempts, entry.id)
        .run();

      return {
        success: false,
        message: reachLimit ? "验证码错误次数过多，请重新获取验证码" : "验证码错误"
      };
    }
    await this.db.markEmailCodeUsed(Number(entry.id));
    return { success: true, entry };
  }
}
