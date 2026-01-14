use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::cache::cache_delete_by_prefix;
use crate::crypto::{generate_uuid, hash_password, random_base64, random_string};
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct UsersQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  search: Option<String>,
  #[serde(rename = "class")]
  class_level: Option<String>,
  status: Option<String>
}

#[derive(Deserialize)]
struct CreateUserRequest {
  email: String,
  username: String,
  password: String,
  #[serde(rename = "class")]
  class_level: Option<i64>,
  transfer_enable: Option<i64>,
  expire_time: Option<String>,
  class_expire_time: Option<String>,
  speed_limit: Option<i64>,
  device_limit: Option<i64>,
  bark_key: Option<String>,
  bark_enabled: Option<bool>,
  invite_code: Option<String>,
  invite_limit: Option<i64>,
  money: Option<f64>
}

#[derive(Deserialize)]
struct UpdateUserRequest {
  email: Option<String>,
  username: Option<String>,
  password: Option<String>,
  status: Option<i64>,
  #[serde(rename = "class")]
  class_level: Option<i64>,
  transfer_enable: Option<i64>,
  expire_time: Option<String>,
  class_expire_time: Option<String>,
  speed_limit: Option<i64>,
  device_limit: Option<i64>,
  bark_key: Option<String>,
  bark_enabled: Option<bool>,
  invite_code: Option<String>,
  invite_limit: Option<i64>,
  money: Option<f64>
}

#[derive(Deserialize)]
struct StatusRequest {
  status: Option<i64>
}

#[derive(Deserialize)]
struct ExportQuery {
  ids: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_users))
    .route("/", post(post_user))
    .route("/export", get(export_users))
    .route("/{id}", put(put_user))
    .route("/{id}", delete(delete_user))
    .route("/{id}/status", post(post_user_status))
    .route("/{id}/traffic", post(post_user_traffic))
}

async fn get_users(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<UsersQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(100);
  let offset = (page - 1) * limit;

  let search = query.search.as_ref().map(|value| value.trim().to_string()).unwrap_or_default();
  let class_filter = parse_optional_i64(query.class_level.as_deref());
  let status_filter = parse_optional_i64(query.status.as_deref());

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !search.is_empty() {
    let keyword = format!("%{search}%");
    conditions.push("(email LIKE ? OR username LIKE ?)".to_string());
    params.push(SqlParam::String(keyword.clone()));
    params.push(SqlParam::String(keyword));
  }
  if let Some(class_value) = class_filter {
    conditions.push("class = ?".to_string());
    params.push(SqlParam::I64(class_value));
  }
  if let Some(status_value) = status_filter {
    conditions.push("status = ?".to_string());
    params.push(SqlParam::I64(status_value));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let list_sql = format!(
    r#"
    SELECT
      id,
      email,
      username,
      uuid,
      class,
      class_expire_time,
      upload_traffic,
      download_traffic,
      (upload_today + download_today) AS transfer_today,
      transfer_enable,
      transfer_total,
      expire_time,
      status,
      is_admin,
      reg_date,
      last_login_time,
      created_at,
      updated_at,
      bark_key,
      bark_enabled,
      speed_limit,
      device_limit,
      CAST(money AS DOUBLE) AS money,
      register_ip,
      invite_code,
      invite_limit,
      invite_used
    FROM users
    {where_clause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
    "#
  );

  let mut query_builder = sqlx::query(&list_sql);
  query_builder = bind_params(query_builder, &params);
  let rows = query_builder
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await;

  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let count_sql = format!("SELECT COUNT(*) as total FROM users {where_clause}");
  let mut count_query = sqlx::query(&count_sql);
  count_query = bind_params(count_query, &params);
  let total_row = count_query
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string());
  let total_row = match total_row {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let users = rows.into_iter().map(map_user_row).collect::<Vec<Value>>();
  success(
    json!({
      "users": users,
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

async fn post_user(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<CreateUserRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  if body.email.trim().is_empty() || body.username.trim().is_empty() || body.password.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少必要参数", None);
  }

  let uuid = generate_uuid();
  let passwd = random_base64(32);
  let token = random_string(32);
  let password_hash = hash_password(&body.password);

  let insert = sqlx::query(
    r#"
    INSERT INTO users
      (email, username, password_hash, uuid, passwd, token, invited_by, invite_limit, reg_date, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#
  )
  .bind(body.email.trim())
  .bind(body.username.trim())
  .bind(password_hash)
  .bind(uuid)
  .bind(passwd)
  .bind(token)
  .execute(&state.db)
  .await;

  if let Err(err) = insert {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  if let Err(message) = apply_user_update(&state, None, &body).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  success(Value::Null, "用户已创建").into_response()
}

async fn put_user(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(user_id): Path<i64>,
  Json(body): Json<UpdateUserRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if user_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "id 无效", None);
  }

  if let Err(message) = apply_user_update(&state, Some(user_id), &body).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  success(Value::Null, "用户已更新").into_response()
}

async fn delete_user(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(user_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if user_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "id 无效", None);
  }

  let result = sqlx::query("DELETE FROM users WHERE id = ?")
    .bind(user_id)
    .execute(&state.db)
    .await;
  match result {
    Ok(outcome) => {
      if outcome.rows_affected() == 0 {
        return error(StatusCode::NOT_FOUND, "用户不存在", None);
      }
    }
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  success(Value::Null, "用户已删除").into_response()
}

async fn post_user_status(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(user_id): Path<i64>,
  Json(body): Json<StatusRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if user_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "id 无效", None);
  }
  let status = body.status.unwrap_or(-1);
  if status != 0 && status != 1 {
    return error(StatusCode::BAD_REQUEST, "状态无效", None);
  }

  let result = sqlx::query("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status)
    .bind(user_id)
    .execute(&state.db)
    .await;
  if let Err(err) = result {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "状态已更新").into_response()
}

async fn post_user_traffic(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(user_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if user_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  if let Err(err) = sqlx::query(
    r#"
    UPDATE users
    SET upload_traffic = 0,
        download_traffic = 0,
        upload_today = 0,
        download_today = 0,
        transfer_total = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(user_id)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  let _ = sqlx::query("DELETE FROM traffic_logs WHERE user_id = ?")
    .bind(user_id)
    .execute(&state.db)
    .await;
  let _ = sqlx::query("DELETE FROM daily_traffic WHERE user_id = ?")
    .bind(user_id)
    .execute(&state.db)
    .await;
  cache_delete_by_prefix(&state, &format!("user_{user_id}")).await;

  success(json!({ "message": "User traffic reset successfully" }), "Success").into_response()
}

async fn export_users(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<ExportQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let ids = parse_ids_from_query(query.ids.as_deref());
  let where_clause = if ids.is_empty() {
    String::new()
  } else {
    format!("WHERE id IN ({})", ids.iter().map(|_| "?").collect::<Vec<&str>>().join(","))
  };

  let sql = format!(
    r#"
    SELECT email, username, class, status,
           upload_traffic, download_traffic, (upload_today + download_today) as transfer_today, transfer_total, transfer_enable,
           reg_date, last_login_time, expire_time, class_expire_time
    FROM users
    {where_clause}
    ORDER BY id DESC
    "#
  );

  let mut query_builder = sqlx::query(&sql);
  for id in ids.iter() {
    query_builder = query_builder.bind(id);
  }
  let rows = match query_builder.fetch_all(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let headers = [
    "Email",
    "Username",
    "Class",
    "Status",
    "Upload Traffic",
    "Download Traffic",
    "Today Traffic",
    "Total Traffic",
    "Transfer Limit",
    "Register Date",
    "Last Login",
    "Expire Time",
    "Class Expire Time"
  ];

  let mut csv = format!("{}\n", headers.join(","));
  for row in rows {
    let status = row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0);
    let line = [
      escape_csv(row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<i64>, _>("class").unwrap_or(Some(0)).unwrap_or(0).to_string()),
      escape_csv(if status == 1 { "Active" } else { "Inactive" }),
      escape_csv(row.try_get::<Option<i64>, _>("upload_traffic").unwrap_or(Some(0)).unwrap_or(0).to_string()),
      escape_csv(row.try_get::<Option<i64>, _>("download_traffic").unwrap_or(Some(0)).unwrap_or(0).to_string()),
      escape_csv(row.try_get::<Option<i64>, _>("transfer_today").unwrap_or(Some(0)).unwrap_or(0).to_string()),
      escape_csv(row.try_get::<Option<i64>, _>("transfer_total").unwrap_or(Some(0)).unwrap_or(0).to_string()),
      escape_csv(row.try_get::<Option<i64>, _>("transfer_enable").unwrap_or(Some(0)).unwrap_or(0).to_string()),
      escape_csv(format_datetime(row.try_get::<Option<NaiveDateTime>, _>("reg_date").ok().flatten()).unwrap_or_default()),
      escape_csv(format_datetime(row.try_get::<Option<NaiveDateTime>, _>("last_login_time").ok().flatten()).unwrap_or_default()),
      escape_csv(format_datetime(row.try_get::<Option<NaiveDateTime>, _>("expire_time").ok().flatten()).unwrap_or_default()),
      escape_csv(format_datetime(row.try_get::<Option<NaiveDateTime>, _>("class_expire_time").ok().flatten()).unwrap_or_default())
    ];
    csv.push_str(&format!("{}\n", line.join(",")));
  }

  let filename = format!("users-{}.csv", Utc::now().format("%Y-%m-%d"));
  let mut response = Response::new(csv.into());
  *response.status_mut() = StatusCode::OK;
  response.headers_mut().insert(
    header::CONTENT_TYPE,
    HeaderValue::from_static("text/csv; charset=utf-8")
  );
  if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
    response.headers_mut().insert(header::CONTENT_DISPOSITION, value);
  }
  response
}

fn map_user_row(row: sqlx::mysql::MySqlRow) -> Value {
  let bark_enabled = row
    .try_get::<Option<i64>, _>("bark_enabled")
    .unwrap_or(Some(0))
    .unwrap_or(0)
    == 1;
  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "email": row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default(),
    "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
    "uuid": row.try_get::<Option<String>, _>("uuid").ok().flatten().unwrap_or_default(),
    "class": row.try_get::<Option<i64>, _>("class").unwrap_or(Some(0)).unwrap_or(0),
    "class_expire_time": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("class_expire_time").ok().flatten()),
    "upload_traffic": row.try_get::<Option<i64>, _>("upload_traffic").unwrap_or(Some(0)).unwrap_or(0),
    "download_traffic": row.try_get::<Option<i64>, _>("download_traffic").unwrap_or(Some(0)).unwrap_or(0),
    "transfer_today": row.try_get::<Option<i64>, _>("transfer_today").unwrap_or(Some(0)).unwrap_or(0),
    "transfer_enable": row.try_get::<Option<i64>, _>("transfer_enable").unwrap_or(Some(0)).unwrap_or(0),
    "transfer_total": row.try_get::<Option<i64>, _>("transfer_total").unwrap_or(Some(0)).unwrap_or(0),
    "expire_time": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("expire_time").ok().flatten()),
    "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0),
    "is_admin": row.try_get::<Option<i64>, _>("is_admin").unwrap_or(Some(0)).unwrap_or(0),
    "reg_date": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("reg_date").ok().flatten()),
    "last_login_time": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("last_login_time").ok().flatten()),
    "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
    "updated_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("updated_at").ok().flatten()),
    "bark_key": row.try_get::<Option<String>, _>("bark_key").ok().flatten(),
    "bark_enabled": bark_enabled,
    "speed_limit": row.try_get::<Option<i64>, _>("speed_limit").unwrap_or(Some(0)).unwrap_or(0),
    "device_limit": row.try_get::<Option<i64>, _>("device_limit").unwrap_or(Some(0)).unwrap_or(0),
    "money": row.try_get::<Option<f64>, _>("money").unwrap_or(Some(0.0)).unwrap_or(0.0),
    "register_ip": row.try_get::<Option<String>, _>("register_ip").ok().flatten(),
    "invite_code": row.try_get::<Option<String>, _>("invite_code").ok().flatten(),
    "invite_limit": row.try_get::<Option<i64>, _>("invite_limit").ok().flatten(),
    "invite_used": row.try_get::<Option<i64>, _>("invite_used").ok().flatten()
  })
}

async fn apply_user_update<T: UserUpdatePayload>(
  state: &AppState,
  user_id: Option<i64>,
  payload: &T
) -> Result<(), String> {
  let target_id = match user_id {
    Some(value) => value,
    None => {
      let row = sqlx::query("SELECT id FROM users WHERE email = ?")
        .bind(payload.email().unwrap_or_default())
        .fetch_optional(&state.db)
        .await
        .map_err(|err| err.to_string())?;
      row.and_then(|row| row.try_get::<Option<i64>, _>("id").ok().flatten())
        .unwrap_or(0)
    }
  };
  if target_id <= 0 {
    return Ok(());
  }

  if let Some(password) = payload.password() {
    if !password.trim().is_empty() {
      let hash = hash_password(password);
      sqlx::query("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(hash)
        .bind(target_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    }
  }

  let mut fields: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if let Some(value) = payload.email() {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
      fields.push("email = ?".to_string());
      params.push(SqlParam::String(trimmed.to_string()));
    }
  }
  if let Some(value) = payload.username() {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
      fields.push("username = ?".to_string());
      params.push(SqlParam::String(trimmed.to_string()));
    }
  }
  if let Some(value) = payload.status() {
    fields.push("status = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = payload.class_level() {
    fields.push("class = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = payload.expire_time() {
    fields.push("expire_time = ?".to_string());
    params.push(SqlParam::DateTime(value));
  }
  if let Some(value) = payload.class_expire_time() {
    fields.push("class_expire_time = ?".to_string());
    params.push(SqlParam::DateTime(value));
  }
  if let Some(value) = payload.transfer_enable() {
    fields.push("transfer_enable = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = payload.speed_limit() {
    fields.push("speed_limit = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = payload.device_limit() {
    fields.push("device_limit = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = payload.bark_key() {
    fields.push("bark_key = ?".to_string());
    params.push(SqlParam::String(value));
  }
  if let Some(value) = payload.bark_enabled() {
    fields.push("bark_enabled = ?".to_string());
    params.push(SqlParam::I64(if value { 1 } else { 0 }));
  }
  if let Some(value) = payload.money() {
    fields.push("money = ?".to_string());
    params.push(SqlParam::F64(value));
  }
  if let Some(value) = payload.invite_code() {
    fields.push("invite_code = ?".to_string());
    params.push(SqlParam::String(value));
  }
  if let Some(value) = payload.invite_limit() {
    fields.push("invite_limit = ?".to_string());
    params.push(SqlParam::I64(value));
  }

  if fields.is_empty() {
    return Ok(());
  }

  let sql = format!("UPDATE users SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", fields.join(", "));
  let mut query = sqlx::query(&sql);
  query = bind_params(query, &params);
  query
    .bind(target_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

  Ok(())
}

trait UserUpdatePayload {
  fn email(&self) -> Option<String>;
  fn username(&self) -> Option<String>;
  fn password(&self) -> Option<&str>;
  fn status(&self) -> Option<i64>;
  fn class_level(&self) -> Option<i64>;
  fn transfer_enable(&self) -> Option<i64>;
  fn expire_time(&self) -> Option<NaiveDateTime>;
  fn class_expire_time(&self) -> Option<NaiveDateTime>;
  fn speed_limit(&self) -> Option<i64>;
  fn device_limit(&self) -> Option<i64>;
  fn bark_key(&self) -> Option<String>;
  fn bark_enabled(&self) -> Option<bool>;
  fn invite_code(&self) -> Option<String>;
  fn invite_limit(&self) -> Option<i64>;
  fn money(&self) -> Option<f64>;
}

impl UserUpdatePayload for CreateUserRequest {
  fn email(&self) -> Option<String> {
    Some(self.email.clone())
  }
  fn username(&self) -> Option<String> {
    Some(self.username.clone())
  }
  fn password(&self) -> Option<&str> {
    Some(self.password.as_str())
  }
  fn status(&self) -> Option<i64> {
    None
  }
  fn class_level(&self) -> Option<i64> {
    self.class_level
  }
  fn transfer_enable(&self) -> Option<i64> {
    self.transfer_enable
  }
  fn expire_time(&self) -> Option<NaiveDateTime> {
    parse_datetime(self.expire_time.as_deref())
  }
  fn class_expire_time(&self) -> Option<NaiveDateTime> {
    parse_datetime(self.class_expire_time.as_deref())
  }
  fn speed_limit(&self) -> Option<i64> {
    self.speed_limit
  }
  fn device_limit(&self) -> Option<i64> {
    self.device_limit
  }
  fn bark_key(&self) -> Option<String> {
    self.bark_key.clone().map(|value| value.trim().to_string())
  }
  fn bark_enabled(&self) -> Option<bool> {
    self.bark_enabled
  }
  fn invite_code(&self) -> Option<String> {
    self.invite_code.clone().map(|value| value.trim().to_string())
  }
  fn invite_limit(&self) -> Option<i64> {
    self.invite_limit
  }
  fn money(&self) -> Option<f64> {
    self.money
  }
}

impl UserUpdatePayload for UpdateUserRequest {
  fn email(&self) -> Option<String> {
    self.email.clone()
  }
  fn username(&self) -> Option<String> {
    self.username.clone()
  }
  fn password(&self) -> Option<&str> {
    self.password.as_deref()
  }
  fn status(&self) -> Option<i64> {
    self.status
  }
  fn class_level(&self) -> Option<i64> {
    self.class_level
  }
  fn transfer_enable(&self) -> Option<i64> {
    self.transfer_enable
  }
  fn expire_time(&self) -> Option<NaiveDateTime> {
    parse_datetime(self.expire_time.as_deref())
  }
  fn class_expire_time(&self) -> Option<NaiveDateTime> {
    parse_datetime(self.class_expire_time.as_deref())
  }
  fn speed_limit(&self) -> Option<i64> {
    self.speed_limit
  }
  fn device_limit(&self) -> Option<i64> {
    self.device_limit
  }
  fn bark_key(&self) -> Option<String> {
    self.bark_key.clone().map(|value| value.trim().to_string())
  }
  fn bark_enabled(&self) -> Option<bool> {
    self.bark_enabled
  }
  fn invite_code(&self) -> Option<String> {
    self.invite_code.clone().map(|value| value.trim().to_string())
  }
  fn invite_limit(&self) -> Option<i64> {
    self.invite_limit
  }
  fn money(&self) -> Option<f64> {
    self.money
  }
}

fn parse_optional_i64(value: Option<&str>) -> Option<i64> {
  value
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .and_then(|value| value.parse::<i64>().ok())
}

fn parse_ids_from_query(value: Option<&str>) -> Vec<i64> {
  let raw = match value {
    Some(value) => value.trim(),
    None => return Vec::new()
  };
  if raw.is_empty() {
    return Vec::new();
  }
  raw
    .split(',')
    .filter_map(|item| item.trim().parse::<i64>().ok())
    .collect()
}

fn parse_datetime(value: Option<&str>) -> Option<NaiveDateTime> {
  let raw = value?.trim();
  if raw.is_empty() {
    return None;
  }
  if let Ok(dt) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
    return Some(dt);
  }
  if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
    return Some(dt.naive_local());
  }
  if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
    return date.and_hms_opt(0, 0, 0);
  }
  None
}

fn escape_csv(value: impl ToString) -> String {
  format!("\"{}\"", value.to_string().replace('"', "\"\""))
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

enum SqlParam {
  I64(i64),
  F64(f64),
  String(String),
  DateTime(NaiveDateTime)
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::F64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value),
      SqlParam::DateTime(value) => query.bind(*value)
    };
  }
  query
}
