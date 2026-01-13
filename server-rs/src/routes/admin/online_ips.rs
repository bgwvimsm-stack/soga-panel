use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct OnlineIpsQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  node_id: Option<String>,
  #[serde(rename = "user_search")]
  user_search: Option<String>,
  #[serde(rename = "node_search")]
  node_search: Option<String>,
  #[serde(rename = "user_email")]
  user_email: Option<String>,
  ip: Option<String>,
  #[serde(rename = "ip_search")]
  ip_search: Option<String>,
  #[serde(rename = "sort_by")]
  sort_by: Option<String>
}

#[derive(Deserialize)]
struct BatchIdsRequest {
  ids: Option<Vec<i64>>
}

#[derive(Deserialize)]
struct KickRequest {
  ip_id: Option<i64>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/online-ips", get(get_online_ips))
    .route("/online-ips/export-csv", post(post_export_csv))
    .route("/online-ips/{id}/kick", post(post_kick))
    .route("/online-ips/{id}", delete(delete_online_ip))
    .route("/online-ips/batch-delete", post(post_batch_delete))
    .route("/kick-ip", post(post_kick_compat))
    .route("/block-ip", post(post_block_ip))
}

async fn get_online_ips(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<OnlineIpsQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(50);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;

  let node_id = parse_optional_i64(query.node_id.as_deref());
  let user_search = query
    .user_search
    .or(query.user_email)
    .unwrap_or_default()
    .trim()
    .to_string();
  let node_search = query.node_search.unwrap_or_default().trim().to_string();
  let ip_search = query
    .ip_search
    .or(query.ip)
    .unwrap_or_default()
    .trim()
    .to_string();
  let sort_by = match query.sort_by.as_deref() {
    Some("connect_time") => "connect_time",
    _ => "last_seen"
  };

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  conditions.push("oi.last_seen > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)".to_string());

  if let Some(value) = node_id {
    conditions.push("oi.node_id = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if !user_search.is_empty() {
    let parsed_id = user_search.parse::<i64>().unwrap_or(-1);
    let pattern = format!("%{user_search}%");
    conditions.push("(u.email LIKE ? OR u.username LIKE ? OR u.id = ?)".to_string());
    params.push(SqlParam::String(pattern.clone()));
    params.push(SqlParam::String(pattern));
    params.push(SqlParam::I64(parsed_id));
  }
  if !node_search.is_empty() {
    conditions.push("n.name LIKE ?".to_string());
    params.push(SqlParam::String(format!("%{node_search}%")));
  }
  if !ip_search.is_empty() {
    conditions.push("oi.ip LIKE ?".to_string());
    params.push(SqlParam::String(format!("%{ip_search}%")));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!(
    r#"
    SELECT COUNT(*) as total
    FROM online_ips oi
    LEFT JOIN users u ON oi.user_id = u.id
    LEFT JOIN nodes n ON oi.node_id = n.id
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

  let list_sql = format!(
    r#"
    SELECT
      oi.id,
      oi.user_id,
      u.username,
      u.email AS user_email,
      u.class AS user_class,
      oi.node_id,
      n.name AS node_name,
      n.type AS node_type,
      oi.ip AS ip_address,
      oi.last_seen AS connect_time,
      oi.last_seen AS last_seen
    FROM online_ips oi
    LEFT JOIN users u ON oi.user_id = u.id
    LEFT JOIN nodes n ON oi.node_id = n.id
    {where_clause}
    ORDER BY {sort_by} DESC
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
        "user_id": row.try_get::<Option<i64>, _>("user_id").unwrap_or(Some(0)).unwrap_or(0),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
        "user_email": row.try_get::<Option<String>, _>("user_email").ok().flatten().unwrap_or_default(),
        "user_class": row.try_get::<Option<i64>, _>("user_class").unwrap_or(Some(0)).unwrap_or(0),
        "node_id": row.try_get::<Option<i64>, _>("node_id").unwrap_or(Some(0)).unwrap_or(0),
        "node_name": row.try_get::<Option<String>, _>("node_name").ok().flatten().unwrap_or_default(),
        "node_type": row.try_get::<Option<String>, _>("node_type").ok().flatten().unwrap_or_default(),
        "ip_address": row.try_get::<Option<String>, _>("ip_address").ok().flatten().unwrap_or_default(),
        "connect_time": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("connect_time").ok().flatten()),
        "last_active": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("last_seen").ok().flatten())
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
    format!("WHERE oi.id IN ({})", ids.iter().map(|_| "?").collect::<Vec<&str>>().join(","))
  };

  let sql = format!(
    r#"
    SELECT u.email as user_email, oi.ip as ip_address, n.name as node_name, oi.last_seen as connect_time
    FROM online_ips oi
    LEFT JOIN users u ON oi.user_id = u.id
    LEFT JOIN nodes n ON oi.node_id = n.id
    {where_clause}
    ORDER BY oi.last_seen DESC
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

  let headers = ["用户邮箱", "IP地址", "连接节点名称", "连接时间"];
  let mut csv = format!("{}\n", headers.join(","));
  for row in rows {
    let line = [
      escape_csv(row.try_get::<Option<String>, _>("user_email").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("ip_address").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("node_name").ok().flatten().unwrap_or_default()),
      escape_csv(
        format_datetime(row.try_get::<Option<NaiveDateTime>, _>("connect_time").ok().flatten()).unwrap_or_default()
      )
    ];
    csv.push_str(&format!("{}\n", line.join(",")));
  }

  build_csv_response("online_ips.csv", csv)
}

async fn post_kick(
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
  if let Err(err) = sqlx::query("DELETE FROM online_ips WHERE id = ?")
    .bind(id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  success(Value::Null, "已踢出该 IP").into_response()
}

async fn post_kick_compat(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<KickRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  let ip_id = body.ip_id.unwrap_or(0);
  if ip_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ip_id 必填", None);
  }
  if let Err(err) = sqlx::query("DELETE FROM online_ips WHERE id = ?")
    .bind(ip_id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  success(json!({ "message": "IP踢出成功" }), "Success").into_response()
}

async fn delete_online_ip(
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
  if let Err(err) = sqlx::query("DELETE FROM online_ips WHERE id = ?")
    .bind(id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  success(Value::Null, "在线 IP 记录已删除").into_response()
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
    return error(StatusCode::BAD_REQUEST, "请提供要删除的记录 ID 数组", None);
  }

  let placeholders = ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
  let sql = format!("DELETE FROM online_ips WHERE id IN ({placeholders})");
  let mut query_builder = sqlx::query(&sql);
  for id in &ids {
    query_builder = query_builder.bind(id);
  }
  let result = match query_builder.execute(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let message = format!("成功删除 {} 条在线 IP 记录", result.rows_affected());
  success(json!({ "deleted_count": result.rows_affected() }), &message).into_response()
}

async fn post_block_ip(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<Value>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  let ip = body
    .get("ip")
    .and_then(Value::as_str)
    .unwrap_or_default()
    .trim()
    .to_string();
  if ip.is_empty() {
    return error(StatusCode::BAD_REQUEST, "IP 地址无效", None);
  }
  success(json!({ "message": "IP 封禁功能待实现", "ip": ip }), "Success").into_response()
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
