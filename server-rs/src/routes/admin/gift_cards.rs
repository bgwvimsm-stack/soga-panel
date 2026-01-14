use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct GiftCardQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>,
  #[serde(rename = "card_type")]
  card_type: Option<String>,
  keyword: Option<String>
}

#[derive(Deserialize)]
struct GiftCardPayload {
  name: Option<String>,
  code: Option<String>,
  #[serde(rename = "card_type")]
  card_type: Option<String>,
  balance_amount: Option<f64>,
  duration_days: Option<i64>,
  traffic_value_gb: Option<i64>,
  reset_traffic_gb: Option<i64>,
  package_id: Option<i64>,
  max_usage: Option<i64>,
  per_user_limit: Option<i64>,
  quantity: Option<i64>,
  start_at: Option<String>,
  end_at: Option<String>,
  description: Option<String>,
  #[serde(rename = "code_prefix")]
  code_prefix: Option<String>
}

#[derive(Deserialize)]
struct StatusRequest {
  status: Option<i64>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_gift_cards))
    .route("/", post(post_gift_cards))
    .route("/{id}", put(put_gift_card))
    .route("/{id}/status", post(post_gift_card_status))
    .route("/{id}", delete(delete_gift_card))
    .route("/{id}/redemptions", get(get_redemptions))
}

async fn get_gift_cards(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<GiftCardQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(100);
  let offset = (page - 1) * limit;
  let status = query.status.as_deref().map(|value| value.trim()).unwrap_or("");
  let card_type = query.card_type.unwrap_or_default().trim().to_string();
  let keyword = query.keyword.unwrap_or_default().trim().to_string();

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !status.is_empty() {
    if let Ok(value) = status.parse::<i64>() {
      conditions.push("gc.status = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }
  if !card_type.is_empty() {
    conditions.push("gc.card_type = ?".to_string());
    params.push(SqlParam::String(card_type));
  }
  if !keyword.is_empty() {
    conditions.push("(UPPER(gc.code) LIKE ? OR gc.name LIKE ?)".to_string());
    params.push(SqlParam::String(format!("%{}%", keyword.to_uppercase())));
    params.push(SqlParam::String(format!("%{keyword}%")));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM gift_cards gc {where_clause}");
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
      gc.*,
      gb.name as batch_name,
      p.name as package_name
    FROM gift_cards gc
    LEFT JOIN gift_card_batches gb ON gc.batch_id = gb.id
    LEFT JOIN packages p ON gc.package_id = p.id
    {where_clause}
    ORDER BY gc.id DESC
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

  let records = rows
    .into_iter()
    .map(|row| map_gift_card_row(&row))
    .collect::<Vec<Value>>();

  success(
    json!({
      "records": records,
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": if total > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 0 }
      }
    }),
    "Success"
  )
  .into_response()
}

async fn post_gift_cards(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<GiftCardPayload>
) -> Response {
  let admin_id = match require_admin_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let name = body.name.unwrap_or_default().trim().to_string();
  if name.is_empty() {
    return error(StatusCode::BAD_REQUEST, "请输入礼品卡名称", None);
  }

  let card_type = body.card_type.unwrap_or_else(|| "balance".to_string());
  let card_type = match card_type.as_str() {
    "balance" | "duration" | "traffic" | "reset_traffic" | "package" => card_type,
    _ => return error(StatusCode::BAD_REQUEST, "无效的礼品卡类型", None)
  };

  let validate_positive = |value: Option<f64>, label: &str| -> Result<Option<f64>, String> {
    match value {
      None => Ok(None),
      Some(raw) if raw <= 0.0 => Err(format!("{label}必须大于0")),
      Some(raw) => Ok(Some(raw))
    }
  };

  let balance_amount = match validate_positive(body.balance_amount, "充值金额") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  let duration_days = match normalize_positive_i64(body.duration_days, "订阅天数") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  let traffic_value_gb = match normalize_positive_i64(body.traffic_value_gb, "流量数值") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  let reset_traffic_gb = match normalize_optional_i64(body.reset_traffic_gb) {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };

  if card_type == "balance" && balance_amount.is_none() {
    return error(StatusCode::BAD_REQUEST, "充值金额必须大于0", None);
  }
  if card_type == "duration" && duration_days.is_none() {
    return error(StatusCode::BAD_REQUEST, "订阅天数必须大于0", None);
  }
  if card_type == "traffic" && traffic_value_gb.is_none() {
    return error(StatusCode::BAD_REQUEST, "流量数值必须大于0", None);
  }
  if card_type == "package" {
    if body.package_id.unwrap_or(0) <= 0 {
      return error(StatusCode::BAD_REQUEST, "请选择可兑换的套餐", None);
    }
  }

  let max_usage = match normalize_positive_i64(body.max_usage, "最大使用次数") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  let per_user_limit = match normalize_positive_i64(body.per_user_limit, "单用户使用次数") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };

  let quantity = body.quantity.unwrap_or(1).max(1).min(500);
  let code_prefix = sanitize_code(body.code_prefix.unwrap_or_else(|| "GC".to_string()).as_str());
  let code_prefix = if code_prefix.is_empty() { "GC".to_string() } else { code_prefix };

  let start_at = format_datetime_input(body.start_at.as_deref());
  let end_at = format_datetime_input(body.end_at.as_deref());

  let batch_result = sqlx::query(
    r#"
    INSERT INTO gift_card_batches
      (name, description, card_type, quantity, code_prefix, balance_amount, duration_days, traffic_value_gb,
       reset_traffic_gb, package_id, max_usage, per_user_limit, start_at, end_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#
  )
  .bind(&name)
  .bind(body.description.map(|value| value.trim().to_string()))
  .bind(&card_type)
  .bind(quantity)
  .bind(&code_prefix)
  .bind(balance_amount)
  .bind(duration_days)
  .bind(traffic_value_gb)
  .bind(if card_type == "reset_traffic" { None::<i64> } else { reset_traffic_gb })
  .bind(body.package_id)
  .bind(max_usage)
  .bind(per_user_limit)
  .bind(start_at.clone())
  .bind(end_at.clone())
  .bind(admin_id)
  .execute(&state.db)
  .await;

  let batch_result = match batch_result {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let batch_id = batch_result.last_insert_id() as i64;

  let mut cards: Vec<Value> = Vec::new();
  for _ in 0..quantity {
    let mut final_code = if quantity == 1 {
      let provided = body.code.as_deref().unwrap_or("");
      if !provided.trim().is_empty() {
        sanitize_code(provided)
      } else {
        generate_gift_card_code(&code_prefix)
      }
    } else {
      generate_gift_card_code(&code_prefix)
    };

    if final_code.is_empty() {
      return error(StatusCode::BAD_REQUEST, "礼品卡卡密无效", None);
    }

    let mut attempt = 0;
    while attempt < 5 && code_exists(&state, &final_code).await.unwrap_or(true) {
      final_code = generate_gift_card_code(&code_prefix);
      attempt += 1;
    }

    let insert = sqlx::query(
      r#"
      INSERT INTO gift_cards
        (batch_id, name, code, card_type, status, balance_amount, duration_days, traffic_value_gb,
         reset_traffic_gb, package_id, max_usage, per_user_limit, start_at, end_at, created_by)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      "#
    )
    .bind(batch_id)
    .bind(&name)
    .bind(&final_code)
    .bind(&card_type)
    .bind(balance_amount)
    .bind(duration_days)
    .bind(traffic_value_gb)
    .bind(if card_type == "reset_traffic" { None::<i64> } else { reset_traffic_gb })
    .bind(body.package_id)
    .bind(max_usage)
    .bind(per_user_limit)
    .bind(start_at.clone())
    .bind(end_at.clone())
    .bind(admin_id)
    .execute(&state.db)
    .await;

    let insert = match insert {
      Ok(value) => value,
      Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
    };
    let card_id = insert.last_insert_id() as i64;
    cards.push(json!({
      "id": card_id,
      "batch_id": batch_id,
      "name": name,
      "code": final_code,
      "card_type": card_type,
      "status": 1,
      "balance_amount": balance_amount,
      "duration_days": duration_days,
      "traffic_value_gb": traffic_value_gb,
      "reset_traffic_gb": if card_type == "reset_traffic" { Value::Null } else { json!(reset_traffic_gb) },
      "package_id": body.package_id,
      "max_usage": max_usage,
      "per_user_limit": per_user_limit,
      "used_count": 0,
      "start_at": start_at,
      "end_at": end_at
    }));
  }

  success(json!({ "batch_id": batch_id, "cards": cards }), "Success").into_response()
}

async fn put_gift_card(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(card_id): Path<i64>,
  Json(body): Json<GiftCardPayload>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if card_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let allowed_fields = [
    ("name", body.name.map(|value| Value::String(value))),
    ("card_type", body.card_type.map(Value::String)),
    ("balance_amount", body.balance_amount.map(|value| json!(value))),
    ("duration_days", body.duration_days.map(|value| json!(value))),
    ("traffic_value_gb", body.traffic_value_gb.map(|value| json!(value))),
    ("reset_traffic_gb", body.reset_traffic_gb.map(|value| json!(value))),
    ("package_id", body.package_id.map(|value| json!(value))),
    ("max_usage", body.max_usage.map(|value| json!(value))),
    ("per_user_limit", body.per_user_limit.map(|value| json!(value))),
    ("start_at", body.start_at.as_ref().map(|value| Value::String(value.clone()))),
    ("end_at", body.end_at.as_ref().map(|value| Value::String(value.clone())))
  ];

  let mut updates: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  for (field, value) in allowed_fields {
    let value = match value {
      Some(value) => value,
      None => continue
    };
    match field {
      "card_type" => {
        let raw = value.as_str().unwrap_or("").trim();
        if !raw.is_empty() {
          updates.push("card_type = ?".to_string());
          params.push(SqlParam::String(raw.to_string()));
        }
      }
      "start_at" | "end_at" => {
        let formatted = format_datetime_input(value.as_str());
        updates.push(format!("{field} = ?"));
        params.push(SqlParam::NullableString(formatted));
      }
      "max_usage" | "per_user_limit" => {
        let raw = value.as_i64();
        if let Some(num) = raw {
          if num <= 0 {
            return error(StatusCode::BAD_REQUEST, &format!("{field} 必须大于 0"), None);
          }
          updates.push(format!("{field} = ?"));
          params.push(SqlParam::I64(num));
        } else {
          updates.push(format!("{field} = ?"));
          params.push(SqlParam::NullableI64(None));
        }
      }
      "balance_amount" => {
        let raw = value.as_f64();
        updates.push("balance_amount = ?".to_string());
        params.push(SqlParam::NullableF64(raw));
      }
      "duration_days" | "traffic_value_gb" | "reset_traffic_gb" | "package_id" => {
        updates.push(format!("{field} = ?"));
        params.push(SqlParam::NullableI64(value.as_i64()));
      }
      _ => {
        updates.push(format!("{field} = ?"));
        params.push(SqlParam::String(value.as_str().unwrap_or("").to_string()));
      }
    }
  }

  if updates.is_empty() {
    return error(StatusCode::BAD_REQUEST, "没有需要更新的字段", None);
  }

  let sql = format!(
    "UPDATE gift_cards SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    updates.join(", ")
  );
  let mut query_builder = sqlx::query(&sql);
  query_builder = bind_params(query_builder, &params);
  let result = query_builder.bind(card_id).execute(&state.db).await;
  if let Err(err) = result {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(json!({ "id": card_id, "message": "礼品卡已更新" }), "礼品卡已更新").into_response()
}

async fn post_gift_card_status(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(card_id): Path<i64>,
  Json(body): Json<StatusRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if card_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let status = body.status.unwrap_or(1);
  if ![0, 1, 2].contains(&status) {
    return error(StatusCode::BAD_REQUEST, "状态无效", None);
  }

  if let Err(err) = sqlx::query(
    r#"
    UPDATE gift_cards
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(status)
  .bind(card_id)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(json!({ "id": card_id, "status": status }), "状态已更新").into_response()
}

async fn delete_gift_card(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(card_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if card_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let row = sqlx::query("SELECT used_count FROM gift_cards WHERE id = ?")
    .bind(card_id)
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let row = match row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "礼品卡不存在", None)
  };
  let used_count = row.try_get::<Option<i64>, _>("used_count").unwrap_or(Some(0)).unwrap_or(0);
  if used_count > 0 {
    return error(StatusCode::BAD_REQUEST, "已使用的礼品卡不能删除", None);
  }

  if let Err(err) = sqlx::query("DELETE FROM gift_cards WHERE id = ?")
    .bind(card_id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(json!({ "id": card_id }), "礼品卡已删除").into_response()
}

async fn get_redemptions(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(card_id): Path<i64>,
  Query(query): Query<PaginationQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if card_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(100);
  let offset = (page - 1) * limit;

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM gift_card_redemptions WHERE card_id = ?")
    .bind(card_id)
    .fetch_optional(&state.db)
    .await;
  let total_row = match total_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let rows = sqlx::query(
    r#"
    SELECT gcr.*, u.email as user_email, u.username as user_name
    FROM gift_card_redemptions gcr
    LEFT JOIN users u ON gcr.user_id = u.id
    WHERE gcr.card_id = ?
    ORDER BY gcr.created_at DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(card_id)
  .bind(limit)
  .bind(offset)
  .fetch_all(&state.db)
  .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let records = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "user_id": row.try_get::<Option<i64>, _>("user_id").unwrap_or(Some(0)).unwrap_or(0),
        "user_email": row.try_get::<Option<String>, _>("user_email").ok().flatten(),
        "user_name": row.try_get::<Option<String>, _>("user_name").ok().flatten(),
        "code": row.try_get::<Option<String>, _>("code").ok().flatten().unwrap_or_default(),
        "card_type": row.try_get::<Option<String>, _>("card_type").ok().flatten().unwrap_or_default(),
        "change_amount": parse_decimal(&row, "change_amount", 0.0),
        "duration_days": row.try_get::<Option<i64>, _>("duration_days").ok().flatten(),
        "traffic_value_gb": row.try_get::<Option<i64>, _>("traffic_value_gb").ok().flatten(),
        "reset_traffic_gb": row.try_get::<Option<i64>, _>("reset_traffic_gb").ok().flatten(),
        "package_id": row.try_get::<Option<i64>, _>("package_id").ok().flatten(),
        "trade_no": row.try_get::<Option<String>, _>("trade_no").ok().flatten(),
        "message": row.try_get::<Option<String>, _>("message").ok().flatten(),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  success(
    json!({
      "records": records,
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": if total > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 0 }
      }
    }),
    "Success"
  )
  .into_response()
}

#[derive(Deserialize)]
struct PaginationQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>
}

fn normalize_positive_i64(value: Option<i64>, label: &str) -> Result<Option<i64>, String> {
  match value {
    None => Ok(None),
    Some(raw) if raw <= 0 => Err(format!("{label}必须大于0")),
    Some(raw) => Ok(Some(raw))
  }
}

fn normalize_optional_i64(value: Option<i64>) -> Result<Option<i64>, String> {
  match value {
    None => Ok(None),
    Some(raw) => Ok(Some(raw.max(0)))
  }
}

fn sanitize_code(raw: &str) -> String {
  raw
    .chars()
    .filter(|ch| ch.is_ascii_alphanumeric())
    .collect::<String>()
    .to_uppercase()
}

fn generate_gift_card_code(prefix: &str) -> String {
  let suffix = Utc::now().timestamp_millis().to_string();
  let tail = if suffix.len() > 6 {
    suffix[suffix.len() - 6..].to_string()
  } else {
    suffix
  };
  format!("{}{}{}", prefix, tail, random_suffix(6))
}

fn random_suffix(len: usize) -> String {
  let raw = crate::crypto::random_string(len + 4);
  sanitize_code(&raw).chars().take(len).collect()
}

fn format_datetime_input(value: Option<&str>) -> Option<String> {
  let raw = value?.trim();
  if raw.is_empty() {
    return None;
  }
  if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
    return Some(dt.naive_local().format("%Y-%m-%d %H:%M:%S").to_string());
  }
  if let Ok(dt) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
    return Some(dt.format("%Y-%m-%d %H:%M:%S").to_string());
  }
  if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
    return date.and_hms_opt(0, 0, 0).map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string());
  }
  None
}

async fn code_exists(state: &AppState, code: &str) -> Result<bool, String> {
  let row = sqlx::query("SELECT id FROM gift_cards WHERE code = ? LIMIT 1")
    .bind(code)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  Ok(row.is_some())
}

fn map_gift_card_row(row: &sqlx::mysql::MySqlRow) -> Value {
  let max_usage = row.try_get::<Option<i64>, _>("max_usage").ok().flatten();
  let per_user_limit = row.try_get::<Option<i64>, _>("per_user_limit").ok().flatten();
  let used_count = row.try_get::<Option<i64>, _>("used_count").ok().flatten().unwrap_or(0);
  let remaining = match max_usage {
    Some(max) => Some((max - used_count).max(0)),
    None => None
  };
  let end_at = row
    .try_get::<Option<NaiveDateTime>, _>("end_at")
    .ok()
    .flatten();
  let is_expired = end_at.map(|dt| dt < Utc::now().naive_utc()).unwrap_or(false);

  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "batch_id": row.try_get::<Option<i64>, _>("batch_id").ok().flatten(),
    "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    "code": row.try_get::<Option<String>, _>("code").ok().flatten().unwrap_or_default(),
    "card_type": row.try_get::<Option<String>, _>("card_type").ok().flatten().unwrap_or_default(),
    "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0),
    "balance_amount": parse_decimal(row, "balance_amount", 0.0),
    "duration_days": row.try_get::<Option<i64>, _>("duration_days").ok().flatten(),
    "traffic_value_gb": row.try_get::<Option<i64>, _>("traffic_value_gb").ok().flatten(),
    "reset_traffic_gb": row.try_get::<Option<i64>, _>("reset_traffic_gb").ok().flatten(),
    "package_id": row.try_get::<Option<i64>, _>("package_id").ok().flatten(),
    "package_name": row.try_get::<Option<String>, _>("package_name").ok().flatten(),
    "max_usage": max_usage,
    "per_user_limit": per_user_limit,
    "used_count": used_count,
    "remaining_usage": remaining,
    "start_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("start_at").ok().flatten()),
    "end_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("end_at").ok().flatten()),
    "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
    "batch_name": row.try_get::<Option<String>, _>("batch_name").ok().flatten(),
    "is_expired": is_expired
  })
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn parse_decimal(row: &sqlx::mysql::MySqlRow, column: &str, fallback: f64) -> f64 {
  if let Ok(value) = row.try_get::<Option<f64>, _>(column) {
    return value.unwrap_or(fallback);
  }
  if let Ok(value) = row.try_get::<Option<String>, _>(column) {
    return value
      .and_then(|val| val.parse::<f64>().ok())
      .unwrap_or(fallback);
  }
  fallback
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  I64(i64),
  String(String),
  NullableI64(Option<i64>),
  NullableString(Option<String>),
  NullableF64(Option<f64>)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value),
      SqlParam::NullableI64(value) => query.bind(value),
      SqlParam::NullableString(value) => query.bind(value),
      SqlParam::NullableF64(value) => query.bind(value)
    };
  }
  query
}
