import type { AppEnv } from "../config/env";
import { Resend } from "resend";
import nodemailer from "nodemailer";

type SendMailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export class EmailService {
  private readonly env: AppEnv;
  private readonly provider: string | undefined;
  private readonly resend?: Resend;
  // 使用 any 避免与 nodemailer 类型命名空间冲突
  private readonly transporter?: any;

  constructor(env: AppEnv) {
    this.env = env;
    this.provider = env.MAIL_PROVIDER?.toLowerCase();

    if (this.provider === "resend") {
      const apiKey = env.RESEND_API_KEY || env.MAIL_RESEND_KEY;
      if (apiKey) {
        this.resend = new Resend(apiKey);
      }
    } else if (this.provider === "smtp" && env.MAIL_SMTP_HOST) {
      const secureEnv = (env.SMTP_SECURE || "").toLowerCase();
      const secure = secureEnv === "true" || secureEnv === "1";
      const port = env.MAIL_SMTP_PORT || (secure ? 465 : 587);
      const startTlsEnv = (env.SMTP_STARTTLS || "").toLowerCase();
      const requireTls =
        startTlsEnv !== ""
          ? startTlsEnv === "true" || startTlsEnv === "1"
          : !secure;
      const authTypeEnv = (env.SMTP_AUTH_TYPE || "").toLowerCase();
      const authMethod =
        authTypeEnv === "login" || authTypeEnv === "plain"
          ? authTypeEnv.toUpperCase()
          : undefined;

      this.transporter = nodemailer.createTransport({
        host: env.MAIL_SMTP_HOST,
        port,
        secure,
        auth:
          env.MAIL_SMTP_USER && env.MAIL_SMTP_PASS
            ? {
                user: env.MAIL_SMTP_USER,
                pass: env.MAIL_SMTP_PASS
              }
            : undefined,
        requireTLS: requireTls,
        ...(authMethod ? { authMethod } : {})
      });
    }
  }

  async sendMail(options: SendMailOptions) {
    const from = this.env.MAIL_FROM || "no-reply@example.com";

    if (this.provider === "resend" && this.resend) {
      await this.resend.emails.send({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text ?? "",
        html: options.html
      });
      return;
    }

    if (this.provider === "smtp" && this.transporter) {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text ?? "",
        html: options.html
      });
      return;
    }

    if (this.provider === "sendgrid" && this.env.SENDGRID_API_KEY) {
      await this.sendViaSendgrid({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        from
      });
      return;
    }

    console.warn("[mail] no provider configured, skip sending. subject:", options.subject);
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
}
