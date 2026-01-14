use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::crypto::random_string;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct CouponQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>,
  keyword: Option<String>,
  search: Option<String>
}

#[derive(Deserialize)]
struct CouponPayload {
  name: Option<String>,
  code: Option<String>,
  discount_type: Option<String>,
  discount_value: Option<f64>,
  start_at: Option<i64>,
  end_at: Option<i64>,
  max_usage: Option<i64>,
  per_user_limit: Option<i64>,
  status: Option<i64>,
  description: Option<String>,
  package_ids: Option<Vec<i64>>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_coupons))
    .route("/", post(post_coupon))
    .route("/stats", get(get_coupon_stats))
    .route("/{id}", get(get_coupon_detail))
    .route("/{id}", put(put_coupon))
    .route("/{id}", delete(delete_coupon))
}

async fn get_coupons(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<CouponQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(100);
  let offset = (page - 1) * limit;
  let status = query.status.as_deref().map(|value| value.trim()).unwrap_or("");
  let keyword = query
    .keyword
    .or(query.search)
    .unwrap_or_default()
    .trim()
    .to_string();

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !status.is_empty() && status != "-1" {
    if let Ok(value) = status.parse::<i64>() {
      conditions.push("c.status = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }
  if !keyword.is_empty() {
    conditions.push("(c.name LIKE ? OR c.code LIKE ?)".to_string());
    let pattern = format!("%{keyword}%");
    params.push(SqlParam::String(pattern.clone()));
    params.push(SqlParam::String(pattern));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM coupons c {where_clause}");
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
      c.*,
      (
        SELECT COUNT(*)
        FROM coupon_packages cp
        WHERE cp.coupon_id = c.id
      ) as package_count
    FROM coupons c
    {where_clause}
    ORDER BY c.id DESC
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

  let coupons = rows
    .into_iter()
    .map(|row| map_coupon_row(&row))
    .collect::<Vec<Value>>();

  success(
    json!({
      "coupons": coupons,
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

async fn get_coupon_detail(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(coupon_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if coupon_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let row = sqlx::query("SELECT * FROM coupons WHERE id = ?")
    .bind(coupon_id)
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let row = match row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "优惠券不存在", None)
  };

  let packages_row = sqlx::query("SELECT package_id FROM coupon_packages WHERE coupon_id = ?")
    .bind(coupon_id)
    .fetch_all(&state.db)
    .await;
  let packages_row = match packages_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let package_ids = packages_row
    .into_iter()
    .filter_map(|row| row.try_get::<Option<i64>, _>("package_id").ok().flatten())
    .collect::<Vec<i64>>();

  let mut payload = map_coupon_row(&row);
  if let Value::Object(map) = &mut payload {
    map.insert("package_ids".to_string(), json!(package_ids));
  }

  success(payload, "Success").into_response()
}

async fn get_coupon_stats(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let summary_row = sqlx::query(
    r#"
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as enabled,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as disabled,
      SUM(CASE WHEN status = 1 AND start_at <= UNIX_TIMESTAMP() AND end_at >= UNIX_TIMESTAMP() THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN end_at < UNIX_TIMESTAMP() THEN 1 ELSE 0 END) as expired,
      SUM(CASE WHEN start_at > UNIX_TIMESTAMP() THEN 1 ELSE 0 END) as upcoming,
      COALESCE(SUM(total_used), 0) as total_used
    FROM coupons
    "#
  )
  .fetch_optional(&state.db)
  .await;
  let summary_row = match summary_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let usage_row = sqlx::query("SELECT COUNT(*) as total FROM coupon_usages")
    .fetch_optional(&state.db)
    .await;
  let usage_row = match usage_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let top_rows = sqlx::query(
    r#"
    SELECT id, name, code, total_used
    FROM coupons
    ORDER BY total_used DESC, id DESC
    LIMIT 5
    "#
  )
  .fetch_all(&state.db)
  .await;
  let top_rows = match top_rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let total = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);
  let enabled = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("enabled").ok().flatten())
    .unwrap_or(0);
  let disabled = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("disabled").ok().flatten())
    .unwrap_or(0);
  let active = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("active").ok().flatten())
    .unwrap_or(0);
  let expired = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("expired").ok().flatten())
    .unwrap_or(0);
  let upcoming = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("upcoming").ok().flatten())
    .unwrap_or(0);
  let total_used = summary_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_used").ok().flatten())
    .unwrap_or(0);
  let usage_records = usage_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let stats = json!({
    "total": total,
    "enabled": enabled,
    "disabled": disabled,
    "active": active,
    "expired": expired,
    "upcoming": upcoming,
    "total_used": total_used,
    "usage_records": usage_records
  });

  let top_coupons = top_rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
        "code": row.try_get::<Option<String>, _>("code").ok().flatten().unwrap_or_default(),
        "total_used": row.try_get::<Option<i64>, _>("total_used").ok().flatten().unwrap_or(0)
      })
    })
    .collect::<Vec<Value>>();

  success(json!({ "summary": stats, "top_coupons": top_coupons }), "Success").into_response()
}

async fn post_coupon(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<CouponPayload>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let name = body.name.unwrap_or_default().trim().to_string();
  if name.is_empty() {
    return error(StatusCode::BAD_REQUEST, "请输入优惠券名称", None);
  }

  let discount_type = match body.discount_type.as_deref() {
    Some("percentage") => "percentage",
    _ => "amount"
  };
  let mut discount_value = body.discount_value.unwrap_or(0.0);
  if discount_value <= 0.0 {
    return error(StatusCode::BAD_REQUEST, "优惠值必须大于0", None);
  }
  if discount_type == "amount" {
    discount_value = fix_money_precision(discount_value);
  } else if discount_value > 100.0 {
    return error(StatusCode::BAD_REQUEST, "折扣比例不能大于100%", None);
  }

  let start_at = match normalize_timestamp(body.start_at, "开始时间") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  let end_at = match normalize_timestamp(body.end_at, "结束时间") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  if end_at <= start_at {
    return error(StatusCode::BAD_REQUEST, "结束时间必须大于开始时间", None);
  }

  let code_input = body.code.unwrap_or_default();
  let code_raw = if code_input.trim().is_empty() {
    generate_coupon_code()
  } else {
    sanitize_code(&code_input)
  };
  if code_raw.is_empty() {
    return error(StatusCode::BAD_REQUEST, "优惠码不能为空", None);
  }

  if let Err(message) = ensure_coupon_code_unique(&state, &code_raw, None).await {
    return error(StatusCode::BAD_REQUEST, &message, None);
  }

  let max_usage = match normalize_limit(body.max_usage, "最大使用次数") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  let per_user_limit = match normalize_limit(body.per_user_limit, "每用户使用次数") {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };

  let status = body.status.unwrap_or(1);
  let description = body.description.map(|value| value.trim().to_string()).filter(|v| !v.is_empty());

  let result = sqlx::query(
    r#"
    INSERT INTO coupons
      (name, code, discount_type, discount_value, start_at, end_at, max_usage, per_user_limit, total_used, status, description)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    "#
  )
  .bind(&name)
  .bind(&code_raw)
  .bind(discount_type)
  .bind(discount_value)
  .bind(start_at)
  .bind(end_at)
  .bind(max_usage)
  .bind(per_user_limit)
  .bind(status)
  .bind(description.clone())
  .execute(&state.db)
  .await;

  let result = match result {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let coupon_id = result.last_insert_id() as i64;
  let package_ids = body.package_ids.clone().unwrap_or_default();
  if !package_ids.is_empty() {
    let package_ids = sanitize_package_ids(&package_ids);
    if let Err(err) = replace_coupon_packages(&state, coupon_id, &package_ids).await {
      return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None);
    }
  }

  success(
    json!({
      "id": coupon_id,
      "name": name,
      "code": code_raw,
      "discount_type": discount_type,
      "discount_value": discount_value,
      "start_at": start_at,
      "end_at": end_at,
      "max_usage": max_usage,
      "per_user_limit": per_user_limit,
      "status": status,
      "description": description,
      "package_ids": package_ids
    }),
    "Success"
  )
  .into_response()
}

async fn put_coupon(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(coupon_id): Path<i64>,
  Json(body): Json<CouponPayload>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if coupon_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let existing = sqlx::query("SELECT * FROM coupons WHERE id = ?")
    .bind(coupon_id)
    .fetch_optional(&state.db)
    .await;
  let existing = match existing {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let existing = match existing {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "优惠券不存在", None)
  };

  let mut update_fields: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if let Some(value) = body.name {
    let name = value.trim().to_string();
    if name.is_empty() {
      return error(StatusCode::BAD_REQUEST, "请输入优惠券名称", None);
    }
    update_fields.push("name = ?".to_string());
    params.push(SqlParam::String(name));
  }

  let mut discount_type = existing
    .try_get::<Option<String>, _>("discount_type")
    .ok()
    .flatten()
    .unwrap_or_else(|| "amount".to_string());
  let mut discount_value = parse_decimal(&existing, "discount_value", 0.0);

  let discount_type_input = body.discount_type.clone();
  if let Some(value) = discount_type_input.as_deref() {
    discount_type = if value == "percentage" { "percentage".to_string() } else { "amount".to_string() };
  }
  if let Some(value) = body.discount_value {
    discount_value = value;
  }
  if discount_type_input.is_some() || body.discount_value.is_some() {
    if discount_value <= 0.0 {
      return error(StatusCode::BAD_REQUEST, "优惠值必须大于0", None);
    }
    if discount_type == "amount" {
      discount_value = fix_money_precision(discount_value);
    } else if discount_value > 100.0 {
      return error(StatusCode::BAD_REQUEST, "折扣比例不能大于100%", None);
    }
    update_fields.push("discount_type = ?".to_string());
    params.push(SqlParam::String(discount_type.clone()));
    update_fields.push("discount_value = ?".to_string());
    params.push(SqlParam::F64(discount_value));
  }

  let mut start_at = existing.try_get::<Option<i64>, _>("start_at").ok().flatten().unwrap_or(0);
  let mut end_at = existing.try_get::<Option<i64>, _>("end_at").ok().flatten().unwrap_or(0);
  let mut time_changed = false;

  if body.start_at.is_some() {
    match normalize_timestamp(body.start_at, "开始时间") {
      Ok(value) => {
        start_at = value;
        time_changed = true;
      }
      Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
    }
  }
  if body.end_at.is_some() {
    match normalize_timestamp(body.end_at, "结束时间") {
      Ok(value) => {
        end_at = value;
        time_changed = true;
      }
      Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
    }
  }
  if time_changed {
    if end_at <= start_at {
      return error(StatusCode::BAD_REQUEST, "结束时间必须大于开始时间", None);
    }
    update_fields.push("start_at = ?".to_string());
    params.push(SqlParam::I64(start_at));
    update_fields.push("end_at = ?".to_string());
    params.push(SqlParam::I64(end_at));
  }

  if body.max_usage.is_some() {
    match normalize_limit(body.max_usage, "最大使用次数") {
      Ok(value) => {
        update_fields.push("max_usage = ?".to_string());
        params.push(SqlParam::NullableI64(value));
      }
      Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
    }
  }

  if body.per_user_limit.is_some() {
    match normalize_limit(body.per_user_limit, "每用户使用次数") {
      Ok(value) => {
        update_fields.push("per_user_limit = ?".to_string());
        params.push(SqlParam::NullableI64(value));
      }
      Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
    }
  }

  if let Some(value) = body.code {
    let code = sanitize_code(&value);
    if code.is_empty() {
      return error(StatusCode::BAD_REQUEST, "优惠码不能为空", None);
    }
    if let Err(message) = ensure_coupon_code_unique(&state, &code, Some(coupon_id)).await {
      return error(StatusCode::BAD_REQUEST, &message, None);
    }
    update_fields.push("code = ?".to_string());
    params.push(SqlParam::String(code));
  }

  if let Some(value) = body.status {
    update_fields.push("status = ?".to_string());
    params.push(SqlParam::I64(value));
  }

  if body.description.is_some() {
    let desc = body.description.unwrap_or_default();
    let desc = if desc.trim().is_empty() { None } else { Some(desc) };
    update_fields.push("description = ?".to_string());
    params.push(SqlParam::NullableString(desc));
  }

  if update_fields.is_empty() && body.package_ids.is_none() {
    return error(StatusCode::BAD_REQUEST, "没有需要更新的内容", None);
  }

  if !update_fields.is_empty() {
    update_fields.push("updated_at = CURRENT_TIMESTAMP".to_string());
    let sql = format!("UPDATE coupons SET {} WHERE id = ?", update_fields.join(", "));
    let mut query_builder = sqlx::query(&sql);
    query_builder = bind_params(query_builder, &params);
    let result = query_builder.bind(coupon_id).execute(&state.db).await;
    if let Err(err) = result {
      return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }
  }

  if let Some(package_ids) = body.package_ids {
    let package_ids = sanitize_package_ids(&package_ids);
    if let Err(err) = replace_coupon_packages(&state, coupon_id, &package_ids).await {
      return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None);
    }
  }

  success(json!({ "id": coupon_id }), "优惠券已更新").into_response()
}

async fn delete_coupon(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(coupon_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if coupon_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }
  if let Err(err) = sqlx::query("DELETE FROM coupons WHERE id = ?")
    .bind(coupon_id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  success(Value::Null, "已删除").into_response()
}

fn map_coupon_row(row: &sqlx::mysql::MySqlRow) -> Value {
  let discount_value = parse_decimal(row, "discount_value", 0.0);
  let max_usage = row
    .try_get::<Option<i64>, _>("max_usage")
    .ok()
    .flatten();
  let per_user_limit = row
    .try_get::<Option<i64>, _>("per_user_limit")
    .ok()
    .flatten();
  let total_used = row
    .try_get::<Option<i64>, _>("total_used")
    .ok()
    .flatten()
    .unwrap_or(0);
  let package_count = row
    .try_get::<Option<i64>, _>("package_count")
    .ok()
    .flatten()
    .unwrap_or(0);
  let remaining_usage = match max_usage {
    Some(max) => Some((max - total_used).max(0)),
    None => None
  };

  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    "code": row.try_get::<Option<String>, _>("code").ok().flatten().unwrap_or_default(),
    "discount_type": row.try_get::<Option<String>, _>("discount_type").ok().flatten().unwrap_or_else(|| "amount".to_string()),
    "discount_value": discount_value,
    "start_at": row.try_get::<Option<i64>, _>("start_at").ok().flatten().unwrap_or(0),
    "end_at": row.try_get::<Option<i64>, _>("end_at").ok().flatten().unwrap_or(0),
    "max_usage": max_usage,
    "per_user_limit": per_user_limit,
    "total_used": total_used,
    "remaining_usage": remaining_usage,
    "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0),
    "description": row.try_get::<Option<String>, _>("description").ok().flatten(),
    "package_count": package_count
  })
}

async fn ensure_coupon_code_unique(
  state: &AppState,
  code: &str,
  exclude_id: Option<i64>
) -> Result<(), String> {
  let row = if let Some(exclude_id) = exclude_id {
    sqlx::query("SELECT id FROM coupons WHERE code = ? AND id != ?")
      .bind(code)
      .bind(exclude_id)
      .fetch_optional(&state.db)
      .await
  } else {
    sqlx::query("SELECT id FROM coupons WHERE code = ?")
      .bind(code)
      .fetch_optional(&state.db)
      .await
  }
  .map_err(|err| err.to_string())?;
  if row.is_some() {
    return Err("优惠码已存在，请重新输入".to_string());
  }
  Ok(())
}

async fn replace_coupon_packages(
  state: &AppState,
  coupon_id: i64,
  package_ids: &[i64]
) -> Result<(), String> {
  sqlx::query("DELETE FROM coupon_packages WHERE coupon_id = ?")
    .bind(coupon_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;

  if package_ids.is_empty() {
    return Ok(());
  }

  for pkg_id in package_ids {
    sqlx::query(
      r#"
      INSERT IGNORE INTO coupon_packages (coupon_id, package_id)
      VALUES (?, ?)
      "#
    )
    .bind(coupon_id)
    .bind(pkg_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  }

  Ok(())
}

fn sanitize_package_ids(raw: &[i64]) -> Vec<i64> {
  let mut ids = raw.iter().copied().filter(|id| *id > 0).collect::<Vec<i64>>();
  ids.sort_unstable();
  ids.dedup();
  ids
}

fn generate_coupon_code() -> String {
  let mut code = sanitize_code(&random_string(16));
  if code.len() < 10 {
    code.push_str("ABCDEFGHJKL");
  }
  code.chars().take(10).collect()
}

fn sanitize_code(raw: &str) -> String {
  raw
    .chars()
    .filter(|ch| ch.is_ascii_alphanumeric())
    .collect::<String>()
    .to_uppercase()
}

fn normalize_timestamp(value: Option<i64>, field: &str) -> Result<i64, String> {
  let raw = value.ok_or_else(|| format!("{field} 不能为空"))?;
  let mut timestamp = raw;
  if timestamp <= 0 {
    return Err(format!("{field} 格式不正确"));
  }
  if timestamp > 1_000_000_000_000 {
    timestamp /= 1000;
  }
  Ok(timestamp)
}

fn normalize_limit(value: Option<i64>, field: &str) -> Result<Option<i64>, String> {
  match value {
    None => Ok(None),
    Some(v) if v <= 0 => Err(format!("{field} 必须为正整数")),
    Some(v) => Ok(Some(v))
  }
}

fn fix_money_precision(amount: f64) -> f64 {
  (amount * 100.0).round() / 100.0
}

fn parse_decimal(row: &sqlx::mysql::MySqlRow, column: &str, fallback: f64) -> f64 {
  if let Ok(value) = row.try_get::<Option<f64>, _>(column) {
    return value.unwrap_or(fallback);
  }
  if let Ok(value) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(column) {
    return value
      .map(|val| val.to_string().parse::<f64>().unwrap_or(fallback))
      .unwrap_or(fallback);
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
  F64(f64),
  String(String),
  NullableI64(Option<i64>),
  NullableString(Option<String>)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::F64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value),
      SqlParam::NullableI64(value) => query.bind(value),
      SqlParam::NullableString(value) => query.bind(value)
    };
  }
  query
}
