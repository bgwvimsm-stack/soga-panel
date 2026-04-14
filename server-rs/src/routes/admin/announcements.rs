use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::{Duration, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::message_queue::{
    enqueue_announcement_notifications, has_channel_input, normalize_channels,
    AnnouncementQueueInput, EnqueueResult,
};
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct AnnouncementsQuery {
    page: Option<i64>,
    limit: Option<i64>,
    #[serde(rename = "pageSize")]
    page_size: Option<i64>,
}

#[derive(Deserialize)]
struct AnnouncementRequest {
    title: Option<String>,
    content: Option<String>,
    #[serde(rename = "type")]
    announcement_type: Option<String>,
    status: Option<i64>,
    is_pinned: Option<bool>,
    priority: Option<i64>,
    notification_channels: Option<Value>,
    notification_min_class: Option<Value>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_announcements))
        .route("/", post(post_announcement))
        .route("/{id}", put(put_announcement))
        .route("/{id}", delete(delete_announcement))
}

async fn get_announcements(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Query(query): Query<AnnouncementsQuery>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    let page = query.page.unwrap_or(1).max(1);
    let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
    let limit = limit_raw.max(1).min(200);
    let offset = (page - 1) * limit;

    let rows = sqlx::query(
    r#"
    SELECT id, title, content, content_html, type, is_active, is_pinned, priority, created_at, updated_at
    FROM announcements
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(limit)
  .bind(offset)
  .fetch_all(&state.db)
  .await;
    let rows = match rows {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let total_row = sqlx::query("SELECT COUNT(*) as total FROM announcements")
        .fetch_optional(&state.db)
        .await;
    let total_row = match total_row {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };
    let total = total_row
        .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
        .unwrap_or(0);

    let items = rows
        .into_iter()
        .map(|row| map_announcement_row(&row))
        .collect::<Vec<Value>>();

    success(
        json!({
          "data": items,
          "total": total,
          "page": page,
          "limit": limit
        }),
        "Success",
    )
    .into_response()
}

async fn post_announcement(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Json(body): Json<AnnouncementRequest>,
) -> Response {
    let admin_id = match require_admin_user_id(&state, &headers, None).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let raw_channels = body.notification_channels.clone();
    let channels = normalize_channels(raw_channels.as_ref());
    if has_channel_input(raw_channels.as_ref()) && channels.is_empty() {
        return error(StatusCode::BAD_REQUEST, "通知方式无效", None);
    }
    let notification_min_class =
        match parse_notification_min_class(body.notification_min_class.as_ref()) {
            Ok(value) => value,
            Err(message) => return error(StatusCode::BAD_REQUEST, message, None),
        };

    let title = body.title.unwrap_or_default().trim().to_string();
    let content = body.content.unwrap_or_default().trim().to_string();
    if title.is_empty() || content.is_empty() {
        return error(StatusCode::BAD_REQUEST, "标题和内容不能为空", None);
    }

    let announcement_type = body
        .announcement_type
        .unwrap_or_else(|| "notice".to_string());
    let status = body.status.unwrap_or(1);
    let is_pinned = body.is_pinned.unwrap_or(false);
    let priority = body.priority.unwrap_or(0);
    let now = (Utc::now() + Duration::hours(8)).timestamp();
    let content_html = markdown_to_html(&content);

    let result = sqlx::query(
    r#"
    INSERT INTO announcements
      (title, content, content_html, type, is_active, is_pinned, priority, created_by, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#
  )
  .bind(&title)
  .bind(&content)
  .bind(&content_html)
  .bind(&announcement_type)
  .bind(status)
  .bind(if is_pinned { 1 } else { 0 })
  .bind(priority)
  .bind(admin_id)
  .bind(now)
  .bind(now)
  .execute(&state.db)
  .await;

    let result = match result {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let announcement_id = result.last_insert_id() as i64;
    if announcement_id <= 0 {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "创建公告失败：无法获取公告ID",
            None,
        );
    }

    let queue_result = if channels.is_empty() {
        EnqueueResult::empty()
    } else {
        match enqueue_announcement_notifications(
            &state,
            AnnouncementQueueInput {
                announcement_id,
                channels,
                min_class: notification_min_class,
                title: title.clone(),
                content: content.clone(),
                content_html: content_html.clone(),
                announcement_type: announcement_type.clone(),
            },
        )
        .await
        {
            Ok(value) => value,
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None),
        }
    };

    let row = sqlx::query(
    r#"
    SELECT id, title, content, content_html, type, is_active, is_pinned, priority, created_at, updated_at
    FROM announcements
    WHERE id = ?
    "#
  )
  .bind(announcement_id)
  .fetch_optional(&state.db)
  .await;

    let row = match row {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let mut payload = row
        .map(|value| map_announcement_row(&value))
        .unwrap_or(Value::Null);
    if let Value::Object(ref mut object) = payload {
        object.insert("notification_queue".to_string(), json!(queue_result));
    }
    success(payload, "创建成功").into_response()
}

fn parse_notification_min_class(raw: Option<&Value>) -> Result<i64, &'static str> {
    let Some(value) = raw else {
        return Ok(0);
    };
    match value {
        Value::Null => Ok(0),
        Value::Number(number) => number
            .as_i64()
            .map(|value| value.max(0))
            .ok_or("VIP等级无效"),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(0);
            }
            match trimmed.parse::<i64>() {
                Ok(value) => Ok(value.max(0)),
                Err(_) => Err("VIP等级无效"),
            }
        }
        _ => Err("VIP等级无效"),
    }
}

async fn put_announcement(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(id): Path<i64>,
    Json(body): Json<AnnouncementRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if id <= 0 {
        return error(StatusCode::BAD_REQUEST, "参数错误", None);
    }

    let mut fields: Vec<String> = Vec::new();
    let mut params: Vec<SqlParam> = Vec::new();

    if let Some(value) = body.title {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            fields.push("title = ?".to_string());
            params.push(SqlParam::String(trimmed));
        }
    }
    if let Some(value) = body.content {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            fields.push("content = ?".to_string());
            params.push(SqlParam::String(trimmed.clone()));
            fields.push("content_html = ?".to_string());
            params.push(SqlParam::String(markdown_to_html(&trimmed)));
        }
    }
    if let Some(value) = body.announcement_type {
        fields.push("type = ?".to_string());
        params.push(SqlParam::String(value));
    }
    if let Some(value) = body.status {
        fields.push("is_active = ?".to_string());
        params.push(SqlParam::I64(value));
    }
    if let Some(value) = body.is_pinned {
        fields.push("is_pinned = ?".to_string());
        params.push(SqlParam::I64(if value { 1 } else { 0 }));
    }
    if let Some(value) = body.priority {
        fields.push("priority = ?".to_string());
        params.push(SqlParam::I64(value));
    }

    if fields.is_empty() {
        return error(StatusCode::BAD_REQUEST, "没有需要更新的字段", None);
    }

    let now = (Utc::now() + Duration::hours(8)).timestamp();
    let sql = format!(
        "UPDATE announcements SET {}, updated_at = ? WHERE id = ?",
        fields.join(", ")
    );
    let mut query_builder = sqlx::query(&sql);
    query_builder = bind_params(query_builder, &params);
    let result = query_builder.bind(now).bind(id).execute(&state.db).await;
    match result {
        Ok(outcome) => {
            if outcome.rows_affected() == 0 {
                return error(StatusCode::NOT_FOUND, "公告不存在或未更新任何字段", None);
            }
        }
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    }

    let row = sqlx::query(
    r#"
    SELECT id, title, content, content_html, type, is_active, is_pinned, priority, created_at, updated_at
    FROM announcements
    WHERE id = ?
    "#
  )
  .bind(id)
  .fetch_optional(&state.db)
  .await;
    let row = match row {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let payload = row
        .map(|value| map_announcement_row(&value))
        .unwrap_or(Value::Null);
    success(payload, "更新成功").into_response()
}

async fn delete_announcement(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(id): Path<i64>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if id <= 0 {
        return error(StatusCode::BAD_REQUEST, "参数错误", None);
    }

    let result = sqlx::query("DELETE FROM announcements WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await;
    match result {
        Ok(outcome) => {
            if outcome.rows_affected() == 0 {
                return error(StatusCode::NOT_FOUND, "公告不存在", None);
            }
        }
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    }

    success(Value::Null, "删除成功").into_response()
}

fn map_announcement_row(row: &sqlx::mysql::MySqlRow) -> Value {
    let created_at = row
        .try_get::<Option<i64>, _>("created_at")
        .ok()
        .flatten()
        .and_then(format_timestamp);
    let updated_at = row
        .try_get::<Option<i64>, _>("updated_at")
        .ok()
        .flatten()
        .and_then(format_timestamp);

    json!({
      "id": row.try_get::<i64, _>("id").unwrap_or(0),
      "title": row.try_get::<Option<String>, _>("title").ok().flatten().unwrap_or_default(),
      "content": row.try_get::<Option<String>, _>("content").ok().flatten().unwrap_or_default(),
      "content_html": row.try_get::<Option<String>, _>("content_html").ok().flatten().unwrap_or_default(),
      "type": row.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default(),
      "status": row.try_get::<Option<i64>, _>("is_active").unwrap_or(Some(0)).unwrap_or(0),
      "is_pinned": row.try_get::<Option<i64>, _>("is_pinned").unwrap_or(Some(0)).unwrap_or(0),
      "priority": row.try_get::<Option<i64>, _>("priority").unwrap_or(Some(0)).unwrap_or(0),
      "created_at": created_at,
      "updated_at": updated_at
    })
}

fn format_timestamp(value: i64) -> Option<String> {
    Utc.timestamp_opt(value, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
}

fn markdown_to_html(input: &str) -> String {
    let normalized = input.replace("\r\n", "\n");
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return String::new();
    }

    let mut blocks: Vec<String> = Vec::new();
    let mut paragraph_lines: Vec<String> = Vec::new();
    let mut quote_lines: Vec<String> = Vec::new();
    let mut list_items: Vec<String> = Vec::new();
    let mut list_type: Option<&str> = None;
    let mut in_code_block = false;
    let mut code_lang = String::new();
    let mut code_lines: Vec<String> = Vec::new();

    for line in normalized.lines() {
        let trimmed = line.trim();

        if in_code_block {
            if trimmed.starts_with("```") {
                flush_code_block(&mut blocks, &mut code_lines, &mut code_lang);
                in_code_block = false;
                continue;
            }
            code_lines.push(line.to_string());
            continue;
        }

        if trimmed.starts_with("```") {
            flush_paragraph(&mut blocks, &mut paragraph_lines);
            flush_quote(&mut blocks, &mut quote_lines);
            flush_list(&mut blocks, &mut list_items, &mut list_type);
            in_code_block = true;
            code_lang = trimmed.trim_start_matches("```").trim().to_string();
            code_lines.clear();
            continue;
        }

        if trimmed.is_empty() {
            flush_paragraph(&mut blocks, &mut paragraph_lines);
            flush_quote(&mut blocks, &mut quote_lines);
            flush_list(&mut blocks, &mut list_items, &mut list_type);
            continue;
        }

        if is_horizontal_rule(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph_lines);
            flush_quote(&mut blocks, &mut quote_lines);
            flush_list(&mut blocks, &mut list_items, &mut list_type);
            blocks.push("<hr/>".to_string());
            continue;
        }

        let heading_level = trimmed.chars().take_while(|ch| *ch == '#').count();
        if (1..=6).contains(&heading_level) {
            let heading_content = trimmed[heading_level..].trim_start();
            if !heading_content.is_empty() {
                flush_paragraph(&mut blocks, &mut paragraph_lines);
                flush_quote(&mut blocks, &mut quote_lines);
                flush_list(&mut blocks, &mut list_items, &mut list_type);
                blocks.push(format!(
                    "<h{level}>{content}</h{level}>",
                    level = heading_level,
                    content = format_inline(heading_content)
                ));
                continue;
            }
        }

        if let Some(content) = trimmed.strip_prefix('>') {
            flush_paragraph(&mut blocks, &mut paragraph_lines);
            flush_list(&mut blocks, &mut list_items, &mut list_type);
            quote_lines.push(content.trim_start().to_string());
            continue;
        }

        let unordered_item = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "));
        if let Some(item) = unordered_item {
            flush_paragraph(&mut blocks, &mut paragraph_lines);
            flush_quote(&mut blocks, &mut quote_lines);
            if list_type.is_some() && list_type != Some("ul") {
                flush_list(&mut blocks, &mut list_items, &mut list_type);
            }
            list_type = Some("ul");
            list_items.push(item.to_string());
            continue;
        }

        if let Some(item) = parse_ordered_list_item(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph_lines);
            flush_quote(&mut blocks, &mut quote_lines);
            if list_type.is_some() && list_type != Some("ol") {
                flush_list(&mut blocks, &mut list_items, &mut list_type);
            }
            list_type = Some("ol");
            list_items.push(item.to_string());
            continue;
        }

        flush_quote(&mut blocks, &mut quote_lines);
        flush_list(&mut blocks, &mut list_items, &mut list_type);
        paragraph_lines.push(line.trim_end().to_string());
    }

    flush_paragraph(&mut blocks, &mut paragraph_lines);
    flush_quote(&mut blocks, &mut quote_lines);
    flush_list(&mut blocks, &mut list_items, &mut list_type);
    if in_code_block {
        flush_code_block(&mut blocks, &mut code_lines, &mut code_lang);
    }

    blocks.join("\n")
}

fn flush_paragraph(blocks: &mut Vec<String>, paragraph_lines: &mut Vec<String>) {
    if paragraph_lines.is_empty() {
        return;
    }
    let paragraph = paragraph_lines.join("\n");
    paragraph_lines.clear();
    let paragraph = paragraph.trim();
    if paragraph.is_empty() {
        return;
    }
    let content = format_inline(paragraph).replace('\n', "<br/>");
    blocks.push(format!("<p>{content}</p>"));
}

fn flush_quote(blocks: &mut Vec<String>, quote_lines: &mut Vec<String>) {
    if quote_lines.is_empty() {
        return;
    }
    let content = quote_lines
        .iter()
        .map(|line| format_inline(line))
        .collect::<Vec<_>>()
        .join("<br/>");
    quote_lines.clear();
    blocks.push(format!("<blockquote>{content}</blockquote>"));
}

fn flush_list(
    blocks: &mut Vec<String>,
    list_items: &mut Vec<String>,
    list_type: &mut Option<&str>,
) {
    let Some(tag) = *list_type else {
        list_items.clear();
        return;
    };
    if list_items.is_empty() {
        *list_type = None;
        return;
    }
    let items_html = list_items
        .iter()
        .map(|item| format!("<li>{}</li>", format_inline(item)))
        .collect::<Vec<_>>()
        .join("");
    blocks.push(format!("<{tag}>{items_html}</{tag}>"));
    list_items.clear();
    *list_type = None;
}

fn flush_code_block(
    blocks: &mut Vec<String>,
    code_lines: &mut Vec<String>,
    code_lang: &mut String,
) {
    if code_lines.is_empty() && code_lang.trim().is_empty() {
        return;
    }
    let safe_lang = code_lang
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    let lang_attr = if safe_lang.is_empty() {
        String::new()
    } else {
        format!(" class=\"language-{safe_lang}\"")
    };
    let code_content = escape_html(&code_lines.join("\n"));
    blocks.push(format!("<pre><code{lang_attr}>{code_content}</code></pre>"));
    code_lines.clear();
    code_lang.clear();
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

fn parse_ordered_list_item(input: &str) -> Option<&str> {
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
    Some(input[idx + 2..].trim())
}

fn format_inline(input: &str) -> String {
    let (with_tokens, placeholders) = extract_inline_code_spans(input);
    let escaped = escape_html(&with_tokens);
    let bold = replace_pairs(&escaped, "**", "strong");
    let bold = replace_pairs(&bold, "__", "strong");
    let italic = replace_pairs(&bold, "*", "em");
    let italic = replace_pairs(&italic, "_", "em");
    restore_inline_placeholders(italic, &placeholders)
}

fn extract_inline_code_spans(input: &str) -> (String, Vec<String>) {
    let mut out = String::new();
    let mut rest = input;
    let mut placeholders: Vec<String> = Vec::new();

    while let Some(start) = rest.find('`') {
        out.push_str(&rest[..start]);
        let after_start = &rest[start + 1..];
        if let Some(end) = after_start.find('`') {
            let code = &after_start[..end];
            if code.contains('\n') {
                out.push('`');
                out.push_str(code);
                out.push('`');
            } else {
                let token = format!("@@MDTOKEN{}@@", placeholders.len());
                placeholders.push(format!("<code>{}</code>", escape_html(code)));
                out.push_str(&token);
            }
            rest = &after_start[end + 1..];
        } else {
            out.push('`');
            out.push_str(after_start);
            rest = "";
            break;
        }
    }

    out.push_str(rest);
    (out, placeholders)
}

fn restore_inline_placeholders(mut input: String, placeholders: &[String]) -> String {
    for (index, value) in placeholders.iter().enumerate() {
        let key = format!("@@MDTOKEN{index}@@");
        input = input.replace(&key, value);
    }
    input
}

fn replace_pairs(input: &str, marker: &str, tag: &str) -> String {
    let mut out = String::new();
    let mut rest = input;
    let mut open = false;

    while let Some(index) = rest.find(marker) {
        out.push_str(&rest[..index]);
        out.push_str(if open { "</" } else { "<" });
        out.push_str(tag);
        out.push('>');
        open = !open;
        rest = &rest[index + marker.len()..];
    }
    out.push_str(rest);
    out
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
    I64(i64),
    String(String),
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
    for param in params {
        query = match param {
            SqlParam::I64(value) => query.bind(*value),
            SqlParam::String(value) => query.bind(value),
        };
    }
    query
}
