use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::{Duration, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct AnnouncementsQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>
}

#[derive(Deserialize)]
struct AnnouncementRequest {
  title: Option<String>,
  content: Option<String>,
  #[serde(rename = "type")]
  announcement_type: Option<String>,
  status: Option<i64>,
  is_pinned: Option<bool>,
  priority: Option<i64>
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
  Query(query): Query<AnnouncementsQuery>
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM announcements")
    .fetch_optional(&state.db)
    .await;
  let total_row = match total_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
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
    "Success"
  )
  .into_response()
}

async fn post_announcement(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<AnnouncementRequest>
) -> Response {
  let admin_id = match require_admin_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let title = body.title.unwrap_or_default().trim().to_string();
  let content = body.content.unwrap_or_default().trim().to_string();
  if title.is_empty() || content.is_empty() {
    return error(StatusCode::BAD_REQUEST, "标题和内容不能为空", None);
  }

  let announcement_type = body.announcement_type.unwrap_or_else(|| "notice".to_string());
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let announcement_id = result.last_insert_id() as i64;
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let payload = row.map(|value| map_announcement_row(&value)).unwrap_or(Value::Null);
  success(payload, "创建成功").into_response()
}

async fn put_announcement(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(id): Path<i64>,
  Json(body): Json<AnnouncementRequest>
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let payload = row.map(|value| map_announcement_row(&value)).unwrap_or(Value::Null);
  success(payload, "更新成功").into_response()
}

async fn delete_announcement(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(id): Path<i64>
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
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
  Utc.timestamp_opt(value, 0).single().map(|dt| dt.to_rfc3339())
}

fn markdown_to_html(input: &str) -> String {
  if input.trim().is_empty() {
    return String::new();
  }

  let mut html = String::new();
  let mut in_list = false;

  for line in input.lines() {
    let trimmed = line.trim();
    if trimmed.starts_with("- ") {
      if !in_list {
        html.push_str("<ul>");
        in_list = true;
      }
      html.push_str("<li>");
      html.push_str(&format_inline(&trimmed[2..]));
      html.push_str("</li>");
      continue;
    }

    if in_list {
      html.push_str("</ul>");
      in_list = false;
    }

    if trimmed.is_empty() {
      continue;
    }

    if let Some(content) = trimmed.strip_prefix("### ") {
      html.push_str("<h3>");
      html.push_str(&format_inline(content));
      html.push_str("</h3>");
      continue;
    }
    if let Some(content) = trimmed.strip_prefix("## ") {
      html.push_str("<h2>");
      html.push_str(&format_inline(content));
      html.push_str("</h2>");
      continue;
    }
    if let Some(content) = trimmed.strip_prefix("# ") {
      html.push_str("<h1>");
      html.push_str(&format_inline(content));
      html.push_str("</h1>");
      continue;
    }

    html.push_str("<p>");
    html.push_str(&format_inline(trimmed));
    html.push_str("</p>");
  }

  if in_list {
    html.push_str("</ul>");
  }

  html
}

fn format_inline(input: &str) -> String {
  let bold = replace_pairs(input, "**", "strong");
  replace_pairs(&bold, "*", "em")
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

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  I64(i64),
  String(String)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value)
    };
  }
  query
}
