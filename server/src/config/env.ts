import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18787),
  DB_HOST: z.string().min(1, "DB_HOST is required"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1, "DB_USER is required"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().min(1, "DB_NAME is required"),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  DB_TIMEZONE: z.string().default("+08:00"),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_PREFIX: z.string().default("soga:"),
  MAIL_PROVIDER: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_RESEND_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  MAIL_SMTP_HOST: z.string().optional(),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().optional(),
  MAIL_SMTP_USER: z.string().optional(),
  MAIL_SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_STARTTLS: z.string().optional(),
  SMTP_AUTH_TYPE: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  TWO_FACTOR_SECRET_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NODE_API_KEY: z.string().optional(),
  EPAY_KEY: z.string().optional(),
  EPAY_PID: z.string().optional(),
  EPAY_API_URL: z.string().optional(),
  EPAY_NOTIFY_URL: z.string().optional(),
  EPAY_RETURN_URL: z.string().optional(),
  PAYMENT_ALIPAY: z.string().optional(),
  PAYMENT_WXPAY: z.string().optional(),
  PAYMENT_CRYPTO: z.string().optional(),
  EPUSDT_TOKEN: z.string().optional(),
  EPUSDT_API_URL: z.string().optional(),
  EPUSDT_NOTIFY_URL: z.string().optional(),
  EPUSDT_RETURN_URL: z.string().optional(),
  SITE_NAME: z.string().optional(),
  SITE_URL: z.string().optional(),
  MAIL_VERIFICATION_EXPIRE_MINUTES: z.string().optional(),
  MAIL_VERIFICATION_COOLDOWN_SECONDS: z.string().optional(),
  MAIL_VERIFICATION_DAILY_LIMIT: z.string().optional(),
  MAIL_VERIFICATION_IP_HOURLY_LIMIT: z.string().optional(),
  MAIL_VERIFICATION_ATTEMPT_LIMIT: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const message = parsed.error.errors
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${message}`);
  }

  return parsed.data;
}
