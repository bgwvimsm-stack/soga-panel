import { Router, type Request, type Response } from "express";
import type { AppContext } from "../types";
import { AuthService } from "../services/auth";
import { errorResponse, successResponse } from "../utils/response";
import { TwoFactorService } from "../services/twoFactor";
import { ReferralService } from "../services/referral";
import { generateRandomString, generateUUID, hashPassword } from "../utils/crypto";
import { ensureString } from "../utils/d1";

export function createAuthRouter(ctx: AppContext) {
  const router = Router();
  const authService = new AuthService(ctx.dbService, ctx.cache, ctx.env);
  const twoFactorService = new TwoFactorService(ctx.env);
  const referralService = new ReferralService(ctx.dbService);

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
    await ctx.dbService.updateLoginInfo(payload.id, req.ip ?? null);
    await ctx.dbService.insertLoginLog({
      userId: payload.id,
      ip: req.ip ?? "",
      userAgent: req.headers["user-agent"] as string | undefined,
      status: 1,
      loginMethod: method
    });
    await referralService.ensureUserInviteCode(payload.id);
    const user = { ...payload, is_admin: Boolean(payload.is_admin) };
    return { token, user, ...extra };
  };

  router.get("/register-config", async (_req: Request, res: Response) => {
    const configs = await ctx.dbService.listSystemConfigsMap();
    const registerEnabled = Number(configs["register_enabled"] ?? 1);
    const emailVerify = Number(configs["register_email_verification_enabled"] ?? 1);
    const inviteRequired = registerEnabled === 2;
    return successResponse(res, {
      registerEnabled: registerEnabled !== 0,
      registerMode: String(registerEnabled),
      inviteRequired,
      verificationEnabled: emailVerify !== 0,
      passwordResetEnabled: true,
      emailProviderEnabled: Boolean(
        ctx.env.MAIL_SMTP_HOST || ctx.env.MAIL_RESEND_KEY || ctx.env.MAIL_SMTP_USER
      )
    });
  });

  router.post("/register", async (req: Request, res: Response) => {
    const { email, username, password } = req.body || {};
    const inviteCodeRaw =
      typeof req.body?.inviteCode === "string"
        ? req.body.inviteCode
        : typeof req.body?.invite_code === "string"
        ? req.body.invite_code
        : "";
    if (!email || !username || !password) {
      return errorResponse(res, "参数缺失", 400);
    }

    try {
      let inviterId: number | null = null;
      const inviter = await referralService.findInviterByCode(inviteCodeRaw);
      if (inviter) {
        inviterId = Number(inviter.id);
      }

      const result = await authService.register(email, username, password, req.ip, inviterId);
      if (!result.success) {
        return errorResponse(res, result.message, 400);
      }

      if (result.userId && inviterId) {
        await referralService.saveReferralRelation({
          inviterId,
          inviteeId: Number(result.userId),
          inviteCode: inviteCodeRaw ?? "",
          inviteIp: req.ip
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
          await ctx.dbService.updateLoginInfo(payload.id, req.ip ?? null);
          await ctx.dbService.insertLoginLog({
            userId: payload.id,
            ip: req.ip ?? "",
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
      const result = await authService.oauthLogin({
        provider,
        email,
        providerId: provider_id,
        username,
        clientIp: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined
      });
      if (!result.success) return errorResponse(res, result.message, 401);
      return successResponse(res, { token: result.token, user: result.user }, "登录成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  // OAuth 注册补全（Node 版暂不接三方校验，仅返回占位响应）
  router.post("/oauth/complete", async (req: Request, res: Response) => {
    const { pendingToken, inviteCode } = req.body || {};
    if (!pendingToken) return errorResponse(res, "缺少注册会话标识", 400);
    // 可以在此接入实际的第三方注册完成逻辑
    return errorResponse(res, "暂未启用第三方登录，请改用邮箱注册", 400, {
      pendingToken,
      inviteCode: inviteCode ?? null
    });
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
      const email = ensureString(tokenInfo.email);
      const emailVerified = tokenInfo.email_verified === "true" || tokenInfo.email_verified === true;
      if (!googleSub) return errorResponse(res, "无效的 Google sub", 400);
      if (!email) return errorResponse(res, "未获取到邮箱", 400);

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

      // 创建新用户
      if (!user) {
        const usernameSeed = email.split("@")[0] || `google_${googleSub.slice(-6)}`;
        const username = usernameSeed.length > 2 ? usernameSeed : `google_${googleSub.slice(-6)}`;
        const passwordHash = hashPassword(generateRandomString(12));
        const uuid = generateUUID();
        const passwd = generateRandomString(12);
        const token = generateRandomString(32);
        const userId = await ctx.dbService.createUser({
          email,
          username,
          password_hash: passwordHash,
          uuid,
          passwd,
          token,
          register_ip: req.ip ?? null
        });
        user = await ctx.dbService.getUserById(Number(userId));
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
        email_verified: emailVerified
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

      // 查找用户
      let user = await ctx.dbService.db.prepare("SELECT * FROM users WHERE github_id = ?").bind(githubId).first<any>();
      if (!user && email) {
        const byEmail = await ctx.dbService.getUserByEmail(email);
        if (byEmail && byEmail.github_id && byEmail.github_id !== githubId) {
          return errorResponse(res, "邮箱已绑定其它 GitHub 账号", 400);
        }
        user = byEmail;
      }

      if (!user) {
        const usernameSeed = ghUser?.login || ghUser?.name || email.split("@")[0] || `github_${githubId.slice(-6)}`;
        const username = usernameSeed.length > 2 ? usernameSeed : `github_${githubId.slice(-6)}`;
        const passwordHash = hashPassword(generateRandomString(12));
        const uuid = generateUUID();
        const passwd = generateRandomString(12);
        const token = generateRandomString(32);
        const userId = await ctx.dbService.createUser({
          email,
          username,
          password_hash: passwordHash,
          uuid,
          passwd,
          token,
          register_ip: req.ip ?? null
        });
        user = await ctx.dbService.getUserById(Number(userId));
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

      const result = await finalizeOauthLogin(user, "github_oauth", req, { provider: "github" });
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
      const result = await authService.verifyTwoFactorChallenge({
        challengeId: String(challenge_id),
        code: String(code),
        rememberDevice: Boolean(rememberDevice),
        deviceName: typeof deviceName === "string" ? deviceName : undefined,
        clientIp: req.ip,
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
      const clientIp =
        (req.headers["cf-connecting-ip"] as string | undefined) ||
        (req.headers["x-forwarded-for"] as string | undefined) ||
        (req.headers["x-real-ip"] as string | undefined) ||
        req.ip ||
        "unknown";
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
    const { email, purpose } = req.body || {};
    if (!email || !purpose) {
      return errorResponse(res, "参数缺失", 400);
    }
    try {
      const result = await authService.sendEmailCode(email, purpose, {
        ip: req.ip,
        ua: req.headers["user-agent"]
      });
      // 为方便自托管调试，直接返回过期时间，验证码仅打印日志
      console.log(`[email-code] purpose=${purpose} email=${email} code=${result.code}`);
      return successResponse(res, { expires_at: result.expires_at }, "验证码已发送（请查看邮件，开发模式下已在日志输出）");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/password-reset/request", async (req: Request, res: Response) => {
    const { email } = req.body || {};
    if (!email) {
      return errorResponse(res, "参数缺失", 400);
    }
    try {
      const result = await authService.sendEmailCode(email, "password_reset", {
        ip: req.ip,
        ua: req.headers["user-agent"]
      });
      console.log(`[password-reset] email=${email} code=${result.code}`);
      return successResponse(res, { expires_at: result.expires_at }, "重置验证码已发送");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(res, message, 500);
    }
  });

  router.post("/password-reset/confirm", async (req: Request, res: Response) => {
    const { email, code, new_password } = req.body || {};
    if (!email || !code || !new_password) {
      return errorResponse(res, "参数缺失", 400);
    }
    try {
      const result = await authService.resetPasswordWithCode(email, code, new_password);
      if (!result.success) {
        return errorResponse(res, result.message || "重置失败", 400);
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
