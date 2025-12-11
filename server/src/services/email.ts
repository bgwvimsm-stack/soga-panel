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
  private readonly resend?: Resend;
  private readonly transporter?: any;

  constructor(env: AppEnv) {
    this.env = env;
    const provider = env.MAIL_PROVIDER?.toLowerCase();

    if (provider === "resend" && env.MAIL_RESEND_KEY) {
      this.resend = new Resend(env.MAIL_RESEND_KEY);
    } else if (provider === "smtp" && env.MAIL_SMTP_HOST && env.MAIL_SMTP_USER) {
      this.transporter = nodemailer.createTransport({
        host: env.MAIL_SMTP_HOST,
        port: env.MAIL_SMTP_PORT || 465,
        secure: true,
        auth: {
          user: env.MAIL_SMTP_USER,
          pass: env.MAIL_SMTP_PASS
        }
      });
    }
  }

  async sendMail(options: SendMailOptions) {
    const from = this.env.MAIL_FROM || "no-reply@example.com";
    if (this.resend) {
      await this.resend.emails.send({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text ?? "",
        html: options.html
      });
      return;
    }

    if (this.transporter) {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text ?? "",
        html: options.html
      });
      return;
    }

    console.warn("[mail] no provider configured, skip sending. subject:", options.subject);
  }
}
