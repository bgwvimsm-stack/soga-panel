import type { Env } from "../types";
import { DatabaseService } from "../services/database";
import {
  createSystemConfigManager,
  type SystemConfigManager,
} from "../utils/systemConfig";
import { errorResponse, successResponse } from "../utils/response";
import { ensureNumber, ensureString } from "../utils/d1";

type DbRow = Record<string, unknown>;

type TelegramMessage = {
  text?: string;
  chat?: {
    id?: string | number | bigint;
  };
};

type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramBotConfig = {
  token: string;
  apiBase: string;
  webhookSecret: string;
};

type SubscriptionType =
  | "v2ray"
  | "clash"
  | "quantumultx"
  | "singbox"
  | "shadowrocket"
  | "surge";

type BoundTelegramUser = {
  id: number;
  email: string;
  username: string;
  class_level: number;
  class_expire_time: string;
  expire_time: string;
  transfer_total: number;
  transfer_enable: number;
  upload_today: number;
  download_today: number;
  status: number;
  token: string;
};

type TelegramCommand = {
  name: string;
  arg: string;
};

const TELEGRAM_START_CODE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const LINK_CALLBACK_PREFIX = "link:";
const SUBSCRIPTION_TYPES: { type: SubscriptionType; label: string }[] = [
  { type: "v2ray", label: "V2Ray" },
  { type: "clash", label: "Clash" },
  { type: "quantumultx", label: "QuantumultX" },
  { type: "singbox", label: "SingBox" },
  { type: "shadowrocket", label: "Shadowrocket" },
  { type: "surge", label: "Surge" },
];

export class TelegramAPI {
  private readonly env: Env;
  private readonly db: DatabaseService;
  private readonly configManager: SystemConfigManager;

  constructor(env: Env) {
    this.env = env;
    this.db = new DatabaseService(env.DB);
    this.configManager = createSystemConfigManager(env);
  }

  async handleWebhook(request: Request) {
    if (request.method === "GET") {
      return successResponse({ ok: true, message: "telegram webhook ready" });
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    try {
      await this.db.ensureUsersTelegramColumns();

      const botConfig = await this.loadBotConfig();
      const providedSecret =
        request.headers.get("X-Telegram-Bot-Api-Secret-Token")?.trim() || "";
      if (
        botConfig.webhookSecret &&
        botConfig.webhookSecret !== providedSecret
      ) {
        return errorResponse("Unauthorized webhook request", 403);
      }

      const payload = (await request.json().catch(() => null)) as
        | TelegramUpdate
        | null;
      if (!payload) {
        return successResponse({ ok: true, skipped: "invalid_json" });
      }

      if (payload.callback_query) {
        return await this.handleCallbackQuery(payload.callback_query, botConfig, request);
      }

      const message = this.extractMessage(payload);
      if (!message?.text) {
        return successResponse({ ok: true, skipped: "no_text_message" });
      }

      const chatId = this.normalizeChatId(message.chat?.id);
      if (!chatId) {
        return successResponse({ ok: true, skipped: "no_chat_id" });
      }

      const command = this.parseCommand(message.text);
      if (!command) {
        return successResponse({ ok: true, skipped: "not_command" });
      }

      if (command.name === "start") {
        return await this.handleStartCommand(chatId, command.arg, botConfig);
      }

      if (command.name === "info") {
        return await this.handleInfoCommand(chatId, botConfig);
      }

      if (command.name === "link") {
        return await this.handleSublinkCommand(chatId, botConfig, request);
      }
      if (command.name === "help") {
        return await this.handleHelpCommand(chatId, botConfig);
      }

      return successResponse({ ok: true, skipped: "unsupported_command" });
    } catch (error) {
      console.error("Telegram webhook error:", error);
      return errorResponse("Webhook 处理失败", 500);
    }
  }

  private async handleStartCommand(
    chatId: string,
    startPayload: string,
    botConfig: TelegramBotConfig
  ) {
    if (!startPayload) {
        await this.sendMessageIfEnabled(
          botConfig,
          chatId,
          "请先在面板中点击 Telegram 绑定，并复制 /start 绑定码后再发送。"
        );
      return successResponse({ ok: true, skipped: "missing_bind_code" });
    }

    if (!TELEGRAM_START_CODE_PATTERN.test(startPayload)) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "绑定码格式无效，请回到面板重新获取绑定码。"
      );
      return successResponse({ ok: true, skipped: "invalid_bind_code" });
    }

    const now = Math.floor(Date.now() / 1000);
    const user = await this.db.db
      .prepare(
        `
          SELECT id, username, telegram_bind_code_expires_at
          FROM users
          WHERE telegram_bind_code = ?
          LIMIT 1
        `
      )
      .bind(startPayload)
      .first<DbRow | null>();

    if (!user) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "绑定码无效或已失效，请回到面板刷新后重试。"
      );
      return successResponse({ ok: true, skipped: "bind_code_not_found" });
    }

    const userId = ensureNumber(user.id);
    const username = ensureString(user.username, "");
    const expiresAt = ensureNumber(user.telegram_bind_code_expires_at, 0);
    if (expiresAt <= now) {
      await this.db.db
        .prepare(
          `
            UPDATE users
            SET telegram_bind_code = NULL,
                telegram_bind_code_expires_at = NULL,
                updated_at = datetime('now', '+8 hours')
            WHERE id = ?
          `
        )
        .bind(userId)
        .run();

      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "绑定码已过期，请回到面板点击刷新绑定码后重试。"
      );
      return successResponse({ ok: true, skipped: "bind_code_expired" });
    }

    await this.db.db
      .prepare(
        `
          UPDATE users
          SET telegram_id = NULL,
              telegram_enabled = 0,
              updated_at = datetime('now', '+8 hours')
          WHERE telegram_id = ?
            AND id != ?
        `
      )
      .bind(chatId, userId)
      .run();

    await this.db.db
      .prepare(
        `
          UPDATE users
          SET telegram_id = ?,
              telegram_enabled = 1,
              telegram_bind_code = NULL,
              telegram_bind_code_expires_at = NULL,
              updated_at = datetime('now', '+8 hours')
          WHERE id = ?
        `
      )
      .bind(chatId, userId)
      .run();

    await this.sendMessageIfEnabled(
      botConfig,
      chatId,
      `绑定成功，账号 ${username || `#${userId}`} 已关联当前 Telegram。\n后续公告和每日流量提醒会通过机器人发送。`
    );

    return successResponse({ ok: true, bound_user_id: userId });
  }

  private async handleInfoCommand(chatId: string, botConfig: TelegramBotConfig) {
    const user = await this.getBoundUserByChatId(chatId);
    if (!user) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "当前 Telegram 未绑定账号，请先在面板点击绑定并发送 /start 绑定码。"
      );
      return successResponse({ ok: true, skipped: "not_bound" });
    }

    const total = Math.max(0, user.transfer_enable);
    const used = Math.max(0, user.transfer_total);
    const remain = total > 0 ? Math.max(0, total - used) : 0;
    const text = [
      "账号信息",
      `邮箱：${user.email || "-"}`,
      `用户名：${user.username || "-"}`,
      `会员等级：Lv.${user.class_level}`,
      `等级到期：${this.formatDateTime(user.class_expire_time)}`,
      `账户到期：${this.formatDateTime(user.expire_time)}`,
      "",
      "流量信息",
      `总额度：${total > 0 ? this.formatBytes(total) : "不限"}`,
      `已使用：${this.formatBytes(used)}`,
      `剩余流量：${total > 0 ? this.formatBytes(remain) : "不限"}`,
      `今日上行：${this.formatBytes(Math.max(0, user.upload_today))}`,
      `今日下行：${this.formatBytes(Math.max(0, user.download_today))}`,
    ].join("\n");

    await this.sendMessageIfEnabled(botConfig, chatId, text);
    return successResponse({ ok: true, command: "info", user_id: user.id });
  }

  private async handleSublinkCommand(
    chatId: string,
    botConfig: TelegramBotConfig,
    _request: Request
  ) {
    const user = await this.getBoundUserByChatId(chatId);
    if (!user) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "当前 Telegram 未绑定账号，请先在面板点击绑定并发送 /start 绑定码。"
      );
      return successResponse({ ok: true, skipped: "not_bound" });
    }
    if (user.status !== 1) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "当前账号不可用，请联系管理员。"
      );
      return successResponse({ ok: true, skipped: "user_disabled" });
    }
    if (!user.token) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "未获取到订阅 token，请在面板中重置订阅后重试。"
      );
      return successResponse({ ok: true, skipped: "missing_token" });
    }

    const inlineKeyboard = this.buildSubscriptionKeyboard();
    await this.sendMessageIfEnabled(
      botConfig,
      chatId,
      "请选择订阅类型，点击按钮后会返回对应订阅链接：",
      {
        inline_keyboard: inlineKeyboard,
      }
    );
    return successResponse({ ok: true, command: "link", user_id: user.id });
  }

  private async handleHelpCommand(chatId: string, botConfig: TelegramBotConfig) {
    await this.sendMessageIfEnabled(botConfig, chatId, this.buildHelpText());
    return successResponse({ ok: true, command: "help" });
  }

  private async handleCallbackQuery(
    callbackQuery: TelegramCallbackQuery,
    botConfig: TelegramBotConfig,
    request: Request
  ) {
    const callbackId = ensureString(callbackQuery.id, "").trim();
    const data = ensureString(callbackQuery.data, "").trim();
    const chatId = this.normalizeChatId(callbackQuery.message?.chat?.id);

    if (!data.startsWith(LINK_CALLBACK_PREFIX)) {
      if (callbackId) {
        await this.answerCallbackQuery(botConfig, callbackId, "不支持的操作");
      }
      return successResponse({ ok: true, skipped: "unsupported_callback" });
    }
    if (!chatId) {
      if (callbackId) {
        await this.answerCallbackQuery(botConfig, callbackId, "未获取到聊天信息");
      }
      return successResponse({ ok: true, skipped: "callback_no_chat_id" });
    }

    const subType = data.slice(LINK_CALLBACK_PREFIX.length) as SubscriptionType;
    const target = SUBSCRIPTION_TYPES.find((item) => item.type === subType);
    if (!target) {
      if (callbackId) {
        await this.answerCallbackQuery(botConfig, callbackId, "不支持的订阅类型");
      }
      return successResponse({ ok: true, skipped: "invalid_subscription_type" });
    }

    const user = await this.getBoundUserByChatId(chatId);
    if (!user || !user.token) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "当前 Telegram 未绑定可用账号，请先绑定后重试。"
      );
      if (callbackId) {
        await this.answerCallbackQuery(botConfig, callbackId, "当前未绑定可用账号");
      }
      return successResponse({ ok: true, skipped: "not_bound_or_missing_token" });
    }
    if (user.status !== 1) {
      await this.sendMessageIfEnabled(
        botConfig,
        chatId,
        "当前账号不可用，请联系管理员。"
      );
      if (callbackId) {
        await this.answerCallbackQuery(botConfig, callbackId, "账号不可用");
      }
      return successResponse({ ok: true, skipped: "user_disabled" });
    }

    const baseUrl = await this.resolveSubscriptionBaseUrl(request);
    const link = this.buildSubscriptionLink(baseUrl, target.type, user.token);
    await this.sendMessageIfEnabled(
      botConfig,
      chatId,
      `${target.label} 订阅链接：\n${link}`
    );
    if (callbackId) {
      await this.answerCallbackQuery(botConfig, callbackId, `已返回 ${target.label} 链接`);
    }
    return successResponse({
      ok: true,
      command: "link_callback",
      type: target.type,
      user_id: user.id,
    });
  }

  private extractMessage(update: TelegramUpdate): TelegramMessage | null {
    if (update.message) return update.message;
    if (update.edited_message) return update.edited_message;
    return null;
  }

  private parseCommand(text: string): TelegramCommand | null {
    const trimmed = text.trim();
    const matched = trimmed.match(
      /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i
    );
    if (!matched) {
      return null;
    }

    const name = ensureString(matched[1], "").trim().toLowerCase();
    const arg = ensureString(matched[2], "").trim().split(/\s+/)[0] || "";
    if (!name) return null;
    return { name, arg };
  }

  private normalizeChatId(raw: unknown): string {
    if (typeof raw === "string") {
      return raw.trim();
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.trunc(raw).toString();
    }
    if (typeof raw === "bigint") {
      return raw.toString();
    }
    return "";
  }

  private async loadBotConfig(): Promise<TelegramBotConfig> {
    const token =
      (
        await this.configManager.getSystemConfig(
          "telegram_bot_token",
          ensureString(this.env.TELEGRAM_BOT_TOKEN, "")
        )
      )?.trim() || "";
    const apiBase =
      (
        await this.configManager.getSystemConfig(
          "telegram_bot_api_base",
          "https://api.telegram.org"
        )
      )?.trim() || "https://api.telegram.org";
    const webhookSecret =
      (
        await this.configManager.getSystemConfig(
          "telegram_webhook_secret",
          ensureString(this.env.TELEGRAM_WEBHOOK_SECRET, "")
        )
      )?.trim() || "";

    return {
      token,
      apiBase,
      webhookSecret,
    };
  }

  private async getBoundUserByChatId(chatId: string): Promise<BoundTelegramUser | null> {
    const user = await this.db.db
      .prepare(
        `
        SELECT id, email, username, class AS class_level, class_expire_time, expire_time,
               transfer_total, transfer_enable, upload_today, download_today, status, token
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `
      )
      .bind(chatId)
      .first<DbRow | null>();
    if (!user) return null;

    return {
      id: ensureNumber(user.id, 0),
      email: ensureString(user.email, ""),
      username: ensureString(user.username, ""),
      class_level: ensureNumber(user.class_level, 0),
      class_expire_time: ensureString(user.class_expire_time, ""),
      expire_time: ensureString(user.expire_time, ""),
      transfer_total: ensureNumber(user.transfer_total, 0),
      transfer_enable: ensureNumber(user.transfer_enable, 0),
      upload_today: ensureNumber(user.upload_today, 0),
      download_today: ensureNumber(user.download_today, 0),
      status: ensureNumber(user.status, 0),
      token: ensureString(user.token, ""),
    };
  }

  private buildSubscriptionKeyboard() {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < SUBSCRIPTION_TYPES.length; i += 2) {
      const left = SUBSCRIPTION_TYPES[i];
      const right = SUBSCRIPTION_TYPES[i + 1];
      const row: { text: string; callback_data: string }[] = [
        {
          text: left.label,
          callback_data: `${LINK_CALLBACK_PREFIX}${left.type}`,
        },
      ];
      if (right) {
        row.push({
          text: right.label,
          callback_data: `${LINK_CALLBACK_PREFIX}${right.type}`,
        });
      }
      rows.push(row);
    }
    return rows;
  }

  private buildHelpText(): string {
    return [
      "可用命令：",
      "/info - 查看账号信息和流量信息",
      "/link - 返回订阅链接按钮",
      "/help - 显示帮助",
      "",
      "首次绑定：",
      "在面板复制绑定命令后，发送 /start <绑定码> 完成绑定。",
    ].join("\n");
  }

  private async resolveSubscriptionBaseUrl(request: Request): Promise<string> {
    const subscriptionUrl = (
      await this.configManager.getSystemConfig("subscription_url", "")
    )
      .trim();
    if (subscriptionUrl) {
      return subscriptionUrl.replace(/\/+$/, "");
    }

    const siteUrl = (
      await this.configManager.getSystemConfig(
        "site_url",
        ensureString(this.env.SITE_URL, "")
      )
    ).trim();
    if (siteUrl) {
      return siteUrl.replace(/\/+$/, "");
    }

    return new URL(request.url).origin.replace(/\/+$/, "");
  }

  private buildSubscriptionLink(baseUrl: string, type: SubscriptionType, token: string): string {
    return `${baseUrl}/api/subscription/${type}?token=${encodeURIComponent(token)}`;
  }

  private formatDateTime(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "永久";
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return trimmed;
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  private async sendMessageIfEnabled(
    botConfig: TelegramBotConfig,
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>
  ) {
    if (!botConfig.token) {
      return;
    }

    try {
      const endpoint = `${botConfig.apiBase.replace(/\/+$/, "")}/bot${botConfig.token}/sendMessage`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "Soga-Panel/1.0",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
      if (!response.ok) {
        console.error(
          "Telegram webhook reply failed:",
          response.status,
          await response.text().catch(() => "")
        );
      }
    } catch (error) {
      console.error("Telegram webhook reply error:", error);
    }
  }

  private async answerCallbackQuery(
    botConfig: TelegramBotConfig,
    callbackQueryId: string,
    text?: string
  ) {
    if (!botConfig.token || !callbackQueryId) {
      return;
    }

    try {
      const endpoint = `${botConfig.apiBase.replace(/\/+$/, "")}/bot${botConfig.token}/answerCallbackQuery`;
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "Soga-Panel/1.0",
        },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text || "",
          show_alert: false,
        }),
      });
    } catch (error) {
      console.error("Telegram answerCallbackQuery error:", error);
    }
  }
}
