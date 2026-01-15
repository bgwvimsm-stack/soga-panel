use axum::body::Body;
use axum::extract::State;
use axum::http::{header, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, post};
use axum::Router;
use chrono::{Duration, Local, NaiveDateTime};
use serde_json::Value;
use sqlx::Row;

use crate::payment::{verify_callback, verify_epay_callback, verify_epusdt_callback, PaymentCallbackResult};
use crate::referral::award_rebate;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", post(post_callback))
    .route("/epay", post(post_epay_callback))
    .route("/epusdt", post(post_epusdt_callback))
}

pub fn notify_router() -> Router<AppState> {
  Router::new().route("/notify", any(payment_notify))
}

async fn post_callback(State(state): State<AppState>, req: Request<Body>) -> Response {
  let payload = match parse_request_payload(req).await {
    Ok(value) => value,
    Err(message) => return text_response(StatusCode::BAD_REQUEST, &message)
  };
  let result = verify_callback(&state.env, &payload);
  handle_callback(&state, result, payload).await
}

async fn post_epay_callback(State(state): State<AppState>, req: Request<Body>) -> Response {
  let payload = match parse_request_payload(req).await {
    Ok(value) => value,
    Err(message) => return text_response(StatusCode::BAD_REQUEST, &message)
  };
  let mut result = verify_epay_callback(&state.env, &payload);
  result.method = Some("epay".to_string());
  handle_callback(&state, result, payload).await
}

async fn post_epusdt_callback(State(state): State<AppState>, req: Request<Body>) -> Response {
  let payload = match parse_request_payload(req).await {
    Ok(value) => value,
    Err(message) => return text_response(StatusCode::BAD_REQUEST, &message)
  };
  let mut result = verify_epusdt_callback(&state.env, &payload);
  result.method = Some("epusdt".to_string());
  handle_callback(&state, result, payload).await
}

async fn payment_notify(State(state): State<AppState>, req: Request<Body>) -> Response {
  let payload = match parse_request_payload(req).await {
    Ok(value) => value,
    Err(message) => return text_response(StatusCode::BAD_REQUEST, &message)
  };
  let epay = verify_epay_callback(&state.env, &payload);
  if epay.ok {
    return handle_callback(&state, epay, payload).await;
  }
  let mut epusdt = verify_epusdt_callback(&state.env, &payload);
  epusdt.method = Some("epusdt".to_string());
  handle_callback(&state, epusdt, payload).await
}

async fn handle_callback(
  state: &AppState,
  result: PaymentCallbackResult,
  _payload: serde_json::Map<String, Value>
) -> Response {
  if !result.ok {
    return text_response(StatusCode::OK, "fail");
  }
  let trade_no = match result.trade_no {
    Some(value) if !value.trim().is_empty() => value,
    _ => return text_response(StatusCode::OK, "fail")
  };

  let settled = match settle_trade(state, &trade_no).await {
    Ok(value) => value,
    Err(_) => return text_response(StatusCode::OK, "fail")
  };

  if settled {
    let body = if result.method.as_deref() == Some("epusdt") { "ok" } else { "success" };
    return text_response(StatusCode::OK, body);
  }
  text_response(StatusCode::OK, "fail")
}

async fn parse_request_payload(req: Request<Body>) -> Result<serde_json::Map<String, Value>, String> {
  if req.method() == Method::GET {
    let query = req.uri().query().unwrap_or("");
    return parse_payload_bytes(query.as_bytes());
  }

  let body = axum::body::to_bytes(req.into_body(), usize::MAX)
    .await
    .map_err(|err| err.to_string())?;
  parse_payload_bytes(&body)
}

fn parse_payload_bytes(bytes: &[u8]) -> Result<serde_json::Map<String, Value>, String> {
  if bytes.is_empty() {
    return Ok(serde_json::Map::new());
  }

  if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
    if let Some(map) = value.as_object() {
      return Ok(map.clone());
    }
    if let Some(text) = value.as_str() {
      return Ok(parse_payload_text(text));
    }
    return Ok(serde_json::Map::new());
  }

  let text = match std::str::from_utf8(bytes) {
    Ok(value) => value,
    Err(_) => return Ok(serde_json::Map::new())
  };
  Ok(parse_payload_text(text))
}

fn parse_payload_text(text: &str) -> serde_json::Map<String, Value> {
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return serde_json::Map::new();
  }

  if (trimmed.starts_with('{') && trimmed.ends_with('}')) || trimmed.starts_with('[') {
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
      if let Some(map) = value.as_object() {
        return map.clone();
      }
    }
  }

  let map = match serde_urlencoded::from_str::<std::collections::HashMap<String, String>>(trimmed) {
    Ok(value) => value,
    Err(_) => return serde_json::Map::new()
  };
  let mut output = serde_json::Map::new();
  for (key, value) in map {
    output.insert(key, Value::String(value));
  }
  output
}

fn text_response(status: StatusCode, body: &str) -> Response {
  (
    status,
    [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
    body.to_string()
  )
    .into_response()
}

async fn settle_trade(state: &AppState, trade_no: &str) -> Result<bool, String> {
  if let Some(result) = mark_recharge_paid(state, trade_no).await? {
    if result.applied {
      let _ = award_rebate(
        state,
        result.user_id,
        result.amount,
        "recharge",
        Some(result.record_id),
        Some(trade_no),
        Some("recharge_rebate")
      )
      .await;
    }
    return Ok(true);
  }

  if let Some(result) = mark_purchase_paid(state, trade_no).await? {
    if result.applied {
      let amount = result.amount;
      let _ = award_rebate(
        state,
        result.user_id,
        amount,
        "purchase",
        Some(result.record_id),
        Some(trade_no),
        Some("purchase_rebate")
      )
      .await;
    }
    return Ok(true);
  }

  Ok(false)
}

pub(crate) struct RechargePaidResult {
  pub(crate) record_id: i64,
  pub(crate) user_id: i64,
  pub(crate) amount: f64,
  pub(crate) applied: bool
}

pub(crate) async fn mark_recharge_paid(
  state: &AppState,
  trade_no: &str
) -> Result<Option<RechargePaidResult>, String> {
  let record = sqlx::query(
    "SELECT id, user_id, CAST(amount AS DOUBLE) as amount, status FROM recharge_records WHERE trade_no = ?"
  )
    .bind(trade_no)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  let record = match record {
    Some(value) => value,
    None => return Ok(None)
  };

  let update = sqlx::query(
    r#"
    UPDATE recharge_records
    SET status = 1, paid_at = CURRENT_TIMESTAMP
    WHERE trade_no = ? AND status = 0
    "#
  )
  .bind(trade_no)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  if update.rows_affected() == 0 {
    return Ok(Some(RechargePaidResult {
      record_id: record.try_get::<i64, _>("id").unwrap_or(0),
      user_id: record.try_get::<i64, _>("user_id").unwrap_or(0),
      amount: parse_decimal(&record, "amount", 0.0),
      applied: false
    }));
  }

  let user_id = record.try_get::<i64, _>("user_id").unwrap_or(0);
  let amount = parse_decimal(&record, "amount", 0.0);
  sqlx::query(
    r#"
    UPDATE users
    SET money = money + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(amount)
  .bind(user_id)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(Some(RechargePaidResult {
    record_id: record.try_get::<i64, _>("id").unwrap_or(0),
    user_id,
    amount,
    applied: true
  }))
}

pub(crate) struct PurchasePaidResult {
  pub(crate) record_id: i64,
  pub(crate) user_id: i64,
  pub(crate) amount: f64,
  pub(crate) applied: bool
}

pub(crate) async fn mark_purchase_paid(
  state: &AppState,
  trade_no: &str
) -> Result<Option<PurchasePaidResult>, String> {
  let record = sqlx::query(
    r#"
    SELECT id, user_id, package_id, status,
           CAST(price AS DOUBLE) as price,
           CAST(package_price AS DOUBLE) as package_price,
           CAST(discount_amount AS DOUBLE) as discount_amount,
           coupon_id, coupon_code, purchase_type
    FROM package_purchase_records
    WHERE trade_no = ?
    "#
  )
  .bind(trade_no)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  let record = match record {
    Some(value) => value,
    None => return Ok(None)
  };

  let package_id = record.try_get::<i64, _>("package_id").unwrap_or(0);
  let package = match get_package_by_id_any(state, package_id).await? {
    Some(value) => value,
    None => return Err("套餐不存在或已下架".to_string())
  };

  let update = sqlx::query(
    r#"
    UPDATE package_purchase_records
    SET status = 1, paid_at = CURRENT_TIMESTAMP
    WHERE trade_no = ? AND status = 0
    "#
  )
  .bind(trade_no)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  if update.rows_affected() == 0 {
    return Ok(Some(PurchasePaidResult {
      record_id: record.try_get::<i64, _>("id").unwrap_or(0),
      user_id: record.try_get::<i64, _>("user_id").unwrap_or(0),
      amount: parse_decimal(&record, "price", 0.0),
      applied: false
    }));
  }

  let purchase_type = record
    .try_get::<Option<String>, _>("purchase_type")
    .ok()
    .flatten()
    .unwrap_or_default()
    .to_lowercase();
  if purchase_type.starts_with("balance_") {
    let base_price = parse_decimal(&record, "package_price", parse_decimal(&record, "price", 0.0));
    let discount = parse_decimal(&record, "discount_amount", 0.0);
    let online_paid = parse_decimal(&record, "price", 0.0);
    let balance_need = (base_price - discount - online_paid).max(0.0);
    if balance_need > 0.0 {
      let ok = deduct_user_balance(state, record.try_get::<i64, _>("user_id").unwrap_or(0), balance_need).await?;
      if !ok {
        sqlx::query(
          r#"
          UPDATE package_purchase_records
          SET status = 0, paid_at = NULL
          WHERE trade_no = ? AND status = 1
          "#
        )
        .bind(trade_no)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
        return Err("余额扣除失败，请联系管理员".to_string());
      }
    }
  }

  let coupon_id = record.try_get::<Option<i64>, _>("coupon_id").ok().flatten();
  if let Some(coupon_id) = coupon_id {
    let order_id = record.try_get::<i64, _>("id").unwrap_or(0);
    let user_id = record.try_get::<i64, _>("user_id").unwrap_or(0);
    record_coupon_usage(state, coupon_id, user_id, order_id, trade_no).await?;
  }

  let apply = update_user_after_package_purchase(state, record.try_get::<i64, _>("user_id").unwrap_or(0), &package).await?;
  if let Some(expire) = apply.new_expire_time.as_ref() {
    sqlx::query("UPDATE package_purchase_records SET expires_at = ? WHERE trade_no = ?")
      .bind(expire)
      .bind(trade_no)
      .execute(&state.db)
      .await
      .map_err(|err| err.to_string())?;
  }

  Ok(Some(PurchasePaidResult {
    record_id: record.try_get::<i64, _>("id").unwrap_or(0),
    user_id: record.try_get::<i64, _>("user_id").unwrap_or(0),
    amount: parse_decimal(&record, "price", 0.0),
    applied: true
  }))
}

async fn deduct_user_balance(state: &AppState, user_id: i64, amount: f64) -> Result<bool, String> {
  let result = sqlx::query(
    r#"
    UPDATE users
    SET money = money - ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND money >= ?
    "#
  )
  .bind(amount)
  .bind(user_id)
  .bind(amount)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(result.rows_affected() > 0)
}

async fn record_coupon_usage(
  state: &AppState,
  coupon_id: i64,
  user_id: i64,
  order_id: i64,
  trade_no: &str
) -> Result<(), String> {
  sqlx::query(
    r#"
    INSERT INTO coupon_usages (coupon_id, user_id, order_id, order_trade_no, used_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(coupon_id)
  .bind(user_id)
  .bind(order_id)
  .bind(trade_no)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

#[derive(Clone)]
struct PackageRow {
  traffic_quota: Option<i64>,
  validity_days: i64,
  level: i64,
  speed_limit: i64,
  device_limit: i64
}

async fn get_package_by_id_any(state: &AppState, package_id: i64) -> Result<Option<PackageRow>, String> {
  let row = sqlx::query(
    r#"
    SELECT traffic_quota, validity_days, level, speed_limit, device_limit
    FROM packages
    WHERE id = ?
    "#
  )
  .bind(package_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(row.map(|row| PackageRow {
    traffic_quota: row.try_get::<Option<i64>, _>("traffic_quota").ok().flatten(),
    validity_days: row.try_get::<Option<i64>, _>("validity_days").ok().flatten().unwrap_or(30),
    level: row.try_get::<Option<i64>, _>("level").ok().flatten().unwrap_or(0),
    speed_limit: row.try_get::<Option<i64>, _>("speed_limit").ok().flatten().unwrap_or(0),
    device_limit: row.try_get::<Option<i64>, _>("device_limit").ok().flatten().unwrap_or(0)
  }))
}

struct ApplyPackageResult {
  new_expire_time: Option<String>
}

async fn update_user_after_package_purchase(
  state: &AppState,
  user_id: i64,
  package: &PackageRow
) -> Result<ApplyPackageResult, String> {
  let user_row = sqlx::query(
    r#"
    SELECT class, class_expire_time, transfer_enable, transfer_total, speed_limit, device_limit
    FROM users
    WHERE id = ?
    "#
  )
  .bind(user_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  let user_row = match user_row {
    Some(value) => value,
    None => return Err("用户不存在".to_string())
  };

  let now = Local::now().naive_local();
  let current_level = user_row.try_get::<Option<i64>, _>("class").ok().flatten().unwrap_or(0);
  let class_expire = user_row.try_get::<Option<NaiveDateTime>, _>("class_expire_time").ok().flatten();
  let current_transfer_enable = user_row
    .try_get::<Option<i64>, _>("transfer_enable")
    .ok()
    .flatten()
    .unwrap_or(0);
  let package_traffic_bytes = (package.traffic_quota.unwrap_or(0) as f64 * 1024.0 * 1024.0 * 1024.0).round() as i64;
  let validity_days = package.validity_days.max(1);

  let (new_expire, new_quota, reset_used) = if let Some(expire) = class_expire {
    if expire > now && current_level == package.level {
      (
        expire + Duration::days(validity_days),
        current_transfer_enable + package_traffic_bytes,
        false
      )
    } else if current_level == package.level {
      (
        now + Duration::days(validity_days),
        current_transfer_enable + package_traffic_bytes,
        false
      )
    } else {
      (
        now + Duration::days(validity_days),
        package_traffic_bytes,
        true
      )
    }
  } else if current_level == package.level {
    (
      now + Duration::days(validity_days),
      current_transfer_enable + package_traffic_bytes,
      false
    )
  } else {
    (
      now + Duration::days(validity_days),
      package_traffic_bytes,
      true
    )
  };

  if reset_used {
    sqlx::query(
      r#"
      UPDATE users
      SET class = ?, class_expire_time = ?, transfer_enable = ?, transfer_total = 0,
          upload_traffic = 0, download_traffic = 0, upload_today = 0, download_today = 0,
          speed_limit = ?, device_limit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#
    )
    .bind(package.level)
    .bind(new_expire)
    .bind(new_quota)
    .bind(package.speed_limit)
    .bind(package.device_limit)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  } else {
    sqlx::query(
      r#"
      UPDATE users
      SET class = ?, class_expire_time = ?, transfer_enable = ?,
          speed_limit = ?, device_limit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#
    )
    .bind(package.level)
    .bind(new_expire)
    .bind(new_quota)
    .bind(package.speed_limit)
    .bind(package.device_limit)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  }

  Ok(ApplyPackageResult {
    new_expire_time: Some(new_expire.format("%Y-%m-%d %H:%M:%S").to_string())
  })
}

fn parse_decimal(row: &sqlx::mysql::MySqlRow, column: &str, fallback: f64) -> f64 {
  if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(column) {
    return value;
  }
  if let Ok(Some(value)) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(column) {
    return value.to_string().parse::<f64>().unwrap_or(fallback);
  }
  if let Ok(Some(value)) = row.try_get::<Option<String>, _>(column) {
    return value.parse::<f64>().unwrap_or(fallback);
  }
  fallback
}
