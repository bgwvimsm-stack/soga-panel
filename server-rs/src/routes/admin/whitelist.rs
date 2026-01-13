use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::cache::cache_delete_by_prefix;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct WhitelistQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  search: Option<String>,
  status: Option<String>
}

#[derive(Deserialize)]
struct WhitelistRequest {
  rule: Option<String>,
  description: Option<String>,
  status: Option<i64>
}

#[derive(Deserialize)]
struct BatchRequest {
  action: Option<String>,
  ids: Option<Vec<i64>>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/whitelist", get(get_whitelist))
    .route("/whitelist", post(post_whitelist))
    .route("/whitelist/{id}", put(put_whitelist))
    .route("/whitelist/{id}", delete(delete_whitelist))
    .route("/whitelist/batch", post(post_whitelist_batch))
}

async fn get_whitelist(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<WhitelistQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;

  let search = query.search.unwrap_or_default().trim().to_string();
  let status = parse_optional_i64(query.status.as_deref());

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !search.is_empty() {
    let pattern = format!("%{search}%");
    conditions.push("(rule LIKE ? OR description LIKE ?)".to_string());
    params.push(SqlParam::String(pattern.clone()));
    params.push(SqlParam::String(pattern));
  }
  if let Some(value) = status {
    conditions.push("status = ?".to_string());
    params.push(SqlParam::I64(value));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM white_list {where_clause}");
  let mut total_query = sqlx::query(&total_sql);
  total_query = bind_params(total_query, &params);
  let total_row = match total_query.fetch_optional(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let list_sql = format!(
    r#"
    SELECT id, rule, description, status, created_at
    FROM white_list
    {where_clause}
    ORDER BY id ASC
    LIMIT ? OFFSET ?
    "#
  );
  let mut list_query = sqlx::query(&list_sql);
  list_query = bind_params(list_query, &params);
  let rows = match list_query
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let items = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "rule": row.try_get::<Option<String>, _>("rule").ok().flatten().unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default(),
        "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(1)).unwrap_or(1),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  success(
    json!({
      "data": items,
      "total": total,
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": if total > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 0 }
      }
    }),
    "Success"
  )
  .into_response()
}

async fn post_whitelist(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<WhitelistRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let rule = body.rule.unwrap_or_default().trim().to_string();
  if rule.is_empty() {
    return error(StatusCode::BAD_REQUEST, "规则内容不能为空", None);
  }
  let description = body.description.unwrap_or_default();
  let status = body.status.unwrap_or(1);

  let result = sqlx::query(
    r#"
    INSERT INTO white_list (rule, description, status, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(&rule)
  .bind(description)
  .bind(status)
  .execute(&state.db)
  .await;

  let result = match result {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let new_id = result.last_insert_id() as i64;
  let row = sqlx::query("SELECT * FROM white_list WHERE id = ?")
    .bind(new_id)
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  cache_delete_by_prefix(&state, "white_list").await;
  cache_delete_by_prefix(&state, "whitelist").await;
  let payload = row.map(map_whitelist_row).unwrap_or(Value::Null);
  success(payload, "创建成功").into_response()
}

async fn put_whitelist(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(id): Path<i64>,
  Json(body): Json<WhitelistRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let mut fields: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if let Some(value) = body.rule {
    let trimmed = value.trim().to_string();
    if !trimmed.is_empty() {
      fields.push("rule = ?".to_string());
      params.push(SqlParam::String(trimmed));
    }
  }
  if let Some(value) = body.description {
    fields.push("description = ?".to_string());
    params.push(SqlParam::String(value));
  }
  if let Some(value) = body.status {
    fields.push("status = ?".to_string());
    params.push(SqlParam::I64(value));
  }

  if fields.is_empty() {
    return error(StatusCode::BAD_REQUEST, "没有需要更新的字段", None);
  }

  let sql = format!("UPDATE white_list SET {} WHERE id = ?", fields.join(", "));
  let mut query_builder = sqlx::query(&sql);
  query_builder = bind_params(query_builder, &params);
  let result = query_builder.bind(id).execute(&state.db).await;
  match result {
    Ok(outcome) => {
      if outcome.rows_affected() == 0 {
        return error(StatusCode::NOT_FOUND, "规则不存在或未更新任何字段", None);
      }
    }
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  }

  let row = sqlx::query("SELECT * FROM white_list WHERE id = ?")
    .bind(id)
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  cache_delete_by_prefix(&state, "white_list").await;
  cache_delete_by_prefix(&state, "whitelist").await;
  let payload = row.map(map_whitelist_row).unwrap_or(Value::Null);
  success(payload, "更新成功").into_response()
}

async fn delete_whitelist(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }
  if let Err(err) = sqlx::query("DELETE FROM white_list WHERE id = ?")
    .bind(id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  cache_delete_by_prefix(&state, "white_list").await;
  cache_delete_by_prefix(&state, "whitelist").await;
  success(Value::Null, "删除成功").into_response()
}

async fn post_whitelist_batch(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<BatchRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let action = body.action.unwrap_or_default();
  let ids = body.ids.unwrap_or_default();
  let ids = ids.into_iter().filter(|id| *id > 0).collect::<Vec<i64>>();
  if action.is_empty() || ids.is_empty() {
    return error(StatusCode::BAD_REQUEST, "无效的操作参数", None);
  }

  let placeholders = ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
  let (sql, message) = match action.as_str() {
    "enable" => (
      format!("UPDATE white_list SET status = 1 WHERE id IN ({placeholders})"),
      format!("已启用 {} 个白名单规则", ids.len())
    ),
    "disable" => (
      format!("UPDATE white_list SET status = 0 WHERE id IN ({placeholders})"),
      format!("已禁用 {} 个白名单规则", ids.len())
    ),
    "delete" => (
      format!("DELETE FROM white_list WHERE id IN ({placeholders})"),
      format!("已删除 {} 个白名单规则", ids.len())
    ),
    _ => return error(StatusCode::BAD_REQUEST, "不支持的操作类型", None)
  };

  let mut query_builder = sqlx::query(&sql);
  for id in &ids {
    query_builder = query_builder.bind(id);
  }
  let result = match query_builder.execute(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  cache_delete_by_prefix(&state, "white_list").await;
  cache_delete_by_prefix(&state, "whitelist").await;
  success(
    json!({
      "message": message,
      "affected_count": result.rows_affected()
    }),
    "Success"
  )
  .into_response()
}

fn parse_optional_i64(value: Option<&str>) -> Option<i64> {
  value
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .and_then(|value| value.parse::<i64>().ok())
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn map_whitelist_row(row: sqlx::mysql::MySqlRow) -> Value {
  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "rule": row.try_get::<Option<String>, _>("rule").ok().flatten().unwrap_or_default(),
    "description": row.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default(),
    "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(1)).unwrap_or(1),
    "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
  })
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
