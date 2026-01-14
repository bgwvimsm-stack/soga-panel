use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{Duration, Local, NaiveDateTime, Utc};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::payment::{active_channels, create_payment, normalize_channel, PaymentOrder};
use crate::referral::award_rebate;
use crate::response::{error, success};
use crate::state::AppState;

use super::auth::require_user_id;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_wallet))
    .route("/money", get(get_wallet_money))
    .route("/recharge-records", get(get_recharge_records))
    .route("/stats", get(get_wallet_stats))
    .route("/recharge", post(post_recharge))
    .route("/recharge/callback", post(post_recharge_callback))
    .route("/recharge/callback", get(get_recharge_callback))
    .route("/gift-card/redeem", post(post_gift_card_redeem))
}

pub fn user_shortcut_router() -> Router<AppState> {
  Router::new()
    .route("/recharge-records", get(get_recharge_records))
    .route("/recharge", post(post_recharge))
}

async fn get_wallet(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let row = sqlx::query("SELECT money FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let row = match row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "用户不存在", None)
  };
  let balance = parse_decimal(&row, "money", 0.0);

  let recharge_stats = sqlx::query(
    r#"
    SELECT
      CAST(COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) AS DOUBLE) as total_recharged
    FROM recharge_records
    WHERE user_id = ?
    "#
  )
  .bind(user_id)
  .fetch_optional(&state.db)
  .await;
  let recharge_stats = match recharge_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total_recharged = recharge_stats
    .as_ref()
    .map(|row| parse_decimal(row, "total_recharged", 0.0))
    .unwrap_or(0.0);

  let purchase_stats = sqlx::query(
    r#"
    SELECT
      CAST(COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) AS DOUBLE) as total_spent
    FROM package_purchase_records
    WHERE user_id = ?
    "#
  )
  .bind(user_id)
  .fetch_optional(&state.db)
  .await;
  let purchase_stats = match purchase_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total_consume = purchase_stats
    .as_ref()
    .map(|row| parse_decimal(row, "total_spent", 0.0))
    .unwrap_or(0.0);

  success(
    json!({
      "balance": balance,
      "money": balance,
      "total_recharge": total_recharged,
      "total_consume": total_consume
    }),
    "Success"
  )
  .into_response()
}

async fn get_wallet_money(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let balance = match get_user_balance(&state, user_id).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let records = match list_recharge_records(&state, user_id, 10, 0).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  success(
    json!({
      "money": balance,
      "recent_recharges": records
    }),
    "Success"
  )
  .into_response()
}

#[derive(Deserialize)]
struct RechargeRecordsQuery {
  page: Option<i64>,
  limit: Option<i64>
}

async fn get_recharge_records(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<RechargeRecordsQuery>
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

  let rows = match list_recharge_records(&state, user_id, limit, offset).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM recharge_records WHERE user_id = ?")
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

  let records: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      let raw_method = row
        .get("payment_method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_lowercase();
      let method = if raw_method == "epay" {
        "alipay".to_string()
      } else if raw_method == "epusdt" {
        "usdt".to_string()
      } else if raw_method.is_empty() {
        "alipay".to_string()
      } else {
        raw_method.clone()
      };

      let trade_no = row
        .get("trade_no")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
      let gift_card_code = row
        .get("gift_card_code")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
      let display_trade_no = if method == "gift_card" {
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

      let status_value = row.get("status").and_then(Value::as_i64).unwrap_or(0);
      let amount = row.get("amount").and_then(Value::as_f64).unwrap_or(0.0);

      json!({
        "id": row.get("id").and_then(Value::as_i64).unwrap_or(0),
        "amount": amount,
        "payment_method": method,
        "trade_no": display_trade_no,
        "status": status_value,
        "created_at": row.get("created_at").and_then(Value::as_str).unwrap_or("").to_string(),
        "paid_at": row.get("paid_at").and_then(Value::as_str).unwrap_or("").to_string(),
        "status_text": status_text(status_value)
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

async fn get_wallet_stats(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let balance_row = sqlx::query("SELECT money FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;
  let balance_row = match balance_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let balance = balance_row
    .as_ref()
    .map(|row| parse_decimal(row, "money", 0.0))
    .unwrap_or(0.0);

  let recharge_stats = sqlx::query(
    r#"
    SELECT
      COUNT(*) as total_recharges,
      CAST(COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) AS DOUBLE) as total_recharged,
      CAST(COALESCE(SUM(CASE WHEN status = 0 THEN amount ELSE 0 END), 0) AS DOUBLE) as pending_amount
    FROM recharge_records
    WHERE user_id = ?
    "#
  )
  .bind(user_id)
  .fetch_optional(&state.db)
  .await;
  let recharge_stats = match recharge_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let purchase_stats = sqlx::query(
    r#"
    SELECT
      COUNT(*) as total_purchases,
      CAST(COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) AS DOUBLE) as total_spent
    FROM package_purchase_records
    WHERE user_id = ?
    "#
  )
  .bind(user_id)
  .fetch_optional(&state.db)
  .await;
  let purchase_stats = match purchase_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  success(
    json!({
      "current_balance": balance,
      "total_recharged": recharge_stats.as_ref().map(|row| parse_decimal(row, "total_recharged", 0.0)).unwrap_or(0.0),
      "total_spent": purchase_stats.as_ref().map(|row| parse_decimal(row, "total_spent", 0.0)).unwrap_or(0.0),
      "pending_recharge": recharge_stats.as_ref().map(|row| parse_decimal(row, "pending_amount", 0.0)).unwrap_or(0.0),
      "total_recharge_count": recharge_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("total_recharges").ok().flatten()).unwrap_or(0),
      "total_purchase_count": purchase_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("total_purchases").ok().flatten()).unwrap_or(0)
    }),
    "Success"
  )
  .into_response()
}

#[derive(Deserialize)]
struct RechargeRequest {
  amount: Option<f64>,
  method: Option<String>,
  #[serde(alias = "payment_method", alias = "paymentMethod")]
  payment_method: Option<String>,
  #[serde(alias = "return_url", alias = "returnUrl")]
  return_url: Option<String>
}

async fn post_recharge(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Json(body): Json<RechargeRequest>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let amount = body.amount.unwrap_or(0.0);
  if amount <= 0.0 {
    return error(StatusCode::BAD_REQUEST, "金额无效", None);
  }

  let raw_channel = body
    .payment_method
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .or_else(|| body.method.as_deref().filter(|value| !value.trim().is_empty()));
  let preferred_channel = normalize_channel(raw_channel);
  let selected_channel = preferred_channel
    .or_else(|| active_channels(&state.env).first().copied())
    .ok_or_else(|| "支付方式不可用".to_string());
  let selected_channel = match selected_channel {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };

  let trade_no = generate_trade_no();
  if let Err(message) = create_recharge_record(&state, user_id, amount, &trade_no, selected_channel).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  let client_return_url = body.return_url.unwrap_or_default();
  let env_return_url = if selected_channel == "crypto" {
    state.env.epusdt_return_url.clone().unwrap_or_default()
  } else {
    state.env.epay_return_url.clone().unwrap_or_default()
  };
  let mut return_url = if !client_return_url.trim().is_empty() {
    client_return_url.trim().to_string()
  } else if !env_return_url.trim().is_empty() {
    env_return_url.trim().to_string()
  } else {
    build_return_url(&headers, state.env.site_url.clone())
  };
  if return_url.is_empty() {
    return_url = build_return_url(&headers, state.env.site_url.clone());
  }

  let notify_url = if selected_channel == "crypto" {
    state.env.epusdt_notify_url.clone().unwrap_or_default()
  } else {
    state.env.epay_notify_url.clone().unwrap_or_default()
  };

  let order = PaymentOrder {
    trade_no: trade_no.clone(),
    amount,
    subject: "账户充值".to_string(),
    notify_url: notify_url.clone(),
    return_url: return_url.clone()
  };

  let result = match create_payment(&state.env, &order, Some(selected_channel)).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  if !result.success || result.pay_url.as_ref().map(|value| value.trim().is_empty()).unwrap_or(true) {
    return error(
      StatusCode::INTERNAL_SERVER_ERROR,
      result.message.as_deref().unwrap_or("创建支付订单失败"),
      None
    );
  }

  success(
    json!({
      "trade_no": trade_no,
      "amount": amount,
      "status": 0,
      "method": result.method,
      "pay_url": result.pay_url
    }),
    "充值订单已创建"
  )
  .into_response()
}

#[derive(Deserialize)]
struct RechargeCallbackRequest {
  trade_no: Option<String>
}

async fn post_recharge_callback(
  State(state): State<AppState>,
  Json(body): Json<RechargeCallbackRequest>
) -> Response {
  let trade_no = body.trade_no.unwrap_or_default();
  if trade_no.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少 trade_no", None);
  }
  handle_recharge_callback(&state, &trade_no).await
}

#[derive(Deserialize)]
struct RechargeCallbackQuery {
  trade_no: Option<String>
}

async fn get_recharge_callback(
  State(state): State<AppState>,
  Query(query): Query<RechargeCallbackQuery>
) -> Response {
  let trade_no = query.trade_no.unwrap_or_default();
  if trade_no.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少 trade_no", None);
  }
  handle_recharge_callback(&state, &trade_no).await
}

async fn handle_recharge_callback(state: &AppState, trade_no: &str) -> Response {
  let result = match mark_recharge_paid(state, trade_no).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };
  let result = match result {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "订单不存在", None)
  };

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
    return success(json!({ "trade_no": trade_no }), "已入账").into_response();
  }

  if result.already_paid {
    return success(json!({ "trade_no": trade_no }), "订单已是已支付").into_response();
  }

  error(StatusCode::BAD_REQUEST, "订单状态不可标记", None)
}

#[derive(Deserialize)]
struct GiftCardRedeemRequest {
  code: Option<String>
}

async fn post_gift_card_redeem(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Json(body): Json<GiftCardRedeemRequest>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let code = body.code.unwrap_or_default();
  if code.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少卡密", None);
  }

  let card = match get_gift_card_by_code(&state, &code).await {
    Ok(Some(value)) => value,
    Ok(None) => return error(StatusCode::NOT_FOUND, "卡密无效或已停用", None),
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  if card.status != 1 {
    return error(StatusCode::BAD_REQUEST, "礼品卡不可用", None);
  }

  let now = Local::now().naive_local();
  if let Some(start_at) = card.start_at {
    if start_at > now {
      return error(StatusCode::BAD_REQUEST, "未到使用时间", None);
    }
  }
  if let Some(end_at) = card.end_at {
    if end_at < now {
      return error(StatusCode::BAD_REQUEST, "礼品卡已过期", None);
    }
  }

  if let Some(max_usage) = card.max_usage {
    if card.used_count >= max_usage {
      return error(StatusCode::BAD_REQUEST, "礼品卡已用完", None);
    }
  }

  let mut user_used_count = 0;
  if let Some(per_user_limit) = card.per_user_limit {
    user_used_count = match count_gift_card_user_redemptions(&state, card.id, user_id).await {
      Ok(value) => value,
      Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
    };
    if user_used_count >= per_user_limit {
      return error(StatusCode::BAD_REQUEST, "您已达到该礼品卡的个人使用次数上限", None);
    }
  }

  let usage_index = card.used_count + 1;
  let trade_no = build_gift_card_trade_no(&code, usage_index);

  let mut change_amount: Option<f64> = None;
  let mut duration_days: Option<i64> = None;
  let mut traffic_value_gb: Option<i64> = None;
  let mut reset_traffic_gb: Option<i64> = None;
  let mut recharge_record_id: Option<i64> = None;
  let mut purchase_record_id: Option<i64> = None;
  let mut package_id: Option<i64> = None;
  let mut expires_at: Option<String> = None;
  let message: String;

  match card.card_type.as_str() {
    "balance" => {
      let amount = card.balance_amount.unwrap_or(0.0);
      if amount <= 0.0 {
        return error(StatusCode::BAD_REQUEST, "卡面值无效", None);
      }
      if let Err(message) = create_recharge_record(&state, user_id, amount, &trade_no, "gift_card").await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
      }
      let paid_result = match mark_recharge_paid(&state, &trade_no).await {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
      };
      let paid_result = match paid_result {
        Some(value) => value,
        None => return error(StatusCode::INTERNAL_SERVER_ERROR, "充值记录创建失败", None)
      };
      recharge_record_id = Some(paid_result.record_id);
      change_amount = Some(amount);
      message = format!("成功充值 ¥{:.2}", amount);
    }
    "duration" => {
      let days = card.duration_days.unwrap_or(0);
      if days <= 0 {
        return error(StatusCode::BAD_REQUEST, "礼品卡未设置有效期天数", None);
      }
      let new_expire = match update_class_expire_time(&state, user_id, days).await {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
      };
      expires_at = new_expire;
      duration_days = Some(days);
      message = format!("等级有效期延长 {} 天", days);
    }
    "traffic" => {
      let traffic_gb = card.traffic_value_gb.unwrap_or(0);
      if traffic_gb <= 0 {
        return error(StatusCode::BAD_REQUEST, "礼品卡未配置流量数值", None);
      }
      let bytes = (traffic_gb as f64 * 1024.0 * 1024.0 * 1024.0).round() as i64;
      let update = sqlx::query(
        r#"
        UPDATE users
        SET transfer_enable = transfer_enable + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#
      )
      .bind(bytes)
      .bind(user_id)
      .execute(&state.db)
      .await;
      if let Err(err) = update {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
      }
      traffic_value_gb = Some(traffic_gb);
      message = format!("已增加 {} GB 流量", traffic_gb);
    }
    "reset_traffic" => {
      let update = sqlx::query(
        r#"
        UPDATE users
        SET transfer_total = 0,
            upload_traffic = 0,
            download_traffic = 0,
            upload_today = 0,
            download_today = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#
      )
      .bind(user_id)
      .execute(&state.db)
      .await;
      if let Err(err) = update {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
      }
      reset_traffic_gb = card.reset_traffic_gb;
      message = "已重置已用流量".to_string();
    }
    "package" => {
      let pkg_id = card.package_id.unwrap_or(0);
      if pkg_id == 0 {
        return error(StatusCode::BAD_REQUEST, "礼品卡未绑定可兑换的套餐", None);
      }
      let package = match get_package_by_id_any(&state, pkg_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return error(StatusCode::NOT_FOUND, "绑定的套餐不存在或已下架", None),
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
      };
      if package.status != 1 {
        return error(StatusCode::NOT_FOUND, "绑定的套餐不存在或已下架", None);
      }

      let now = Local::now().naive_local();
      let insert = sqlx::query(
        r#"
        INSERT INTO package_purchase_records
        (user_id, package_id, price, package_price, discount_amount, purchase_type, trade_no, status, created_at, paid_at)
        VALUES (?, ?, 0, ?, ?, 'gift_card', ?, 1, ?, ?)
        "#
      )
      .bind(user_id)
      .bind(package.id)
      .bind(package.price)
      .bind(package.price)
      .bind(&trade_no)
      .bind(now)
      .bind(now)
      .execute(&state.db)
      .await;
      let record_id = match insert {
        Ok(result) => result.last_insert_id() as i64,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
      };
      purchase_record_id = Some(record_id);
      package_id = Some(package.id);

      let apply = match update_user_after_package_purchase(&state, user_id, &package).await {
        Ok(value) => value,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
      };
      expires_at = apply.new_expire_time.clone();
      if let Some(expire) = apply.new_expire_time.as_ref() {
        let update = sqlx::query("UPDATE package_purchase_records SET expires_at = ? WHERE id = ?")
          .bind(expire)
          .bind(record_id)
          .execute(&state.db)
          .await;
        if let Err(err) = update {
          return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
        }
      }
      duration_days = package.validity_days;
      traffic_value_gb = package.traffic_quota;
      message = format!("已成功兑换套餐 {}", package.name);
    }
    _ => {
      return error(StatusCode::BAD_REQUEST, "暂不支持该礼品卡类型", None);
    }
  }

  if let Err(message) = mark_gift_card_used(&state, card.id, card.used_count, card.max_usage).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  if let Err(message) = insert_gift_card_redemption(
    &state,
    GiftCardRedemption {
      card_id: card.id,
      user_id,
      code: code.clone(),
      card_type: card.card_type.clone(),
      change_amount,
      duration_days,
      traffic_value_gb,
      reset_traffic_gb,
      package_id,
      recharge_record_id,
      purchase_record_id,
      trade_no: Some(trade_no.clone()),
      message: Some(message.clone())
    }
  )
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  success(
    json!({
      "code": code,
      "card_type": card.card_type,
      "change_amount": change_amount,
      "duration_days": duration_days,
      "traffic_value_gb": traffic_value_gb,
      "reset_traffic_gb": reset_traffic_gb,
      "usage": {
        "used_count": usage_index,
        "max_usage": card.max_usage,
        "per_user_limit": card.per_user_limit,
        "user_used_count": card.per_user_limit.map(|_| user_used_count + 1)
      },
      "message": message,
      "trade_no": trade_no,
      "package_id": package_id,
      "expires_at": expires_at
    }),
    "兑换成功"
  )
  .into_response()
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

async fn get_user_balance(state: &AppState, user_id: i64) -> Result<f64, String> {
  let row = sqlx::query("SELECT money FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  Ok(row.map(|value| parse_decimal(&value, "money", 0.0)).unwrap_or(0.0))
}

async fn list_recharge_records(
  state: &AppState,
  user_id: i64,
  limit: i64,
  offset: i64
) -> Result<Vec<Value>, String> {
  let rows = sqlx::query(
    r#"
    SELECT
      rr.id,
      CAST(rr.amount AS DOUBLE) as amount,
      rr.payment_method,
      rr.trade_no,
      rr.status,
      rr.created_at,
      rr.paid_at,
      gcr.code AS gift_card_code
    FROM recharge_records rr
    LEFT JOIN gift_card_redemptions gcr ON gcr.recharge_record_id = rr.id
    WHERE rr.user_id = ?
    ORDER BY rr.created_at DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(user_id)
  .bind(limit)
  .bind(offset)
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let data = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "amount": parse_decimal(&row, "amount", 0.0),
        "payment_method": row.try_get::<Option<String>, _>("payment_method").ok().flatten().unwrap_or_default(),
        "trade_no": row.try_get::<Option<String>, _>("trade_no").ok().flatten().unwrap_or_default(),
        "status": row.try_get::<Option<i64>, _>("status").ok().flatten().unwrap_or(0),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()).unwrap_or_default(),
        "paid_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("paid_at").ok().flatten()).unwrap_or_default(),
        "gift_card_code": row.try_get::<Option<String>, _>("gift_card_code").ok().flatten().unwrap_or_default()
      })
    })
    .collect();

  Ok(data)
}

async fn create_recharge_record(
  state: &AppState,
  user_id: i64,
  amount: f64,
  trade_no: &str,
  method: &str
) -> Result<(), String> {
  sqlx::query(
    r#"
    INSERT INTO recharge_records (user_id, amount, payment_method, trade_no, status, created_at)
    VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    "#
  )
  .bind(user_id)
  .bind(fix_money_precision(amount))
  .bind(method)
  .bind(trade_no)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

struct RechargePaidResult {
  record_id: i64,
  user_id: i64,
  amount: f64,
  applied: bool,
  already_paid: bool
}

async fn mark_recharge_paid(state: &AppState, trade_no: &str) -> Result<Option<RechargePaidResult>, String> {
  let record = sqlx::query(
    r#"
    SELECT id, user_id, amount, status
    FROM recharge_records
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
    let latest = sqlx::query("SELECT status FROM recharge_records WHERE trade_no = ?")
      .bind(trade_no)
      .fetch_optional(&state.db)
      .await
      .map_err(|err| err.to_string())?;
    let is_paid = latest
      .as_ref()
      .and_then(|row| row.try_get::<Option<i64>, _>("status").ok().flatten())
      .unwrap_or(record.try_get::<Option<i64>, _>("status").ok().flatten().unwrap_or(0))
      == 1;
    return Ok(Some(RechargePaidResult {
      record_id: record.try_get::<i64, _>("id").unwrap_or(0),
      user_id: record.try_get::<i64, _>("user_id").unwrap_or(0),
      amount: parse_decimal(&record, "amount", 0.0),
      applied: false,
      already_paid: is_paid
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
    applied: true,
    already_paid: false
  }))
}

fn build_return_url(headers: &axum::http::HeaderMap, site_url: Option<String>) -> String {
  let base = detect_base_url(headers, site_url);
  if base.is_empty() {
    return String::new();
  }
  format!("{}/user/wallet", base.trim_end_matches('/'))
}

fn detect_base_url(headers: &axum::http::HeaderMap, site_url: Option<String>) -> String {
  let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok()).map(|value| value.trim().to_string());
  let mut candidates = vec![
    header("x-frontend-url"),
    header("x-frontend-origin"),
    header("x-forwarded-origin"),
    header("cf-connecting-origin"),
    header("origin"),
    header("referer")
  ];

  for value in candidates.drain(..) {
    if let Some(base) = value.and_then(|value| parse_base_url(&value)) {
      return base;
    }
  }

  if let Some(site) = site_url.as_ref().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
    if !site.contains("panel.example.com") {
      if let Some(base) = parse_base_url(&site) {
        return base;
      }
      return site.trim_end_matches('/').to_string();
    }
  }

  if let Some(forwarded_host) = header("x-forwarded-host") {
    if !forwarded_host.is_empty() {
      let proto = header("x-forwarded-proto").unwrap_or_else(|| "https".to_string());
      return format!("{}://{}", proto.split(',').next().unwrap_or("https").trim(), forwarded_host.split(',').next().unwrap_or("").trim());
    }
  }

  if let Some(host) = header("host") {
    if !host.is_empty() {
      let proto = header("x-forwarded-proto").unwrap_or_else(|| "https".to_string());
      return format!("{}://{}", proto.split(',').next().unwrap_or("https").trim(), host);
    }
  }

  String::new()
}

fn parse_base_url(value: &str) -> Option<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return None;
  }
  let parsed = reqwest::Url::parse(trimmed).ok()?;
  let scheme = parsed.scheme();
  let host = parsed.host_str()?;
  let base = if let Some(port) = parsed.port() {
    format!("{scheme}://{host}:{port}")
  } else {
    format!("{scheme}://{host}")
  };
  Some(base)
}

fn generate_trade_no() -> String {
  let ts = Utc::now().timestamp_millis().to_string();
  let suffix = if ts.len() > 8 { &ts[ts.len() - 8..] } else { &ts };
  format!("R{}{}", suffix, random_upper_alnum(4))
}

fn random_upper_alnum(len: usize) -> String {
  const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let mut rng = rand::thread_rng();
  (0..len)
    .map(|_| {
      let idx = rng.gen_range(0..CHARSET.len());
      CHARSET[idx] as char
    })
    .collect()
}

fn fix_money_precision(amount: f64) -> f64 {
  (amount * 100.0).round() / 100.0
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

#[derive(Clone)]
struct GiftCardRow {
  id: i64,
  card_type: String,
  status: i64,
  balance_amount: Option<f64>,
  duration_days: Option<i64>,
  traffic_value_gb: Option<i64>,
  reset_traffic_gb: Option<i64>,
  package_id: Option<i64>,
  max_usage: Option<i64>,
  per_user_limit: Option<i64>,
  used_count: i64,
  start_at: Option<NaiveDateTime>,
  end_at: Option<NaiveDateTime>
}

async fn get_gift_card_by_code(state: &AppState, code: &str) -> Result<Option<GiftCardRow>, String> {
  let row = sqlx::query(
    r#"
    SELECT id, card_type, status, CAST(balance_amount AS DOUBLE) as balance_amount, duration_days, traffic_value_gb,
           reset_traffic_gb, package_id, max_usage, per_user_limit, used_count, start_at, end_at
    FROM gift_cards
    WHERE code = ? AND status = 1
    "#
  )
  .bind(code)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(row.map(|row| GiftCardRow {
    id: row.try_get::<i64, _>("id").unwrap_or(0),
    card_type: row.try_get::<Option<String>, _>("card_type").ok().flatten().unwrap_or_default(),
    status: row.try_get::<Option<i64>, _>("status").ok().flatten().unwrap_or(0),
    balance_amount: row.try_get::<Option<f64>, _>("balance_amount").ok().flatten(),
    duration_days: row.try_get::<Option<i64>, _>("duration_days").ok().flatten(),
    traffic_value_gb: row.try_get::<Option<i64>, _>("traffic_value_gb").ok().flatten(),
    reset_traffic_gb: row.try_get::<Option<i64>, _>("reset_traffic_gb").ok().flatten(),
    package_id: row.try_get::<Option<i64>, _>("package_id").ok().flatten(),
    max_usage: row.try_get::<Option<i64>, _>("max_usage").ok().flatten(),
    per_user_limit: row.try_get::<Option<i64>, _>("per_user_limit").ok().flatten(),
    used_count: row.try_get::<Option<i64>, _>("used_count").ok().flatten().unwrap_or(0),
    start_at: row.try_get::<Option<NaiveDateTime>, _>("start_at").ok().flatten(),
    end_at: row.try_get::<Option<NaiveDateTime>, _>("end_at").ok().flatten()
  }))
}

async fn count_gift_card_user_redemptions(
  state: &AppState,
  card_id: i64,
  user_id: i64
) -> Result<i64, String> {
  let row = sqlx::query(
    r#"
    SELECT COUNT(*) as total
    FROM gift_card_redemptions
    WHERE card_id = ? AND user_id = ? AND result_status = 'success'
    "#
  )
  .bind(card_id)
  .bind(user_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(row.and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten()).unwrap_or(0))
}

async fn mark_gift_card_used(
  state: &AppState,
  card_id: i64,
  used_count: i64,
  max_usage: Option<i64>
) -> Result<(), String> {
  let next_count = used_count + 1;
  let next_status = match max_usage {
    Some(max_usage) if next_count >= max_usage => 2,
    _ => 1
  };
  sqlx::query(
    r#"
    UPDATE gift_cards
    SET used_count = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(next_count)
  .bind(next_status)
  .bind(card_id)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

struct GiftCardRedemption {
  card_id: i64,
  user_id: i64,
  code: String,
  card_type: String,
  change_amount: Option<f64>,
  duration_days: Option<i64>,
  traffic_value_gb: Option<i64>,
  reset_traffic_gb: Option<i64>,
  package_id: Option<i64>,
  recharge_record_id: Option<i64>,
  purchase_record_id: Option<i64>,
  trade_no: Option<String>,
  message: Option<String>
}

async fn insert_gift_card_redemption(
  state: &AppState,
  params: GiftCardRedemption
) -> Result<(), String> {
  sqlx::query(
    r#"
    INSERT INTO gift_card_redemptions (
      card_id, user_id, code, card_type, change_amount, duration_days, traffic_value_gb, reset_traffic_gb,
      package_id, recharge_record_id, purchase_record_id, trade_no, result_status, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(params.card_id)
  .bind(params.user_id)
  .bind(params.code)
  .bind(params.card_type)
  .bind(params.change_amount)
  .bind(params.duration_days)
  .bind(params.traffic_value_gb)
  .bind(params.reset_traffic_gb)
  .bind(params.package_id)
  .bind(params.recharge_record_id)
  .bind(params.purchase_record_id)
  .bind(params.trade_no)
  .bind(params.message)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

#[derive(Clone)]
struct PackageRow {
  id: i64,
  name: String,
  price: f64,
  traffic_quota: Option<i64>,
  validity_days: Option<i64>,
  level: i64,
  status: i64,
  speed_limit: i64,
  device_limit: i64
}

async fn get_package_by_id_any(state: &AppState, package_id: i64) -> Result<Option<PackageRow>, String> {
  let row = sqlx::query(
    r#"
    SELECT id, name, price, traffic_quota, validity_days, level, status, speed_limit, device_limit
    FROM packages
    WHERE id = ?
    "#
  )
  .bind(package_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(row.map(|row| PackageRow {
    id: row.try_get::<i64, _>("id").unwrap_or(0),
    name: row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    price: parse_decimal(&row, "price", 0.0),
    traffic_quota: row.try_get::<Option<i64>, _>("traffic_quota").ok().flatten(),
    validity_days: row.try_get::<Option<i64>, _>("validity_days").ok().flatten(),
    level: row.try_get::<Option<i64>, _>("level").ok().flatten().unwrap_or(0),
    status: row.try_get::<Option<i64>, _>("status").ok().flatten().unwrap_or(0),
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
  let package_level = package.level;
  let class_expire = user_row.try_get::<Option<NaiveDateTime>, _>("class_expire_time").ok().flatten();
  let current_transfer_enable = user_row
    .try_get::<Option<i64>, _>("transfer_enable")
    .ok()
    .flatten()
    .unwrap_or(0);
  let package_traffic_bytes = package
    .traffic_quota
    .unwrap_or(0) as f64
    * 1024.0
    * 1024.0
    * 1024.0;
  let package_traffic_bytes = package_traffic_bytes.round() as i64;
  let validity_days = package.validity_days.unwrap_or(30).max(1);
  let new_speed_limit = package.speed_limit;
  let new_device_limit = package.device_limit;

  let (new_expire, new_quota, reset_used) = if let Some(expire) = class_expire {
    if expire > now && current_level == package_level {
      (
        expire + Duration::days(validity_days),
        current_transfer_enable + package_traffic_bytes,
        false
      )
    } else if current_level == package_level {
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
  } else if current_level == package_level {
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
    .bind(package_level)
    .bind(new_expire)
    .bind(new_quota)
    .bind(new_speed_limit)
    .bind(new_device_limit)
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
    .bind(package_level)
    .bind(new_expire)
    .bind(new_quota)
    .bind(new_speed_limit)
    .bind(new_device_limit)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  }

  Ok(ApplyPackageResult {
    new_expire_time: Some(new_expire.format("%Y-%m-%d %H:%M:%S").to_string())
  })
}

async fn update_class_expire_time(
  state: &AppState,
  user_id: i64,
  days: i64
) -> Result<Option<String>, String> {
  let row = sqlx::query("SELECT class_expire_time FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  let row = match row {
    Some(value) => value,
    None => return Err("用户不存在".to_string())
  };
  let existing = row.try_get::<Option<NaiveDateTime>, _>("class_expire_time").ok().flatten();

  let now = Local::now().naive_local();
  let base = if let Some(expire) = existing {
    if expire > now {
      expire
    } else {
      now
    }
  } else {
    now
  };
  let new_expire = base + Duration::days(days.max(1));
  let formatted = new_expire.format("%Y-%m-%d %H:%M:%S").to_string();

  sqlx::query(
    r#"
    UPDATE users
    SET class_expire_time = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(&formatted)
  .bind(user_id)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(Some(formatted))
}

fn build_gift_card_trade_no(code: &str, usage_index: i64) -> String {
  let clean_code = code.trim();
  let suffix = Utc::now().timestamp_millis().to_string();
  let suffix = if suffix.len() > 6 { &suffix[suffix.len() - 6..] } else { &suffix };
  format!("{clean_code}-{usage_index}-{suffix}")
}
