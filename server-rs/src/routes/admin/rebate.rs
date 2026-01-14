use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::referral::insert_user_transaction;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct PaginationQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>
}

#[derive(Deserialize)]
struct TransactionsQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  inviter_id: Option<i64>
}

#[derive(Deserialize)]
struct TransferRequest {
  user_id: Option<i64>,
  amount: Option<f64>
}

#[derive(Deserialize)]
struct TransfersQuery {
  user_id: Option<i64>,
  limit: Option<i64>
}

#[derive(Deserialize)]
struct WithdrawalsQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>
}

#[derive(Deserialize)]
struct ReviewRequest {
  id: Option<i64>,
  status: Option<String>,
  note: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/users", get(get_users))
    .route("/transactions", get(get_transactions))
    .route("/transfer", post(post_transfer))
    .route("/transfers", get(get_transfers))
    .route("/withdrawals", get(get_withdrawals))
    .route("/withdrawals/review", post(post_withdrawal_review))
}

async fn get_users(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<PaginationQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;

  let rows = sqlx::query(
    r#"
    SELECT id, email, username, money, rebate_available, rebate_total, created_at
    FROM users
    ORDER BY id DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(limit)
  .bind(offset)
  .fetch_all(&state.db)
  .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM users")
    .fetch_optional(&state.db)
    .await;
  let total_row = match total_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let records = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "email": row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default(),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
        "money": parse_decimal(&row, "money", 0.0),
        "rebate_available": parse_decimal(&row, "rebate_available", 0.0),
        "rebate_total": parse_decimal(&row, "rebate_total", 0.0),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  success(json!({ "data": records, "total": total }), "Success").into_response()
}

async fn get_transactions(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<TransactionsQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;
  let inviter_id = query.inviter_id.filter(|value| *value > 0);

  let where_clause = if inviter_id.is_some() { "WHERE rt.inviter_id = ?" } else { "" };

  let list_sql = format!(
    r#"
    SELECT rt.*, u.email as inviter_email, u.username as inviter_username,
           iu.email as invitee_email, iu.username as invitee_username
    FROM rebate_transactions rt
    LEFT JOIN users u ON rt.inviter_id = u.id
    LEFT JOIN users iu ON rt.invitee_id = iu.id
    {where_clause}
    ORDER BY rt.created_at DESC
    LIMIT ? OFFSET ?
    "#
  );

  let mut list_query = sqlx::query(&list_sql);
  if let Some(value) = inviter_id {
    list_query = list_query.bind(value);
  }
  let rows = match list_query
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let count_sql = format!("SELECT COUNT(*) as total FROM rebate_transactions rt {where_clause}");
  let mut count_query = sqlx::query(&count_sql);
  if let Some(value) = inviter_id {
    count_query = count_query.bind(value);
  }
  let total_row = match count_query.fetch_optional(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let records = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "inviter_id": row.try_get::<Option<i64>, _>("inviter_id").ok().flatten(),
        "referral_id": row.try_get::<Option<i64>, _>("referral_id").ok().flatten(),
        "invitee_id": row.try_get::<Option<i64>, _>("invitee_id").ok().flatten(),
        "source_type": row.try_get::<Option<String>, _>("source_type").ok().flatten().unwrap_or_default(),
        "source_id": row.try_get::<Option<i64>, _>("source_id").ok().flatten(),
        "trade_no": row.try_get::<Option<String>, _>("trade_no").ok().flatten(),
        "event_type": row.try_get::<Option<String>, _>("event_type").ok().flatten().unwrap_or_default(),
        "amount": parse_decimal(&row, "amount", 0.0),
        "status": row.try_get::<Option<String>, _>("status").ok().flatten().unwrap_or_default(),
        "remark": row.try_get::<Option<String>, _>("remark").ok().flatten(),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
        "inviter_email": row.try_get::<Option<String>, _>("inviter_email").ok().flatten(),
        "inviter_username": row.try_get::<Option<String>, _>("inviter_username").ok().flatten(),
        "invitee_email": row.try_get::<Option<String>, _>("invitee_email").ok().flatten(),
        "invitee_username": row.try_get::<Option<String>, _>("invitee_username").ok().flatten()
      })
    })
    .collect::<Vec<Value>>();

  success(json!({ "data": records, "total": total }), "Success").into_response()
}

async fn post_transfer(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<TransferRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let user_id = body.user_id.unwrap_or(0);
  let amount = fix_money_precision(body.amount.unwrap_or(0.0));
  if user_id <= 0 || amount <= 0.0 {
    return error(StatusCode::BAD_REQUEST, "参数无效", None);
  }

  let mut tx = match state.db.begin().await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let row = sqlx::query("SELECT money, rebate_available FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let row = match row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "用户不存在", None)
  };

  let balance_before = parse_decimal(&row, "money", 0.0);
  let rebate_before = parse_decimal(&row, "rebate_available", 0.0);
  if rebate_before + 1e-6 < amount {
    return error(StatusCode::BAD_REQUEST, "返利余额不足", None);
  }

  let balance_after = fix_money_precision(balance_before + amount);
  let rebate_after = fix_money_precision(rebate_before - amount);

  if let Err(err) = sqlx::query(
    r#"
    UPDATE users
    SET rebate_available = rebate_available - ?, money = money + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(amount)
  .bind(amount)
  .bind(user_id)
  .execute(&mut *tx)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  if let Err(err) = sqlx::query(
    r#"
    INSERT INTO rebate_transfers (
      user_id, amount, balance_before, balance_after, rebate_before, rebate_after, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(user_id)
  .bind(amount)
  .bind(balance_before)
  .bind(balance_after)
  .bind(rebate_before)
  .bind(rebate_after)
  .execute(&mut *tx)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  if let Err(err) = tx.commit().await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "划转成功").into_response()
}

async fn get_transfers(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<TransfersQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let user_id = query.user_id.unwrap_or(0);
  if user_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "user_id 必填", None);
  }

  let mut limit = query.limit.unwrap_or(20);
  if limit <= 0 {
    limit = 20;
  }
  if limit > 200 {
    limit = 200;
  }

  let rows = sqlx::query(
    r#"
    SELECT amount, balance_before, balance_after, rebate_before, rebate_after, created_at
    FROM rebate_transfers
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
    "#
  )
  .bind(user_id)
  .bind(limit)
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
        "amount": parse_decimal(&row, "amount", 0.0),
        "balance_before": parse_decimal(&row, "balance_before", 0.0),
        "balance_after": parse_decimal(&row, "balance_after", 0.0),
        "rebate_before": parse_decimal(&row, "rebate_before", 0.0),
        "rebate_after": parse_decimal(&row, "rebate_after", 0.0),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  success(Value::Array(records), "Success").into_response()
}

async fn get_withdrawals(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<WithdrawalsQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;
  let status = query.status.as_deref().map(|value| value.trim()).unwrap_or("");

  let where_clause = if status.is_empty() {
    String::new()
  } else {
    "WHERE rw.status = ?".to_string()
  };

  let list_sql = format!(
    r#"
    SELECT rw.*, u.email, u.username
    FROM rebate_withdrawals rw
    LEFT JOIN users u ON rw.user_id = u.id
    {where_clause}
    ORDER BY rw.created_at DESC
    LIMIT ? OFFSET ?
    "#
  );

  let mut list_query = sqlx::query(&list_sql);
  if !status.is_empty() {
    list_query = list_query.bind(status);
  }
  let rows = match list_query
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let count_sql = format!("SELECT COUNT(*) as total FROM rebate_withdrawals rw {where_clause}");
  let mut count_query = sqlx::query(&count_sql);
  if !status.is_empty() {
    count_query = count_query.bind(status);
  }
  let total_row = match count_query.fetch_optional(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let records = rows
    .into_iter()
    .map(|row| {
      let payload = row
        .try_get::<Option<String>, _>("account_payload")
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str::<Value>(&value).ok());
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "userId": row.try_get::<Option<i64>, _>("user_id").ok().flatten().unwrap_or(0),
        "email": row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default(),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
        "amount": parse_decimal(&row, "amount", 0.0),
        "method": row.try_get::<Option<String>, _>("method").ok().flatten().unwrap_or_default(),
        "status": row.try_get::<Option<String>, _>("status").ok().flatten().unwrap_or_default(),
        "accountPayload": payload,
        "reviewNote": row.try_get::<Option<String>, _>("review_note").ok().flatten().unwrap_or_default(),
        "feeRate": parse_decimal(&row, "fee_rate", 0.0),
        "feeAmount": parse_decimal(&row, "fee_amount", 0.0),
        "createdAt": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
        "updatedAt": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("updated_at").ok().flatten()),
        "processedAt": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("processed_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  let total_pages = if limit > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 1 };
  success(
    json!({
      "records": records,
      "pagination": {
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": total_pages.max(1)
      }
    }),
    "Success"
  )
  .into_response()
}

async fn post_withdrawal_review(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<ReviewRequest>
) -> Response {
  let admin_id = match require_admin_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let withdrawal_id = body.id.unwrap_or(0);
  if withdrawal_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "缺少提现申请 ID", None);
  }
  let status = body.status.unwrap_or_default();
  let allowed = ["approved", "rejected", "paid"];
  if !allowed.contains(&status.as_str()) {
    return error(StatusCode::BAD_REQUEST, "状态无效", None);
  }

  if let Err(err) = sqlx::query(
    r#"
    UPDATE rebate_withdrawals
    SET status = ?, review_note = ?, reviewer_id = ?, updated_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(&status)
  .bind(body.note)
  .bind(admin_id)
  .bind(withdrawal_id)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  if status == "rejected" {
    let row = sqlx::query("SELECT user_id, amount FROM rebate_withdrawals WHERE id = ?")
      .bind(withdrawal_id)
      .fetch_optional(&state.db)
      .await;
    let row = match row {
      Ok(value) => value,
      Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
    };
    if let Some(row) = row {
      let user_id = row.try_get::<Option<i64>, _>("user_id").ok().flatten().unwrap_or(0);
      let amount = parse_decimal(&row, "amount", 0.0);
      if user_id > 0 && amount > 0.0 {
        let _ = sqlx::query(
          r#"
          UPDATE users
          SET rebate_available = rebate_available + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          "#
        )
        .bind(amount)
        .bind(user_id)
        .execute(&state.db)
        .await;

        let _ = insert_user_transaction(
          &state,
          user_id,
          amount,
          "withdraw_revert",
          "withdraw",
          Some(withdrawal_id),
          None,
          Some("withdraw_revert")
        )
        .await;
      }
    }
  }

  success(json!({ "id": withdrawal_id, "status": status }), "已更新状态").into_response()
}

fn fix_money_precision(amount: f64) -> f64 {
  (amount * 100.0).round() / 100.0
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

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}
