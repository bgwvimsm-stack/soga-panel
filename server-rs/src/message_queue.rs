use std::collections::{HashMap, HashSet};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;

use crate::mail::EmailService;
use crate::state::AppState;

const STATUS_PENDING: i64 = 0;
const STATUS_PROCESSING: i64 = 1;
const STATUS_SENT: i64 = 2;
const STATUS_FAILED: i64 = 3;
const DEFAULT_PAGE_SIZE: i64 = 20;
const MAX_PAGE_SIZE: i64 = 200;
const DEFAULT_MAX_ATTEMPTS: i64 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum MessageChannel {
    Email,
    Bark,
    Telegram,
}

impl MessageChannel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Bark => "bark",
            Self::Telegram => "telegram",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "email" => Some(Self::Email),
            "bark" => Some(Self::Bark),
            "telegram" => Some(Self::Telegram),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AnnouncementQueueInput {
    pub announcement_id: i64,
    pub channels: Vec<MessageChannel>,
    pub min_class: i64,
    pub title: String,
    pub content: String,
    pub content_html: String,
    pub announcement_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnqueueResult {
    pub success: bool,
    pub queued_count: i64,
    pub channels: Vec<String>,
    pub min_class: i64,
    pub channel_stats: HashMap<String, i64>,
}

impl EnqueueResult {
    pub fn empty() -> Self {
        Self {
            success: true,
            queued_count: 0,
            channels: Vec::new(),
            min_class: 0,
            channel_stats: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueDispatchResult {
    pub success: bool,
    pub message: String,
    pub page_size: i64,
    pub fetched: i64,
    pub processed: i64,
    pub sent: i64,
    pub retrying: i64,
    pub failed: i64,
    pub skipped: i64,
}

#[derive(Debug, Clone)]
struct RecipientRow {
    user_id: i64,
    recipient: String,
}

#[derive(Debug, Clone)]
struct QueueMessageRow {
    id: i64,
    channel: String,
    recipient: String,
    payload: String,
    attempt_count: i64,
    max_attempts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QueuePayload {
    #[serde(rename = "type")]
    payload_type: String,
    site_name: Option<String>,
    site_url: Option<String>,
    announcement: QueueAnnouncement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QueueAnnouncement {
    id: i64,
    title: String,
    content: String,
    content_html: String,
    announcement_type: String,
}

pub fn has_channel_input(raw: Option<&Value>) -> bool {
    match raw {
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::String(text)) => !text.trim().is_empty(),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

pub fn normalize_channels(raw: Option<&Value>) -> Vec<MessageChannel> {
    let source = extract_channel_list(raw);
    if source.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<MessageChannel> = Vec::new();
    let mut seen: HashSet<MessageChannel> = HashSet::new();
    for item in source {
        if let Some(channel) = MessageChannel::from_str(&item) {
            if seen.insert(channel) {
                out.push(channel);
            }
        }
    }
    out
}

pub async fn enqueue_announcement_notifications(
    state: &AppState,
    input: AnnouncementQueueInput,
) -> Result<EnqueueResult, String> {
    if input.channels.is_empty() {
        return Ok(EnqueueResult::empty());
    }
    let min_class = input.min_class.max(0);

    let (site_name, site_url) = load_site_configs(state).await?;
    let payload = QueuePayload {
        payload_type: "announcement".to_string(),
        site_name: Some(site_name),
        site_url: Some(site_url),
        announcement: QueueAnnouncement {
            id: input.announcement_id,
            title: input.title,
            content: input.content,
            content_html: input.content_html,
            announcement_type: input.announcement_type,
        },
    };
    let payload_json = serde_json::to_string(&payload).map_err(|err| err.to_string())?;

    let mut queued_count: i64 = 0;
    let mut channel_stats: HashMap<String, i64> = HashMap::new();
    let mut channel_names: Vec<String> = Vec::new();

    for channel in input.channels {
        let recipients = get_recipients_by_channel(state, channel, min_class).await?;
        let channel_name = channel.as_str().to_string();
        channel_names.push(channel_name.clone());
        channel_stats.insert(channel_name.clone(), recipients.len() as i64);

        for recipient in recipients {
            sqlx::query(
                r#"
        INSERT INTO message_queue (
          announcement_id, user_id, channel, recipient, payload,
          status, attempt_count, max_attempts, scheduled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        "#,
            )
            .bind(input.announcement_id)
            .bind(recipient.user_id)
            .bind(channel.as_str())
            .bind(recipient.recipient)
            .bind(&payload_json)
            .bind(STATUS_PENDING)
            .bind(DEFAULT_MAX_ATTEMPTS)
            .execute(&state.db)
            .await
            .map_err(|err| err.to_string())?;
            queued_count += 1;
        }
    }

    Ok(EnqueueResult {
        success: true,
        queued_count,
        channels: channel_names,
        min_class,
        channel_stats,
    })
}

pub async fn process_pending_messages(state: &AppState) -> Result<QueueDispatchResult, String> {
    release_stale_processing_messages(state).await?;

    let page_size = get_queue_page_size(state).await?;
    let rows = sqlx::query(
        r#"
    SELECT id, announcement_id, user_id, channel, recipient, payload, attempt_count, max_attempts
    FROM message_queue
    WHERE status = ? AND scheduled_at <= CURRENT_TIMESTAMP
    ORDER BY id ASC
    LIMIT ?
    "#,
    )
    .bind(STATUS_PENDING)
    .bind(page_size)
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let messages: Vec<QueueMessageRow> = rows
        .into_iter()
        .map(|row| QueueMessageRow {
            id: row
                .try_get::<Option<i64>, _>("id")
                .ok()
                .flatten()
                .unwrap_or(0),
            channel: row
                .try_get::<Option<String>, _>("channel")
                .ok()
                .flatten()
                .unwrap_or_default(),
            recipient: row
                .try_get::<Option<String>, _>("recipient")
                .ok()
                .flatten()
                .unwrap_or_default(),
            payload: row
                .try_get::<Option<String>, _>("payload")
                .ok()
                .flatten()
                .unwrap_or_default(),
            attempt_count: row
                .try_get::<Option<i64>, _>("attempt_count")
                .ok()
                .flatten()
                .unwrap_or(0),
            max_attempts: row
                .try_get::<Option<i64>, _>("max_attempts")
                .ok()
                .flatten()
                .unwrap_or(DEFAULT_MAX_ATTEMPTS),
        })
        .collect();

    if messages.is_empty() {
        return Ok(QueueDispatchResult {
            success: true,
            message: "消息队列无待发送消息".to_string(),
            page_size,
            fetched: 0,
            processed: 0,
            sent: 0,
            retrying: 0,
            failed: 0,
            skipped: 0,
        });
    }

    let mut sent = 0;
    let mut retrying = 0;
    let mut failed = 0;
    let mut skipped = 0;

    for row in messages.iter() {
        let locked = lock_message(state, row.id).await?;
        if !locked {
            skipped += 1;
            continue;
        }

        match dispatch_message(state, row).await {
            Ok(_) => {
                mark_sent(state, row.id, row.attempt_count + 1).await?;
                sent += 1;
            }
            Err(err) => {
                let outcome = mark_failed_or_retry(state, row, &err).await?;
                if outcome == "retry" {
                    retrying += 1;
                } else {
                    failed += 1;
                }
            }
        }
    }

    Ok(QueueDispatchResult {
        success: true,
        message: format!("消息发送完成，成功 {sent}，重试中 {retrying}，失败 {failed}"),
        page_size,
        fetched: (sent + retrying + failed + skipped),
        processed: (sent + retrying + failed),
        sent,
        retrying,
        failed,
        skipped,
    })
}

async fn load_site_configs(state: &AppState) -> Result<(String, String), String> {
    let rows = sqlx::query(
        "SELECT `key`, `value` FROM system_configs WHERE `key` IN ('site_name', 'site_url')",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut map: HashMap<String, String> = HashMap::new();
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
        if !key.is_empty() {
            map.insert(key, value);
        }
    }

    let site_name = map
        .get("site_name")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| state.env.site_name.clone())
        .unwrap_or_else(|| "Soga Panel".to_string());
    let site_url = map
        .get("site_url")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| state.env.site_url.clone())
        .unwrap_or_default();

    Ok((site_name, site_url))
}

async fn get_queue_page_size(state: &AppState) -> Result<i64, String> {
    let row = sqlx::query(
        "SELECT value FROM system_configs WHERE `key` = 'message_queue_page_size' LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let raw_value = row
        .as_ref()
        .and_then(|value| value.try_get::<Option<String>, _>("value").ok().flatten())
        .unwrap_or_else(|| DEFAULT_PAGE_SIZE.to_string());
    let parsed = raw_value.parse::<i64>().unwrap_or(DEFAULT_PAGE_SIZE);
    if parsed <= 0 {
        return Ok(DEFAULT_PAGE_SIZE);
    }
    Ok(parsed.min(MAX_PAGE_SIZE))
}

async fn release_stale_processing_messages(state: &AppState) -> Result<(), String> {
    sqlx::query(
    r#"
    UPDATE message_queue
    SET status = ?, updated_at = CURRENT_TIMESTAMP, last_error = IFNULL(last_error, 'processing timeout')
    WHERE status = ? AND updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)
    "#
  )
  .bind(STATUS_PENDING)
  .bind(STATUS_PROCESSING)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
    Ok(())
}

async fn get_recipients_by_channel(
    state: &AppState,
    channel: MessageChannel,
    min_class: i64,
) -> Result<Vec<RecipientRow>, String> {
    let safe_min_class = min_class.max(0);
    let rows = match channel {
        MessageChannel::Email => sqlx::query(
            r#"
      SELECT id AS user_id, email AS recipient
      FROM users
      WHERE status = 1
        AND email IS NOT NULL
        AND email != ''
        AND (? <= 0 OR class >= ?)
      "#,
        )
        .bind(safe_min_class)
        .bind(safe_min_class)
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?,
        MessageChannel::Bark => sqlx::query(
            r#"
      SELECT id AS user_id, bark_key AS recipient
      FROM users
      WHERE status = 1
        AND bark_enabled = 1
        AND NOT (
          telegram_enabled = 1
          AND telegram_id IS NOT NULL
          AND telegram_id != ''
        )
        AND bark_key IS NOT NULL
        AND bark_key != ''
        AND (? <= 0 OR class >= ?)
      "#,
        )
        .bind(safe_min_class)
        .bind(safe_min_class)
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?,
        MessageChannel::Telegram => sqlx::query(
            r#"
      SELECT id AS user_id, telegram_id AS recipient
      FROM users
      WHERE status = 1
        AND telegram_enabled = 1
        AND telegram_id IS NOT NULL
        AND telegram_id != ''
        AND (? <= 0 OR class >= ?)
      "#,
        )
        .bind(safe_min_class)
        .bind(safe_min_class)
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?,
    };

    let recipients = rows
        .into_iter()
        .map(|row| RecipientRow {
            user_id: row
                .try_get::<Option<i64>, _>("user_id")
                .ok()
                .flatten()
                .unwrap_or(0),
            recipient: row
                .try_get::<Option<String>, _>("recipient")
                .ok()
                .flatten()
                .unwrap_or_default(),
        })
        .filter(|row| row.user_id > 0 && !row.recipient.trim().is_empty())
        .collect::<Vec<_>>();

    Ok(recipients)
}

async fn lock_message(state: &AppState, id: i64) -> Result<bool, String> {
    let result = sqlx::query(
        r#"
    UPDATE message_queue
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = ? AND scheduled_at <= CURRENT_TIMESTAMP
    "#,
    )
    .bind(STATUS_PROCESSING)
    .bind(id)
    .bind(STATUS_PENDING)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    Ok(result.rows_affected() > 0)
}

async fn dispatch_message(state: &AppState, row: &QueueMessageRow) -> Result<(), String> {
    let payload = parse_payload(&row.payload)?;
    let channel = row.channel.trim().to_lowercase();

    if channel == "email" {
        send_email_notification(state, row, &payload).await?;
        return Ok(());
    }
    if channel == "bark" {
        send_bark_notification(row, &payload).await?;
        return Ok(());
    }
    if channel == "telegram" {
        send_telegram_notification(state, row, &payload).await?;
        return Ok(());
    }

    Err(format!("不支持的通知通道: {}", row.channel))
}

async fn send_email_notification(
    state: &AppState,
    row: &QueueMessageRow,
    payload: &QueuePayload,
) -> Result<(), String> {
    let site_name = payload
        .site_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Soga Panel".to_string());
    let title = if payload.announcement.title.trim().is_empty() {
        "系统公告".to_string()
    } else {
        payload.announcement.title.clone()
    };
    let content = payload.announcement.content.clone();
    let content_html = payload.announcement.content_html.clone();

    let html_body = if content_html.trim().is_empty() {
        escape_html(&content).replace('\n', "<br/>")
    } else {
        content_html
    };
    let html = format!(
    "<h2>{}</h2><div>{}</div><hr/><p style=\"color:#666;font-size:12px;\">此邮件由 {} 自动发送</p>",
    escape_html(&title),
    html_body,
    escape_html(&site_name)
  );
    let text = format!("{title}\n\n{content}\n\n{site_name}");

    let email_service = EmailService::new(&state.env);
    email_service
        .send_mail(
            &row.recipient,
            &format!("[{site_name}] {title}"),
            &text,
            Some(&html),
        )
        .await
}

async fn send_bark_notification(
    row: &QueueMessageRow,
    payload: &QueuePayload,
) -> Result<(), String> {
    let site_name = payload
        .site_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Soga Panel".to_string());
    let site_url = payload.site_url.clone().unwrap_or_default();
    let title = if payload.announcement.title.trim().is_empty() {
        "系统公告".to_string()
    } else {
        payload.announcement.title.clone()
    };
    let markdown = build_bark_markdown(&payload.announcement.content);
    let preview = truncate(
        &payload
            .announcement
            .content
            .replace(char::is_whitespace, " ")
            .trim()
            .to_string(),
        180,
    );

    let mut endpoint = "https://api.day.app".to_string();
    let mut key_path = row.recipient.trim().to_string();
    if key_path.starts_with("http://") || key_path.starts_with("https://") {
        if let Ok(url) = Url::parse(&key_path) {
            endpoint = format!(
                "{}://{}",
                url.scheme(),
                url.host_str().unwrap_or("api.day.app")
            );
            let path = url.path().trim_start_matches('/').to_string();
            key_path = if path.is_empty() {
                "push".to_string()
            } else {
                path
            };
        }
    }

    let mut request_body = json!({
      "title": title,
      "body": if preview.is_empty() { "您有一条新的公告，请登录面板查看。".to_string() } else { preview },
      "markdown": markdown,
      "group": site_name
    });
    if !site_url.trim().is_empty() {
        let icon = format!("{}/favicon.ico", site_url.trim_end_matches('/'));
        request_body["icon"] = json!(icon);
        request_body["url"] = json!(site_url);
    }

    let response = reqwest::Client::new()
        .post(format!("{endpoint}/{key_path}"))
        .header("Content-Type", "application/json; charset=utf-8")
        .header("User-Agent", "Soga-Panel-Rust/1.0")
        .json(&request_body)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Bark 请求失败: HTTP {}", response.status()));
    }

    match response.json::<Value>().await {
        Ok(value) => {
            let code = value.get("code").and_then(Value::as_i64);
            if let Some(status_code) = code {
                if status_code != 200 {
                    let message = value
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    return Err(format!("Bark 返回错误: {message}"));
                }
            }
            Ok(())
        }
        Err(_) => Ok(()),
    }
}

async fn load_telegram_bot_configs(state: &AppState) -> Result<(String, String), String> {
    let rows = sqlx::query(
        "SELECT `key`, `value` FROM system_configs WHERE `key` IN ('telegram_bot_token','telegram_bot_api_base')",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;

    let mut token = String::new();
    let mut api_base = "https://api.telegram.org".to_string();
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
        }
    }

    Ok((token, api_base))
}

async fn send_telegram_notification(
    state: &AppState,
    row: &QueueMessageRow,
    payload: &QueuePayload,
) -> Result<(), String> {
    let (token, api_base) = load_telegram_bot_configs(state).await?;
    if token.trim().is_empty() {
        return Err("未配置 telegram_bot_token".to_string());
    }

    let site_name = payload
        .site_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Soga Panel".to_string());
    let site_url = payload.site_url.clone().unwrap_or_default();
    let title = if payload.announcement.title.trim().is_empty() {
        "系统公告".to_string()
    } else {
        payload.announcement.title.clone()
    };
    let content = payload.announcement.content.clone();
    let title_markdown = format!(
        "*{}*",
        escape_telegram_markdown_v2(&format!("【{}】{}", site_name, title))
    );
    let body_markdown = build_telegram_markdown_v2(&content);
    let url_part = if site_url.trim().is_empty() {
        String::new()
    } else {
        format!(
            "\n\n[打开面板]({})",
            escape_telegram_markdown_v2_url(site_url.trim())
        )
    };
    let text = if body_markdown.is_empty() {
        format!("{title_markdown}\n\n您有一条新的公告，请登录面板查看。{url_part}")
    } else {
        format!("{title_markdown}\n\n{body_markdown}{url_part}")
    };

    let endpoint = format!(
        "{}/bot{}/sendMessage",
        api_base.trim_end_matches('/'),
        token
    );
    let response = reqwest::Client::new()
        .post(endpoint.clone())
        .header("Content-Type", "application/json; charset=utf-8")
        .header("User-Agent", "Soga-Panel-Rust/1.0")
        .json(&json!({
            "chat_id": row.recipient,
            "text": text,
            "parse_mode": "MarkdownV2",
            "disable_web_page_preview": true
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let status = response.status();
    let value = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    let detail = value
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(true);

    if (!status.is_success() || !ok) && is_telegram_parse_error(&detail) {
        let fallback_text = build_telegram_plain_text(&site_name, &title, &content, &site_url);
        let fallback_response = reqwest::Client::new()
            .post(endpoint)
            .header("Content-Type", "application/json; charset=utf-8")
            .header("User-Agent", "Soga-Panel-Rust/1.0")
            .json(&json!({
                "chat_id": row.recipient,
                "text": fallback_text,
                "disable_web_page_preview": true
            }))
            .send()
            .await
            .map_err(|err| err.to_string())?;

        let fallback_status = fallback_response.status();
        let fallback_value = fallback_response
            .json::<Value>()
            .await
            .unwrap_or_else(|_| json!({}));
        let fallback_ok = fallback_value
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if fallback_status.is_success() && fallback_ok {
            return Ok(());
        }
        let fallback_detail = fallback_value
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!(
            "Telegram MarkdownV2与纯文本均发送失败: {}",
            fallback_detail
        ));
    }

    if !status.is_success() {
        return Err(format!(
            "Telegram 请求失败: HTTP {} - {}",
            status,
            if detail.is_empty() {
                "unknown"
            } else {
                &detail
            }
        ));
    }

    if !ok {
        return Err(format!(
            "Telegram 返回错误: {}",
            if detail.is_empty() {
                "unknown"
            } else {
                &detail
            }
        ));
    }

    Ok(())
}

async fn mark_sent(state: &AppState, id: i64, attempts: i64) -> Result<(), String> {
    sqlx::query(
    r#"
    UPDATE message_queue
    SET status = ?, sent_at = CURRENT_TIMESTAMP, attempt_count = ?, updated_at = CURRENT_TIMESTAMP, last_error = NULL
    WHERE id = ?
    "#
  )
  .bind(STATUS_SENT)
  .bind(attempts)
  .bind(id)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
    Ok(())
}

async fn mark_failed_or_retry(
    state: &AppState,
    row: &QueueMessageRow,
    error: &str,
) -> Result<&'static str, String> {
    let attempts = row.attempt_count + 1;
    let max_attempts = row.max_attempts.max(1);
    let error_message = truncate(error, 500);

    if attempts >= max_attempts {
        sqlx::query(
            r#"
      UPDATE message_queue
      SET status = ?, attempt_count = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#,
        )
        .bind(STATUS_FAILED)
        .bind(attempts)
        .bind(error_message)
        .bind(row.id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
        return Ok("failed");
    }

    let retry_delay_seconds = get_retry_delay_seconds(attempts);
    sqlx::query(
        r#"
    UPDATE message_queue
    SET status = ?, attempt_count = ?, last_error = ?,
        scheduled_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#,
    )
    .bind(STATUS_PENDING)
    .bind(attempts)
    .bind(error_message)
    .bind(retry_delay_seconds)
    .bind(row.id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
    Ok("retry")
}

fn parse_payload(raw: &str) -> Result<QueuePayload, String> {
    let payload = serde_json::from_str::<QueuePayload>(raw)
        .map_err(|err| format!("消息内容解析失败: {}", err))?;
    if payload.payload_type != "announcement" {
        return Err("消息内容解析失败: payload type mismatch".to_string());
    }
    Ok(payload)
}

fn get_retry_delay_seconds(attempts: i64) -> i64 {
    (attempts * 60).max(60).min(600)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn build_telegram_markdown_v2(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return String::new();
    }

    let mut out: Vec<String> = Vec::new();
    let mut in_code_block = false;

    for line in normalized.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            if !in_code_block {
                in_code_block = true;
                let lang = trimmed
                    .trim_start_matches("```")
                    .trim()
                    .chars()
                    .filter(|ch| {
                        ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '+' || *ch == '-'
                    })
                    .collect::<String>();
                out.push(format!("```{}", lang));
            } else {
                in_code_block = false;
                out.push("```".to_string());
            }
            continue;
        }

        if in_code_block {
            out.push(escape_telegram_code(line));
            continue;
        }

        if trimmed.is_empty() {
            out.push(String::new());
            continue;
        }

        if is_horizontal_rule(trimmed) {
            out.push("────────".to_string());
            continue;
        }

        let heading_level = trimmed.chars().take_while(|ch| *ch == '#').count();
        if (1..=6).contains(&heading_level) {
            let heading_text = trimmed[heading_level..].trim_start();
            if !heading_text.is_empty() {
                out.push(format!("*{}*", escape_telegram_markdown_v2(heading_text)));
                continue;
            }
        }

        if let Some(quote) = trimmed.strip_prefix('>') {
            out.push(format!(
                "❝ {}",
                escape_telegram_markdown_v2(quote.trim_start())
            ));
            continue;
        }

        let unordered_item = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "));
        if let Some(item) = unordered_item {
            out.push(format!("• {}", escape_telegram_markdown_v2(item)));
            continue;
        }

        if let Some((prefix, item)) = parse_ordered_markdown_line(trimmed) {
            out.push(format!(
                "{}\\. {}",
                escape_telegram_markdown_v2(prefix),
                escape_telegram_markdown_v2(item)
            ));
            continue;
        }

        out.push(escape_telegram_markdown_v2(line.trim_end()));
    }

    if in_code_block {
        out.push("```".to_string());
    }

    collapse_blank_lines(&out.join("\n"))
}

fn collapse_blank_lines(value: &str) -> String {
    let mut out = value.to_string();
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out.trim().to_string()
}

fn escape_telegram_markdown_v2(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if matches!(
            ch,
            '_' | '*'
                | '['
                | ']'
                | '('
                | ')'
                | '~'
                | '`'
                | '>'
                | '#'
                | '+'
                | '-'
                | '='
                | '|'
                | '{'
                | '}'
                | '.'
                | '!'
                | '\\'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn escape_telegram_markdown_v2_url(value: &str) -> String {
    value.replace('\\', "\\\\").replace(')', "\\)")
}

fn escape_telegram_code(value: &str) -> String {
    value.replace('\\', "\\\\").replace('`', "\\`")
}

fn parse_ordered_markdown_line(input: &str) -> Option<(&str, &str)> {
    let bytes = input.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx == 0 || idx + 1 >= bytes.len() {
        return None;
    }
    if bytes[idx] != b'.' || bytes[idx + 1] != b' ' {
        return None;
    }
    Some((&input[..idx], input[idx + 2..].trim()))
}

fn is_horizontal_rule(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.len() < 3 {
        return false;
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first != '-' && first != '*' && first != '_' {
        return false;
    }
    chars.all(|ch| ch == first)
}

fn is_telegram_parse_error(detail: &str) -> bool {
    let message = detail.trim().to_lowercase();
    message.contains("can't parse entities")
        || message.contains("unsupported start tag")
        || message.contains("unsupported end tag")
        || message.contains("can't find end tag")
        || message.contains("entity is not closed")
}

fn build_telegram_plain_text(
    site_name: &str,
    title: &str,
    content: &str,
    site_url: &str,
) -> String {
    let preview = truncate(content.trim(), 3200);
    if preview.trim().is_empty() {
        if site_url.trim().is_empty() {
            format!(
                "【{}】{}\n\n您有一条新的公告，请登录面板查看。",
                site_name, title
            )
        } else {
            format!(
                "【{}】{}\n\n您有一条新的公告，请登录面板查看。\n{}",
                site_name, title, site_url
            )
        }
    } else if site_url.trim().is_empty() {
        format!("【{}】{}\n\n{}", site_name, title, preview)
    } else {
        format!("【{}】{}\n\n{}\n\n{}", site_name, title, preview, site_url)
    }
}

fn truncate(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        return value.to_string();
    }
    let mut out = String::new();
    for ch in value.chars().take(max_len) {
        out.push(ch);
    }
    out.push_str("...");
    out
}

fn build_bark_markdown(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        "您有一条新的公告，请登录面板查看。".to_string()
    } else {
        trimmed.to_string()
    }
}

fn extract_channel_list(raw: Option<&Value>) -> Vec<String> {
    match raw {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                if let Some(text) = value.as_str() {
                    return Some(text.to_string());
                }
                if value.is_null() {
                    return None;
                }
                Some(value.to_string())
            })
            .collect(),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Vec::new();
            }
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                    if let Some(items) = value.as_array() {
                        return items
                            .iter()
                            .filter_map(|item| item.as_str().map(ToString::to_string))
                            .collect();
                    }
                }
            }
            trimmed
                .split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect()
        }
        _ => Vec::new(),
    }
}
