use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{NaiveDateTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use urlencoding::encode;

use crate::response::{error, success};
use crate::state::AppState;

const TELEGRAM_BIND_CODE_MIN_LEN: usize = 8;
const TELEGRAM_BIND_CODE_MAX_LEN: usize = 64;
const LINK_CALLBACK_PREFIX: &str = "link:";

struct TelegramBotConfig {
    token: String,
    api_base: String,
    webhook_secret: String,
}

struct ParsedCommand {
    name: String,
    arg: String,
}

#[derive(Clone)]
struct BoundTelegramUser {
    id: i64,
    email: String,
    username: String,
    class_level: i64,
    class_expire_time: Option<NaiveDateTime>,
    expire_time: Option<NaiveDateTime>,
    transfer_total: i64,
    transfer_enable: i64,
    upload_today: i64,
    download_today: i64,
    status: i64,
    token: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/webhook", get(get_webhook))
        .route("/webhook", post(post_webhook))
}

async fn get_webhook() -> Response {
    success(
        json!({ "ok": true, "message": "telegram webhook ready" }),
        "Success",
    )
    .into_response()
}

async fn post_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(update): Json<Value>,
) -> Response {
    let config = match load_telegram_bot_config(&state).await {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None),
    };

    if !config.webhook_secret.is_empty() {
        let provided = headers
            .get("x-telegram-bot-api-secret-token")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .unwrap_or("");
        if provided != config.webhook_secret {
            return error(StatusCode::FORBIDDEN, "Unauthorized webhook request", None);
        }
    }

    if let Some(callback_query) = update.get("callback_query") {
        return match handle_callback_query(&state, &config, callback_query).await {
            Ok(payload) => success(payload, "Success").into_response(),
            Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, &message, None),
        };
    }

    let message = match extract_message(&update) {
        Some(value) => value,
        None => {
            return success(json!({ "ok": true, "skipped": "no_message" }), "Success")
                .into_response();
        }
    };
    let text = message
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if text.is_empty() {
        return success(json!({ "ok": true, "skipped": "empty_text" }), "Success").into_response();
    }

    let chat_id = message
        .get("chat")
        .and_then(|chat| chat.get("id"))
        .and_then(value_to_chat_id);
    let chat_id = match chat_id {
        Some(value) => value,
        None => {
            return success(
                json!({ "ok": true, "skipped": "invalid_chat_id" }),
                "Success",
            )
            .into_response();
        }
    };

    let command = match parse_command(text) {
        Some(value) => value,
        None => {
            return success(json!({ "ok": true, "skipped": "not_command" }), "Success")
                .into_response();
        }
    };

    let result = match command.name.as_str() {
        "start" => handle_start_command(&state, &config, &chat_id, &command.arg).await,
        "info" => handle_info_command(&state, &config, &chat_id).await,
        "link" => handle_sublink_command(&state, &config, &chat_id).await,
        "help" => handle_help_command(&config, &chat_id).await,
        _ => Ok(json!({ "ok": true, "skipped": "unsupported_command" })),
    };

    match result {
        Ok(payload) => success(payload, "Success").into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, &message, None),
    }
}

async fn handle_start_command(
    state: &AppState,
    config: &TelegramBotConfig,
    chat_id: &str,
    bind_code: &str,
) -> Result<Value, String> {
    let bind_code = bind_code.trim();
    if bind_code.is_empty() {
        let _ = send_telegram_message(
            config,
            chat_id,
            "请先在面板中点击 Telegram 绑定，并复制 /start 绑定码后再发送。",
            None,
        )
        .await;
        return Ok(json!({ "ok": true, "skipped": "missing_bind_code" }));
    }
    if !is_valid_bind_code(bind_code) {
        let _ = send_telegram_message(
            config,
            chat_id,
            "绑定码格式无效，请回到面板刷新绑定码后重试。",
            None,
        )
        .await;
        return Ok(json!({ "ok": true, "skipped": "invalid_bind_code" }));
    }

    let row = sqlx::query(
        "SELECT id, username, telegram_bind_code_expires_at FROM users WHERE telegram_bind_code = ? LIMIT 1",
    )
    .bind(bind_code)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let row = match row {
        Some(value) => value,
        None => {
            let _ = send_telegram_message(
                config,
                chat_id,
                "绑定码无效或已失效，请回到面板重新获取绑定码。",
                None,
            )
            .await;
            return Ok(json!({ "ok": true, "skipped": "bind_code_not_found" }));
        }
    };

    let user_id = row
        .try_get::<Option<i64>, _>("id")
        .unwrap_or(Some(0))
        .unwrap_or(0);
    let username = row
        .try_get::<Option<String>, _>("username")
        .ok()
        .flatten()
        .unwrap_or_default();
    let expires_at = row
        .try_get::<Option<i64>, _>("telegram_bind_code_expires_at")
        .unwrap_or(Some(0))
        .unwrap_or(0);

    let now = Utc::now().timestamp();
    if expires_at <= now {
        sqlx::query(
            r#"
            UPDATE users
            SET telegram_bind_code = NULL,
                telegram_bind_code_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        "#,
        )
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;

        let _ = send_telegram_message(
            config,
            chat_id,
            "绑定码已过期，请回到面板点击“刷新绑定码”后重试。",
            None,
        )
        .await;
        return Ok(json!({ "ok": true, "skipped": "bind_code_expired" }));
    }

    sqlx::query(
        r#"
        UPDATE users
        SET telegram_id = NULL,
            telegram_enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = ?
          AND id != ?
    "#,
    )
    .bind(chat_id)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        r#"
        UPDATE users
        SET telegram_id = ?,
            telegram_enabled = 1,
            telegram_bind_code = NULL,
            telegram_bind_code_expires_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    "#,
    )
    .bind(chat_id)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let account_name = if username.trim().is_empty() {
        format!("#{user_id}")
    } else {
        username
    };
    let _ = send_telegram_message(
        config,
        chat_id,
        &format!(
            "绑定成功，账号 {} 已关联当前 Telegram。\n后续公告和每日流量提醒会通过机器人发送。",
            account_name
        ),
        None,
    )
    .await;

    Ok(json!({ "ok": true, "bound_user_id": user_id }))
}

async fn handle_info_command(
    state: &AppState,
    config: &TelegramBotConfig,
    chat_id: &str,
) -> Result<Value, String> {
    let user = match fetch_bound_user_by_chat_id(state, chat_id).await? {
        Some(value) => value,
        None => {
            let _ = send_telegram_message(
                config,
                chat_id,
                "当前 Telegram 未绑定账号，请先在面板点击绑定并发送 /start 绑定码。",
                None,
            )
            .await;
            return Ok(json!({ "ok": true, "skipped": "not_bound" }));
        }
    };

    let total = user.transfer_enable.max(0);
    let used = user.transfer_total.max(0);
    let remain = if total > 0 { (total - used).max(0) } else { 0 };
    let text = [
        "账号信息".to_string(),
        format!(
            "邮箱：{}",
            if user.email.is_empty() {
                "-"
            } else {
                &user.email
            }
        ),
        format!(
            "用户名：{}",
            if user.username.is_empty() {
                "-"
            } else {
                &user.username
            }
        ),
        format!("会员等级：Lv.{}", user.class_level),
        format!("等级到期：{}", format_datetime_text(user.class_expire_time)),
        format!("账户到期：{}", format_datetime_text(user.expire_time)),
        "".to_string(),
        "流量信息".to_string(),
        format!(
            "总额度：{}",
            if total > 0 {
                format_bytes(total)
            } else {
                "不限".to_string()
            }
        ),
        format!("已使用：{}", format_bytes(used)),
        format!(
            "剩余流量：{}",
            if total > 0 {
                format_bytes(remain)
            } else {
                "不限".to_string()
            }
        ),
        format!("今日上行：{}", format_bytes(user.upload_today.max(0))),
        format!("今日下行：{}", format_bytes(user.download_today.max(0))),
    ]
    .join("\n");

    let _ = send_telegram_message(config, chat_id, &text, None).await;
    Ok(json!({ "ok": true, "command": "info", "user_id": user.id }))
}

async fn handle_sublink_command(
    state: &AppState,
    config: &TelegramBotConfig,
    chat_id: &str,
) -> Result<Value, String> {
    let user = match fetch_bound_user_by_chat_id(state, chat_id).await? {
        Some(value) => value,
        None => {
            let _ = send_telegram_message(
                config,
                chat_id,
                "当前 Telegram 未绑定账号，请先在面板点击绑定并发送 /start 绑定码。",
                None,
            )
            .await;
            return Ok(json!({ "ok": true, "skipped": "not_bound" }));
        }
    };

    if user.status != 1 {
        let _ =
            send_telegram_message(config, chat_id, "当前账号不可用，请联系管理员。", None).await;
        return Ok(json!({ "ok": true, "skipped": "user_disabled" }));
    }

    if user.token.trim().is_empty() {
        let _ = send_telegram_message(
            config,
            chat_id,
            "未获取到订阅 token，请在面板中重置订阅后重试。",
            None,
        )
        .await;
        return Ok(json!({ "ok": true, "skipped": "missing_token" }));
    }

    let _ = send_telegram_message(
        config,
        chat_id,
        "请选择订阅类型，点击按钮后会返回对应订阅链接：",
        Some(build_sublink_keyboard()),
    )
    .await;

    Ok(json!({ "ok": true, "command": "link", "user_id": user.id }))
}

async fn handle_help_command(config: &TelegramBotConfig, chat_id: &str) -> Result<Value, String> {
    let _ = send_telegram_message(config, chat_id, &build_help_text(), None).await;
    Ok(json!({ "ok": true, "command": "help" }))
}

async fn handle_callback_query(
    state: &AppState,
    config: &TelegramBotConfig,
    callback_query: &Value,
) -> Result<Value, String> {
    let callback_id = callback_query
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let callback_data = callback_query
        .get("data")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let chat_id = callback_query
        .get("message")
        .and_then(|message| message.get("chat"))
        .and_then(|chat| chat.get("id"))
        .and_then(value_to_chat_id)
        .unwrap_or_default();

    if !callback_data.starts_with(LINK_CALLBACK_PREFIX) {
        if !callback_id.is_empty() {
            let _ = answer_callback_query(config, &callback_id, Some("不支持的操作")).await;
        }
        return Ok(json!({ "ok": true, "skipped": "unsupported_callback" }));
    }

    if chat_id.is_empty() {
        if !callback_id.is_empty() {
            let _ = answer_callback_query(config, &callback_id, Some("未获取到聊天信息")).await;
        }
        return Ok(json!({ "ok": true, "skipped": "callback_no_chat_id" }));
    }

    let sub_type_raw = &callback_data[LINK_CALLBACK_PREFIX.len()..];
    let sub_type = match parse_subscription_type(sub_type_raw) {
        Some(value) => value,
        None => {
            if !callback_id.is_empty() {
                let _ = answer_callback_query(config, &callback_id, Some("不支持的订阅类型")).await;
            }
            return Ok(json!({ "ok": true, "skipped": "invalid_subscription_type" }));
        }
    };

    let user = match fetch_bound_user_by_chat_id(state, &chat_id).await? {
        Some(value) => value,
        None => {
            let _ = send_telegram_message(
                config,
                &chat_id,
                "当前 Telegram 未绑定账号，请先在面板点击绑定并发送 /start 绑定码。",
                None,
            )
            .await;
            if !callback_id.is_empty() {
                let _ = answer_callback_query(config, &callback_id, Some("当前未绑定账号")).await;
            }
            return Ok(json!({ "ok": true, "skipped": "not_bound" }));
        }
    };

    if user.status != 1 {
        let _ =
            send_telegram_message(config, &chat_id, "当前账号不可用，请联系管理员。", None).await;
        if !callback_id.is_empty() {
            let _ = answer_callback_query(config, &callback_id, Some("账号不可用")).await;
        }
        return Ok(json!({ "ok": true, "skipped": "user_disabled" }));
    }

    if user.token.trim().is_empty() {
        let _ = send_telegram_message(
            config,
            &chat_id,
            "未获取到订阅 token，请在面板中重置订阅后重试。",
            None,
        )
        .await;
        if !callback_id.is_empty() {
            let _ = answer_callback_query(config, &callback_id, Some("缺少订阅 token")).await;
        }
        return Ok(json!({ "ok": true, "skipped": "missing_token" }));
    }

    let base_url = resolve_subscription_base_url(state).await?;
    let link = build_subscription_link(&base_url, sub_type, &user.token);
    let label = subscription_label(sub_type);
    let _ = send_telegram_message(
        config,
        &chat_id,
        &format!("{} 订阅链接：\n{}", label, link),
        None,
    )
    .await;

    if !callback_id.is_empty() {
        let _ = answer_callback_query(
            config,
            &callback_id,
            Some(&format!("已返回 {} 链接", label)),
        )
        .await;
    }

    Ok(json!({
      "ok": true,
      "command": "link_callback",
      "type": sub_type,
      "user_id": user.id
    }))
}

async fn load_telegram_bot_config(state: &AppState) -> Result<TelegramBotConfig, String> {
    let rows = sqlx::query(
        "SELECT `key`, `value` FROM system_configs WHERE `key` IN ('telegram_bot_token','telegram_bot_api_base','telegram_webhook_secret')",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut token = String::new();
    let mut api_base = "https://api.telegram.org".to_string();
    let mut webhook_secret = String::new();

    for row in rows {
        let key = row
            .try_get::<Option<String>, _>("key")
            .ok()
            .flatten()
            .unwrap_or_default();
        let value = row
            .try_get::<Option<String>, _>("value")
            .ok()
            .flatten()
            .unwrap_or_default();

        if key == "telegram_bot_token" && !value.trim().is_empty() {
            token = value.trim().to_string();
        } else if key == "telegram_bot_api_base" && !value.trim().is_empty() {
            api_base = value.trim().to_string();
        } else if key == "telegram_webhook_secret" && !value.trim().is_empty() {
            webhook_secret = value.trim().to_string();
        }
    }

    Ok(TelegramBotConfig {
        token,
        api_base,
        webhook_secret,
    })
}

async fn fetch_bound_user_by_chat_id(
    state: &AppState,
    chat_id: &str,
) -> Result<Option<BoundTelegramUser>, String> {
    let row = sqlx::query(
        r#"
        SELECT id, email, username, class AS class_level, class_expire_time, expire_time,
               transfer_total, transfer_enable, upload_today, download_today, status, token
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
    "#,
    )
    .bind(chat_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(row.map(|row| BoundTelegramUser {
        id: row
            .try_get::<Option<i64>, _>("id")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        email: row
            .try_get::<Option<String>, _>("email")
            .ok()
            .flatten()
            .unwrap_or_default(),
        username: row
            .try_get::<Option<String>, _>("username")
            .ok()
            .flatten()
            .unwrap_or_default(),
        class_level: row
            .try_get::<Option<i64>, _>("class_level")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        class_expire_time: row
            .try_get::<Option<NaiveDateTime>, _>("class_expire_time")
            .ok()
            .flatten(),
        expire_time: row
            .try_get::<Option<NaiveDateTime>, _>("expire_time")
            .ok()
            .flatten(),
        transfer_total: row
            .try_get::<Option<i64>, _>("transfer_total")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        transfer_enable: row
            .try_get::<Option<i64>, _>("transfer_enable")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        upload_today: row
            .try_get::<Option<i64>, _>("upload_today")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        download_today: row
            .try_get::<Option<i64>, _>("download_today")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        status: row
            .try_get::<Option<i64>, _>("status")
            .unwrap_or(Some(0))
            .unwrap_or(0),
        token: row
            .try_get::<Option<String>, _>("token")
            .ok()
            .flatten()
            .unwrap_or_default(),
    }))
}

async fn resolve_subscription_base_url(state: &AppState) -> Result<String, String> {
    let rows = sqlx::query(
        "SELECT `key`, `value` FROM system_configs WHERE `key` IN ('subscription_url','site_url')",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut subscription_url = String::new();
    let mut site_url = String::new();
    for row in rows {
        let key = row
            .try_get::<Option<String>, _>("key")
            .ok()
            .flatten()
            .unwrap_or_default();
        let value = row
            .try_get::<Option<String>, _>("value")
            .ok()
            .flatten()
            .unwrap_or_default();
        if key == "subscription_url" && !value.trim().is_empty() {
            subscription_url = value.trim().to_string();
        } else if key == "site_url" && !value.trim().is_empty() {
            site_url = value.trim().to_string();
        }
    }

    let base = if !subscription_url.is_empty() {
        subscription_url
    } else if !site_url.is_empty() {
        site_url
    } else {
        state.env.site_url.clone().unwrap_or_default()
    };

    Ok(base.trim_end_matches('/').to_string())
}

fn extract_message(update: &Value) -> Option<&Value> {
    update
        .get("message")
        .or_else(|| update.get("edited_message"))
}

fn parse_command(text: &str) -> Option<ParsedCommand> {
    let trimmed = text.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let command_token = parts.next()?.trim_start_matches('/');
    let command_name = command_token
        .split('@')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if command_name.is_empty() {
        return None;
    }

    let arg = parts.next().unwrap_or("").trim().to_string();
    Some(ParsedCommand {
        name: command_name,
        arg,
    })
}

fn value_to_chat_id(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    None
}

fn is_valid_bind_code(code: &str) -> bool {
    let len = code.len();
    if !(TELEGRAM_BIND_CODE_MIN_LEN..=TELEGRAM_BIND_CODE_MAX_LEN).contains(&len) {
        return false;
    }
    code.bytes()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
}

fn parse_subscription_type(value: &str) -> Option<&'static str> {
    match value {
        "v2ray" => Some("v2ray"),
        "clash" => Some("clash"),
        "quantumultx" => Some("quantumultx"),
        "singbox" => Some("singbox"),
        "shadowrocket" => Some("shadowrocket"),
        "surge" => Some("surge"),
        _ => None,
    }
}

fn subscription_label(value: &str) -> &'static str {
    match value {
        "v2ray" => "V2Ray",
        "clash" => "Clash",
        "quantumultx" => "QuantumultX",
        "singbox" => "SingBox",
        "shadowrocket" => "Shadowrocket",
        "surge" => "Surge",
        _ => "Unknown",
    }
}

fn build_sublink_keyboard() -> Value {
    json!({
      "inline_keyboard": [
        [
          { "text": "V2Ray", "callback_data": "link:v2ray" },
          { "text": "Clash", "callback_data": "link:clash" }
        ],
        [
          { "text": "QuantumultX", "callback_data": "link:quantumultx" },
          { "text": "SingBox", "callback_data": "link:singbox" }
        ],
        [
          { "text": "Shadowrocket", "callback_data": "link:shadowrocket" },
          { "text": "Surge", "callback_data": "link:surge" }
        ]
      ]
    })
}

fn build_help_text() -> String {
    [
        "可用命令：",
        "/info - 查看账号信息和流量信息",
        "/link - 返回订阅链接按钮",
        "/help - 显示帮助",
        "",
        "首次绑定：",
        "在面板复制绑定命令后，发送 /start <绑定码> 完成绑定。",
    ]
    .join("\n")
}

fn build_subscription_link(base_url: &str, sub_type: &str, token: &str) -> String {
    let encoded_token = encode(token).to_string();
    if base_url.trim().is_empty() {
        return format!("/api/subscription/{}?token={}", sub_type, encoded_token);
    }
    format!(
        "{}/api/subscription/{}?token={}",
        base_url.trim_end_matches('/'),
        sub_type,
        encoded_token
    )
}

fn format_datetime_text(value: Option<NaiveDateTime>) -> String {
    match value {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => "永久".to_string(),
    }
}

fn format_bytes(bytes: i64) -> String {
    if bytes <= 0 {
        return "0 B".to_string();
    }

    let units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut value = bytes as f64;
    let mut unit_index = 0usize;
    while value >= 1024.0 && unit_index < units.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }

    let precision = if value >= 100.0 {
        0
    } else if value >= 10.0 {
        1
    } else {
        2
    };
    format!("{:.*} {}", precision, value, units[unit_index])
}

async fn send_telegram_message(
    config: &TelegramBotConfig,
    chat_id: &str,
    text: &str,
    reply_markup: Option<Value>,
) -> Result<(), String> {
    if config.token.trim().is_empty() {
        return Ok(());
    }
    if chat_id.trim().is_empty() {
        return Ok(());
    }

    let endpoint = format!(
        "{}/bot{}/sendMessage",
        config.api_base.trim_end_matches('/'),
        config.token
    );

    let mut payload = json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true
    });
    if let Some(value) = reply_markup {
        payload["reply_markup"] = value;
    }

    let response = reqwest::Client::new()
        .post(endpoint)
        .header("User-Agent", "Soga-Panel-Server/1.0")
        .json(&payload)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Telegram 响应状态码异常: {}",
            response.status().as_u16()
        ));
    }

    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    if body.get("ok").and_then(Value::as_bool).unwrap_or(true) == false {
        let desc = body
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("未知错误");
        return Err(format!("Telegram API 返回失败: {desc}"));
    }

    Ok(())
}

async fn answer_callback_query(
    config: &TelegramBotConfig,
    callback_query_id: &str,
    text: Option<&str>,
) -> Result<(), String> {
    if config.token.trim().is_empty() || callback_query_id.trim().is_empty() {
        return Ok(());
    }

    let endpoint = format!(
        "{}/bot{}/answerCallbackQuery",
        config.api_base.trim_end_matches('/'),
        config.token
    );
    let payload = json!({
      "callback_query_id": callback_query_id,
      "text": text.unwrap_or(""),
      "show_alert": false
    });

    let response = reqwest::Client::new()
        .post(endpoint)
        .header("User-Agent", "Soga-Panel-Server/1.0")
        .json(&payload)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "answerCallbackQuery 失败，状态码: {}",
            response.status().as_u16()
        ));
    }

    Ok(())
}
