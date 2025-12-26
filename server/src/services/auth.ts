import { CacheService } from "./cache";
import { DatabaseService } from "./database";
import {
  generateBase64Random,
  generateRandomString,
  generateUUID,
  hashPassword,
  verifyPassword
} from "../utils/crypto";
import { ensureString } from "../utils/d1";
import { EmailCodeService } from "./emailCode";
import { EmailService } from "./email";
import {
  buildEmailSubject,
  buildEmailText,
  buildVerificationHtml,
  getVerificationTitleText
} from "../email/templates";
import type { AppEnv } from "../config/env";
import { TwoFactorService } from "./twoFactor";

export type SessionPayload = {
  id: number;
  email: string;
  username: string;
  is_admin: number;
};

type LoginResult =
  | { success: true; token: string; user: SessionPayload; trustToken?: string | null }
  | { success: false; message: string; twoFactorRequired?: false }
  | { success: false; message: string; twoFactorRequired: true; challengeId: string };

type RegisterResult =
  | { success: true; userId: number | null }
  | { success: false; message: string };

export class AuthService {
  private readonly db: DatabaseService;
  private readonly cache: CacheService;
  private readonly sessionTTL: number;
  private readonly trustTTL: number;
  private readonly twoFactorChallengeTTL: number;
  private readonly emailCodeService: EmailCodeService;
  private readonly emailService: EmailService;
  private readonly env: AppEnv;
  private readonly twoFactorService: TwoFactorService;
  private readonly verificationExpireMinutes: number;

  constructor(db: DatabaseService, cache: CacheService, env: AppEnv, sessionTTL = 60 * 60 * 24 * 7) {
    this.db = db;
    this.cache = cache;
    this.sessionTTL = sessionTTL;
    this.trustTTL = 60 * 60 * 24 * 30; // 30 天记住设备
    this.twoFactorChallengeTTL = 60 * 5; // 5 分钟验证窗口
    this.env = env;
    const expireMinutesEnv = env.MAIL_VERIFICATION_EXPIRE_MINUTES;
    const expireMinutes = expireMinutesEnv
      ? Math.max(1, Number.parseInt(expireMinutesEnv, 10) || 10)
      : 10;
    this.verificationExpireMinutes = expireMinutes;
    this.emailCodeService = new EmailCodeService(db, expireMinutes * 60);
    this.emailService = new EmailService(env);
    this.twoFactorService = new TwoFactorService(env);
  }

  private getVerificationAttemptLimit() {
    const raw = this.env.MAIL_VERIFICATION_ATTEMPT_LIMIT;
    const parsed =
      typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 5;
  }

  async register(
    email: string,
    username: string,
    password: string,
    registerIp?: string | null,
    invitedBy?: number | null
  ): Promise<RegisterResult> {
    const existingEmail = await this.db.getUserByEmail(email);
    if (existingEmail) {
      return { success: false, message: "邮箱已被注册" };
    }
    const existingUser = await this.db.getUserByUsername(username);
    if (existingUser) {
      return { success: false, message: "用户名已被占用" };
    }

    const passwordHash = hashPassword(password);
    const uuid = generateUUID();
    // 订阅/节点密码：需要兼容 SS2022 的 Base64 密钥格式（等价 openssl rand -base64 32）
    const passwd = generateBase64Random(32);
    const token = generateRandomString(32);

    const configMap = await this.db.listSystemConfigsMap();
    const inviteLimitRaw = configMap["invite_default_limit"];
    const inviteLimit = inviteLimitRaw ? Number(inviteLimitRaw) : 0;
    const toIntConfig = (
      value: unknown,
      fallback: number,
      options: { min?: number; allowZero?: boolean } = {}
    ) => {
      const parsed =
        typeof value === "number"
          ? value
          : typeof value === "string"
          ? Number.parseInt(value, 10)
          : Number.NaN;
      const min = options.min ?? 0;
      const allowZero = options.allowZero ?? true;
      if (!Number.isFinite(parsed)) return fallback;
      if (parsed < min) return fallback;
      if (!allowZero && parsed === 0) return fallback;
      return parsed;
    };
    const transferEnable = toIntConfig(
      configMap["default_traffic"],
      10737418240,
      { min: 0, allowZero: true }
    );
    const accountExpireDays = toIntConfig(
      configMap["default_account_expire_days"],
      3650,
      { min: 0, allowZero: true }
    );
    const classExpireDays = toIntConfig(
      configMap["default_expire_days"],
      30,
      { min: 0, allowZero: true }
    );
    const defaultClass = toIntConfig(
      configMap["default_class"],
      1,
      { min: 0, allowZero: true }
    );

    const userId = await this.db.createUser({
      email,
      username,
      password_hash: passwordHash,
      uuid,
      passwd,
      token,
      register_ip: registerIp ?? null,
      invited_by: invitedBy ?? null,
      invite_limit: Number.isFinite(inviteLimit) && inviteLimit > 0 ? inviteLimit : 0
    });

    if (userId) {
      const utc8Now = Date.now() + 8 * 60 * 60 * 1000;
      const accountExpireTime =
        accountExpireDays > 0
          ? new Date(
              utc8Now + accountExpireDays * 24 * 60 * 60 * 1000
            )
          : null;
      const classExpireTime =
        classExpireDays > 0
          ? new Date(utc8Now + classExpireDays * 24 * 60 * 60 * 1000)
          : null;
      await this.db.db
        .prepare(
          `
          UPDATE users
          SET transfer_enable = ?,
              expire_time = ?,
              class = ?,
              class_expire_time = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(
          transferEnable,
          accountExpireTime,
          defaultClass,
          classExpireTime,
          userId
        )
        .run();
    }

    return { success: true, userId };
  }

  async login(
    email: string,
    password: string,
    clientIp?: string | null,
    remember?: boolean,
    twoFactorTrustToken?: string | null,
    twoFactorCode?: string | null,
    backupCode?: string | null,
    userAgent?: string | null
  ): Promise<LoginResult> {
    const user = await this.db.getUserByEmail(email);
    if (!user) return { success: false, message: "账户不存在" };

    if (Number(user.status ?? 0) !== 1) {
      return { success: false, message: "账户已禁用" };
    }

    const ok = verifyPassword(password, String(user.password_hash || ""));
    if (!ok) return { success: false, message: "密码错误" };

    // 处理二步验证
    if (Number(user.two_factor_enabled) === 1) {
      // 已信任设备则跳过
      const trustKey = twoFactorTrustToken ? await this.cache.get(`2fa_trust_${twoFactorTrustToken}`) : null;
      if (trustKey && Number(trustKey) === Number(user.id)) {
        // 继续后续发 token
      } else if (!twoFactorCode && !backupCode) {
        const challengeId = await this.createTwoFactorChallenge({
          userId: Number(user.id),
          remember: Boolean(remember),
          loginMethod: "password",
          clientIp,
          userAgent
        });
        return {
          success: false,
          message: "需要二步验证",
          twoFactorRequired: true,
          challengeId
        };
      }

      const secret = await this.twoFactorService.decryptSecret(
        ensureString(user.two_factor_secret)
      );
      if (!secret) {
        return { success: false, message: "2FA 配置异常，请联系管理员" };
      }

      const backupCodes = this.twoFactorService.parseBackupCodes(
        ensureString(user.two_factor_backup_codes)
      );

      let verified = false;
      let backupUsedIndex = -1;

      if (twoFactorCode && (await this.twoFactorService.verifyTotp(secret, twoFactorCode))) {
        verified = true;
      } else if (backupCode) {
        const hashed = await this.twoFactorService.hashBackupCode(backupCode);
        backupUsedIndex = backupCodes.findIndex((c) => c === hashed);
        if (backupUsedIndex >= 0) {
          verified = true;
        }
      }

      if (!verified) {
        return { success: false, message: "需要二步验证码或备份码" };
      }

      // 如果使用了备份码，删除该码
      if (backupUsedIndex >= 0) {
        backupCodes.splice(backupUsedIndex, 1);
        await this.db.updateTwoFactorData({
          userId: Number(user.id),
          enabled: 1,
          secret: ensureString(user.two_factor_secret),
          backupCodes
        });
      }
    }

    const payload: SessionPayload = {
      id: Number(user.id),
      email: String(user.email),
      username: ensureString(user.username),
      is_admin: Number(user.is_admin ?? 0)
    };

    const sessionToken = generateRandomString(48);
    await this.cache.set(
      `session_${sessionToken}`,
      JSON.stringify({ ...payload, login_time: new Date().toISOString() }),
      this.sessionTTL
    );

    await this.db.updateLoginInfo(payload.id, clientIp ?? null);
    await this.db.insertLoginLog({
      userId: payload.id,
      ip: clientIp ?? "",
      userAgent: userAgent ?? "",
      status: 1,
      loginMethod: "password"
    });

    return { success: true, token: sessionToken, user: payload };
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    await this.cache.delete(`session_${token}`);
  }

  async createTwoFactorChallenge(payload: {
    userId: number;
    remember: boolean;
    loginMethod: string;
    clientIp?: string | null;
    userAgent?: string | null;
  }) {
    const challengeId = generateRandomString(32);
    await this.cache.set(
      `2fa_challenge_${challengeId}`,
      JSON.stringify(payload),
      this.twoFactorChallengeTTL
    );
    return challengeId;
  }

  async verifyTwoFactorChallenge(params: {
    challengeId: string;
    code: string;
    rememberDevice?: boolean;
    deviceName?: string;
    clientIp?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    const cached = await this.cache.get(`2fa_challenge_${params.challengeId}`);
    if (!cached) return { success: false, message: "验证会话已过期，请重新登录" };
    const parsed = (() => {
      try {
        return JSON.parse(cached);
      } catch {
        return null;
      }
    })();
    if (!parsed || typeof parsed.userId !== "number") {
      return { success: false, message: "验证会话无效" };
    }
    const user = await this.db.getUserById(Number(parsed.userId));
    if (!user) return { success: false, message: "用户不存在" };
    if (Number(user.two_factor_enabled) !== 1) {
      return { success: false, message: "未启用二步验证" };
    }

    const secret = await this.twoFactorService.decryptSecret(ensureString(user.two_factor_secret));
    if (!secret) return { success: false, message: "2FA 配置异常，请联系管理员" };

    const backupCodes = this.twoFactorService.parseBackupCodes(ensureString(user.two_factor_backup_codes));
    let verified = false;
    let backupUsedIndex = -1;
    const code = params.code?.trim();
    if (code && (await this.twoFactorService.verifyTotp(secret, code))) {
      verified = true;
    } else if (code) {
      const hashed = await this.twoFactorService.hashBackupCode(code);
      backupUsedIndex = backupCodes.findIndex((c) => c === hashed);
      if (backupUsedIndex >= 0) verified = true;
    }
    if (!verified) return { success: false, message: "验证码无效，请重试" };

    // 备用码使用一次即废除
    if (backupUsedIndex >= 0) {
      backupCodes.splice(backupUsedIndex, 1);
      await this.db.updateTwoFactorData({
        userId: Number(user.id),
        enabled: 1,
        secret: ensureString(user.two_factor_secret),
        backupCodes
      });
    }

    // 登录成功，删除挑战
    await this.cache.delete(`2fa_challenge_${params.challengeId}`);

    // 生成 session
    const payload: SessionPayload = {
      id: Number(user.id),
      email: String(user.email),
      username: ensureString(user.username),
      is_admin: Number(user.is_admin ?? 0)
    };
    const sessionToken = generateRandomString(48);
    await this.cache.set(
      `session_${sessionToken}`,
      JSON.stringify({ ...payload, login_time: new Date().toISOString() }),
      this.sessionTTL
    );

    // 记住设备 token
    let trustToken: string | null = null;
    if (params.rememberDevice) {
      trustToken = generateRandomString(48);
      await this.cache.set(`2fa_trust_${trustToken}`, String(user.id), this.trustTTL);
    }

    await this.db.updateLoginInfo(payload.id, params.clientIp ?? null);
    await this.db.insertLoginLog({
      userId: payload.id,
      ip: params.clientIp ?? "",
      userAgent: params.userAgent ?? "",
      status: 1,
      loginMethod: "password"
    });

    return { success: true, token: sessionToken, user: payload, trustToken };
  }

  async issueSessionToken(payload: SessionPayload) {
    const sessionToken = generateRandomString(48);
    await this.cache.set(
      `session_${sessionToken}`,
      JSON.stringify({ ...payload, login_time: new Date().toISOString() }),
      this.sessionTTL
    );
    return sessionToken;
  }

  async sendEmailCode(email: string, purpose: string, meta?: { ip?: string | null; ua?: string | null }) {
    const result = await this.emailCodeService.issueCode(email, purpose, meta);
    const configs = await this.db.listSystemConfigsMap();
    const siteName = String(configs["site_name"] || this.env.SITE_NAME || "Soga Panel");
    const siteUrl = String(configs["site_url"] || this.env.SITE_URL || "").trim() || undefined;

    const subject = buildEmailSubject(purpose, siteName);
    const text = buildEmailText(purpose, result.code, this.verificationExpireMinutes, siteName);
    const html = buildVerificationHtml({
      subject,
      siteName,
      siteUrl,
      code: result.code,
      textContent: text,
      expireMinutes: this.verificationExpireMinutes,
      titleText: getVerificationTitleText(purpose)
    });
    await this.emailService.sendMail({ to: email, subject, text, html });
    return result;
  }

  async verifyEmailCode(email: string, purpose: string, code: string) {
    const trimmedCode = (code || "").trim();
    if (!trimmedCode) {
      return { success: false, message: "请填写邮箱验证码" };
    }
    if (!/^\d{6}$/.test(trimmedCode)) {
      return { success: false, message: "验证码格式不正确，请输入6位数字验证码" };
    }
    const attemptLimit = this.getVerificationAttemptLimit();
    return await this.emailCodeService.verifyCode(
      email.toLowerCase(),
      purpose,
      trimmedCode,
      { attemptLimit }
    );
  }

  async resetPasswordWithCode(email: string, code: string, newPassword: string) {
    const verifyResult = await this.verifyEmailCode(email, "password_reset", code);
    if (!verifyResult.success) {
      return { success: false, message: verifyResult.message };
    }

    const user = await this.db.getUserByEmail(email.toLowerCase());
    if (!user) {
      return { success: false, message: "用户不存在" };
    }

    const hash = hashPassword(newPassword);
    await this.db.updateUserPassword(Number(user.id), hash);
    return { success: true };
  }

  async oauthLogin(params: {
    provider: string;
    email: string;
    providerId: string;
    username?: string;
    clientIp?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    const providerKey = params.provider.toLowerCase();
    const email = params.email.toLowerCase();
    const providerId = params.providerId;

    let user = await this.db.getUserByEmail(email);
    if (!user) {
      const username = params.username || email.split("@")[0] + "_" + generateRandomString(4);
      const created = await this.register(email, username, generateRandomString(12), params.clientIp ?? null, null);
      if (!created.success) return { success: false, message: "注册失败" };
      user = await this.db.getUserByEmail(email);
    }

    if (!user) return { success: false, message: "账户不存在" };

    const payload: SessionPayload = {
      id: Number(user.id),
      email: String(user.email),
      username: ensureString(user.username),
      is_admin: Number(user.is_admin ?? 0)
    };

    const sessionToken = generateRandomString(48);
    await this.cache.set(
      `session_${sessionToken}`,
      JSON.stringify({ ...payload, login_time: new Date().toISOString(), provider: providerKey }),
      this.sessionTTL
    );

    await this.db.updateLoginInfo(payload.id, params.clientIp ?? null);
    await this.db.insertLoginLog({
      userId: payload.id,
      ip: params.clientIp ?? "",
      userAgent: params.userAgent ?? "",
      status: 1,
      loginMethod: providerKey
    });

    return { success: true, token: sessionToken, user: payload };
  }

  // 邮件模板统一在 src/email/templates.ts 中维护
}
