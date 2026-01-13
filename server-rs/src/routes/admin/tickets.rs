use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct TicketQuery {
  page: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>
}

#[derive(Deserialize)]
struct ReplyRequest {
  content: Option<String>,
  status: Option<String>
}

#[derive(Deserialize)]
struct StatusRequest {
  status: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_tickets))
    .route("/pending-count", get(get_pending_count))
    .route("/{id}", get(get_ticket_detail))
    .route("/{id}/replies", post(post_reply))
    .route("/{id}/status", post(post_status))
}

async fn get_tickets(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<TicketQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let page_size = query.page_size.unwrap_or(20).max(1).min(100);
  let offset = (page - 1) * page_size;

  let status = query
    .status
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| ["open", "answered", "closed"].contains(&value.as_str()));

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();
  if let Some(status_value) = status.as_ref() {
    conditions.push("t.status = ?".to_string());
    params.push(SqlParam::String(status_value.clone()));
  }
  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let list_sql = format!(
    r#"
    SELECT t.*, u.username AS user_name, u.email AS user_email
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id
    {where_clause}
    ORDER BY t.updated_at DESC
    LIMIT ? OFFSET ?
    "#
  );

  let mut list_query = sqlx::query(&list_sql);
  list_query = bind_params(list_query, &params);
  let rows = match list_query
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.db)
    .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let count_sql = format!("SELECT COUNT(*) as total FROM tickets t {where_clause}");
  let mut count_query = sqlx::query(&count_sql);
  count_query = bind_params(count_query, &params);
  let total_row = match count_query.fetch_optional(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let items: Vec<Value> = rows
    .into_iter()
    .map(|row| build_ticket_value(&row, false, true))
    .collect();

  success(
    json!({
      "items": items,
      "pagination": {
        "page": page,
        "pageSize": page_size,
        "total": total
      }
    }),
    "Success"
  )
  .into_response()
}

async fn get_pending_count(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let row = sqlx::query("SELECT COUNT(*) as total FROM tickets WHERE status = 'open'")
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  success(json!({ "count": total }), "Success").into_response()
}

async fn get_ticket_detail(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(ticket_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if ticket_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "无效的工单ID", None);
  }

  let row = sqlx::query(
    r#"
    SELECT t.*, u.username AS user_name, u.email AS user_email
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.id = ?
    "#
  )
  .bind(ticket_id)
  .fetch_optional(&state.db)
  .await;

  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let row = match row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "未找到工单", None)
  };

  let replies = match list_ticket_replies(&state, ticket_id).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  success(
    json!({
      "ticket": build_ticket_value(&row, true, true),
      "replies": replies
    }),
    "Success"
  )
  .into_response()
}

async fn post_reply(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(ticket_id): Path<i64>,
  Json(body): Json<ReplyRequest>
) -> Response {
  let admin_id = match require_admin_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };
  if ticket_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "无效的工单ID", None);
  }

  let content = body.content.unwrap_or_default();
  let content = sanitize_text(&content, 8000);
  if content.is_empty() {
    return error(StatusCode::BAD_REQUEST, "回复内容不能为空", None);
  }

  let status = body
    .status
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| ["open", "answered", "closed"].contains(&value.as_str()));
  let next_status = status.unwrap_or_else(|| "answered".to_string());

  let ticket_row = sqlx::query("SELECT id FROM tickets WHERE id = ?")
    .bind(ticket_id)
    .fetch_optional(&state.db)
    .await;
  let ticket_row = match ticket_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  if ticket_row.is_none() {
    return error(StatusCode::NOT_FOUND, "未找到工单", None);
  }

  if let Err(err) = sqlx::query(
    r#"
    INSERT INTO ticket_replies (ticket_id, author_id, author_role, content, created_at)
    VALUES (?, ?, 'admin', ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(ticket_id)
  .bind(admin_id)
  .bind(&content)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  if let Err(err) = sqlx::query(
    r#"
    UPDATE tickets
    SET status = ?, last_reply_by_admin_id = ?, last_reply_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(&next_status)
  .bind(admin_id)
  .bind(ticket_id)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  let replies = match list_ticket_replies(&state, ticket_id).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  success(
    json!({
      "replies": replies,
      "status": next_status
    }),
    "回复成功"
  )
  .into_response()
}

async fn post_status(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(ticket_id): Path<i64>,
  Json(body): Json<StatusRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if ticket_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "无效的工单ID", None);
  }

  let status = body
    .status
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| ["open", "answered", "closed"].contains(&value.as_str()));
  let status = match status {
    Some(value) => value,
    None => return error(StatusCode::BAD_REQUEST, "状态无效", None)
  };

  if let Err(err) = sqlx::query("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(&status)
    .bind(ticket_id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(json!({ "status": status }), "状态已更新").into_response()
}

fn build_ticket_value(row: &sqlx::mysql::MySqlRow, include_content: bool, include_user: bool) -> Value {
  let id = row.try_get::<i64, _>("id").unwrap_or(0);
  let title = row
    .try_get::<Option<String>, _>("title")
    .ok()
    .flatten()
    .unwrap_or_default();
  let status = row
    .try_get::<Option<String>, _>("status")
    .ok()
    .flatten()
    .unwrap_or_else(|| "open".to_string());
  let last_reply_at = format_datetime(row.try_get::<Option<NaiveDateTime>, _>("last_reply_at").ok().flatten());
  let created_at = format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten());
  let updated_at = format_datetime(row.try_get::<Option<NaiveDateTime>, _>("updated_at").ok().flatten());

  let mut payload = json!({
    "id": id,
    "title": title,
    "status": status,
    "last_reply_at": last_reply_at,
    "created_at": created_at,
    "updated_at": updated_at
  });

  if include_user {
    let user_id = row.try_get::<Option<i64>, _>("user_id").unwrap_or(Some(0)).unwrap_or(0);
    let username = row.try_get::<Option<String>, _>("user_name").ok().flatten();
    let email = row.try_get::<Option<String>, _>("user_email").ok().flatten();
    if let Value::Object(map) = &mut payload {
      map.insert("user".to_string(), json!({ "id": user_id, "username": username, "email": email }));
    }
  }

  if include_content {
    let content = row
      .try_get::<Option<String>, _>("content")
      .ok()
      .flatten()
      .unwrap_or_default();
    if let Value::Object(map) = &mut payload {
      map.insert("content".to_string(), json!(content));
    }
  }

  payload
}

async fn list_ticket_replies(state: &AppState, ticket_id: i64) -> Result<Vec<Value>, String> {
  let rows = sqlx::query(
    r#"
    SELECT tr.id, tr.ticket_id, tr.author_id, tr.author_role, tr.content, tr.created_at,
           u.username AS author_username, u.email AS author_email
    FROM ticket_replies tr
    LEFT JOIN users u ON tr.author_id = u.id
    WHERE tr.ticket_id = ?
    ORDER BY tr.created_at ASC
    "#
  )
  .bind(ticket_id)
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let replies = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "content": row
          .try_get::<Option<String>, _>("content")
          .ok()
          .flatten()
          .unwrap_or_default(),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
        "author": {
          "id": row.try_get::<i64, _>("author_id").unwrap_or(0),
          "role": row
            .try_get::<Option<String>, _>("author_role")
            .ok()
            .flatten()
            .unwrap_or_else(|| "user".to_string()),
          "username": row.try_get::<Option<String>, _>("author_username").ok().flatten(),
          "email": row.try_get::<Option<String>, _>("author_email").ok().flatten()
        }
      })
    })
    .collect();

  Ok(replies)
}

fn sanitize_text(input: &str, max_length: usize) -> String {
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return String::new();
  }
  trimmed.chars().take(max_length).collect()
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  String(String)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::String(value) => query.bind(value)
    };
  }
  query
}
