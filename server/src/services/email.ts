import type { AppEnv } from "../config/env";
import { Resend } from "resend";
import nodemailer from "nodemailer";

type SendMailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

type MailProvider = "resend" | "smtp" | "sendgrid" | "none";
type SmtpDriver = "nodemailer" | "emailjs";

type EmailjsClientOptions = {
  user?: string;
  password?: string;
  host: string;
  port: number;
  ssl?: boolean;
  tls?: boolean | Record<string, unknown>;
  timeout?: number;
  authentication?: string[];
};

export class EmailService {
  private readonly env: AppEnv;
  private readonly provider: MailProvider;
  private readonly resend?: Resend;
  // 使用 any 避免与 nodemailer 类型命名空间冲突
  private readonly transporter?: any;
  private readonly emailjsOptions?: EmailjsClientOptions;
  private emailjsModulePromise?: Promise<any>;

  constructor(env: AppEnv) {
    this.env = env;
    this.provider = this.resolveProvider(env);

    if (this.provider === "resend") {
      const apiKey = this.readEnv("RESEND_API_KEY") || this.readEnv("MAIL_RESEND_KEY");
      if (apiKey) {
        this.resend = new Resend(apiKey);
      }
    } else if (this.provider === "smtp" && this.getSmtpHost()) {
      const host = this.getSmtpHost()!;
      const secureEnv = (this.readEnv("SMTP_SECURE") || "").toLowerCase();
      const secure = secureEnv === "true" || secureEnv === "1";
      const port = this.getSmtpPort() || (secure ? 465 : 587);
      const startTlsEnv = (this.readEnv("SMTP_STARTTLS") || "").toLowerCase();
      const requireTls =
        startTlsEnv !== ""
          ? startTlsEnv === "true" || startTlsEnv === "1"
          : !secure;
      const authTypeEnv = (this.readEnv("SMTP_AUTH_TYPE") || "").toLowerCase();
      const authMethod =
        authTypeEnv === "login" || authTypeEnv === "plain"
          ? authTypeEnv.toUpperCase()
          : undefined;

      const smtpDriver = this.resolveSmtpDriver(host);
      const user = this.getSmtpUser();
      const pass = this.getSmtpPass();

      if (smtpDriver === "emailjs") {
        this.emailjsOptions = {
          user,
          password: pass,
          host,
          port,
          ssl: secure,
          tls: requireTls,
          ...(authMethod ? { authentication: [authMethod] } : {})
        };
      } else {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure,
          auth:
            user && pass
              ? {
                  user,
                  pass
                }
              : undefined,
          requireTLS: requireTls,
          ...(authMethod ? { authMethod } : {})
        });
      }
    }
  }

  async sendMail(options: SendMailOptions) {
    const from = this.getFromAddress();

    if (this.provider === "resend") {
      if (!this.resend) {
        throw new Error("未配置 RESEND_API_KEY（或 MAIL_RESEND_KEY），无法发送邮件");
      }
      this.assertResendFromDomain(from);
      const result = await this.resend.emails.send({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text ?? "",
        html: options.html
      });
      const error = (result as any)?.error;
      if (error) {
        const message =
          typeof error === "string"
            ? error
            : error?.message || JSON.stringify(error);
        console.error("[mail] Resend 发送失败", message);
        throw new Error(message || "Resend 发送失败");
      }
      return;
    }

    if (this.provider === "smtp") {
      if (!this.transporter && !this.emailjsOptions) {
        throw new Error("未配置 SMTP_HOST（或 MAIL_SMTP_HOST），无法发送邮件");
      }
      const smtpHost = this.getSmtpHost() || "";
      const isGmailHost = /smtp\.gmail\.com|smtp\.googlemail\.com/i.test(smtpHost);
      if (isGmailHost && (!this.getSmtpUser() || !this.getSmtpPass())) {
        throw new Error(
          "Gmail SMTP 需要配置 SMTP_USER/SMTP_PASS（建议使用应用专用密码），否则无法发送邮件"
        );
      }
      const textContent =
        options.text ??
        (options.html
          ? options.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "");
      try {
        if (this.emailjsOptions) {
          await this.sendViaEmailjs({
            from,
            to: options.to,
            subject: options.subject,
            text: textContent,
            html: options.html
          });
        } else {
          await this.transporter.sendMail({
            from,
            to: options.to,
            subject: options.subject,
            text: textContent,
            html: options.html
          });
        }
      } catch (error) {
        throw this.wrapSmtpError(error);
      }
      return;
    }

    if (this.provider === "sendgrid") {
      if (!this.readEnv("SENDGRID_API_KEY")) {
        throw new Error("未配置 SENDGRID_API_KEY，无法发送邮件");
      }
      await this.sendViaSendgrid({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        from
      });
      return;
    }

    throw new Error(
      "未配置邮件发送提供商：请设置 MAIL_PROVIDER 为 resend/smtp/sendgrid，并补齐对应密钥"
    );
  }

  private async sendViaSendgrid(message: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    from: string;
  }) {
    const apiKey = this.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.warn("[mail] SENDGRID_API_KEY not configured, skip sending");
      return;
    }

    const from = {
      email: message.from,
      name: message.from
    };

    const content: Array<{ type: string; value: string }> = [];
    const textContent =
      message.text ||
      (message.html
        ? message.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "");

    content.push({ type: "text/plain", value: textContent || "" });

    if (message.html) {
      content.push({ type: "text/html", value: message.html });
    }

    const body = {
      personalizations: [
        {
          to: [{ email: message.to }],
          subject: message.subject
        }
      ],
      from,
      content
    };

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      console.error("[mail] SendGrid 发送失败", response.status, errorText);
      throw new Error(`SendGrid API 调用失败: ${response.status} ${errorText}`);
    }
  }

  private readEnv(key: keyof AppEnv): string | undefined {
    const value = this.env[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private resolveProvider(env: AppEnv): MailProvider {
    const raw = (this.readEnv("MAIL_PROVIDER") || "").toLowerCase();
    if (raw === "resend" || raw === "smtp" || raw === "sendgrid") return raw;
    if (raw === "none") return "none";

    if (this.readEnv("RESEND_API_KEY") || this.readEnv("MAIL_RESEND_KEY")) {
      return "resend";
    }
    if (this.getSmtpHost()) return "smtp";
    if (this.readEnv("SENDGRID_API_KEY")) return "sendgrid";
    return "none";
  }

  private getSmtpHost() {
    return this.readEnv("MAIL_SMTP_HOST") || this.readEnv("SMTP_HOST");
  }

  private getSmtpPort() {
    return this.env.MAIL_SMTP_PORT || this.env.SMTP_PORT;
  }

  private getSmtpUser() {
    return this.readEnv("MAIL_SMTP_USER") || this.readEnv("SMTP_USER");
  }

  private getSmtpPass() {
    return this.readEnv("MAIL_SMTP_PASS") || this.readEnv("SMTP_PASS");
  }

  private getFromAddress() {
    const configured = this.readEnv("MAIL_FROM");
    if (configured) return configured;
    if (this.provider === "smtp") {
      const smtpUser = this.getSmtpUser();
      if (smtpUser) return smtpUser;
    }
    if (this.provider === "resend") {
      // Resend 支持使用官方测试域名发件（无需验证域名）
      return "onboarding@resend.dev";
    }
    return "no-reply@example.com";
  }

  private resolveSmtpDriver(host: string): SmtpDriver {
    const raw = (
      this.readEnv("MAIL_SMTP_DRIVER") ||
      this.readEnv("SMTP_DRIVER") ||
      ""
    ).toLowerCase();
    if (raw === "emailjs" || raw === "nodemailer") return raw;

    // Gmail 在部分运行时/网络环境下对 SMTP 握手/鉴权更挑剔，优先走 emailjs 分支
    const normalized = host.trim().toLowerCase();
    if (normalized === "smtp.gmail.com" || normalized === "smtp.googlemail.com") {
      return "emailjs";
    }

    return "nodemailer";
  }

  private async sendViaEmailjs(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    if (!this.emailjsOptions) {
      throw new Error("emailjs SMTP options are not initialized");
    }

    const { SMTPClient, Message } = await this.loadEmailjs();

    const headers: any = {
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text || ""
    };

    if (message.html) {
      headers.attachment = [
        {
          data: message.html,
          alternative: true,
          contentType: "text/html"
        }
      ];
    }

    const client = new SMTPClient(this.emailjsOptions);
    try {
      const msg = new Message(headers);
      if (typeof client.sendAsync === "function") {
        await client.sendAsync(msg);
      } else {
        await new Promise<void>((resolve, reject) => {
          client.send(msg, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } finally {
      if (client?.smtp?.close) client.smtp.close();
      else if (typeof client?.close === "function") client.close();
    }
  }

  private async loadEmailjs(): Promise<{ SMTPClient: any; Message: any }> {
    // emailjs@5 为 ESM-only；在 CommonJS 构建下需要用动态 import 载入
    this.emailjsModulePromise ||= (new Function(
      "moduleName",
      "return import(moduleName)"
    ) as any)("emailjs");
    const mod = await this.emailjsModulePromise;
    const resolved = mod?.default ?? mod;
    const SMTPClient = resolved?.SMTPClient ?? mod?.SMTPClient;
    const Message = resolved?.Message ?? mod?.Message;
    if (!SMTPClient || !Message) {
      throw new Error(
        "emailjs 未正确导出 SMTPClient/Message，请确认已安装 emailjs@5 且依赖未被错误打包"
      );
    }
    return { SMTPClient, Message };
  }

  private wrapSmtpError(error: unknown) {
    const host = this.getSmtpHost() || "";
    const message = (() => {
      if (error instanceof Error) return error.message;
      if (typeof error === "string") return error;
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    })();

    const isGmailHost = /(^|\.)gmail\.com$|(^|\.)googlemail\.com$|smtp\.gmail\.com|smtp\.googlemail\.com/i.test(
      host
    );
    const isBadCredentials =
      /\b535\b/.test(message) ||
      /BadCredentials/i.test(message) ||
      /Username and Password not accepted/i.test(message);

    if (isGmailHost && isBadCredentials) {
      return new Error(
        [
          "Gmail SMTP 鉴权失败（535 5.7.8 BadCredentials）。",
          "请确认：",
          "1) SMTP_USER 使用完整 Gmail 地址；",
          "2) SMTP_PASS 使用“应用专用密码”（需开启两步验证后生成），不要用账号登录密码；",
          "3) 建议使用 smtp.gmail.com:465（SMTP_SECURE=true）或 587（SMTP_STARTTLS=true）。",
          `原始错误：${message}`
        ].join("\n")
      );
    }

    if (error instanceof Error) return error;
    return new Error(message || "SMTP 发送失败");
  }

  private assertResendFromDomain(from: string) {
    const email = extractEmailAddress(from);
    if (!email) {
      throw new Error("MAIL_FROM 格式不正确，需为 email 或 `Name <email>`");
    }

    const domain = email.split("@")[1]?.toLowerCase() || "";
    if (!domain) {
      throw new Error("MAIL_FROM 格式不正确，缺少域名部分");
    }

    // Resend 不支持使用公共邮箱域名作为发件人域名（例如 gmail.com）
    if (domain === "gmail.com" || domain === "googlemail.com") {
      throw new Error(
        "Resend 不支持使用 gmail.com 作为发件人域名；请将 MAIL_FROM 改为已在 Resend 验证的自有域名邮箱，或测试用 onboarding@resend.dev"
      );
    }
  }
}

function extractEmailAddress(from: string) {
  const trimmed = from.trim();
  const match = /<([^>]+)>/.exec(trimmed);
  const candidate = (match?.[1] || trimmed).trim();
  if (!candidate) return null;
  // 粗略校验，避免误把 Name 当 email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
}
