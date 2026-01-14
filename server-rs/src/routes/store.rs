use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{Duration, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::crypto::random_string;
use crate::payment::{self, PaymentOrder};
use crate::response::{error, success};
use crate::state::AppState;

use super::auth::require_user_id;
use super::payment_callback::mark_purchase_paid;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_packages))
    .route("/packages", get(get_packages))
    .route("/packages/{id}", get(get_package_detail))
    .route("/packages/coupon/preview", post(post_coupon_preview))
    .route("/packages/purchase", post(post_purchase))
    .route("/packages/purchase-records", get(get_purchase_records))
    .route("/purchase-records", get(get_purchase_records))
}

#[derive(Deserialize)]
struct PackagesQuery {
  page: Option<i64>,
  limit: Option<i64>,
  level: Option<i64>,
  sort: Option<String>,
  order: Option<String>
}

#[derive(Deserialize)]
struct CouponPreviewRequest {
  package_id: Option<i64>,
  coupon_code: Option<String>
}

#[derive(Deserialize)]
struct PurchaseRequest {
  package_id: Option<i64>,
  coupon_code: Option<String>,
  payment_method: Option<String>,
  purchase_type: Option<String>,
  return_url: Option<String>
}

#[derive(Clone)]
struct PackageSummary {
  id: i64,
  name: String,
  price: f64
}

#[derive(Clone)]
struct CouponRow {
  id: i64,
  name: String,
  code: String,
  discount_type: String,
  discount_value: f64,
  start_at: i64,
  end_at: i64,
  max_usage: Option<i64>,
  per_user_limit: Option<i64>,
  total_used: i64
}

async fn get_packages(State(state): State<AppState>, Query(query): Query<PackagesQuery>) -> Response {
  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.unwrap_or(10);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;
  let level = query.level.unwrap_or(0);
  let sort = query.sort.unwrap_or_else(|| "price".to_string());
  let order = query.order.unwrap_or_else(|| "asc".to_string());

  let mut conditions: Vec<String> = vec!["status = 1".to_string()];
  let mut params: Vec<SqlParam> = Vec::new();
  if level > 0 {
    conditions.push("level = ?".to_string());
    params.push(SqlParam::I64(level));
  }

  let where_clause = format!("WHERE {}", conditions.join(" AND "));
  let sort_field = match sort.as_str() {
    "traffic_quota" => "traffic_quota",
    "validity_days" => "validity_days",
    "level" => "level",
    _ => "price"
  };
  let order = if order.to_lowercase() == "desc" { "DESC" } else { "ASC" };

  let total_sql = format!("SELECT COUNT(*) as total FROM packages {where_clause}");
  let mut total_query = sqlx::query(&total_sql);
  total_query = bind_params(total_query, &params);
  let total_row = total_query.fetch_optional(&state.db).await;
  let total_row = match total_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let list_sql = format!(
    r#"
    SELECT id, name, CAST(price AS DOUBLE) as price, traffic_quota, validity_days, speed_limit, device_limit,
           level, is_recommended, sort_weight, created_at
    FROM packages
    {where_clause}
    ORDER BY sort_weight DESC, {sort_field} {order}
    LIMIT ? OFFSET ?
    "#
  );
  let mut list_query = sqlx::query(&list_sql);
  list_query = bind_params(list_query, &params);
  let rows = list_query
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let packages = rows
    .into_iter()
    .map(|row| map_package_row(&row))
    .collect::<Vec<Value>>();

  let total_pages = if limit > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 1 };
  success(
    json!({
      "packages": packages,
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": total_pages.max(1)
      }
    }),
    "Success"
  )
  .into_response()
}

async fn get_package_detail(
  State(state): State<AppState>,
  Path(id): Path<i64>
) -> Response {
  if id <= 0 {
    return error(StatusCode::BAD_REQUEST, "参数错误", None);
  }

  let row = sqlx::query(
    r#"
    SELECT id, name, CAST(price AS DOUBLE) as price, traffic_quota, validity_days, speed_limit, device_limit,
           level, is_recommended, sort_weight, created_at
    FROM packages
    WHERE id = ? AND status = 1
    "#
  )
  .bind(id)
  .fetch_optional(&state.db)
  .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let row = match row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "套餐不存在或已下架", None)
  };

  success(map_package_row(&row), "Success").into_response()
}

async fn post_coupon_preview(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<CouponPreviewRequest>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let package_id = body.package_id.unwrap_or(0);
  let coupon_code = body.coupon_code.unwrap_or_default();
  if package_id <= 0 || coupon_code.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少参数", None);
  }

  let package = match get_package_by_id(&state, package_id).await {
    Ok(Some(value)) => value,
    Ok(None) => return error(StatusCode::NOT_FOUND, "套餐不存在或已下架", None),
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let coupon = match get_coupon_by_code(&state, &coupon_code).await {
    Ok(Some(value)) => value,
    Ok(None) => return error(StatusCode::BAD_REQUEST, "优惠券无效", None),
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let now = (Utc::now() + Duration::hours(8)).timestamp();
  if coupon.start_at > 0 && now < coupon.start_at {
    return error(StatusCode::BAD_REQUEST, "未到使用时间", None);
  }
  if coupon.end_at > 0 && now > coupon.end_at {
    return error(StatusCode::BAD_REQUEST, "优惠券已过期", None);
  }

  let usage = match count_coupon_usage(&state, coupon.id, user_id).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  if let Some(max_usage) = coupon.max_usage {
    if usage.total >= max_usage {
      return error(StatusCode::BAD_REQUEST, "优惠券名额已用尽", None);
    }
  }
  if let Some(per_user_limit) = coupon.per_user_limit {
    if usage.by_user >= per_user_limit {
      return error(StatusCode::BAD_REQUEST, "您已达到使用次数上限", None);
    }
  }

  let price = package.price;
  let discount = compute_coupon_discount(&coupon, price);
  let final_price = (price - discount).max(0.0);

  success(
    json!({
      "price": price,
      "discount_amount": discount,
      "final_price": final_price,
      "coupon": {
        "id": coupon.id,
        "name": coupon.name,
        "code": coupon.code,
        "discount_type": coupon.discount_type,
        "discount_value": coupon.discount_value,
        "start_at": coupon.start_at,
        "end_at": coupon.end_at,
        "max_usage": coupon.max_usage,
        "per_user_limit": coupon.per_user_limit,
        "total_used": coupon.total_used
      }
    }),
    "Success"
  )
  .into_response()
}

async fn post_purchase(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<PurchaseRequest>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let package_id = body.package_id.unwrap_or(0);
  if package_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "缺少参数", None);
  }

  let package = match get_package_by_id(&state, package_id).await {
    Ok(Some(value)) => value,
    Ok(None) => return error(StatusCode::NOT_FOUND, "套餐不存在或已下架", None),
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let original_price = package.price;
  let mut price = original_price;
  let mut discount = 0.0;
  let mut coupon_id: Option<i64> = None;
  let mut coupon_code: Option<String> = None;

  if let Some(code) = body.coupon_code.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
    let coupon = match get_coupon_by_code(&state, code).await {
      Ok(Some(value)) => value,
      Ok(None) => return error(StatusCode::BAD_REQUEST, "优惠券无效", None),
      Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
    };

    let now = (Utc::now() + Duration::hours(8)).timestamp();
    if coupon.start_at > 0 && now < coupon.start_at {
      return error(StatusCode::BAD_REQUEST, "未到使用时间", None);
    }
    if coupon.end_at > 0 && now > coupon.end_at {
      return error(StatusCode::BAD_REQUEST, "优惠券已过期", None);
    }

    let usage = match count_coupon_usage(&state, coupon.id, user_id).await {
      Ok(value) => value,
      Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
    };

    if let Some(max_usage) = coupon.max_usage {
      if usage.total >= max_usage {
        return error(StatusCode::BAD_REQUEST, "优惠券名额已用尽", None);
      }
    }
    if let Some(per_user_limit) = coupon.per_user_limit {
      if usage.by_user >= per_user_limit {
        return error(StatusCode::BAD_REQUEST, "您已达到使用次数上限", None);
      }
    }

    discount = compute_coupon_discount(&coupon, price);
    price = (price - discount).max(0.0);
    coupon_id = Some(coupon.id);
    coupon_code = Some(coupon.code);
  }

  let user_balance = match get_user_balance(&state, user_id).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let trade_no = build_trade_no();
  let requested_type = body
    .purchase_type
    .clone()
    .unwrap_or_else(|| "balance".to_string())
    .to_lowercase();

  let normalized_channel = payment::normalize_channel(body.payment_method.as_deref());
  let default_channel = payment::active_channels(&state.env).first().copied();

  let mut actual_purchase_type = requested_type.as_str();
  let mut payment_amount = price;

  if price <= 0.0 {
    actual_purchase_type = "balance";
    payment_amount = 0.0;
  } else if requested_type == "balance" {
    if user_balance < price {
      actual_purchase_type = "smart_topup";
      payment_amount = (price - user_balance).max(0.0);
    }
  } else if requested_type == "direct" {
    if user_balance > 0.0 && user_balance < price {
      actual_purchase_type = "smart_topup";
      payment_amount = (price - user_balance).max(0.0);
    }
  } else if requested_type == "smart_topup" {
    actual_purchase_type = "smart_topup";
    payment_amount = (price - user_balance).max(0.0);
  } else {
    actual_purchase_type = "balance";
    payment_amount = price;
  }

  if payment_amount <= 0.0 {
    actual_purchase_type = "balance";
  }

  let channel_for_online = payment::normalize_channel(body.payment_method.as_deref())
    .or(normalized_channel)
    .or(default_channel);
  let stored_purchase_type = if actual_purchase_type == "balance" {
    "balance".to_string()
  } else if actual_purchase_type == "smart_topup" {
    format!("balance_{}", channel_for_online.unwrap_or("online"))
  } else {
    channel_for_online.unwrap_or("online").to_string()
  };

  if price <= 0.0 {
    let insert = create_purchase_record(
      &state,
      user_id,
      package.id,
      0.0,
      original_price,
      discount,
      "balance",
      &trade_no,
      coupon_id,
      coupon_code.as_deref()
    )
    .await;
    if let Err(message) = insert {
      return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
    }

    let applied = match mark_purchase_paid(&state, &trade_no).await {
      Ok(value) => value.map(|value| value.applied).unwrap_or(false),
      Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
    };

    return success(
      json!({
        "trade_no": trade_no,
        "package_name": package.name,
        "price": original_price,
        "final_price": price,
        "discount_amount": discount,
        "coupon_code": coupon_code,
        "purchase_type": "balance",
        "status": if applied { 1 } else { 0 },
        "status_text": if applied { "购买成功" } else { "待处理" }
      }),
      "已自动激活套餐"
    )
    .into_response();
  }

  if actual_purchase_type == "balance" {
    if let Err(message) = deduct_user_balance(&state, user_id, price).await {
      return error(StatusCode::BAD_REQUEST, &message, None);
    }

    let insert = create_purchase_record(
      &state,
      user_id,
      package.id,
      price,
      original_price,
      discount,
      "balance",
      &trade_no,
      coupon_id,
      coupon_code.as_deref()
    )
    .await;
    if let Err(message) = insert {
      let _ = refund_user_balance(&state, user_id, price).await;
      return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
    }

    let applied = match mark_purchase_paid(&state, &trade_no).await {
      Ok(value) => value.map(|value| value.applied).unwrap_or(false),
      Err(message) => {
        let _ = refund_user_balance(&state, user_id, price).await;
        return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
      }
    };

    return success(
      json!({
        "trade_no": trade_no,
        "package_name": package.name,
        "price": original_price,
        "final_price": price,
        "discount_amount": discount,
        "coupon_code": coupon_code,
        "purchase_type": "balance",
        "status": if applied { 1 } else { 0 },
        "status_text": if applied { "购买成功" } else { "待处理" }
      }),
      "已使用余额支付并激活套餐"
    )
    .into_response();
  }

  let channel_to_use = match channel_for_online {
    Some(value) => value,
    None => return error(StatusCode::BAD_REQUEST, "支付未配置，请联系管理员", None)
  };

  if payment::active_channels(&state.env).is_empty() {
    return error(StatusCode::BAD_REQUEST, "支付未配置，请联系管理员", None);
  }

  if let Err(message) = create_purchase_record(
    &state,
    user_id,
    package.id,
    payment_amount,
    original_price,
    discount,
    &stored_purchase_type,
    &trade_no,
    coupon_id,
    coupon_code.as_deref()
  )
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  let notify_url = state
    .env
    .epay_notify_url
    .clone()
    .or(state.env.epusdt_notify_url.clone())
    .unwrap_or_default();
  let return_url = resolve_return_url(&headers, &state.env, body.return_url.as_deref());

  let order = PaymentOrder {
    trade_no: trade_no.clone(),
    amount: payment_amount,
    subject: package.name.clone(),
    notify_url,
    return_url: return_url.unwrap_or_default()
  };
  let pay = match payment::create_payment(&state.env, &order, Some(channel_to_use)).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  if !pay.success || pay.pay_url.is_none() {
    return error(StatusCode::INTERNAL_SERVER_ERROR, pay.message.as_deref().unwrap_or("创建支付订单失败"), None);
  }

  let is_mixed = stored_purchase_type.starts_with("balance_");
  let status_text = if is_mixed { "待支付差额" } else { "待支付" };
  let message = if is_mixed {
    format!("需要补差额 ¥{:.2}，正在跳转到支付页面", payment_amount)
  } else {
    "购买订单创建成功，请完成支付".to_string()
  };

  success(
    json!({
      "trade_no": trade_no,
      "package_name": package.name,
      "price": original_price,
      "final_price": price,
      "discount_amount": discount,
      "coupon_code": coupon_code,
      "purchase_type": stored_purchase_type,
      "status": 0,
      "status_text": status_text,
      "payment_url": pay.pay_url,
      "payment_amount": payment_amount,
      "user_balance": user_balance
    }),
    &message
  )
  .into_response()
}

#[derive(Deserialize)]
struct PurchaseRecordsQuery {
  page: Option<i64>,
  limit: Option<i64>
}

async fn get_purchase_records(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<PurchaseRecordsQuery>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let page = query.page.unwrap_or(1).max(1);
  let mut limit = query.limit.unwrap_or(20);
  if limit <= 0 {
    limit = 20;
  }
  if limit > 200 {
    limit = 200;
  }
  let offset = (page - 1) * limit;

  let rows = sqlx::query(
    r#"
    SELECT
      ppr.id,
      ppr.price,
      ppr.package_price,
      ppr.discount_amount,
      ppr.coupon_code,
      ppr.purchase_type,
      ppr.trade_no,
      ppr.status,
      ppr.created_at,
      ppr.paid_at,
      ppr.expires_at,
      p.name AS package_name,
      p.traffic_quota,
      p.validity_days,
      p.level,
      gcr.code AS gift_card_code
    FROM package_purchase_records ppr
    LEFT JOIN packages p ON ppr.package_id = p.id
    LEFT JOIN gift_card_redemptions gcr ON gcr.purchase_record_id = ppr.id
    WHERE ppr.user_id = ?
    ORDER BY ppr.created_at DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(user_id)
  .bind(limit)
  .bind(offset)
  .fetch_all(&state.db)
  .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM package_purchase_records WHERE user_id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;
  let total_row = match total_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let status_text = |status: i64| match status {
    0 => "待支付",
    1 => "已支付",
    2 => "已取消",
    3 => "支付失败",
    _ => "未知状态"
  };
  let purchase_type_text = |value: &str| {
    let trimmed = value.trim();
    if trimmed.is_empty() {
      return "未知".to_string();
    }
    let lower = trimmed.to_lowercase();
    if lower == "balance" {
      return "余额支付".to_string();
    }
    if lower == "gift_card" {
      return "礼品卡".to_string();
    }
    if lower == "free" {
      return "免费".to_string();
    }
    if lower == "balance_epay" || lower == "balance_epusdt" {
      return "混合支付".to_string();
    }
    if lower == "epay" || lower == "epusdt" {
      return "在线支付".to_string();
    }
    trimmed.to_string()
  };

  let records: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      let price = parse_decimal(&row, "price", 0.0);
      let package_price = if row.try_get::<Option<f64>, _>("package_price").ok().flatten().is_some() {
        parse_decimal(&row, "package_price", price)
      } else {
        price
      };
      let discount = parse_decimal(&row, "discount_amount", 0.0);
      let final_price = (package_price - discount).max(0.0);
      let purchase_type = row
        .try_get::<Option<String>, _>("purchase_type")
        .ok()
        .flatten()
        .unwrap_or_default();

      let trade_no = row
        .try_get::<Option<String>, _>("trade_no")
        .ok()
        .flatten()
        .unwrap_or_default();
      let gift_card_code = row
        .try_get::<Option<String>, _>("gift_card_code")
        .ok()
        .flatten()
        .unwrap_or_default();

      let display_trade_no = if purchase_type == "gift_card" {
        if !gift_card_code.is_empty() {
          gift_card_code
        } else if trade_no.contains('-') {
          trade_no.split('-').next().unwrap_or(&trade_no).to_string()
        } else {
          trade_no
        }
      } else {
        trade_no
      };

      let status_value = row.try_get::<Option<i64>, _>("status").ok().flatten().unwrap_or(0);
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "price": price,
        "package_price": package_price,
        "discount_amount": discount,
        "coupon_code": row.try_get::<Option<String>, _>("coupon_code").ok().flatten().unwrap_or_default(),
        "purchase_type": purchase_type,
        "purchase_type_text": purchase_type_text(&row.try_get::<Option<String>, _>("purchase_type").ok().flatten().unwrap_or_default()),
        "trade_no": display_trade_no,
        "status": status_value,
        "status_text": status_text(status_value),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
        "paid_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("paid_at").ok().flatten()),
        "expires_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("expires_at").ok().flatten()),
        "package_name": row.try_get::<Option<String>, _>("package_name").ok().flatten().unwrap_or_default(),
        "traffic_quota": row.try_get::<Option<i64>, _>("traffic_quota").ok().flatten(),
        "validity_days": row.try_get::<Option<i64>, _>("validity_days").ok().flatten(),
        "level": row.try_get::<Option<i64>, _>("level").ok().flatten(),
        "gift_card_code": row.try_get::<Option<String>, _>("gift_card_code").ok().flatten().unwrap_or_default(),
        "final_price": final_price,
        "traffic_quota_gb": row.try_get::<Option<i64>, _>("traffic_quota").ok().flatten()
      })
    })
    .collect();

  let total_pages = if limit > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 1 };
  success(
    json!({
      "records": records,
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": total_pages.max(1)
      }
    }),
    "Success"
  )
  .into_response()
}

async fn get_package_by_id(state: &AppState, package_id: i64) -> Result<Option<PackageSummary>, String> {
  let row = sqlx::query(
    r#"
    SELECT id, name, CAST(price AS DOUBLE) as price, traffic_quota, validity_days, speed_limit, device_limit,
           level, is_recommended, sort_weight
    FROM packages
    WHERE id = ? AND status = 1
    "#
  )
  .bind(package_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let row = match row {
    Some(value) => value,
    None => return Ok(None)
  };

  Ok(Some(PackageSummary {
    id: row.try_get::<i64, _>("id").unwrap_or(0),
    name: row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    price: parse_decimal(&row, "price", 0.0)
  }))
}

async fn get_coupon_by_code(state: &AppState, code: &str) -> Result<Option<CouponRow>, String> {
  let row = sqlx::query(
    r#"
    SELECT id, name, code, discount_type, discount_value, start_at, end_at,
           max_usage, per_user_limit, total_used
    FROM coupons
    WHERE code = ? AND status = 1
    "#
  )
  .bind(code)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let row = match row {
    Some(value) => value,
    None => return Ok(None)
  };

  Ok(Some(CouponRow {
    id: row.try_get::<i64, _>("id").unwrap_or(0),
    name: row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    code: row.try_get::<Option<String>, _>("code").ok().flatten().unwrap_or_default(),
    discount_type: row
      .try_get::<Option<String>, _>("discount_type")
      .ok()
      .flatten()
      .unwrap_or_else(|| "amount".to_string()),
    discount_value: parse_decimal(&row, "discount_value", 0.0),
    start_at: row.try_get::<Option<i64>, _>("start_at").unwrap_or(Some(0)).unwrap_or(0),
    end_at: row.try_get::<Option<i64>, _>("end_at").unwrap_or(Some(0)).unwrap_or(0),
    max_usage: row.try_get::<Option<i64>, _>("max_usage").ok().flatten(),
    per_user_limit: row.try_get::<Option<i64>, _>("per_user_limit").ok().flatten(),
    total_used: row.try_get::<Option<i64>, _>("total_used").unwrap_or(Some(0)).unwrap_or(0)
  }))
}

struct CouponUsageCount {
  total: i64,
  by_user: i64
}

async fn count_coupon_usage(
  state: &AppState,
  coupon_id: i64,
  user_id: i64
) -> Result<CouponUsageCount, String> {
  let total_row = sqlx::query("SELECT COUNT(*) as total FROM coupon_usages WHERE coupon_id = ?")
    .bind(coupon_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  let by_user_row = sqlx::query(
    "SELECT COUNT(*) as total FROM coupon_usages WHERE coupon_id = ? AND user_id = ?"
  )
  .bind(coupon_id)
  .bind(user_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(CouponUsageCount {
    total: total_row
      .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
      .unwrap_or(0),
    by_user: by_user_row
      .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
      .unwrap_or(0)
  })
}

fn compute_coupon_discount(coupon: &CouponRow, price: f64) -> f64 {
  match coupon.discount_type.as_str() {
    "percentage" => (price * coupon.discount_value / 100.0).max(0.0),
    "amount" => coupon.discount_value.max(0.0),
    _ => 0.0
  }
}

async fn get_user_balance(state: &AppState, user_id: i64) -> Result<f64, String> {
  let row = sqlx::query("SELECT money FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  let row = match row {
    Some(value) => value,
    None => return Ok(0.0)
  };
  Ok(parse_decimal(&row, "money", 0.0))
}

fn build_trade_no() -> String {
  let ts = Utc::now().timestamp_millis().to_string();
  let suffix = if ts.len() > 8 { &ts[ts.len() - 8..] } else { ts.as_str() };
  format!("P{}{}", suffix, random_string(4).to_uppercase())
}

async fn create_purchase_record(
  state: &AppState,
  user_id: i64,
  package_id: i64,
  price: f64,
  package_price: f64,
  discount_amount: f64,
  purchase_type: &str,
  trade_no: &str,
  coupon_id: Option<i64>,
  coupon_code: Option<&str>
) -> Result<(), String> {
  sqlx::query(
    r#"
    INSERT INTO package_purchase_records
      (user_id, package_id, price, package_price, discount_amount, purchase_type, trade_no, status, created_at, coupon_id, coupon_code)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, ?, ?)
    "#
  )
  .bind(user_id)
  .bind(package_id)
  .bind(price)
  .bind(package_price)
  .bind(discount_amount)
  .bind(purchase_type)
  .bind(trade_no)
  .bind(coupon_id)
  .bind(coupon_code)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

async fn deduct_user_balance(state: &AppState, user_id: i64, amount: f64) -> Result<(), String> {
  if amount <= 0.0 {
    return Ok(());
  }
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
  if result.rows_affected() == 0 {
    return Err("余额不足".to_string());
  }
  Ok(())
}

async fn refund_user_balance(state: &AppState, user_id: i64, amount: f64) -> Result<(), String> {
  if amount <= 0.0 {
    return Ok(());
  }
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
  Ok(())
}

fn resolve_return_url(headers: &HeaderMap, env: &crate::config::AppEnv, provided: Option<&str>) -> Option<String> {
  if let Some(value) = provided.map(|value| value.trim()).filter(|value| !value.is_empty()) {
    return Some(value.to_string());
  }

  let base = detect_base_url(headers, env.site_url.as_deref())?;
  Some(format!("{}/user/store", base.trim_end_matches('/')))
}

fn detect_base_url(headers: &HeaderMap, site_url: Option<&str>) -> Option<String> {
  let header_keys = [
    "x-frontend-url",
    "x-frontend-origin",
    "x-forwarded-origin",
    "cf-connecting-origin",
    "origin",
    "referer"
  ];

  for key in &header_keys {
    if let Some(value) = header_value(headers, key) {
      if let Some(base) = parse_base_url(&value) {
        return Some(base);
      }
    }
  }

  if let Some(value) = site_url {
    if let Some(base) = parse_base_url(value) {
      return Some(base);
    }
    let trimmed = value.trim().trim_end_matches('/');
    if !trimmed.is_empty() {
      return Some(trimmed.to_string());
    }
  }

  let host = header_value(headers, "x-forwarded-host").or_else(|| header_value(headers, "host"));
  let host = host.and_then(|value| value.split(',').next().map(|item| item.trim().to_string()));
  let host = host.filter(|value| !value.is_empty())?;
  let proto = header_value(headers, "x-forwarded-proto")
    .and_then(|value| value.split(',').next().map(|item| item.trim().to_string()))
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "https".to_string());
  Some(format!("{proto}://{host}"))
}

fn header_value(headers: &HeaderMap, key: &str) -> Option<String> {
  headers
    .get(key)
    .and_then(|value| value.to_str().ok())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn parse_base_url(value: &str) -> Option<String> {
  let url = reqwest::Url::parse(value).ok()?;
  let host = url.host_str()?;
  Some(format!("{}://{}", url.scheme(), host))
}

fn map_package_row(row: &sqlx::mysql::MySqlRow) -> Value {
  let price = parse_decimal(row, "price", 0.0);
  let traffic_quota = row.try_get::<Option<i64>, _>("traffic_quota").unwrap_or(Some(0)).unwrap_or(0);
  let validity_days = row.try_get::<Option<i64>, _>("validity_days").unwrap_or(Some(0)).unwrap_or(0);
  let speed_limit = row.try_get::<Option<i64>, _>("speed_limit").unwrap_or(Some(0)).unwrap_or(0);
  let device_limit = row.try_get::<Option<i64>, _>("device_limit").unwrap_or(Some(0)).unwrap_or(0);

  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    "price": price,
    "traffic_quota": traffic_quota,
    "traffic_quota_gb": traffic_quota,
    "traffic_quota_bytes": traffic_quota.saturating_mul(1024 * 1024 * 1024),
    "validity_days": validity_days,
    "speed_limit": speed_limit,
    "device_limit": device_limit,
    "level": row.try_get::<Option<i64>, _>("level").unwrap_or(Some(0)).unwrap_or(0),
    "is_recommended": row.try_get::<Option<i64>, _>("is_recommended").unwrap_or(Some(0)).unwrap_or(0),
    "sort_weight": row.try_get::<Option<i64>, _>("sort_weight").unwrap_or(Some(0)).unwrap_or(0),
    "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
    "speed_limit_text": if speed_limit > 0 { format!("{speed_limit} Mbps") } else { "无限制".to_string() },
    "device_limit_text": if device_limit > 0 { format!("{device_limit} 个设备") } else { "无限制".to_string() },
    "validity_text": format!("{validity_days} 天")
  })
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  I64(i64)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value)
    };
  }
  query
}

fn parse_decimal(row: &sqlx::mysql::MySqlRow, column: &str, fallback: f64) -> f64 {
  if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(column) {
    return value;
  }
  if let Ok(Some(value)) = row.try_get::<Option<String>, _>(column) {
    return value.parse::<f64>().unwrap_or(fallback);
  }
  fallback
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}
