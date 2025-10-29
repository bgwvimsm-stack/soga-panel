// src/api/auth.js - 认证 API

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../types";
import { DatabaseService } from "../services/database";
import { CacheService } from "../services/cache";
import { successResponse, errorResponse } from "../utils/response";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  generateUUID,
  generateRandomString,
  generateNumericCode,
} from "../utils/crypto";
import { EmailService } from "../services/email";
import {
  createSystemConfigManager,
  SystemConfigManager,
} from "../utils/systemConfig";
import { getLogger, Logger } from "../utils/logger";
import {
  defaultRegisterEmailSubject,
  defaultRegisterEmailTemplate,
  defaultPasswordResetEmailSubject,
  defaultPasswordResetEmailTemplate,
} from "./email/templates";
import {
  ensureNumber,
  ensureString,
  toRunResult,
  getChanges,
  getLastRowId,
} from "../utils/d1";

const GOOGLE_TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

type GoogleTokenInfo = {
  aud: string;
  sub: string;
  email?: string;
  email_verified?: string;
  iss?: string;
  name?: string;
  given_name?: string;
  picture?: string;
};

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id?: number;
  email?: string;
  name?: string;
  login?: string;
  [key: string]: unknown;
}

interface GithubEmailEntry {
  email?: string;
  primary?: boolean;
  verified?: boolean;
  [key: string]: unknown;
}

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const PURPOSE_REGISTER = "register";
const PURPOSE_PASSWORD_RESET = "password_reset";

interface AuthUserRow {
  id: number;
  email: string;
  password_hash: string;
  is_admin: number;
  expire_time?: string | null;
  status?: number | null;
  google_sub?: string | null;
  github_id?: string | null;
  username?: string | null;
  [key: string]: unknown;
}

interface ConfigRow {
  key: string;
  value: string;
}

interface UserEmailUsernameRow {
  email?: string;
  username?: string;
}

type GetIntOptions = {
  allowZero?: boolean;
  min?: number;
};

export class AuthAPI {
  db: DatabaseService;
  cache: CacheService;
  env: Env;
  emailService: EmailService;
  configManager: SystemConfigManager;
  logger: Logger;
  private readonly dbRaw: D1Database;

  constructor(env: Env) {
    this.dbRaw = env.DB as D1Database;
    this.db = new DatabaseService(this.dbRaw);
    this.cache = new CacheService(this.dbRaw);
    this.env = env;
    this.emailService = new EmailService(env);
    this.configManager = createSystemConfigManager(env);
    this.logger = getLogger(env);
  }

  getIntConfig(value: unknown, fallback: number, options: GetIntOptions = {}) {
    const { allowZero = false, min = 1 } = options;
    const raw =
      typeof value === "number"
        ? value
        : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
    if (!Number.isFinite(raw)) return fallback;
    const num = raw;
    if (allowZero && num === 0) return 0;
    if (num < min) return fallback;
    return num;
  }

  parseNumber(value, defaultValue = 0) {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === "number") return value;
    const num = Number(value);
    return Number.isFinite(num) ? num : defaultValue;
  }

  parseBoolean(value, defaultValue = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "n", "off"].includes(normalized)) {
        return false;
      }
    }
    return defaultValue;
  }

  private getGoogleClientIds(): string[] {
    const rawValue =
      typeof this.env.GOOGLE_CLIENT_ID === "string"
        ? this.env.GOOGLE_CLIENT_ID
        : typeof this.env.GOOGLE_CLIENT_IDS === "string"
        ? this.env.GOOGLE_CLIENT_IDS
        : "";

    if (!rawValue) {
      return [];
    }

    return rawValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private isMailConfigured(): boolean {
    const fromEmail =
      typeof this.env.MAIL_FROM === "string" ? this.env.MAIL_FROM.trim() : "";
    const provider =
      typeof this.env.MAIL_PROVIDER === "string"
        ? this.env.MAIL_PROVIDER.trim().toLowerCase()
        : "";

    if (!fromEmail) return false;
    if (!provider || provider === "none") return false;
    return true;
  }

  private async verifyGoogleIdToken(
    idToken: string
  ): Promise<GoogleTokenInfo> {
    const url = `${GOOGLE_TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(
      idToken
    )}`;

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch (error) {
      this.logger.error("Google token 验证请求失败", error);
      throw new Error("无法验证 Google 身份令牌，请稍后重试");
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      this.logger.warn("Google token 验证失败", {
        status: response.status,
        body: errorText,
      });
      throw new Error("Google 身份令牌无效或已过期");
    }

    const data = (await response.json()) as GoogleTokenInfo;
    if (!data || typeof data !== "object" || !data.aud || !data.sub) {
      throw new Error("Google 身份令牌返回数据异常");
    }

    return data;
  }

  private sanitizeUsername(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .replace(/^_+/, "")
      .replace(/_+$/, "")
      .slice(0, 30);
  }

  private async resolveUniqueUsername(base: string): Promise<string> {
    let sanitizedBase = this.sanitizeUsername(base);
    if (!sanitizedBase) {
      sanitizedBase = `user_${generateRandomString(6).toLowerCase()}`;
    }

    let candidate = sanitizedBase;
    let counter = 1;
    while (true) {
      const existing = await this.db.db
        .prepare("SELECT id FROM users WHERE username = ?")
        .bind(candidate)
        .first();
      if (!existing) {
        return candidate;
      }
      const suffix = String(counter);
      const maxBaseLength = Math.max(1, 30 - suffix.length);
      candidate = `${sanitizedBase.slice(0, maxBaseLength)}${suffix}`;
      counter += 1;
    }
  }

  private async generateUniqueUsername(
    preferredNames: string[],
    fallbackSeed: string
  ): Promise<string> {
    for (const name of preferredNames) {
      const sanitized = this.sanitizeUsername(name);
      if (!sanitized) continue;
      const unique = await this.resolveUniqueUsername(sanitized);
      if (unique) return unique;
    }

    const fallbackBase = this.sanitizeUsername(
      fallbackSeed ? `user_${fallbackSeed}` : ""
    );
    return this.resolveUniqueUsername(
      fallbackBase || `user_${generateRandomString(6).toLowerCase()}`
    );
  }

  private buildSessionPayload(user: any) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      uuid: user.uuid,
      passwd: user.passwd,
      is_admin: user.is_admin,
      class: user.class,
      class_expire_time: user.class_expire_time,
      upload_traffic: user.upload_traffic,
      download_traffic: user.download_traffic,
      upload_today: user.upload_today,
      download_today: user.download_today,
      transfer_total: user.transfer_total,
      transfer_enable: user.transfer_enable,
      transfer_remain: Math.max(
        0,
        user.transfer_enable - user.transfer_total
      ),
      speed_limit: user.speed_limit,
      device_limit: user.device_limit,
      expire_time: user.expire_time,
      status: user.status,
    };
  }

  private buildUserResponse(user: any) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      uuid: user.uuid,
      passwd: user.passwd,
      is_admin: user.is_admin === 1,
      class: user.class,
      class_expire_time: user.class_expire_time,
      expire_time: user.expire_time,
      upload_traffic: user.upload_traffic,
      download_traffic: user.download_traffic,
      upload_today: user.upload_today,
      download_today: user.download_today,
      transfer_total: user.transfer_total,
      transfer_enable: user.transfer_enable,
      transfer_remain: Math.max(
        0,
        user.transfer_enable - user.transfer_total
      ),
      speed_limit: user.speed_limit,
      device_limit: user.device_limit,
      status: user.status,
      token: user.token,
    };
  }

  private async sendOAuthWelcomeEmail(
    providerLabel: string,
    email: string,
    password: string,
    siteName: string,
    siteUrl?: string
  ): Promise<boolean> {
    if (!this.isMailConfigured()) {
      return false;
    }

    const subject = `${siteName} 账户已创建`;
    const safeSiteUrl = siteUrl || "";
    const html = `
      <p>您好，</p>
      <p>您已使用 ${this.escapeHtml(providerLabel)} 账号成功创建 ${this.escapeHtml(siteName)} 账户。</p>
      <p>我们为您生成了一组初始密码，请妥善保管：</p>
      <pre style="padding:12px;background:#f4f4f5;border-radius:6px;">${this.escapeHtml(
        password
      )}</pre>
      <p>建议您登录后尽快在个人资料页面修改密码。</p>
      ${
        safeSiteUrl
          ? `<p>立即访问：<a href="${this.escapeHtml(
              safeSiteUrl
            )}" target="_blank" rel="noopener">${this.escapeHtml(
              safeSiteUrl
            )}</a></p>`
          : ""
      }
      <p>祝您使用愉快！</p>
      `;

    const text = [
      "您好，",
      `您已使用 ${providerLabel} 账号成功创建 ${siteName} 账户。`,
      "我们为您生成了一组初始密码，请妥善保管：",
      password,
      "建议您登录后尽快在个人资料页面修改密码。",
      safeSiteUrl ? `立即访问：${safeSiteUrl}` : "",
      "祝您使用愉快！",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await this.emailService.sendEmail({
        to: email,
        subject,
        html,
        text,
      });
      return true;
    } catch (error) {
      this.logger.error("Google 注册欢迎邮件发送失败", error, { email });
      return false;
    }
  }

  isGmailAlias(email: string) {
    const [local = "", domain = ""] = email.split("@");
    const normalizedDomain = domain.toLowerCase();
    if (
      normalizedDomain !== "gmail.com" &&
      normalizedDomain !== "googlemail.com"
    ) {
      return false;
    }
    const plusIndex = local.indexOf("+");
    if (plusIndex !== -1) {
      return true;
    }
    return local.includes(".");
  }

  async getVerificationSettings(purpose = PURPOSE_REGISTER) {
    const isRegister = purpose === PURPOSE_REGISTER;
    const emailProviderEnabled = this.isMailConfigured();

    const envDefaults = {
      expire: this.getIntConfig(
        this.env.MAIL_VERIFICATION_EXPIRE_MINUTES,
        10,
        { min: 1 }
      ),
      cooldown: this.getIntConfig(
        this.env.MAIL_VERIFICATION_COOLDOWN_SECONDS,
        60,
        { allowZero: true, min: 1 }
      ),
      dailyLimit: this.getIntConfig(
        this.env.MAIL_VERIFICATION_DAILY_LIMIT,
        5,
        { allowZero: true, min: 1 }
      ),
      ipHourlyLimit: this.getIntConfig(
        this.env.MAIL_VERIFICATION_IP_HOURLY_LIMIT,
        10,
        { allowZero: true, min: 1 }
      ),
      attemptLimit: this.getIntConfig(
        this.env.MAIL_VERIFICATION_ATTEMPT_LIMIT,
        5,
        { min: 1 }
      ),
    };

    const siteConfigs = await this.configManager.getSiteConfigs();

    if (isRegister) {
      const registerEnabled = await this.configManager.getSystemConfig(
        "register_enabled",
        "1"
      );
      const verificationEnabled = await this.configManager.getSystemConfig(
        "register_email_verification_enabled",
        "1"
      );

      return {
        purpose,
        enabled:
          registerEnabled !== "0" &&
          verificationEnabled !== "0" &&
          emailProviderEnabled,
        subjectTemplate: defaultRegisterEmailSubject,
        bodyTemplate: defaultRegisterEmailTemplate,
        expireMinutes: envDefaults.expire,
        cooldownSeconds: envDefaults.cooldown,
        dailyLimit: envDefaults.dailyLimit,
        ipHourlyLimit: envDefaults.ipHourlyLimit,
        attemptLimit: envDefaults.attemptLimit,
        siteName: siteConfigs.site_name || "Soga Panel",
        siteUrl: siteConfigs.site_url || "",
      };
    }

    return {
      purpose,
      enabled: emailProviderEnabled,
      subjectTemplate: defaultPasswordResetEmailSubject,
      bodyTemplate: defaultPasswordResetEmailTemplate,
      expireMinutes: envDefaults.expire,
      cooldownSeconds: envDefaults.cooldown,
      dailyLimit: envDefaults.dailyLimit,
      ipHourlyLimit: envDefaults.ipHourlyLimit,
      attemptLimit: envDefaults.attemptLimit,
      siteName: siteConfigs.site_name || "Soga Panel",
      siteUrl: siteConfigs.site_url || "",
    };
  }

  async cleanupVerificationCodes(email = null, purpose = null) {
    const condition = `(
      expires_at <= datetime('now', '+8 hours')
      OR (used_at IS NOT NULL AND used_at < datetime('now', '+8 hours', '-1 day'))
    )`;

    let query = `DELETE FROM email_verification_codes WHERE ${condition}`;
    const bindings: any[] = [];

    if (email) {
      query += " AND email = ?";
      bindings.push(email);
    }

    if (purpose) {
      query += " AND purpose = ?";
      bindings.push(purpose);
    }

    await this.db.db.prepare(query).bind(...bindings).run();
  }

  renderTemplate(template, context) {
    if (!template) return "";
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
      const normalizedKey = key.trim().toLowerCase();
      return context[normalizedKey] ?? "";
    });
  }

  escapeHtml(str = "") {
    const value = str ?? "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  buildVerificationHtml({
    subject,
    siteName,
    siteUrl,
    code,
    textContent,
    expireMinutes,
    titleText,
  }) {
    const paragraphs = textContent
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          `<p style="margin:0 0 12px;">${this.escapeHtml(line)}</p>`
      )
      .join("");

    const footer = siteUrl
      ? `<p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">访问 <a href="${this.escapeHtml(
          siteUrl
        )}" style="color:#2563eb;text-decoration:none;">${this.escapeHtml(
          siteUrl
        )}</a> 获取更多信息。</p>`
      : "";

    return `
      <div style="background:#f1f5f9;padding:24px;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 16px 32px rgba(15,23,42,0.15);font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:28px;font-weight:700;color:#2563eb;">${this.escapeHtml(
              siteName
            )}</div>
            <div style="font-size:14px;color:#64748b;margin-top:6px;">${this.escapeHtml(
              subject
            )}</div>
          </div>
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:14px;color:#475569;margin-bottom:8px;">${this.escapeHtml(
              titleText
            )}</div>
            <div style="display:inline-block;padding:16px 24px;border-radius:14px;background:#1d4ed8;color:#ffffff;font-size:36px;font-weight:700;letter-spacing:10px;">${this.escapeHtml(
              code
            )}</div>
            <div style="font-size:13px;color:#64748b;margin-top:12px;">验证码将在 ${expireMinutes} 分钟后失效</div>
          </div>
          <div style="font-size:14px;line-height:1.7;color:#334155;margin-bottom:24px;">
            ${paragraphs}
          </div>
          <div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:32px;">
            如果这不是您的操作，请忽略此邮件。${footer}
          </div>
        </div>
      </div>
    `;
  }

  getPurposeMeta(purpose: string) {
    if (purpose === PURPOSE_PASSWORD_RESET) {
      return {
        label: "密码重置验证码",
        successMessage: "验证码已发送，请查收邮箱",
        disabledMessage: "当前未开启密码重置功能",
        existingUserMessage: "",
        missingUserMessage: "该邮箱未注册账户，请检查邮箱是否正确",
        titleText: "您的密码重置验证码",
        logPrefix: "密码重置",
      };
    }

    return {
      label: "注册验证码",
      successMessage: "验证码已发送，请查收邮箱",
      disabledMessage: "当前未开启邮箱验证码功能",
      existingUserMessage: "该邮箱已被注册，请使用其他邮箱或直接登录",
      missingUserMessage: "该邮箱地址不存在，请先注册账号",
      titleText: "您的注册验证码",
      logPrefix: "注册",
    };
  }

  async handleVerificationCodeRequest(
    request,
    {
      purpose = PURPOSE_REGISTER,
      requireExistingUser = false,
      disallowExistingUser = false,
    } = {}
  ) {
    let recordId = null;

    try {
      const requestBody = await request.json().catch(() => ({}));
      const rawEmail =
        typeof requestBody?.email === "string" ? requestBody.email : "";
      const email = rawEmail.trim().toLowerCase();

      if (!email) {
        return errorResponse("请填写邮箱地址", 400);
      }

      if (!EMAIL_REGEX.test(email)) {
        return errorResponse("请输入有效的邮箱地址", 400);
      }

      if (purpose === PURPOSE_REGISTER && this.isGmailAlias(email)) {
        return errorResponse(
          "暂不支持使用 Gmail 别名注册，请使用不含点和加号的原始邮箱地址",
          400
        );
      }

      const meta = this.getPurposeMeta(purpose);
      const settings = await this.getVerificationSettings(purpose);

      if (!settings.enabled) {
        return errorResponse(meta.disabledMessage, 403);
      }

      if (purpose === PURPOSE_REGISTER) {
        const registerEnabled = await this.configManager.getSystemConfig(
          "register_enabled",
          "1"
        );
        if (registerEnabled !== "1") {
          return errorResponse("系统暂时关闭注册功能", 403);
        }

        const existing = await this.db.db
          .prepare("SELECT id FROM users WHERE email = ?")
          .bind(email)
          .first();

        if (existing) {
          return errorResponse(
            "该邮箱已被注册，请直接登录或找回密码",
            409
          );
        }
      }

      let user = null;
      if (requireExistingUser || disallowExistingUser) {
        user = await this.db.db
          .prepare("SELECT id FROM users WHERE email = ?")
          .bind(email)
          .first();

        if (requireExistingUser && !user) {
          return errorResponse(meta.missingUserMessage, 400);
        }

        if (disallowExistingUser && user) {
          return errorResponse(meta.existingUserMessage, 409);
        }
      }

      await this.cleanupVerificationCodes(email, purpose);

      const clientIP =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For") ||
        request.headers.get("X-Real-IP") ||
        "unknown";
      const userAgent = request.headers.get("User-Agent") || "";

      if (settings.cooldownSeconds > 0) {
        const cooldownResult = await this.db.db
          .prepare(
            `
            SELECT COUNT(*) as count
            FROM email_verification_codes
            WHERE email = ?
              AND purpose = ?
              AND created_at > datetime('now', '+8 hours', ?)
          `
          )
          .bind(email, purpose, `-${settings.cooldownSeconds} seconds`)
          .first();

        if (this.parseNumber(cooldownResult?.count) > 0) {
          return errorResponse(
            `验证码发送频繁，请在 ${settings.cooldownSeconds} 秒后重试`,
            429
          );
        }
      }

      if (settings.dailyLimit > 0) {
        const dailyResult = await this.db.db
          .prepare(
            `
            SELECT COUNT(*) as count
            FROM email_verification_codes
            WHERE email = ?
              AND purpose = ?
              AND created_at > datetime('now', '+8 hours', '-1 day')
          `
          )
          .bind(email, purpose)
          .first();

        if (this.parseNumber(dailyResult?.count) >= settings.dailyLimit) {
          return errorResponse(
            "今日验证码发送次数已达上限，请24小时后再试",
            429
          );
        }
      }

      if (settings.ipHourlyLimit > 0 && clientIP !== "unknown") {
        const ipResult = await this.db.db
          .prepare(
            `
            SELECT COUNT(*) as count
            FROM email_verification_codes
            WHERE request_ip = ?
              AND purpose = ?
              AND created_at > datetime('now', '+8 hours', '-1 hour')
          `
          )
          .bind(clientIP, purpose)
          .first();

        if (this.parseNumber(ipResult?.count) >= settings.ipHourlyLimit) {
          return errorResponse(
            "请求过于频繁，请稍后再试或更换网络",
            429
          );
        }
      }

      await this.db.db
        .prepare(
          `
          UPDATE email_verification_codes
          SET used_at = datetime('now', '+8 hours')
          WHERE email = ? AND purpose = ? AND used_at IS NULL
        `
        )
        .bind(email, purpose)
        .run();

      const code = generateNumericCode(6);
      const codeHash = await hashPassword(code);

      const insertResult = await this.db.db
        .prepare(
          `
          INSERT INTO email_verification_codes (
            email, purpose, code_hash, expires_at, attempts, request_ip, user_agent
          )
          VALUES (?, ?, ?, datetime('now', '+8 hours', ?), 0, ?, ?)
        `
        )
        .bind(
          email,
          purpose,
          codeHash,
          `+${settings.expireMinutes} minutes`,
          clientIP,
          userAgent ? userAgent.slice(0, 500) : null
        )
        .run();

      recordId = insertResult?.meta?.last_row_id || null;

      const replacements = {
        code,
        email,
        purpose,
        site_name: settings.siteName,
        site_url: settings.siteUrl || "",
        expire_minutes: settings.expireMinutes.toString(),
        ip: clientIP,
      };

      const subject = this.renderTemplate(
        settings.subjectTemplate,
        replacements
      );
      const textContent = this.renderTemplate(
        settings.bodyTemplate,
        replacements
      );
      const htmlContent = this.buildVerificationHtml({
        subject,
        siteName: settings.siteName,
        siteUrl: settings.siteUrl,
        code,
        textContent,
        expireMinutes: settings.expireMinutes,
        titleText: meta.titleText,
      });

      await this.emailService.sendEmail({
        to: email,
        subject,
        html: htmlContent,
        text: textContent,
        fromName: settings.siteName,
      });

      this.logger.info(`发送${meta.label}成功`, {
        email,
        purpose,
        request_ip: clientIP,
        cooldown: settings.cooldownSeconds,
      });

      return successResponse({
        message: meta.successMessage,
        cooldown: settings.cooldownSeconds,
        expire_minutes: settings.expireMinutes,
      });
    } catch (error) {
      if (recordId) {
        await this.db.db
          .prepare("DELETE FROM email_verification_codes WHERE id = ?")
          .bind(recordId)
          .run();
      }

      this.logger.error(`发送验证码失败`, error, { purpose });
      return errorResponse("发送验证码失败，请稍后重试", 500);
    }
  }

  async validateVerificationCode(email, verificationCode, purpose, settings) {
    if (!verificationCode) {
      return {
        ok: false,
        response: errorResponse("请填写邮箱验证码", 400),
      };
    }

    if (!/^\d{6}$/.test(verificationCode)) {
      return {
        ok: false,
        response: errorResponse("验证码格式不正确，请输入6位数字验证码", 400),
      };
    }

    const meta = this.getPurposeMeta(purpose);

    const activeCode = await this.db.db
      .prepare(
        `
        SELECT id, code_hash, attempts
        FROM email_verification_codes
        WHERE email = ?
          AND purpose = ?
          AND used_at IS NULL
          AND expires_at > datetime('now', '+8 hours')
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .bind(email, purpose)
      .first();

    if (!activeCode) {
      this.logger.warn(`${meta.logPrefix}验证码验证失败：未找到有效验证码`, { email });
      return {
        ok: false,
        response: errorResponse("验证码已过期或不存在，请重新获取", 400),
      };
    }

    const hashedInput = await hashPassword(verificationCode);
    if (hashedInput !== activeCode.code_hash) {
      const currentAttempts = this.parseNumber(activeCode.attempts);
      const nextAttempts = currentAttempts + 1;
      const reachLimit = nextAttempts >= settings.attemptLimit;

      if (reachLimit) {
        await this.db.db
          .prepare(
            `UPDATE email_verification_codes SET attempts = ?, used_at = datetime('now', '+8 hours') WHERE id = ?`
          )
          .bind(nextAttempts, activeCode.id)
          .run();
        this.logger.warn(`${meta.logPrefix}验证码错误次数达到上限`, {
          email,
          purpose,
          attempts: nextAttempts,
        });
        return {
          ok: false,
          response: errorResponse(
            "验证码错误次数过多，请重新获取验证码",
            429
          ),
        };
      }

      await this.db.db
        .prepare(
          `UPDATE email_verification_codes SET attempts = ? WHERE id = ?`
        )
        .bind(nextAttempts, activeCode.id)
        .run();

      this.logger.warn(`${meta.logPrefix}验证码校验失败`, {
        email,
        purpose,
        attempts: nextAttempts,
      });
      return {
        ok: false,
        response: errorResponse("验证码不正确，请检查后重试", 400),
      };
    }

    await this.db.db
      .prepare(
        `UPDATE email_verification_codes SET used_at = datetime('now', '+8 hours') WHERE id = ?`
      )
      .bind(activeCode.id)
      .run();

    this.logger.info(`${meta.logPrefix}验证码验证成功`, { email, purpose });

    return { ok: true, record: activeCode };
  }

  async sendEmailCode(request) {
    return this.handleVerificationCodeRequest(request, {
      purpose: PURPOSE_REGISTER,
      disallowExistingUser: true,
    });
  }

  async requestPasswordReset(request) {
    return this.handleVerificationCodeRequest(request, {
      purpose: PURPOSE_PASSWORD_RESET,
      requireExistingUser: true,
    });
  }

  async getRegisterConfig() {
    try {
      const emailProviderEnabled = this.isMailConfigured();
      const [registerEnabled, verificationEnabled] = await Promise.all([
        this.configManager.getSystemConfig("register_enabled", "1"),
        this.configManager.getSystemConfig(
          "register_email_verification_enabled",
          "1"
        ),
      ]);

      const registerEnabledFlag = registerEnabled !== "0";
      const verificationFlag =
        registerEnabledFlag &&
        verificationEnabled !== "0" &&
        emailProviderEnabled;
      const passwordResetEnabled =
        verificationEnabled !== "0" && emailProviderEnabled;

      return successResponse({
        registerEnabled: registerEnabledFlag,
        verificationEnabled: verificationFlag,
        passwordResetEnabled,
        emailProviderEnabled,
      });
    } catch (error) {
      this.logger.error("获取注册配置失败", error);
      return errorResponse(error.message, 500);
    }
  }

  async getSiteSettings() {
    try {
      const siteConfigs = await this.configManager.getSiteConfigs();
      const siteName = siteConfigs.site_name || (this.env.SITE_NAME as string) || "Soga Panel";
      const siteUrl = siteConfigs.site_url || (this.env.SITE_URL as string) || "";

      return successResponse({
        siteName,
        siteUrl,
      });
    } catch (error) {
      this.logger.error("获取站点配置失败", error);
      const fallbackName = (this.env.SITE_NAME as string) || "Soga Panel";
      const fallbackUrl = (this.env.SITE_URL as string) || "";
      return successResponse({
        siteName: fallbackName,
        siteUrl: fallbackUrl,
      });
    }
  }

  async confirmPasswordReset(request) {
    try {
      const body = await request.json();
      const rawEmail =
        typeof body.email === "string" ? body.email.trim() : "";
      const email = rawEmail.toLowerCase();
      const verificationCode =
        typeof body.verificationCode === "string"
          ? body.verificationCode.trim()
          : typeof body.verification_code === "string"
          ? body.verification_code.trim()
          : "";
      const newPassword =
        typeof body.newPassword === "string"
          ? body.newPassword
          : typeof body.password === "string"
          ? body.password
          : "";
      const confirmPassword =
        typeof body.confirmPassword === "string"
          ? body.confirmPassword
          : typeof body.password_confirm === "string"
          ? body.password_confirm
          : "";

      if (!email || !verificationCode || !newPassword) {
        return errorResponse("请完整填写邮箱、验证码和新密码", 400);
      }

      if (!EMAIL_REGEX.test(email)) {
        return errorResponse("请输入有效的邮箱地址", 400);
      }

      if (newPassword.length < 6) {
        return errorResponse("新密码长度不能少于6位", 400);
      }

      if (confirmPassword && newPassword !== confirmPassword) {
        return errorResponse("两次输入的新密码不一致", 400);
      }

      const user = await this.db.db
        .prepare("SELECT id FROM users WHERE email = ?")
        .bind(email)
        .first();

      if (!user) {
        return errorResponse("该邮箱未注册账户，请检查邮箱是否正确", 404);
      }

      const settings = await this.getVerificationSettings(
        PURPOSE_PASSWORD_RESET
      );

      if (!settings.enabled) {
        return errorResponse("当前未开启密码重置功能", 403);
      }

      const validation = await this.validateVerificationCode(
        email,
        verificationCode,
        PURPOSE_PASSWORD_RESET,
        settings
      );

      if (!validation.ok) {
        return validation.response;
      }

      const hashedPassword = await hashPassword(newPassword);

      await this.db.db
        .prepare(
          `
        UPDATE users
        SET password_hash = ?, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
        )
        .bind(hashedPassword, user.id)
        .run();

      await this.cleanupVerificationCodes(email, PURPOSE_PASSWORD_RESET);
      await this.cache.deleteByPrefix(`user_${user.id}`);

      this.logger.info("密码重置成功", { email, user_id: user.id });

      return successResponse({
        message: "密码已重置，请使用新密码登录",
      });
    } catch (error) {
      this.logger.error("密码重置失败", error);
      return errorResponse(error.message, 500);
    }
  }

  async login(request) {
    try {
      const body = await request.json();
      const rawEmail =
        typeof body.email === "string" ? body.email.trim() : "";
      const email = rawEmail.toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const remember = this.parseBoolean(body.remember, false);

      if (!email || !password) {
        return errorResponse("请填写邮箱和密码", 400);
      }

      // 获取客户端信息（在验证之前获取，用于失败日志记录）
      const clientIP = request.headers.get("CF-Connecting-IP") || 
                      request.headers.get("X-Forwarded-For") || 
                      request.headers.get("X-Real-IP") || 
                      "unknown";
      const userAgent = request.headers.get("User-Agent") || "";

      // 查找用户
      const user = await this.db.db
        .prepare("SELECT * FROM users WHERE email = ?")
        .bind(email)
        .first<AuthUserRow>();

      if (!user) {
        this.logger.warn("登录失败：邮箱不存在", {
          email,
          login_ip: clientIP,
        });
        return errorResponse("该邮箱地址不存在，请先注册账号", 400);
      }

      // 验证密码
      const isValidPassword = await verifyPassword(
        password,
        user.password_hash
      );
      if (!isValidPassword) {
        // 记录密码错误的失败登录
        await this.db.db
          .prepare(`INSERT INTO login_logs (user_id, login_ip, user_agent, login_status, failure_reason, login_method) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(user.id, clientIP, userAgent, 0, "密码错误", "password")
          .run();
        return errorResponse("密码错误，请检查您的密码", 401);
      }

      // 注释：允许禁用用户登录，但会在前端显示受限提示
      // 这里不检查用户状态，让禁用用户也能正常登录

      // 检查是否过期
      const expireTime = user.expire_time
        ? new Date(typeof user.expire_time === "string" ? user.expire_time : String(user.expire_time))
        : null;

      if (expireTime && expireTime < new Date()) {
        // 记录账户过期的失败登录
        await this.db.db
          .prepare(`INSERT INTO login_logs (user_id, login_ip, user_agent, login_status, failure_reason, login_method) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(user.id, clientIP, userAgent, 0, "账户过期", "password")
          .run();
        return errorResponse("账户已过期，请联系管理员续费", 403);
      }

      // 生成 Token
      const token = await generateToken(
        {
          userId: user.id,
          email: user.email,
          isAdmin: user.is_admin === 1,
        },
        this.env.JWT_SECRET
      );

      const sessionTTL = remember ? 604800 : 86400;

      // 保存会话，包含代理连接所需信息但不包含密码哈希
      await this.cache.set(
        `session_${token}`,
        JSON.stringify(this.buildSessionPayload(user)),
        sessionTTL
      );

      // 更新最后登录信息
      await this.db.db
        .prepare(
          `
        UPDATE users 
        SET last_login_time = datetime('now', '+8 hours'), 
            last_login_ip = ?
        WHERE id = ?
      `
        )
        .bind(clientIP, user.id)
        .run();

      // 记录登录日志
      const loginNote = user.status === 0 ? "禁用用户登录" : null;
      await this.db.db
        .prepare(
          `
        INSERT INTO login_logs (user_id, login_ip, user_agent, login_status, failure_reason, login_method)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .bind(user.id, clientIP, userAgent, 1, loginNote, "password")
        .run();

      // 返回用户信息，包含代理连接所需的passwd，但不包含password_hash
      const userResponse = this.buildUserResponse(user);

      return successResponse({
        token,
        user: userResponse,
        remember,
      });
    } catch (error) {
      console.error("Login error:", error);
      return errorResponse(error.message, 500);
    }
  }

  async googleOAuthLogin(request) {
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      this.logger.warn("Google OAuth 登录失败：请求体解析失败", error);
      return errorResponse("请求格式不正确，请使用 JSON", 400);
    }

    const remember = this.parseBoolean(body?.remember, false);

    const possibleToken =
      typeof body?.idToken === "string"
        ? body.idToken
        : typeof body?.credential === "string"
        ? body.credential
        : typeof body?.id_token === "string"
        ? body.id_token
        : typeof body?.token === "string"
        ? body.token
        : "";
    const idToken = possibleToken.trim();

    if (!idToken) {
      return errorResponse("缺少 Google 身份令牌", 400);
    }

    const clientIds = this.getGoogleClientIds();
    if (clientIds.length === 0) {
      this.logger.error("Google OAuth 登录失败：未配置 GOOGLE_CLIENT_ID");
      return errorResponse("未启用 Google 登录，请联系管理员", 503);
    }

    let tokenInfo: GoogleTokenInfo;
    try {
      tokenInfo = await this.verifyGoogleIdToken(idToken);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Google 身份验证失败",
        401
      );
    }

    if (!clientIds.includes(tokenInfo.aud)) {
      this.logger.warn("Google OAuth 登录失败：aud 不匹配", {
        aud: tokenInfo.aud,
      });
      return errorResponse("Google 身份令牌无效，请重试", 401);
    }

    const issuer = tokenInfo.iss || "";
    if (
      issuer &&
      issuer !== "accounts.google.com" &&
      issuer !== "https://accounts.google.com"
    ) {
      this.logger.warn("Google OAuth 登录失败：issuer 不匹配", { issuer });
      return errorResponse("Google 身份令牌无效，请重试", 401);
    }

    const email = (tokenInfo.email || "").toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) {
      return errorResponse("未从 Google 获取到有效邮箱地址", 400);
    }

    const emailVerifiedRaw = tokenInfo.email_verified;
    const emailVerified = typeof emailVerifiedRaw === "string"
      ? ["true", "1", "yes"].includes(emailVerifiedRaw.trim().toLowerCase())
      : false;
    if (!emailVerified) {
      return errorResponse("您的 Google 邮箱尚未验证，无法登录", 403);
    }

    const googleSub = tokenInfo.sub;
    if (!googleSub) {
      return errorResponse("Google 身份令牌缺少唯一标识", 400);
    }

    const clientIP =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      request.headers.get("X-Real-IP") ||
      "unknown";
    const userAgent = request.headers.get("User-Agent") || "";

    try {
      let user = await this.db.db
        .prepare("SELECT * FROM users WHERE google_sub = ?")
        .bind(googleSub)
        .first();

      if (!user) {
        const existingByEmail = await this.db.db
          .prepare("SELECT * FROM users WHERE email = ?")
          .bind(email)
          .first();

        if (existingByEmail) {
          if (
            existingByEmail.google_sub &&
            existingByEmail.google_sub !== googleSub
          ) {
            this.logger.warn("Google OAuth 登录失败：sub 与已绑定账号不匹配", {
              email,
              existingSub: existingByEmail.google_sub,
              incomingSub: googleSub,
            });
            return errorResponse(
              "该邮箱已绑定其它 Google 账号，请使用原账号登录",
              409
            );
          }
          user = existingByEmail;
        }
      }

      let isNewUser = false;
      let tempPassword: string | null = null;
      let passwordEmailSent = false;

      if (!user) {
        isNewUser = true;
        tempPassword = generateRandomString(16);
        const hashedPassword = await hashPassword(tempPassword);
        const uuid = generateUUID();
        const proxyPassword = generateRandomString(16);
        const subscriptionToken = generateRandomString(32);

        const configRows = await this.db.db
          .prepare(
            "SELECT * FROM system_configs WHERE key IN ('default_traffic', 'default_expire_days', 'default_account_expire_days', 'default_class')"
          )
          .all<ConfigRow>();

        const config: Record<string, string> = {};
        for (const item of configRows.results ?? []) {
          if (item?.key) {
            config[item.key] = item.value ?? "";
          }
        }

        const toPositiveInt = (value: unknown, fallback: number) => {
          const num = typeof value === "number"
            ? value
            : typeof value === "string"
            ? Number.parseInt(value, 10)
            : Number.NaN;
          return Number.isFinite(num) && num > 0 ? num : fallback;
        };

        const transferEnable = toPositiveInt(
          config.default_traffic,
          10737418240
        );
        const accountExpireDays = toPositiveInt(
          config.default_account_expire_days,
          3650
        );
        const classExpireDays = toPositiveInt(config.default_expire_days, 30);
        const defaultClass = toPositiveInt(config.default_class, 1);

        const withOffset = (days: number) =>
          new Date(
            Date.now() + 8 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000
          )
            .toISOString()
            .replace("Z", "+08:00");

        const accountExpireTime = withOffset(accountExpireDays);
        const classExpireTime = withOffset(classExpireDays);

        const emailLocal = email.split("@")[0] || "";
        const usernameCandidates = [
          tokenInfo.given_name,
          tokenInfo.name,
          emailLocal,
          `google_${googleSub.slice(-6)}`,
        ].filter(
          (name): name is string => !!name && name.trim().length > 0
        );

        const username = await this.generateUniqueUsername(
          usernameCandidates,
          emailLocal || googleSub.slice(-6)
        );

        const insertStmt = this.db.db.prepare(`
          INSERT INTO users (
            email, username, password_hash, uuid, passwd, token,
            google_sub, oauth_provider, first_oauth_login_at, last_oauth_login_at,
            transfer_enable, expire_time, class, class_expire_time, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'), ?, ?, ?, ?, 1)
        `);

        const insertResult = await insertStmt
          .bind(
            email,
            username,
            hashedPassword,
            uuid,
            proxyPassword,
            subscriptionToken,
            googleSub,
            "google",
            transferEnable,
            accountExpireTime,
            defaultClass,
            classExpireTime
          )
          .run();

        const userId = insertResult.meta.last_row_id;
        user = await this.db.db
          .prepare("SELECT * FROM users WHERE id = ?")
          .bind(userId)
          .first();

        const siteConfigs = await this.configManager.getSiteConfigs();
        const siteName = siteConfigs.site_name || "Soga Panel";
        const siteUrl = siteConfigs.site_url || "";

        passwordEmailSent = await this.sendOAuthWelcomeEmail(
          "Google",
          email,
          tempPassword,
          siteName,
          siteUrl
        );

        await this.cache.deleteByPrefix("user_");
      } else {
        await this.cache.deleteByPrefix(`user_${user.id}`);
      }

      if (!user) {
        return errorResponse("无法创建或加载用户信息", 500);
      }

      await this.db.db
        .prepare(
          `
        UPDATE users
        SET google_sub = ?,
            oauth_provider = 'google',
            first_oauth_login_at = COALESCE(first_oauth_login_at, datetime('now', '+8 hours')),
            last_oauth_login_at = datetime('now', '+8 hours'),
            last_login_time = datetime('now', '+8 hours'),
            last_login_ip = ?,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
        )
        .bind(googleSub, clientIP, user.id)
        .run();

      user = await this.db.db
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(user.id)
        .first<AuthUserRow>();

      if (!user) {
        return errorResponse("用户不存在", 404);
      }

      const refreshedExpire = user.expire_time
        ? new Date(typeof user.expire_time === "string" ? user.expire_time : String(user.expire_time))
        : null;

      if (refreshedExpire && refreshedExpire < new Date()) {
        await this.db.db
          .prepare(
            `INSERT INTO login_logs (user_id, login_ip, user_agent, login_status, failure_reason, login_method) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(user.id, clientIP, userAgent, 0, "账户过期", "google_oauth")
          .run();
        return errorResponse("账户已过期，请联系管理员续费", 403);
      }

      const token = await generateToken(
        {
          userId: user.id,
          email: user.email,
          isAdmin: user.is_admin === 1,
        },
        this.env.JWT_SECRET
      );

      const sessionTTL = remember ? 604800 : 86400;

      await this.cache.set(
        `session_${token}`,
        JSON.stringify(this.buildSessionPayload(user)),
        sessionTTL
      );

      const userStatus = typeof user.status === "number" ? user.status : Number(user.status ?? 0);
      const loginNote = userStatus === 0 ? "禁用用户登录" : null;
      await this.db.db
        .prepare(
          `
        INSERT INTO login_logs (user_id, login_ip, user_agent, login_status, failure_reason, login_method)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .bind(user.id, clientIP, userAgent, 1, loginNote, "google_oauth")
        .run();

      const userResponse = this.buildUserResponse(user);

      return successResponse({
        token,
        user: userResponse,
        isNewUser,
        tempPassword,
        passwordEmailSent,
        remember,
        provider: "google",
      });
    } catch (error) {
      this.logger.error("Google OAuth 登录失败", error, { email });
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Google 登录失败，请稍后重试",
        500
      );
    }
  }

  async githubOAuthLogin(request) {
    try {
      const clientId =
        typeof this.env.GITHUB_CLIENT_ID === "string"
          ? this.env.GITHUB_CLIENT_ID.trim()
          : "";
      const clientSecret =
        typeof this.env.GITHUB_CLIENT_SECRET === "string"
          ? this.env.GITHUB_CLIENT_SECRET.trim()
          : "";

      if (!clientId || !clientSecret) {
        return errorResponse("未配置 GitHub 登录，请联系管理员", 503);
      }

      let body: any = {};
      try {
        body = await request.json();
      } catch (err) {
        this.logger.warn("GitHub OAuth 登录：解析请求体失败", err);
      }

      const code =
        typeof body?.code === "string" ? body.code.trim() : "";
      const redirectUri =
        typeof body?.redirectUri === "string" ? body.redirectUri.trim() : "";
      const remember = this.parseBoolean(body?.remember, false);

      if (!code) {
        return errorResponse("缺少 GitHub 授权码", 400);
      }

      const tokenRequestPayload: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code,
      };

      if (redirectUri) {
        tokenRequestPayload.redirect_uri = redirectUri;
      }

      if (typeof body?.state === "string" && body.state.trim()) {
        tokenRequestPayload.state = body.state.trim();
      }

      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(tokenRequestPayload),
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => "");
        this.logger.error("GitHub token 交换失败", null, {
          status: tokenResponse.status,
          errorText,
        });
        return errorResponse("GitHub 授权失败，请重试", 502);
      }

      const tokenData = (await tokenResponse.json()) as GithubTokenResponse;
      if (tokenData.error) {
        return errorResponse(
          tokenData.error_description || "GitHub 授权失败",
          400
        );
      }

      const accessToken = ensureString(tokenData.access_token);
      if (!accessToken) {
        return errorResponse("未获取到 GitHub access token", 400);
      }

      const githubUserResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "soga-panel",
        },
      });

      if (!githubUserResponse.ok) {
        const errorText = await githubUserResponse.text().catch(() => "");
        this.logger.error("GitHub 用户信息获取失败", null, {
          status: githubUserResponse.status,
          errorText,
        });
        return errorResponse("无法获取 GitHub 用户信息", 502);
      }

      const githubUser = (await githubUserResponse.json()) as GithubUserResponse;
      const githubId = githubUser?.id ? String(githubUser.id) : "";
      let email = typeof githubUser?.email === "string" ? githubUser.email : "";

      if (!email) {
        const emailsResponse = await fetch(
          "https://api.github.com/user/emails",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "soga-panel",
            },
          }
        );

        if (emailsResponse.ok) {
          const emailsData = (await emailsResponse.json()) as GithubEmailEntry[];
          const primaryEmail = emailsData.find(
            (item) => item?.primary && item?.verified
          );
          const verifiedEmail = emailsData.find((item) => item?.verified);
          email = ensureString(primaryEmail?.email) || ensureString(verifiedEmail?.email);
        }
      }

      if (!githubId) {
        return errorResponse("无法获取 GitHub 用户标识", 400);
      }

      if (!email) {
        return errorResponse(
          "未能获取到 GitHub 邮箱，请在 GitHub 账户中公开邮箱或允许应用访问",
          400
        );
      }

      const normalizedEmail = email.toLowerCase();
      const clientIP =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For") ||
        request.headers.get("X-Real-IP") ||
        "unknown";
      const userAgent = request.headers.get("User-Agent") || "";

      let user = await this.db.db
        .prepare("SELECT * FROM users WHERE github_id = ?")
        .bind(githubId)
        .first<AuthUserRow>();

      if (!user) {
        const existingByEmail = await this.db.db
          .prepare("SELECT * FROM users WHERE email = ?")
          .bind(normalizedEmail)
          .first<AuthUserRow>();

        if (existingByEmail) {
          if (
            existingByEmail.github_id &&
            existingByEmail.github_id !== githubId
          ) {
            return errorResponse(
              "该邮箱已绑定其他 GitHub 账号，请使用原账号登录",
              409
            );
          }
          user = existingByEmail;
        }
      }

      let isNewUser = false;
      let tempPassword: string | null = null;
      let passwordEmailSent = false;

      if (!user) {
        isNewUser = true;
        tempPassword = generateRandomString(16);
        const hashedPassword = await hashPassword(tempPassword);
        const uuid = generateUUID();
        const proxyPassword = generateRandomString(16);
        const subscriptionToken = generateRandomString(32);

        const configRows = await this.db.db
          .prepare(
            "SELECT * FROM system_configs WHERE key IN ('default_traffic', 'default_expire_days', 'default_account_expire_days', 'default_class')"
          )
          .all<ConfigRow>();

        const config = new Map<string, string>();
        for (const item of configRows.results ?? []) {
          if (item?.key) {
            config.set(item.key, item.value ?? "");
          }
        }

        const toPositiveInt = (value: unknown, fallback: number) => {
          const parsed =
            typeof value === "number"
              ? value
              : typeof value === "string"
              ? Number.parseInt(value, 10)
              : Number.NaN;
          return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
        };

        const transferEnable = toPositiveInt(
          config.get("default_traffic"),
          10737418240
        );
        const accountExpireDays = toPositiveInt(
          config.get("default_account_expire_days"),
          3650
        );
        const classExpireDays = toPositiveInt(
          config.get("default_expire_days"),
          30
        );
        const defaultClass = toPositiveInt(config.get("default_class"), 1);

        const withOffset = (days: number) =>
          new Date(
            Date.now() + 8 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000
          )
            .toISOString()
            .replace("Z", "+08:00");

        const accountExpireTime = withOffset(accountExpireDays);
        const classExpireTime = withOffset(classExpireDays);

        const emailLocal = normalizedEmail.split("@")[0] || "";
        const usernameCandidates = [
          githubUser?.login,
          githubUser?.name,
          emailLocal,
          `github_${githubId.slice(-6)}`,
        ].filter((item): item is string => !!item && item.trim().length > 0);

        const username = await this.generateUniqueUsername(
          usernameCandidates,
          emailLocal || githubId.slice(-6)
        );

        const insertStmt = this.db.db.prepare(`
          INSERT INTO users (
            email, username, password_hash, uuid, passwd, token,
            oauth_provider, first_oauth_login_at, last_oauth_login_at,
            github_id, transfer_enable, expire_time, class, class_expire_time, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'), ?, ?, ?, ?, ?, 1)
        `);

        const insertResult = await insertStmt
          .bind(
            normalizedEmail,
            username,
            hashedPassword,
            uuid,
            proxyPassword,
            subscriptionToken,
            "github",
            githubId,
            transferEnable,
            accountExpireTime,
            defaultClass,
            classExpireTime
          )
          .run();

        const userId = insertResult.meta.last_row_id;
        user = await this.db.db
          .prepare("SELECT * FROM users WHERE id = ?")
          .bind(userId)
          .first();

        const siteConfigs = await this.configManager.getSiteConfigs();
        const siteName = siteConfigs.site_name || "Soga Panel";
        const siteUrl = siteConfigs.site_url || "";

        passwordEmailSent = await this.sendOAuthWelcomeEmail(
          "GitHub",
          normalizedEmail,
          tempPassword,
          siteName,
          siteUrl
        );

        await this.cache.deleteByPrefix("user_");
      } else {
        const now = "datetime('now', '+8 hours')";
        await this.db.db
          .prepare(
            `UPDATE users SET github_id = ?, oauth_provider = 'github', last_oauth_login_at = ${now}, first_oauth_login_at = COALESCE(first_oauth_login_at, ${now}) WHERE id = ?`
          )
          .bind(githubId, user.id)
          .run();

        await this.cache.deleteByPrefix(`user_${user.id}`);
      }

      if (!user) {
        return errorResponse("无法创建或加载用户信息", 500);
      }

      await this.db.db
        .prepare(
          `
        UPDATE users
        SET github_id = ?,
            oauth_provider = 'github',
            first_oauth_login_at = COALESCE(first_oauth_login_at, datetime('now', '+8 hours')),
            last_oauth_login_at = datetime('now', '+8 hours'),
            last_login_time = datetime('now', '+8 hours'),
            last_login_ip = ?,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
        )
        .bind(githubId, clientIP, user.id)
        .run();

      user = await this.db.db
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(user.id)
        .first();

      const token = await generateToken(
        {
          userId: user.id,
          email: user.email,
          isAdmin: user.is_admin === 1,
        },
        this.env.JWT_SECRET
      );

      const sessionTTL = remember ? 604800 : 86400;

      await this.cache.set(
        `session_${token}`,
        JSON.stringify(this.buildSessionPayload(user)),
        sessionTTL
      );

      const loginNote = user.status === 0 ? "禁用用户登录" : null;
      await this.db.db
        .prepare(
          `
        INSERT INTO login_logs (user_id, login_ip, user_agent, login_status, failure_reason, login_method)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .bind(user.id, clientIP, userAgent, 1, loginNote, "github_oauth")
        .run();

      const userResponse = this.buildUserResponse(user);

      return successResponse({
        token,
        user: userResponse,
        isNewUser,
        tempPassword,
        passwordEmailSent,
        remember,
        provider: "github",
      });
    } catch (error) {
      this.logger.error("GitHub OAuth 登录失败", error);
      return errorResponse(
        error instanceof Error
          ? error.message
          : "GitHub 登录失败，请稍后重试",
        500
      );
    }
  }

  async register(request) {
    try {
      const body = await request.json();
      const rawEmail =
        typeof body.email === "string" ? body.email.trim() : "";
      const email = rawEmail.toLowerCase();
      const username =
        typeof body.username === "string" ? body.username.trim() : "";
      const password =
        typeof body.password === "string" ? body.password : "";
      const verificationCode =
        typeof body.verificationCode === "string"
          ? body.verificationCode.trim()
          : typeof body.verification_code === "string"
          ? body.verification_code.trim()
          : "";

      if (!email || !username || !password) {
        return errorResponse("请填写邮箱、用户名和密码", 400);
      }

      if (!EMAIL_REGEX.test(email)) {
        return errorResponse("请输入有效的邮箱地址", 400);
      }

      if (this.isGmailAlias(email)) {
        return errorResponse(
          "暂不支持使用 Gmail 别名注册，请使用不含点和加号的原始邮箱地址",
          400
        );
      }

      // 获取系统配置
      const siteConfig = await this.db.db
        .prepare(
          "SELECT * FROM system_configs WHERE key IN ('register_enabled', 'default_traffic', 'default_expire_days', 'default_account_expire_days', 'default_class')"
        )
        .all<ConfigRow>();

      const config = new Map<string, string>();
      for (const item of siteConfig.results ?? []) {
        if (item?.key) {
          config.set(item.key, item.value ?? "");
        }
      }

      const registerEnabled = config.get("register_enabled");

      if (registerEnabled !== "1") {
        return errorResponse("系统暂时关闭注册功能", 403);
      }

      // 检查邮箱和用户名是否已存在
      const existingUser = await this.db.db
        .prepare("SELECT email, username FROM users WHERE email = ? OR username = ?")
        .bind(email, username)
        .first<UserEmailUsernameRow>();

      if (existingUser) {
        const existingEmail = ensureString(existingUser.email).toLowerCase();
        if (existingEmail === email) {
          return errorResponse("该邮箱已被注册，请使用其他邮箱或直接登录", 409);
        } else {
          return errorResponse("该用户名已被占用，请选择其他用户名", 409);
        }
      }

      const verificationSettings = await this.getVerificationSettings(
        PURPOSE_REGISTER
      );

      if (verificationSettings.enabled) {
        const validation = await this.validateVerificationCode(
          email,
          verificationCode,
          PURPOSE_REGISTER,
          verificationSettings
        );

        if (!validation.ok) {
          return validation.response;
        }
      }

      // 创建用户
      const hashedPassword = await hashPassword(password);
      const uuid = generateUUID();
      const proxyPassword = generateRandomString(16);
      const subscriptionToken = generateRandomString(32);

      const stmt = this.db.db.prepare(`
        INSERT INTO users (
          email, username, password_hash, uuid, passwd, token,
          transfer_enable, expire_time, class, class_expire_time, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);

      const transferEnableParsed = Number.parseInt(
        config.get("default_traffic") || "10737418240",
        10
      );
      const accountExpireDaysParsed = Number.parseInt(
        config.get("default_account_expire_days") || "3650",
        10
      );
      const classExpireDaysParsed = Number.parseInt(
        config.get("default_expire_days") || "30",
        10
      );
      const defaultClassParsed = Number.parseInt(
        config.get("default_class") || "1",
        10
      );

      const transferEnableValue = Number.isFinite(transferEnableParsed)
        ? transferEnableParsed
        : 10737418240;
      const accountExpireDays = Number.isFinite(accountExpireDaysParsed)
        ? accountExpireDaysParsed
        : 3650;
      const classExpireDays = Number.isFinite(classExpireDaysParsed)
        ? classExpireDaysParsed
        : 30;
      const defaultClassValue = Number.isFinite(defaultClassParsed)
        ? defaultClassParsed
        : 1;

      const accountExpireTime = new Date(
        Date.now() + 8 * 60 * 60 * 1000 + accountExpireDays * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .replace("Z", "+08:00");
      const classExpireTime = new Date(
        Date.now() + 8 * 60 * 60 * 1000 + classExpireDays * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .replace("Z", "+08:00");

      const insertResult = toRunResult(
        await stmt
        .bind(
          email,
          username,
          hashedPassword,
          uuid,
          proxyPassword,
          subscriptionToken,
          transferEnableValue,
          accountExpireTime,
          defaultClassValue,
          classExpireTime
        )
        .run()
      );

      const userId = getLastRowId(insertResult);
      if (userId === null) {
        return errorResponse("创建用户失败", 500);
      }

      // 自动登录
      const token = await generateToken(
        { userId, email, isAdmin: false },
        this.env.JWT_SECRET
      );

      // 获取完整的用户数据用于会话
      const newUser = await this.db.db
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(userId)
        .first<AuthUserRow>();

      if (!newUser) {
        return errorResponse("获取用户信息失败", 500);
      }
      
      // 保存会话，包含代理连接所需信息但不包含密码哈希
      await this.cache.set(
        `session_${token}`,
        JSON.stringify({
          id: newUser.id,
          email: ensureString(newUser.email),
          username: ensureString(newUser.username),
          uuid: ensureString((newUser as any).uuid),
          passwd: ensureString((newUser as any).passwd),
          is_admin: ensureNumber(newUser.is_admin),
          class: ensureNumber((newUser as any).class),
          class_expire_time: ensureString(
            (newUser as Record<string, unknown>).class_expire_time as string | undefined
          ),
          upload_traffic: ensureNumber((newUser as any).upload_traffic),
          download_traffic: ensureNumber((newUser as any).download_traffic),
          upload_today: ensureNumber((newUser as any).upload_today),
          download_today: ensureNumber((newUser as any).download_today),
          transfer_total: ensureNumber((newUser as any).transfer_total),
          transfer_enable: ensureNumber((newUser as any).transfer_enable),
          expire_time: ensureString((newUser as any).expire_time),
          speed_limit: ensureNumber((newUser as any).speed_limit),
          device_limit: ensureNumber((newUser as any).device_limit),
          status: ensureNumber(newUser.status),
        }),
        86400
      );

      // 清除用户缓存
      await this.cache.deleteByPrefix("user_");
      await this.cleanupVerificationCodes(email, PURPOSE_REGISTER);

      // 返回新用户信息，包含代理连接所需的passwd，但不包含password_hash和subscription_token
      const userTransferEnable = ensureNumber((newUser as any).transfer_enable);
      const userTransferTotal = ensureNumber((newUser as any).transfer_total);

      const newUserResponse = {
        id: newUser.id,
        email: ensureString(newUser.email),
        username: ensureString(newUser.username),
        uuid: ensureString((newUser as any).uuid),
        passwd: ensureString((newUser as any).passwd),
        is_admin: ensureNumber(newUser.is_admin) === 1,
        class: ensureNumber((newUser as any).class),
        class_expire_time: ensureString((newUser as any).class_expire_time),
        expire_time: ensureString((newUser as any).expire_time),
        upload_traffic: ensureNumber((newUser as any).upload_traffic),
        download_traffic: ensureNumber((newUser as any).download_traffic),
        upload_today: ensureNumber((newUser as any).upload_today),
        download_today: ensureNumber((newUser as any).download_today),
        transfer_total: userTransferTotal,
        transfer_enable: userTransferEnable,
        transfer_remain: Math.max(0, userTransferEnable - userTransferTotal),
        speed_limit: ensureNumber((newUser as any).speed_limit),
        device_limit: ensureNumber((newUser as any).device_limit),
        status: ensureNumber(newUser.status),
        // 注意：不返回subscription_token，它只在重置订阅时才返回
      };

      return successResponse({
        message: "Registration successful",
        token,
        user: newUserResponse,
      });
    } catch (error) {
      console.error("Registration error:", error);
      return errorResponse(error.message, 500);
    }
  }

  async logout(request) {
    try {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        await this.cache.delete(`session_${token}`);
      }

      return successResponse({ message: "Logged out successfully" });
    } catch (error) {
      return errorResponse(error.message, 500);
    }
  }
}
