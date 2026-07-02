import { Resend } from "resend";
import { WorkerMailer, type WorkerMailerOptions } from "worker-mailer";
import type { Env } from "../types";
import { createSystemConfigManager, type SystemConfigManager } from "../utils/systemConfig";
import { getLogger, Logger } from "../utils/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  fromName?: string;
}

export type EmailProvider =
  | "resend"
  | "smtp"
  | "sendgrid"
  | "cloudflare"
  | "none";

/**
 * Cloudflare Email Sending 绑定的最小类型定义。
 * 通过在 wrangler 配置中声明 `send_email` 绑定后，可在 env.EMAIL 上调用 send()。
 * 参考：https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */
interface CloudflareSendEmailBinding {
  send(message: {
    to: string | string[];
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
  }): Promise<{ messageId?: string } | void>;
}

export class EmailService {
  private provider: EmailProvider;
  private fromEmail: string;
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly configManager: SystemConfigManager;
  private resendClient: Resend | null = null;

  constructor(env: Env) {
    this.env = env;
    const provider = (this.getEnv("MAIL_PROVIDER") || "none").toLowerCase();
    if (
      provider === "resend" ||
      provider === "smtp" ||
      provider === "sendgrid" ||
      provider === "cloudflare"
    ) {
      this.provider = provider;
    } else {
      this.provider = "none";
    }
    this.fromEmail = this.getEnv("MAIL_FROM") || "";
    this.logger = getLogger(this.env);
    this.configManager = createSystemConfigManager(env);
  }

  private getEnv(key: string): string | undefined {
    const value = this.env[key];
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private async getFromName(defaultName?: string) {
    if (defaultName) {
      return defaultName;
    }

    const siteName = await this.configManager.getSystemConfig(
      "site_name",
      this.getEnv("SITE_NAME") || "Soga Panel"
    );
    return siteName || "Soga Panel";
  }

  async sendEmail(message: EmailMessage) {
    if (this.provider === "none") {
      throw new Error("MAIL_PROVIDER is set to 'none', email sending is disabled");
    }

    if (!this.fromEmail) {
      throw new Error("MAIL_FROM is not configured");
    }

    const payload = {
      ...message,
      fromName: await this.getFromName(message.fromName),
    };

    if (this.provider === "smtp") {
      return await this.sendViaSmtp(payload);
    }

    if (this.provider === "sendgrid") {
      return await this.sendViaSendgrid(payload);
    }

    if (this.provider === "cloudflare") {
      return await this.sendViaCloudflare(payload);
    }

    // 默认使用 Resend
    return await this.sendViaResend(payload);
  }

  private async sendViaResend(message: EmailMessage) {
    const resend = this.getResendClient();

    const from = `${message.fromName} <${this.fromEmail}>`;
    const response = await resend.emails.send({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (response.error) {
      this.logger.error("Resend 邮件发送失败", response.error, {
        to: message.to,
        subject: message.subject,
      });
      throw new Error(
        `Resend API 调用失败: ${response.error.message || "Unknown error"}`
      );
    }

    this.logger.info("Resend 邮件发送成功", {
      to: message.to,
      subject: message.subject,
      id: response.data?.id,
    });

    return true;
  }

  private async sendViaCloudflare(message: EmailMessage) {
    const binding = this.env.EMAIL as CloudflareSendEmailBinding | undefined;
    if (!binding || typeof binding.send !== "function") {
      throw new Error(
        "Cloudflare Email Sending 绑定未配置：请在 wrangler 配置中声明 send_email 绑定（name = \"EMAIL\"），并对发件域名执行 `wrangler email sending enable <域名>`"
      );
    }

    const textContent =
      message.text ||
      (message.html
        ? message.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : undefined);

    try {
      const response = await binding.send({
        to: message.to,
        from: { email: this.fromEmail, name: message.fromName },
        subject: message.subject,
        html: message.html,
        text: textContent,
      });

      this.logger.info("Cloudflare 邮件发送成功", {
        to: message.to,
        subject: message.subject,
        messageId:
          response && typeof response === "object"
            ? response.messageId
            : undefined,
      });

      return true;
    } catch (error) {
      // Workers 绑定以 Error 抛出，error.code 为 E_* 错误码
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      this.logger.error("Cloudflare 邮件发送失败", error, {
        to: message.to,
        subject: message.subject,
        code,
      });
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cloudflare Email Sending 调用失败${code ? ` [${code}]` : ""}: ${detail}`
      );
    }
  }

  private async sendViaSmtp(message: EmailMessage) {
    const host = this.getEnv("SMTP_HOST");
    const secureEnv = (this.getEnv("SMTP_SECURE") || "false").toLowerCase();
    const secure = secureEnv === "true" || secureEnv === "1";
    const portEnv = this.getEnv("SMTP_PORT");
    const port = portEnv ? parseInt(portEnv, 10) : secure ? 465 : 587;
    const startTlsEnv = this.getEnv("SMTP_STARTTLS");
    const authTypeEnv = (this.getEnv("SMTP_AUTH_TYPE") || "").toLowerCase();
    const username = this.getEnv("SMTP_USER");
    const password = this.getEnv("SMTP_PASS");

    if (!host) {
      throw new Error("SMTP_HOST is not configured");
    }

    if (Number.isNaN(port)) {
      throw new Error("SMTP_PORT is invalid");
    }

    const options: WorkerMailerOptions = {
      host,
      port,
      secure,
      startTls:
        startTlsEnv !== undefined
          ? startTlsEnv.toLowerCase() === "true" || startTlsEnv === "1"
          : !secure,
      socketTimeoutMs: parseInt(this.getEnv("SMTP_SOCKET_TIMEOUT_MS") || "15000", 10),
      responseTimeoutMs: parseInt(this.getEnv("SMTP_RESPONSE_TIMEOUT_MS") || "15000", 10),
    };

    if (authTypeEnv === "login" || authTypeEnv === "plain") {
      options.authType = authTypeEnv;
    } else if (secure) {
      options.authType = "login";
    }

    if (username && password) {
      options.credentials = {
        username,
        password,
      };
    }

    const textContent =
      message.text ||
      (message.html
        ? message.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : undefined);

    await WorkerMailer.send(options, {
      from: { name: message.fromName, email: this.fromEmail },
      to: { email: message.to },
      subject: message.subject,
      text: textContent,
      html: message.html,
    });

    this.logger.info("SMTP 邮件发送成功", {
      to: message.to,
      subject: message.subject,
    });

    return true;
  }

  private getResendClient(): Resend {
    if (this.resendClient) {
      return this.resendClient;
    }

    const apiKey = this.getEnv("RESEND_API_KEY");
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    this.resendClient = new Resend(apiKey);
    return this.resendClient;
  }

  private async sendViaSendgrid(message: EmailMessage) {
    const apiKey = this.getEnv("SENDGRID_API_KEY");
    if (!apiKey) {
      throw new Error("SENDGRID_API_KEY is not configured");
    }

    const from = {
      email: this.fromEmail,
      name: message.fromName,
    };

    const content = [] as Array<{ type: string; value: string }>;
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
          subject: message.subject,
        },
      ],
      from,
      content,
    };

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      this.logger.error("SendGrid 邮件发送失败", null, {
        status: response.status,
        statusText: response.statusText,
        body,
        errorText,
      });
      throw new Error(`SendGrid API 调用失败: ${response.status} ${errorText}`);
    }

    this.logger.info("SendGrid 邮件发送成功", {
      to: message.to,
      subject: message.subject,
    });

    return true;
  }
}
