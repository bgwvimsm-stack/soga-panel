use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct LoginLogsQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>,
  #[serde(rename = "user_id")]
  user_search: Option<String>,
  ip: Option<String>,
  start_date: Option<String>,
  end_date: Option<String>
}

#[derive(Deserialize)]
struct BatchIdsRequest {
  ids: Option<Vec<i64>>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_login_logs))
    .route("/{id}", delete(delete_login_log))
    .route("/batch-delete", post(post_batch_delete))
    .route("/export-csv", post(post_export_csv))
}

async fn get_login_logs(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<LoginLogsQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(50);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;

  let status = parse_optional_i64(query.status.as_deref());
  let ip = query.ip.unwrap_or_default().trim().to_string();
  let user_search = query.user_search.unwrap_or_default().trim().to_string();
  let start_time = parse_datetime_input(query.start_date.as_deref());
  let end_time = parse_datetime_input(query.end_date.as_deref());

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if let Some(value) = status {
    conditions.push("l.login_status = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if !ip.is_empty() {
    conditions.push("l.login_ip LIKE ?".to_string());
    params.push(SqlParam::String(format!("%{ip}%")));
  }
  if !user_search.is_empty() {
    let parsed_id = user_search.parse::<i64>().unwrap_or(-1);
    let pattern = format!("%{user_search}%");
    conditions.push("(u.email LIKE ? OR u.username LIKE ? OR l.user_id = ?)".to_string());
    params.push(SqlParam::String(pattern.clone()));
    params.push(SqlParam::String(pattern));
    params.push(SqlParam::I64(parsed_id));
  }
  if let Some(value) = start_time {
    conditions.push("l.login_time >= ?".to_string());
    params.push(SqlParam::String(value));
  }
  if let Some(value) = end_time {
    conditions.push("l.login_time <= ?".to_string());
    params.push(SqlParam::String(value));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let list_sql = format!(
    r#"
    SELECT l.id, l.user_id, l.login_ip, l.login_time, l.user_agent, l.login_status, l.failure_reason, l.login_method,
           l.created_at, u.email AS user_email, u.username
    FROM login_logs l
    LEFT JOIN users u ON l.user_id = u.id
    {where_clause}
    ORDER BY l.created_at DESC
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

  let total_sql = format!(
    r#"
    SELECT COUNT(*) as total
    FROM login_logs l
    LEFT JOIN users u ON l.user_id = u.id
    {where_clause}
    "#
  );
  let mut total_query = sqlx::query(&total_sql);
  total_query = bind_params(total_query, &params);
  let total_row = match total_query.fetch_optional(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let logs = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "user_id": row.try_get::<Option<i64>, _>("user_id").unwrap_or(Some(0)).unwrap_or(0),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
        "user_email": row.try_get::<Option<String>, _>("user_email").ok().flatten().unwrap_or_default(),
        "email": row.try_get::<Option<String>, _>("user_email").ok().flatten().unwrap_or_default(),
        "login_ip": row.try_get::<Option<String>, _>("login_ip").ok().flatten().unwrap_or_default(),
        "login_time": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("login_time").ok().flatten()),
        "user_agent": row.try_get::<Option<String>, _>("user_agent").ok().flatten().unwrap_or_default(),
        "login_status": row.try_get::<Option<i64>, _>("login_status").unwrap_or(Some(0)).unwrap_or(0),
        "failure_reason": row.try_get::<Option<String>, _>("failure_reason").ok().flatten().unwrap_or_default(),
        "login_method": row.try_get::<Option<String>, _>("login_method").ok().flatten().unwrap_or_default(),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  success(
    json!({
      "data": logs,
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

async fn delete_login_log(
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
  if let Err(err) = sqlx::query("DELETE FROM login_logs WHERE id = ?")
    .bind(id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  success(json!({ "message": "登录日志删除成功" }), "Success").into_response()
}

async fn post_batch_delete(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<BatchIdsRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let ids = body.ids.unwrap_or_default();
  let ids = ids.into_iter().filter(|id| *id > 0).collect::<Vec<i64>>();
  if ids.is_empty() {
    return error(StatusCode::BAD_REQUEST, "请提供要删除的记录ID数组", None);
  }

  let placeholders = ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
  let sql = format!("DELETE FROM login_logs WHERE id IN ({placeholders})");
  let mut query_builder = sqlx::query(&sql);
  for id in &ids {
    query_builder = query_builder.bind(id);
  }
  if let Err(err) = query_builder.execute(&state.db).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(
    json!({ "message": format!("成功删除 {} 条登录日志", ids.len()), "deleted_count": ids.len() }),
    "Success"
  )
  .into_response()
}

async fn post_export_csv(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<BatchIdsRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let ids = body.ids.unwrap_or_default();
  let ids = ids.into_iter().filter(|id| *id > 0).collect::<Vec<i64>>();
  let where_clause = if ids.is_empty() {
    String::new()
  } else {
    format!("WHERE ll.id IN ({})", ids.iter().map(|_| "?").collect::<Vec<&str>>().join(","))
  };

  let sql = format!(
    r#"
    SELECT u.email as user_email, ll.login_ip, ll.user_agent as login_ua, ll.login_time,
           CASE
             WHEN ll.login_status = 1 THEN '成功'
             WHEN ll.login_status = 0 THEN '失败'
             ELSE '未知'
           END as login_status
    FROM login_logs ll
    LEFT JOIN users u ON ll.user_id = u.id
    {where_clause}
    ORDER BY ll.login_time DESC
    {}
    "#,
    if ids.is_empty() { "LIMIT 100" } else { "" }
  );
  let mut query_builder = sqlx::query(&sql);
  for id in &ids {
    query_builder = query_builder.bind(id);
  }
  let rows = match query_builder.fetch_all(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let headers = ["用户邮箱", "登录IP", "登录UA", "登录时间", "登录状态"];
  let mut csv = format!("{}\n", headers.join(","));
  for row in rows {
    let line = [
      escape_csv(row.try_get::<Option<String>, _>("user_email").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("login_ip").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("login_ua").ok().flatten().unwrap_or_default()),
      escape_csv(format_datetime(row.try_get::<Option<NaiveDateTime>, _>("login_time").ok().flatten()).unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("login_status").ok().flatten().unwrap_or_default())
    ];
    csv.push_str(&format!("{}\n", line.join(",")));
  }

  build_csv_response("login_logs.csv", csv)
}

fn parse_optional_i64(value: Option<&str>) -> Option<i64> {
  value
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .and_then(|value| value.parse::<i64>().ok())
}

fn parse_datetime_input(value: Option<&str>) -> Option<String> {
  let raw = value?.trim();
  if raw.is_empty() {
    return None;
  }
  if let Ok(dt) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
    return Some(dt.format("%Y-%m-%d %H:%M:%S").to_string());
  }
  if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
    return date.and_hms_opt(0, 0, 0).map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string());
  }
  if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
    return Some(dt.naive_local().format("%Y-%m-%d %H:%M:%S").to_string());
  }
  None
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn escape_csv(value: impl ToString) -> String {
  format!("\"{}\"", value.to_string().replace('"', "\"\""))
}

fn build_csv_response(filename: &str, csv: String) -> Response {
  let mut response = Response::new(csv.into());
  *response.status_mut() = StatusCode::OK;
  response.headers_mut().insert(
    header::CONTENT_TYPE,
    HeaderValue::from_static("text/csv; charset=utf-8")
  );
  if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename={filename}")) {
    response.headers_mut().insert(header::CONTENT_DISPOSITION, value);
  }
  response
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
