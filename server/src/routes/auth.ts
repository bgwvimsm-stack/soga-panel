import { Router, type Request, type Response } from "express";
import type { AppContext } from "../types";
import { AuthService } from "../services/auth";
import { errorResponse, successResponse } from "../utils/response";
import { TwoFactorService } from "../services/twoFactor";
import { ReferralService } from "../services/referral";
import { EmailService } from "../services/email";
import { generateRandomString } from "../utils/crypto";
import { ensureString } from "../utils/d1";
import { createAuthMiddleware } from "../middleware/auth";
import {
  AuthenticationCredential,
  RegistrationCredential,
  base64UrlDecode,
  base64UrlEncode,
  randomChallenge,
  validateAuthenticationResponse,
  validateRegistrationResponse
} from "../utils/passkey";

export function createAuthRouter(ctx: AppContext) {
  const router = Router();
  const authService = new AuthService(ctx.dbService, ctx.cache, ctx.env);
  const twoFactorService = new TwoFactorService(ctx.env);
  const referralService = new ReferralService(ctx.dbService);
  const emailService = new EmailService(ctx.env);

  type PasskeyChallengePayload = {
    type: "registration" | "authentication";
    userId: number;
    challenge: string;
    rpId: string;
    origin: string;
    remember?: boolean;
    createdAt: number;
  };

  type PendingOAuthRegistration = {
    provider: "google" | "github";
    email: string;
    providerId: string;
    usernameCandidates: string[];
    fallbackUsernameSeed: string;
    remember: boolean;
    clientIp?: string | null;
    userAgent?: string | null;
  };

  const PASSKEY_CHALLENGE_TTL = 300;
  const OAUTH_PENDING_TTL = 600;
  const localPasskeyChallenges = new Map<
    string,
    { payload: PasskeyChallengePayload; expiresAt: number }
  >();
  const localPendingOAuth = new Map<
    string,
    { payload: PendingOAuthRegistration; expiresAt: number }
  >();

  const buildPasskeyCacheKey = (challenge: string) =>
    `passkey_challenge_${challenge}`;

  const extractIp = (value?: string | string[] | null) => {
    const first =
      Array.isArray(value) && value.length ? value[0] : typeof value === "string" ? value : "";
    if (!first) return "";
    const ip = first.split(",")[0]?.trim();
    if (!ip) return "";
    if (ip.startsWith("::ffff:")) return ip.slice(7);
    if (ip === "::1") return "127.0.0.1";
    return ip;
  };

  const getClientIp = (req: Request) => {
    return (
      extractIp((req.headers["x-client-ip"] as any) ?? null) ||
      extractIp((req.headers["x-forwarded-for"] as any) ?? null) ||
      extractIp((req.headers["cf-connecting-ip"] as any) ?? null) ||
      extractIp((req.headers["true-client-ip"] as any) ?? null) ||
      extractIp((req.headers["x-real-ip"] as any) ?? null) ||
      extractIp(req.ip) ||
      extractIp((req.socket as any)?.remoteAddress ?? null)
    );
  };

  const savePasskeyChallenge = async (payload: PasskeyChallengePayload) => {
    const key = buildPasskeyCacheKey(payload.challenge);
    const value = JSON.stringify(payload);
    if (ctx.redis) {
      try {
        await ctx.redis.set(key, value, "EX", PASSKEY_CHALLENGE_TTL);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[passkey] 保存挑战失败（redis）:", message);
      }
    }
    localPasskeyChallenges.set(key, {
      payload,
      expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL * 1000
    });
  };

  const loadPasskeyChallenge = async (challenge: string) => {
    const key = buildPasskeyCacheKey(challenge);
    if (ctx.redis) {
      try {
        const raw = await ctx.redis.get(key);
        if (raw) {
          return JSON.parse(raw) as PasskeyChallengePayload;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[passkey] 读取挑战失败（redis）:", message);
      }
    }
    const cached = localPasskeyChallenges.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload;
    }
    localPasskeyChallenges.delete(key);
    return null;
  };

  const clearPasskeyChallenge = async (challenge: string) => {
    const key = buildPasskeyCacheKey(challenge);
    if (ctx.redis) {
      try {
        await ctx.redis.del(key);
      } catch {
        // ignore
      }
    }
    localPasskeyChallenges.delete(key);
  };

  const parseTransports = (raw?: string | null) => {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((t) => String(t));
      }
    } catch {
      // ignore
    }
    return undefined;
  };

  const getExpectedOrigin = (req: Request) => {
    const override = (ctx.env.PASSKEY_ORIGIN || "").trim();
    if (override) {
      return override.replace(/\/+$/, "");
    }
    const host = req.get("host") || "";
    return `${req.protocol}://${host}`;
  };

  const getRpId = (req: Request) => {
    const override = (ctx.env.PASSKEY_RP_ID || "").trim();
    if (override) return override;
    const host = req.get("host") || "";
    return host.split(":")[0] || host || "localhost";
  };

  const extractClientChallenge = (clientDataJSON: string) => {
    try {
      const decoded = base64UrlDecode(clientDataJSON);
      const parsed = JSON.parse(
        new TextDecoder().decode(decoded)
      ) as Record<string, unknown>;
      return typeof parsed.challenge === "string" ? parsed.challenge : "";
    } catch {
      return "";
    }
  };

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const isGmailAlias = (email: string) => {
    const [local = "", domain = ""] = email.toLowerCase().split("@");
    if (domain !== "gmail.com" && domain !== "googlemail.com") return false;
    return local.includes("+") || local.includes(".");
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const isEmailConfigured = () => {
    const provider = (ctx.env.MAIL_PROVIDER || "").toLowerCase();
    if (provider === "resend") {
      return Boolean(ctx.env.RESEND_API_KEY || ctx.env.MAIL_RESEND_KEY);
    }
    if (provider === "smtp") {
      return Boolean(ctx.env.MAIL_SMTP_HOST || ctx.env.SMTP_HOST);
    }
    if (provider === "sendgrid") {
      return Boolean(ctx.env.SENDGRID_API_KEY);
    }
    if (provider === "none") return false;
    return Boolean(
      ctx.env.MAIL_SMTP_HOST ||
        ctx.env.SMTP_HOST ||
        ctx.env.MAIL_RESEND_KEY ||
        ctx.env.RESEND_API_KEY ||
        ctx.env.SENDGRID_API_KEY
    );
  };

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

  const resolveVerificationFlags = async () => {
    const configs = await ctx.dbService.listSystemConfigsMap();
    const registerMode = String(configs["register_enabled"] ?? "1");
    const registerEnabled = registerMode !== "0";
    const inviteRequired = registerMode === "2";
    const emailVerifyEnabled =
      String(configs["register_email_verification_enabled"] ?? "1") !== "0";
    const emailProviderEnabled = isEmailConfigured();
    return {
      configs,
      registerMode,
      registerEnabled,
      inviteRequired,
      emailVerifyEnabled,
      emailProviderEnabled
    };
  };

  const getPurposeMeta = (purpose: "register" | "password_reset") => {
    if (purpose === "password_reset") {
      return {
        successMessage: "验证码已发送，请查收邮箱",
        disabledMessage: "当前未开启密码重置功能",
        missingUserMessage: "该邮箱未注册账户，请检查邮箱是否正确",
        existingUserMessage: "",
        logPrefix: "password-reset"
      };
    }

    return {
      successMessage: "验证码已发送，请查收邮箱",
      disabledMessage: "当前未开启邮箱验证码功能",
      existingUserMessage: "该邮箱已被注册，请使用其他邮箱或直接登录",
      missingUserMessage: "该邮箱地址不存在，请先注册账号",
      logPrefix: "email-code"
    };
  };

  const handleVerificationCodeRequest = async (
    req: Request,
    res: Response,
    options: {
      purpose: "register" | "password_reset";
      requireExistingUser?: boolean;
      disallowExistingUser?: boolean;
    }
  ) => {
    const { purpose, requireExistingUser, disallowExistingUser } = options;
    const rawEmail =
      typeof req.body?.email === "string" ? req.body.email : "";
    const email = rawEmail.trim().toLowerCase();

    if (!email) {
      return errorResponse(res, "请填写邮箱地址", 400);
    }
    if (!EMAIL_REGEX.test(email)) {
      return errorResponse(res, "请输入有效的邮箱地址", 400);
    }
    if (purpose === "register" && isGmailAlias(email)) {
      return errorResponse(
        res,
        "暂不支持使用 Gmail 别名注册，请使用不含点和加号的原始邮箱地址",
        400
      );
    }

    const meta = getPurposeMeta(purpose);
    const { registerMode, registerEnabled, emailVerifyEnabled, emailProviderEnabled } =
      await resolveVerificationFlags();
    const verificationEnabled =
      purpose === "register"
        ? registerEnabled && emailVerifyEnabled && emailProviderEnabled
        : emailVerifyEnabled && emailProviderEnabled;

    if (!verificationEnabled) {
      return errorResponse(res, meta.disabledMessage, 403);
    }

    if (purpose === "register" && registerMode !== "1") {
      return errorResponse(res, "系统暂时关闭注册功能", 403);
    }

    const existingUser = await ctx.dbService.getUserByEmail(email);
    if (requireExistingUser && !existingUser) {
      return errorResponse(res, meta.missingUserMessage, 400);
    }
    if (disallowExistingUser && existingUser) {
      return errorResponse(res, meta.existingUserMessage || "该邮箱已被注册", 409);
    }

    await ctx.dbService.db
      .prepare(
        `
        UPDATE email_verification_codes
        SET used_at = CURRENT_TIMESTAMP
        WHERE email = ? AND purpose = ? AND used_at IS NULL
      `
      )
      .bind(email, purpose)
      .run();

    const clientIp = getClientIp(req) || "unknown";
    const userAgent = req.headers["user-agent"] as string | undefined;
    const cooldownSeconds = toIntConfig(
      ctx.env.MAIL_VERIFICATION_COOLDOWN_SECONDS,
      60,
      { min: 0, allowZero: true }
    );
    const dailyLimit = toIntConfig(
      ctx.env.MAIL_VERIFICATION_DAILY_LIMIT,
      5,
      { min: 0, allowZero: true }
    );
    const ipHourlyLimit = toIntConfig(
      ctx.env.MAIL_VERIFICATION_IP_HOURLY_LIMIT,
      10,
      { min: 0, allowZero: true }
    );

    if (cooldownSeconds > 0) {
      const cooldownResult = await ctx.dbService.db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM email_verification_codes
          WHERE email = ?
            AND purpose = ?
            AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${cooldownSeconds} SECOND)
        `
        )
        .bind(email, purpose)
        .first<{ count?: number }>();
      if (Number(cooldownResult?.count ?? 0) > 0) {
        return errorResponse(
          res,
          `验证码发送频繁，请在 ${cooldownSeconds} 秒后重试`,
          429
        );
      }
    }

    if (dailyLimit > 0) {
      const dailyResult = await ctx.dbService.db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM email_verification_codes
          WHERE email = ?
            AND purpose = ?
            AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)
        `
        )
        .bind(email, purpose)
        .first<{ count?: number }>();
      if (Number(dailyResult?.count ?? 0) >= dailyLimit) {
        return errorResponse(res, "今日验证码发送次数已达上限，请24小时后再试", 429);
      }
    }

    if (ipHourlyLimit > 0 && clientIp && clientIp !== "unknown") {
      const ipResult = await ctx.dbService.db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM email_verification_codes
          WHERE request_ip = ?
            AND purpose = ?
            AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)
        `
        )
        .bind(clientIp, purpose)
        .first<{ count?: number }>();
      if (Number(ipResult?.count ?? 0) >= ipHourlyLimit) {
        return errorResponse(res, "请求过于频繁，请稍后再试或更换网络", 429);
      }
    }

    const result = await authService.sendEmailCode(email, purpose, {
      ip: clientIp,
      ua: userAgent ? userAgent.slice(0, 500) : undefined
    });
    console.log(
      `[${meta.logPrefix}] purpose=${purpose} email=${email} code=${result.code}`
    );
    return successResponse(
      res,
      { expires_at: result.expires_at },
      meta.successMessage
    );
  };

  const sendOAuthWelcomeEmail = async (
    providerLabel: string,
    email: string,
    password: string
  ) => {
    if (!isEmailConfigured()) return false;
    const configs = await ctx.dbService.listSystemConfigsMap();
    const siteName = configs["site_name"] || ctx.env.SITE_NAME || "Soga Panel";
    const siteUrl = (configs["site_url"] || ctx.env.SITE_URL || "").trim();
    const subject = `${siteName} 账户已创建`;
    const safeSiteUrl = siteUrl ? escapeHtml(siteUrl) : "";
    const html = `
      <p>您好，</p>
      <p>您已使用 ${escapeHtml(providerLabel)} 账号成功创建 ${escapeHtml(
      siteName
    )} 账户。</p>
      <p>我们为您生成了一组初始密码，请妥善保管：</p>
      <pre style="padding:12px;background:#f4f4f5;border-radius:6px;">${escapeHtml(
        password
      )}</pre>
      <p>建议您登录后尽快在个人资料页面修改密码。</p>
      ${
        safeSiteUrl
          ? `<p>立即访问：<a href="${safeSiteUrl}" target="_blank" rel="noopener">${safeSiteUrl}</a></p>`
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
      siteUrl ? `立即访问：${siteUrl}` : "",
      "祝您使用愉快！"
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await emailService.sendMail({
        to: email,
        subject,
        text,
        html
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[oauth] welcome email send failed:", message);
      return false;
    }
  };

  const cachePendingOAuthRegistration = async (
    data: PendingOAuthRegistration
  ) => {
    const token = generateRandomString(48);
    const cacheKey = `oauth_pending_${token}`;
    await ctx.cache.set(cacheKey, JSON.stringify(data), OAUTH_PENDING_TTL);
    localPendingOAuth.set(cacheKey, {
      payload: data,
      expiresAt: Date.now() + OAUTH_PENDING_TTL * 1000
    });
    return token;
  };

  const consumePendingOAuthRegistration = async (token: string) => {
    const cacheKey = `oauth_pending_${token}`;
    const raw = await ctx.cache.get(cacheKey);
    if (raw) {
      await ctx.cache.delete(cacheKey);
      localPendingOAuth.delete(cacheKey);
      try {
        return JSON.parse(raw) as PendingOAuthRegistration;
      } catch {
        return null;
      }
    }
    const local = localPendingOAuth.get(cacheKey);
    if (!local) return null;
    if (local.expiresAt <= Date.now()) {
      localPendingOAuth.delete(cacheKey);
      return null;
    }
    localPendingOAuth.delete(cacheKey);
    return local.payload;
  };

  const normalizeUsernameCandidate = (value: string) =>
    value.trim().replace(/\s+/g, "_");

  const generateUniqueUsername = async (
    candidates: string[],
    fallbackSeed: string
  ) => {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const normalized = normalizeUsernameCandidate(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const existing = await ctx.dbService.getUserByUsername(normalized);
      if (!existing) return normalized;
    }

    const base = normalizeUsernameCandidate(fallbackSeed) || "user";
    for (let i = 0; i < 6; i++) {
      const next = `${base}_${generateRandomString(4)}`;
      const existing = await ctx.dbService.getUserByUsername(next);
      if (!existing) return next;
    }

    return `${base}_${generateRandomString(6)}`;
  };

  const buildPayload = (userRow: any) => ({
    id: Number(userRow.id),
    email: ensureString(userRow.email),
    username: ensureString(userRow.username),
    is_admin: Number(userRow.is_admin ?? 0)
  });

  const finalizeOauthLogin = async (
    userRow: any,
    method: "google_oauth" | "github_oauth",
    req: Request,
    extra?: Record<string, unknown>
  ) => {
    const payload = buildPayload(userRow);
    const token = await authService.issueSessionToken(payload);
    const clientIp = getClientIp(req);
    await ctx.dbService.updateLoginInfo(payload.id, clientIp || null);
    await ctx.dbService.insertLoginLog({
      userId: payload.id,
      ip: clientIp,
      userAgent: req.headers["user-agent"] as string | undefined,
      status: 1,
      loginMethod: method
    });
    await referralService.ensureUserInviteCode(payload.id);
    const user = { ...payload, is_admin: Boolean(payload.is_admin) };
    return { token, user, ...extra };
  };

  router.get("/register-config", async (_req: Request, res: Response) => {
    const { registerMode, registerEnabled, inviteRequired, emailVerifyEnabled, emailProviderEnabled } =
      await resolveVerificationFlags();
    const verificationEnabled = registerEnabled && emailVerifyEnabled && emailProviderEnabled;
    const passwordResetEnabled = emailVerifyEnabled && emailProviderEnabled;
    return successResponse(res, {
      registerEnabled,
      registerMode,
      inviteRequired,
      verificationEnabled,
      passwordResetEnabled,
      emailProviderEnabled
    });
  });

  router.post("/register", async (req: Request, res: Response) => {
    const { email, username, password } = req.body || {};
    const verificationCode =
      typeof req.body?.verificationCode === "string"
        ? req.body.verificationCode.trim()
        : typeof req.body?.verification_code === "string"
        ? req.body.verification_code.trim()
        : "";
    const inviteCodeRaw =
      typeof req.body?.inviteCode === "string"
        ? req.body.inviteCode
        : typeof req.body?.invite_code === "string"
        ? req.body.invite_code
        : "";
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedUsername =
      typeof username === "string" ? username.trim() : "";
    if (!normalizedEmail || !normalizedUsername || !password) {
      return errorResponse(res, "参数缺失", 400);
    }

    try {
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return errorResponse(res, "请输入有效的邮箱地址", 400);
      }
      if (isGmailAlias(normalizedEmail)) {
        return errorResponse(
          res,
          "暂不支持使用 Gmail 别名注册，请使用不含点和加号的原始邮箱地址",
          400
        );
      }

      const { registerMode, emailVerifyEnabled, emailProviderEnabled } =
        await resolveVerificationFlags();
      if (registerMode === "0") {
        return errorResponse(res, "系统暂时关闭注册功能", 403);
      }

      const clientIp = getClientIp(req);
      let inviterId: number | null = null;
      const inviteCode = referralService.normalizeInviteCode(inviteCodeRaw);
      if (inviteCode) {
        const inviter = await referralService.findInviterByCode(inviteCode);
        if (!inviter) {
          return errorResponse(res, "邀请码无效或已失效，请联系邀请人", 400);
        }
        const inviteLimit = Number(inviter.invite_limit ?? 0);
        const inviteUsed = Number(inviter.invite_used ?? 0);
        if (inviteLimit > 0 && inviteUsed >= inviteLimit) {
          return errorResponse(res, "该邀请码使用次数已达上限，请联系邀请人", 400);
        }
        inviterId = Number(inviter.id);
      } else if (registerMode === "2") {
        return errorResponse(res, "当前仅允许受邀注册，请填写有效邀请码", 403);
      }

      const verificationEnabled = emailVerifyEnabled && emailProviderEnabled;
      if (verificationEnabled) {
        const verifyResult = await authService.verifyEmailCode(
          normalizedEmail,
          "register",
          verificationCode
        );
        if (!verifyResult.success) {
          const status = verifyResult.message?.includes("次数过多") ? 429 : 400;
          return errorResponse(res, verifyResult.message, status);
        }
      }

      const result = await authService.register(
        normalizedEmail,
        normalizedUsername,
        password,
        clientIp,
        inviterId
      );
      if (!result.success) {
        return errorResponse(res, result.message, 400);
      }

      if (result.userId && inviterId) {
        await referralService.saveReferralRelation({
          inviterId,
          inviteeId: Number(result.userId),
          inviteCode: inviteCode || "",
          inviteIp: clientIp
        });
        await referralService.incrementInviteUsage(inviterId);
      }
      if (result.userId) {
        await referralService.ensureUserInviteCode(Number(result.userId));
      }
      if (result.userId) {
        const created = await ctx.dbService.getUserById(Number(result.userId));
        if (created) {
          const payload = {
            id: Number(created.id),
            email: created.email as string,
            username: created.username as string,
            is_admin: Number(created.is_admin ?? 0)
          };
          const token = await authService.issueSessionToken(payload);
          await ctx.dbService.updateLoginInfo(payload.id, clientIp || null);
          await ctx.dbService.insertLoginLog({
            userId: payload.id,
            ip: clientIp,
            userAgent: req.headers["user-agent"] as string | undefined,
            status: 1,
            loginMethod: "register"
          });
          return successResponse(res, { token, user: payload }, "注册成功");
        }
      }
      return successResponse(res, { user_id: result.userId }, "注册成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  // OAuth 通用登录（自托管可接回调后端校验，再调用此接口）
  router.post("/oauth/login", async (req: Request, res: Response) => {
    const { provider, email, provider_id, username } = req.body || {};
    if (!provider || !email || !provider_id) return errorResponse(res, "参数缺失", 400);
    try {
      const clientIp = getClientIp(req);
      const result = await authService.oauthLogin({
        provider,
        email,
        providerId: provider_id,
        username,
        clientIp,
        userAgent: req.headers["user-agent"] as string | undefined
      });
      if (!result.success) return errorResponse(res, result.message, 401);
      return successResponse(res, { token: result.token, user: result.user }, "登录成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  // OAuth 注册补全
  router.post("/oauth/complete", async (req: Request, res: Response) => {
    const inviteCodeRaw =
      typeof req.body?.inviteCode === "string"
        ? req.body.inviteCode
        : typeof req.body?.invite_code === "string"
        ? req.body.invite_code
        : "";
    const pendingToken = ensureString(
      req.body?.pendingToken || req.body?.pending_token
    );
    if (!pendingToken) return errorResponse(res, "缺少注册会话标识", 400);

    const pending = await consumePendingOAuthRegistration(pendingToken);
    if (!pending) {
      return errorResponse(res, "注册会话已过期，请重新登录并同意条款", 410);
    }

    const identifierField =
      pending.provider === "google" ? "google_sub" : "github_id";

    let user = await ctx.dbService.db
      .prepare(`SELECT * FROM users WHERE ${identifierField} = ?`)
      .bind(pending.providerId)
      .first<any>();

    if (!user) {
      const byEmail = await ctx.dbService.getUserByEmail(pending.email);
      if (
        byEmail &&
        (byEmail as any)?.[identifierField] &&
        ensureString((byEmail as any)?.[identifierField]) !== pending.providerId
      ) {
        return errorResponse(
          res,
          "该邮箱已绑定其他第三方账号，请使用原账号登录",
          409
        );
      }
      user = byEmail;
    }

    let isNewUser = false;
    let tempPassword: string | null = null;
    let passwordEmailSent = false;

    const configs = await ctx.dbService.listSystemConfigsMap();
    const registerEnabled = Number(configs["register_enabled"] ?? 1);
    const registerMode = String(registerEnabled);
    const inviteCode = referralService.normalizeInviteCode(inviteCodeRaw);

    let inviterId = 0;

    if (!user) {
      if (registerMode === "0") {
        return errorResponse(res, "系统暂时关闭注册功能", 403);
      }
      if (inviteCode) {
        const inviter = await referralService.findInviterByCode(inviteCode);
        if (!inviter) {
          return errorResponse(res, "邀请码无效或已失效，请联系邀请人", 400);
        }
        const inviteLimit = Number(inviter.invite_limit ?? 0);
        const inviteUsed = Number(inviter.invite_used ?? 0);
        if (inviteLimit > 0 && inviteUsed >= inviteLimit) {
          return errorResponse(res, "该邀请码使用次数已达上限，请联系邀请人", 400);
        }
        inviterId = Number(inviter.id);
      } else if (registerMode === "2") {
        return errorResponse(res, "当前仅允许受邀注册，请输入有效邀请码", 403);
      }

      const username = await generateUniqueUsername(
        pending.usernameCandidates,
        pending.fallbackUsernameSeed
      );
      tempPassword = generateRandomString(32);
      const registerResult = await authService.register(
        pending.email,
        username,
        tempPassword,
        pending.clientIp ?? null,
        inviterId || null
      );
      if (!registerResult.success) {
        return errorResponse(res, registerResult.message || "注册失败", 400);
      }
      if (!registerResult.userId) {
        return errorResponse(res, "注册失败", 400);
      }
      user = await ctx.dbService.getUserById(Number(registerResult.userId));
      if (!user) return errorResponse(res, "创建用户失败", 500);

      if (inviterId) {
        await referralService.saveReferralRelation({
          inviterId,
          inviteeId: Number(user.id),
          inviteCode: inviteCode || "",
          inviteIp: pending.clientIp ?? null
        });
        await referralService.incrementInviteUsage(inviterId);
      }

      await referralService.ensureUserInviteCode(Number(user.id));

      const providerLabel = pending.provider === "google" ? "Google" : "GitHub";
      passwordEmailSent = await sendOAuthWelcomeEmail(
        providerLabel,
        pending.email,
        tempPassword
      );
      isNewUser = true;
    }

    if (!user) return errorResponse(res, "无法创建或加载用户信息", 500);
    if (Number(user.status ?? 0) !== 1) {
      return errorResponse(res, "账户已禁用", 403);
    }

    await ctx.dbService.db
      .prepare(
        `
        UPDATE users
        SET ${identifierField} = ?,
            oauth_provider = ?,
            first_oauth_login_at = COALESCE(first_oauth_login_at, CURRENT_TIMESTAMP),
            last_oauth_login_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(pending.providerId, pending.provider, user.id)
      .run();

    const refreshed = await ctx.dbService.getUserById(Number(user.id));
    if (refreshed) user = refreshed;

    const method =
      pending.provider === "google" ? "google_oauth" : "github_oauth";
    const result = await finalizeOauthLogin(user, method, req, {
      provider: pending.provider,
      isNewUser,
      tempPassword,
      passwordEmailSent
    });
    return successResponse(res, result, "登录成功");
  });

  // Google/GitHub 入口占位（当前未启用第三方登录，避免 404）
  // Google OAuth 登录（使用 id_token 简单校验 aud/iss）
  router.post("/google", async (req: Request, res: Response) => {
    const idToken = ensureString((req.body || {}).idToken || (req.body || {}).id_token);
    const remember = Boolean((req.body || {}).remember);
    if (!idToken) return errorResponse(res, "缺少 idToken", 400);
    if (!ctx.env.GOOGLE_CLIENT_ID) return errorResponse(res, "未配置 Google OAuth", 400);

    try {
      const tokenInfoResp = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
      if (!tokenInfoResp.ok) {
        return errorResponse(res, "Google token 校验失败", 401);
      }
      const tokenInfo = (await tokenInfoResp.json()) as any;
      const aud = tokenInfo.aud;
      const issuer = tokenInfo.iss;
      if (aud !== ctx.env.GOOGLE_CLIENT_ID) {
        return errorResponse(res, "aud 不匹配", 401);
      }
      if (issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") {
        return errorResponse(res, "iss 不合法", 401);
      }
      const googleSub = ensureString(tokenInfo.sub);
      const email = ensureString(tokenInfo.email).toLowerCase();
      const emailVerified = tokenInfo.email_verified === "true" || tokenInfo.email_verified === true;
      if (!googleSub) return errorResponse(res, "无效的 Google sub", 400);
      if (!email) return errorResponse(res, "未获取到邮箱", 400);
      const clientIp = getClientIp(req);
      const userAgent = req.headers["user-agent"] as string | undefined;

      // 查找用户
      let user = await ctx.dbService.db
        .prepare("SELECT * FROM users WHERE google_sub = ?")
        .bind(googleSub)
        .first<any>();

      if (!user && email) {
        const byEmail = await ctx.dbService.getUserByEmail(email);
        if (byEmail && byEmail.google_sub && byEmail.google_sub !== googleSub) {
          return errorResponse(res, "邮箱已绑定其它 Google 账号", 400);
        }
        user = byEmail;
      }

      if (!user) {
        const emailLocal = email.split("@")[0] || "";
        const usernameCandidates = [
          tokenInfo.given_name,
          tokenInfo.name,
          emailLocal,
          `google_${googleSub.slice(-6)}`
        ].filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        );
        const pendingToken = await cachePendingOAuthRegistration({
          provider: "google",
          email,
          providerId: googleSub,
          usernameCandidates,
          fallbackUsernameSeed: emailLocal || googleSub.slice(-6),
          remember,
          clientIp: clientIp || null,
          userAgent: userAgent ?? null
        });
        const profileUsername =
          usernameCandidates[0] || emailLocal || `google_${googleSub.slice(-6)}`;
        return successResponse(
          res,
          {
            need_terms_agreement: true,
            pending_terms_token: pendingToken,
            provider: "google",
            profile: {
              email,
              username: profileUsername,
              avatar: ensureString(tokenInfo.picture)
            }
          },
          "请先同意服务条款"
        );
      }

      if (!user) return errorResponse(res, "创建用户失败", 500);
      if (Number(user.status ?? 0) !== 1) return errorResponse(res, "账户已禁用", 403);

      // 绑定 Google 信息
      await ctx.dbService.db
        .prepare(
          `
          UPDATE users
          SET google_sub = ?, oauth_provider = 'google',
              first_oauth_login_at = COALESCE(first_oauth_login_at, CURRENT_TIMESTAMP),
              last_oauth_login_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(googleSub, user.id)
        .run();

      const result = await finalizeOauthLogin(user, "google_oauth", req, {
        provider: "google",
        email_verified: emailVerified,
        isNewUser: false,
        tempPassword: null,
        passwordEmailSent: false
      });
      return successResponse(res, result, "登录成功");
    } catch (error: any) {
      return errorResponse(res, error?.message || "Google 登录失败", 500);
    }
  });

  // GitHub OAuth 登录：使用授权码换取 access_token 后获取用户信息
  router.post("/github", async (req: Request, res: Response) => {
    const { code, redirectUri, remember } = req.body || {};
    if (!code) return errorResponse(res, "缺少 code", 400);
    if (!ctx.env.GITHUB_CLIENT_ID || !ctx.env.GITHUB_CLIENT_SECRET) {
      return errorResponse(res, "未配置 GitHub OAuth", 400);
    }

    try {
      const redirect = ensureString(redirectUri) || ctx.env.GITHUB_REDIRECT_URI || "";
      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams({
          client_id: ctx.env.GITHUB_CLIENT_ID,
          client_secret: ctx.env.GITHUB_CLIENT_SECRET,
          code: String(code),
          ...(redirect ? { redirect_uri: redirect } : {})
        })
      });
      if (!tokenResp.ok) {
        return errorResponse(res, "GitHub token 交换失败", 401);
      }
      const tokenData = (await tokenResp.json()) as any;
      const accessToken = tokenData.access_token;
      if (!accessToken) return errorResponse(res, "缺少 access_token", 401);

      const userResp = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "soga-panel-server"
        }
      });
      if (!userResp.ok) {
        return errorResponse(res, "获取 GitHub 用户信息失败", 401);
      }
      const ghUser = (await userResp.json()) as any;
      const githubId = ghUser?.id ? String(ghUser.id) : "";
      if (!githubId) return errorResponse(res, "无效的 GitHub ID", 400);
      let email = ensureString(ghUser?.email);

      // 若主邮箱为空，尝试获取可见邮箱
      if (!email) {
        const emailsResp = await fetch("https://api.github.com/user/emails", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "soga-panel-server"
          }
        });
        if (emailsResp.ok) {
          const emails = (await emailsResp.json()) as Array<{ email?: string; primary?: boolean; verified?: boolean }>;
          const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
          email = ensureString(primary?.email);
        }
      }
      if (!email) return errorResponse(res, "未获取到邮箱，请在 GitHub 公开邮箱后重试", 400);
      const normalizedEmail = email.toLowerCase();
      const clientIp = getClientIp(req);
      const userAgent = req.headers["user-agent"] as string | undefined;

      // 查找用户
      let user = await ctx.dbService.db.prepare("SELECT * FROM users WHERE github_id = ?").bind(githubId).first<any>();
      if (!user && normalizedEmail) {
        const byEmail = await ctx.dbService.getUserByEmail(normalizedEmail);
        if (byEmail && byEmail.github_id && byEmail.github_id !== githubId) {
          return errorResponse(res, "邮箱已绑定其它 GitHub 账号", 400);
        }
        user = byEmail;
      }

      if (!user) {
        const emailLocal = normalizedEmail.split("@")[0] || "";
        const usernameCandidates = [
          ghUser?.login,
          ghUser?.name,
          emailLocal,
          `github_${githubId.slice(-6)}`
        ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        const pendingToken = await cachePendingOAuthRegistration({
          provider: "github",
          email: normalizedEmail,
          providerId: githubId,
          usernameCandidates,
          fallbackUsernameSeed: emailLocal || githubId.slice(-6),
          remember: Boolean(remember),
          clientIp: clientIp || null,
          userAgent: userAgent ?? null
        });
        const profileUsername =
          usernameCandidates[0] || emailLocal || `github_${githubId.slice(-6)}`;
        return successResponse(
          res,
          {
            need_terms_agreement: true,
            pending_terms_token: pendingToken,
            provider: "github",
            profile: {
              email: normalizedEmail,
              username: profileUsername,
              avatar: ensureString(ghUser?.avatar_url)
            }
          },
          "请先同意服务条款"
        );
      }

      if (!user) return errorResponse(res, "创建用户失败", 500);
      if (Number(user.status ?? 0) !== 1) return errorResponse(res, "账户已禁用", 403);

      await ctx.dbService.db
        .prepare(
          `
          UPDATE users
          SET github_id = ?, oauth_provider = 'github',
              first_oauth_login_at = COALESCE(first_oauth_login_at, CURRENT_TIMESTAMP),
              last_oauth_login_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .bind(githubId, user.id)
        .run();

      const result = await finalizeOauthLogin(user, "github_oauth", req, {
        provider: "github",
        isNewUser: false,
        tempPassword: null,
        passwordEmailSent: false
      });
      return successResponse(res, result, "登录成功");
    } catch (error: any) {
      return errorResponse(res, error?.message || "GitHub 登录失败", 500);
    }
  });

  // 二步验证校验
  router.post("/verify-2fa", async (req: Request, res: Response) => {
    const { challenge_id, code, rememberDevice, deviceName } = req.body || {};
    if (!challenge_id || !code) {
      return errorResponse(res, "缺少参数", 400);
    }
    try {
      const clientIp = getClientIp(req);
      const result = await authService.verifyTwoFactorChallenge({
        challengeId: String(challenge_id),
        code: String(code),
        rememberDevice: Boolean(rememberDevice),
        deviceName: typeof deviceName === "string" ? deviceName : undefined,
        clientIp,
        userAgent: req.headers["user-agent"] as string | undefined
      });
      if (!result.success) {
        return errorResponse(res, result.message || "二步验证失败", 401);
      }
      const user = result.user ? { ...result.user, is_admin: Boolean(result.user.is_admin) } : null;
      return successResponse(
        res,
        { token: result.token, user, trust_token: result.trustToken ?? undefined },
        "登录成功"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/login", async (req: Request, res: Response) => {
    const {
      email,
      password,
      two_factor_code,
      backup_code,
      remember,
      twoFactorTrustToken,
      turnstileToken,
      ["cf-turnstile-response"]: cfTurnstileResponse
    } = (req.body || {}) as any;
    if (!email || !password) {
      return errorResponse(res, "参数缺失", 400);
    }
    try {
      const clientIp = getClientIp(req) || "unknown";
      const userAgent = (req.headers["user-agent"] as string | undefined) || "";

      const turnstileSecret = (ctx.env.TURNSTILE_SECRET_KEY || "").trim();
      const turnstileEnabled = turnstileSecret.length > 0;
      const tokenValue =
        typeof turnstileToken === "string" && turnstileToken.trim()
          ? turnstileToken.trim()
          : typeof cfTurnstileResponse === "string" && cfTurnstileResponse.trim()
          ? cfTurnstileResponse.trim()
          : "";

      if (turnstileEnabled) {
        if (!tokenValue) {
          return errorResponse(res, "请完成人机验证后再登录", 400);
        }
        try {
          const params = new URLSearchParams();
          params.set("secret", turnstileSecret);
          params.set("response", tokenValue);
          if (clientIp && clientIp !== "unknown") {
            params.set("remoteip", clientIp);
          }

          const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            body: params
          });

          if (!resp.ok) {
            return errorResponse(res, "人机验证失败，请稍后重试", 400);
          }
          const verifyResult = (await resp.json()) as { success?: boolean; ["error-codes"]?: string[] };
          if (!verifyResult.success) {
            return errorResponse(res, "人机验证未通过，请重试", 400);
          }
        } catch (e) {
          return errorResponse(res, "人机验证异常，请稍后重试", 400);
        }
      }

      const result = await authService.login(
        email,
        password,
        clientIp,
        Boolean(remember),
        typeof twoFactorTrustToken === "string" ? twoFactorTrustToken : null,
        two_factor_code,
        backup_code,
        userAgent
      );
      if (!result.success) {
        if ((result as any).twoFactorRequired && (result as any).challengeId) {
          return successResponse(res, {
            need_2fa: true,
            challenge_id: (result as any).challengeId,
            two_factor_enabled: true
          });
        }
        return errorResponse(res, result.message, result.message?.includes("二步") ? 428 : 401);
      }
      const user = result.user ? { ...result.user, is_admin: Boolean(result.user.is_admin) } : null;
      return successResponse(res, { token: result.token, user, trust_token: (result as any).trustToken ?? undefined }, "登录成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post(
    "/passkey/register/options",
    createAuthMiddleware(ctx),
    async (req: Request, res: Response) => {
      const user = (req as any).user;
      if (!user?.id) return errorResponse(res, "未登录", 401);
      try {
        const configs = await ctx.dbService.listSystemConfigsMap();
        const siteName = configs["site_name"] || ctx.env.SITE_NAME || "Soga Panel";
        const rpId = getRpId(req);
        const origin = getExpectedOrigin(req);
        const challenge = randomChallenge(32);

        const passkeys = await ctx.dbService.listPasskeys(Number(user.id));
        await savePasskeyChallenge({
          type: "registration",
          userId: Number(user.id),
          challenge,
          rpId,
          origin,
          createdAt: Date.now()
        });

        const excludeCredentials = passkeys.map((p: any) => ({
          id: String(p.credential_id),
          type: "public-key",
          transports: parseTransports(p.transports)
        }));

        const displayName = ensureString(user.username) || ensureString(user.email) || `user_${user.id}`;

        return successResponse(res, {
          challenge,
          rp: { id: rpId, name: siteName },
          user: {
            id: base64UrlEncode(String(user.id)),
            name: ensureString(user.email) || displayName,
            displayName
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 }
          ],
          timeout: 120000,
          attestation: "none",
          authenticatorSelection: {
            userVerification: "preferred",
            residentKey: "preferred"
          },
          excludeCredentials
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(res, message, 500);
      }
    }
  );

  router.post(
    "/passkey/register/verify",
    createAuthMiddleware(ctx),
    async (req: Request, res: Response) => {
      const user = (req as any).user;
      if (!user?.id) return errorResponse(res, "未登录", 401);
      const { credential, deviceName } = req.body || {};
      if (
        !credential ||
        typeof credential?.response?.clientDataJSON !== "string" ||
        typeof credential?.response?.attestationObject !== "string"
      ) {
        return errorResponse(res, "缺少凭证数据", 400);
      }

      const receivedChallenge = extractClientChallenge(credential.response.clientDataJSON);
      if (!receivedChallenge) {
        return errorResponse(res, "挑战码无效，请重试", 400);
      }

      const challenge = await loadPasskeyChallenge(receivedChallenge);
      if (!challenge || challenge.type !== "registration" || Number(challenge.userId) !== Number(user.id)) {
        return errorResponse(res, "Passkey 注册会话已过期，请重试", 400);
      }

      try {
        const validated = await validateRegistrationResponse({
          credential: credential as RegistrationCredential,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRpId: challenge.rpId
        });

        const existing = await ctx.dbService.getPasskeyByCredentialId(validated.credentialId);
        if (existing) {
          await clearPasskeyChallenge(receivedChallenge);
          return errorResponse(res, "该 Passkey 已被绑定", 400);
        }

        const safeDeviceName =
          typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, 64) : null;

        await ctx.dbService.insertPasskey({
          userId: Number(user.id),
          credentialId: validated.credentialId,
          publicKey: validated.publicKey,
          alg: validated.alg,
          userHandle: validated.userHandle || base64UrlEncode(String(user.id)),
          rpId: challenge.rpId,
          transports: validated.transports,
          signCount: validated.signCount,
          deviceName: safeDeviceName
        });

        await clearPasskeyChallenge(receivedChallenge);
        return successResponse(res, { credential_id: validated.credentialId }, "Passkey 已绑定");
      } catch (error) {
        await clearPasskeyChallenge(receivedChallenge);
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(res, message, 400);
      }
    }
  );

  router.post("/passkey/login/options", async (req: Request, res: Response) => {
    const { email, remember } = req.body || {};
    const normalizedEmail = ensureString(email).toLowerCase();
    if (!normalizedEmail) {
      return errorResponse(res, "请填写邮箱", 400);
    }

    try {
      const user = await ctx.dbService.getUserByEmail(normalizedEmail);
      if (!user) {
        return errorResponse(res, "账户不存在", 404);
      }

      const passkeys = await ctx.dbService.listPasskeys(Number(user.id));
      if (!passkeys.length) {
        return errorResponse(res, "该账户未绑定 Passkey，请先使用密码登录绑定", 400);
      }

      const rpId =
        passkeys.find((p: any) => typeof p.rp_id === "string" && p.rp_id)?.rp_id || getRpId(req);
      const origin = getExpectedOrigin(req);
      const challenge = randomChallenge(32);

      await savePasskeyChallenge({
        type: "authentication",
        userId: Number(user.id),
        challenge,
        rpId,
        origin,
        remember: Boolean(remember),
        createdAt: Date.now()
      });

      return successResponse(res, {
        challenge,
        rpId,
        timeout: 120000,
        allowCredentials: passkeys.map((row: any) => ({
          id: String(row.credential_id),
          type: "public-key",
          transports: parseTransports(row.transports)
        })),
        userVerification: "required"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/passkey/login/verify", async (req: Request, res: Response) => {
    const { credential } = req.body || {};
    if (
      !credential ||
      typeof credential?.response?.clientDataJSON !== "string" ||
      typeof credential?.response?.authenticatorData !== "string" ||
      typeof credential?.response?.signature !== "string"
    ) {
      return errorResponse(res, "缺少凭证数据", 400);
    }

    const clientChallenge = extractClientChallenge(credential.response.clientDataJSON);
    if (!clientChallenge) {
      return errorResponse(res, "挑战码无效，请重试", 400);
    }

    const challenge = await loadPasskeyChallenge(clientChallenge);
    if (!challenge || challenge.type !== "authentication") {
      return errorResponse(res, "登录会话已失效，请重试", 400);
    }

    const credentialId = ensureString(credential.id);
    try {
      const clientIp = getClientIp(req);
      const passkey = await ctx.dbService.getPasskeyByCredentialId(credentialId);
      if (!passkey || Number(passkey.user_id) !== Number(challenge.userId)) {
        await clearPasskeyChallenge(clientChallenge);
        return errorResponse(res, "未找到匹配的 Passkey", 404);
      }

      const user = await ctx.dbService.getUserById(Number(passkey.user_id));
      if (!user) {
        await clearPasskeyChallenge(clientChallenge);
        return errorResponse(res, "账户不存在", 404);
      }

      if (Number(user.status ?? 0) !== 1) {
        await clearPasskeyChallenge(clientChallenge);
        return errorResponse(res, "账户已禁用", 403);
      }

      const validated = await validateAuthenticationResponse({
        credential: credential as AuthenticationCredential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRpId: challenge.rpId || getRpId(req),
        storedPublicKey: ensureString(passkey.public_key),
        alg: Number(passkey.alg ?? -7),
        prevSignCount: Number(passkey.sign_count ?? 0),
        expectedUserHandle: ensureString(passkey.user_handle) || undefined
      });

      const newCount = validated.newSignCount ?? Number(passkey.sign_count ?? 0);
      const finalCount =
        newCount > Number(passkey.sign_count ?? 0) ? newCount : Number(passkey.sign_count ?? 0);
      await ctx.dbService.updatePasskeyUsage(credentialId, finalCount);

      await clearPasskeyChallenge(clientChallenge);

      const payload = buildPayload(user);
      const token = await authService.issueSessionToken(payload);
      await ctx.dbService.updateLoginInfo(payload.id, clientIp || null);
      await ctx.dbService.insertLoginLog({
        userId: payload.id,
        ip: clientIp,
        userAgent: req.headers["user-agent"] as string | undefined,
        status: 1,
        loginMethod: "passkey"
      });

      const userResp = { ...payload, is_admin: Boolean(payload.is_admin) };
      return successResponse(res, { token, user: userResp }, "登录成功");
    } catch (error) {
      await clearPasskeyChallenge(clientChallenge);
      const clientIp = getClientIp(req);
      await ctx.dbService.insertLoginLog({
        userId: Number(challenge.userId || 0),
        ip: clientIp,
        userAgent: req.headers["user-agent"] as string | undefined,
        status: 0,
        failureReason: error instanceof Error ? error.message : String(error),
        loginMethod: "passkey"
      });
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 400);
    }
  });

  router.post("/logout", async (req: Request, res: Response) => {
    const token =
      typeof req.body?.token === "string"
        ? req.body.token
        : parseAuthHeader(req.headers.authorization);
    if (!token) {
      return errorResponse(res, "缺少 token", 400);
    }
    try {
      await authService.logout(token);
      return successResponse(res, null, "已登出");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/send-email-code", async (req: Request, res: Response) => {
    try {
      return await handleVerificationCodeRequest(req, res, {
        purpose: "register",
        disallowExistingUser: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/password-reset/request", async (req: Request, res: Response) => {
    try {
      return await handleVerificationCodeRequest(req, res, {
        purpose: "password_reset",
        requireExistingUser: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/password-reset/confirm", async (req: Request, res: Response) => {
    const { email, code, new_password } = req.body || {};
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !code || !new_password) {
      return errorResponse(res, "参数缺失", 400);
    }
    try {
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return errorResponse(res, "请输入有效的邮箱地址", 400);
      }
      const { emailVerifyEnabled, emailProviderEnabled } =
        await resolveVerificationFlags();
      if (!emailVerifyEnabled || !emailProviderEnabled) {
        return errorResponse(res, "当前未开启密码重置功能", 403);
      }

      const result = await authService.resetPasswordWithCode(
        normalizedEmail,
        code,
        new_password
      );
      if (!result.success) {
        const status = result.message?.includes("次数过多") ? 429 : 400;
        return errorResponse(res, result.message || "重置失败", status);
      }
      return successResponse(res, null, "密码已重置");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  // 2FA: 开启流程，生成密钥+二维码
  router.post("/two-factor/setup", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return errorResponse(res, "未登录", 401);

    const secret = twoFactorService.generateSecret();
    const encrypted = await twoFactorService.encryptSecret(secret);
    const site = ctx.env.SITE_NAME || "Soga Panel";
    const { url, qr } = await twoFactorService.generateQr(secret, user.email || user.username, site);
    return successResponse(res, {
      secret,
      encrypted_secret: encrypted,
      otpauth_url: url,
      qr
    });
  });

  // 2FA: 校验并启用
  router.post("/two-factor/enable", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return errorResponse(res, "未登录", 401);

    const { encrypted_secret, code } = req.body || {};
    if (!encrypted_secret || !code) {
      return errorResponse(res, "参数缺失", 400);
    }
    const secret = await twoFactorService.decryptSecret(String(encrypted_secret));
    if (!secret) return errorResponse(res, "密钥无效", 400);

    const ok = await twoFactorService.verifyTotp(secret, String(code));
    if (!ok) return errorResponse(res, "验证码错误", 400);

    const backups = await twoFactorService.hashBackupCodes(twoFactorService.generateBackupCodes());
    await ctx.dbService.db
      .prepare(
        `
        UPDATE users 
        SET two_factor_enabled = 1,
            two_factor_secret = ?,
            two_factor_backup_codes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(await twoFactorService.encryptSecret(secret), JSON.stringify(backups), user.id)
      .run();

    return successResponse(res, { backup_codes: backups.map(() => "********") }, "已开启二步验证");
  });

  // 2FA: 关闭
  router.post("/two-factor/disable", async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return errorResponse(res, "未登录", 401);
    await ctx.dbService.db
      .prepare(
        `
        UPDATE users 
        SET two_factor_enabled = 0,
            two_factor_secret = NULL,
            two_factor_backup_codes = NULL,
            two_factor_temp_secret = NULL,
            two_factor_confirmed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(user.id)
      .run();
    return successResponse(res, null, "已关闭二步验证");
  });

  return router;
}

function parseAuthHeader(header?: string) {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return null;
}
