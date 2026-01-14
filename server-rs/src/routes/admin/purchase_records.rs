use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::referral::award_rebate;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;
use super::super::payment_callback::mark_purchase_paid;

#[derive(Deserialize)]
struct PurchaseQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>,
  #[serde(rename = "user_id")]
  user_id: Option<String>,
  #[serde(rename = "package_id")]
  package_id: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/purchase-records", get(get_purchase_records))
    .route("/purchase-records/{tradeNo}/mark-paid", post(post_mark_paid))
}

async fn get_purchase_records(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<PurchaseQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;
  let status = query.status.as_deref().map(|value| value.trim()).unwrap_or("");
  let user_id = query.user_id.as_deref().map(|value| value.trim()).unwrap_or("");
  let package_id = query.package_id.as_deref().map(|value| value.trim()).unwrap_or("");

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !status.is_empty() {
    if let Ok(value) = status.parse::<i64>() {
      conditions.push("ppr.status = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }
  if !user_id.is_empty() {
    if let Ok(value) = user_id.parse::<i64>() {
      conditions.push("ppr.user_id = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }
  if !package_id.is_empty() {
    if let Ok(value) = package_id.parse::<i64>() {
      conditions.push("ppr.package_id = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM package_purchase_records ppr {where_clause}");
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
      ppr.id,
      ppr.user_id,
      ppr.package_id,
      CAST(ppr.price AS DOUBLE) as price,
      CAST(ppr.package_price AS DOUBLE) as package_price,
      CAST(ppr.discount_amount AS DOUBLE) as discount_amount,
      ppr.coupon_code,
      ppr.purchase_type,
      ppr.trade_no,
      ppr.status,
      ppr.created_at,
      ppr.paid_at,
      ppr.expires_at,
      u.email,
      u.username,
      p.name AS package_name,
      p.traffic_quota,
      p.validity_days,
      gcr.code AS gift_card_code
    FROM package_purchase_records ppr
    LEFT JOIN users u ON ppr.user_id = u.id
    LEFT JOIN packages p ON ppr.package_id = p.id
    LEFT JOIN gift_card_redemptions gcr ON gcr.purchase_record_id = ppr.id
    {where_clause}
    ORDER BY ppr.created_at DESC
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

  let status_map = [
    (0, "待支付"),
    (1, "已支付"),
    (2, "已取消"),
    (3, "支付失败")
  ];

  let records = rows
    .into_iter()
    .map(|row| {
      let status = row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0);
      let price = parse_decimal(&row, "price", 0.0);
      let package_price = row
        .try_get::<Option<String>, _>("package_price")
        .ok()
        .and_then(|value| value.and_then(|val| val.parse::<f64>().ok()));
      let discount_amount = parse_decimal(&row, "discount_amount", 0.0);
      let final_price = fix_money_precision(
        package_price
          .map(|value| (value - discount_amount).max(0.0))
          .unwrap_or(price)
      );

      let purchase_type = row.try_get::<Option<String>, _>("purchase_type").ok().flatten().unwrap_or_default();
      let purchase_type_text = normalize_purchase_type_text(&purchase_type);
      let trade_no_raw = row.try_get::<Option<String>, _>("trade_no").ok().flatten().unwrap_or_default();
      let mut trade_no = trade_no_raw.clone();
      if purchase_type == "gift_card" {
        let gift_card_code = row.try_get::<Option<String>, _>("gift_card_code").ok().flatten().unwrap_or_default();
        if !gift_card_code.is_empty() {
          trade_no = gift_card_code;
        } else if let Some((first, _)) = trade_no_raw.split_once('-') {
          trade_no = first.to_string();
        }
      }

      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "user_id": row.try_get::<Option<i64>, _>("user_id").unwrap_or(Some(0)).unwrap_or(0),
        "email": row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default(),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
        "package_id": row.try_get::<Option<i64>, _>("package_id").unwrap_or(Some(0)).unwrap_or(0),
        "package_name": row.try_get::<Option<String>, _>("package_name").ok().flatten().unwrap_or_default(),
        "price": fix_money_precision(price),
        "package_price": package_price.map(fix_money_precision),
        "discount_amount": discount_amount,
        "coupon_code": row.try_get::<Option<String>, _>("coupon_code").ok().flatten(),
        "purchase_type": purchase_type.clone(),
        "purchase_type_text": purchase_type_text,
        "trade_no": trade_no,
        "status": status,
        "status_text": status_map.iter().find(|(code, _)| *code == status).map(|(_, text)| *text).unwrap_or("未知状态"),
        "traffic_quota": row.try_get::<Option<i64>, _>("traffic_quota").ok().flatten(),
        "validity_days": row.try_get::<Option<i64>, _>("validity_days").ok().flatten(),
        "created_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("created_at").ok().flatten().map(format_datetime),
        "paid_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("paid_at").ok().flatten().map(format_datetime),
        "expires_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("expires_at").ok().flatten().map(format_datetime),
        "final_price": final_price
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

async fn post_mark_paid(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(trade_no): Path<String>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let result = match mark_purchase_paid(&state, &trade_no).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };
  let result = match result {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "订单不存在", None)
  };

  if result.applied {
    let _ = award_rebate(
      &state,
      result.user_id,
      result.amount,
      "purchase",
      Some(result.record_id),
      Some(&trade_no),
      Some("purchase_rebate")
    )
    .await;
    return success(json!({ "trade_no": trade_no }), "已标记支付并激活套餐").into_response();
  }

  success(json!({ "trade_no": trade_no }), "订单已是已支付").into_response()
}

fn normalize_purchase_type_text(value: &str) -> String {
  if value.is_empty() {
    return "未知".to_string();
  }
  let normalized = value.to_lowercase();
  if normalized == "balance" {
    return "余额支付".to_string();
  }
  if normalized == "smart_topup" || normalized.starts_with("balance_") {
    return "混合支付".to_string();
  }
  if normalized == "alipay" || normalized.ends_with("alipay") {
    return "支付宝".to_string();
  }
  if normalized == "wechat" || normalized == "wxpay" || normalized.ends_with("wxpay") {
    return "微信".to_string();
  }
  if normalized == "qqpay" || normalized.ends_with("qqpay") {
    return "QQ支付".to_string();
  }
  if normalized == "gift_card" {
    return "礼品卡".to_string();
  }
  if normalized == "direct" {
    return "在线支付".to_string();
  }
  value.to_string()
}

fn format_datetime(value: chrono::NaiveDateTime) -> String {
  value.format("%Y-%m-%d %H:%M:%S").to_string()
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
