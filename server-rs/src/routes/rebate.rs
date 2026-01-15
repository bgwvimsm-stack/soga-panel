use axum::extract::{Query, State};
use axum::http::StatusCode;
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

use super::auth::{list_system_configs, require_user_id};

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/balance", get(get_balance))
    .route("/withdraw", post(post_withdraw))
    .route("/transfers", get(get_transfers))
    .route("/withdrawals", get(get_withdrawals))
    .route("/transactions", get(get_transactions))
    .route("/ledger", get(get_ledger))
    .route("/transfer", post(post_transfer))
}

async fn get_balance(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let row = sqlx::query("SELECT rebate_available, rebate_total, money FROM users WHERE id = ?")
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

  let rebate_available = parse_decimal(&row, "rebate_available", 0.0);
  let rebate_total = parse_decimal(&row, "rebate_total", 0.0);
  let balance = parse_decimal(&row, "money", 0.0);

  success(
    json!({
      "rebate_available": rebate_available,
      "rebate_total": rebate_total,
      "balance": balance
    }),
    "Success"
  )
  .into_response()
}

#[derive(Deserialize)]
struct WithdrawRequest {
  amount: Option<f64>,
  method: Option<String>,
  #[serde(alias = "accountPayload", alias = "account_payload")]
  account_payload: Option<Value>,
  account: Option<Value>
}

async fn post_withdraw(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Json(body): Json<WithdrawRequest>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let amount_raw = body.amount.unwrap_or(0.0);
  let amount = fix_money_precision(amount_raw);
  if amount <= 0.0 {
    return error(StatusCode::BAD_REQUEST, "金额无效", None);
  }

  let configs = list_system_configs(&state).await.unwrap_or_default();
  let min_amount = configs
    .get("rebate_withdraw_min_amount")
    .and_then(|value| value.parse::<f64>().ok())
    .filter(|value| *value > 0.0)
    .unwrap_or(200.0);
  let fee_rate = configs
    .get("rebate_withdraw_fee_rate")
    .and_then(|value| value.parse::<f64>().ok())
    .unwrap_or(0.0)
    .clamp(0.0, 1.0);

  if amount + 1e-6 < min_amount {
    return error(
      StatusCode::BAD_REQUEST,
      &format!("单次提现金额需不少于 {:.2} 元", min_amount),
      None
    );
  }

  let user_row = sqlx::query("SELECT rebate_available FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;
  let user_row = match user_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let user_row = match user_row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "用户不存在", None)
  };
  let available = parse_decimal(&user_row, "rebate_available", 0.0);
  if available + 1e-6 < min_amount {
    return error(
      StatusCode::BAD_REQUEST,
      &format!("返利余额满 {:.2} 元才允许提现", min_amount),
      None
    );
  }
  if available + 1e-6 < amount {
    return error(StatusCode::BAD_REQUEST, "返利余额不足", None);
  }

  let fee_amount = fix_money_precision(amount * fee_rate);
  let account_payload = body
    .account_payload
    .or(body.account)
    .map(|value| serde_json::to_string(&value).unwrap_or_default())
    .filter(|value| !value.trim().is_empty());
  let method = body.method.unwrap_or_else(|| "manual".to_string());

  let update = sqlx::query(
    r#"
    UPDATE users
    SET rebate_available = rebate_available - ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(amount)
  .bind(user_id)
  .execute(&state.db)
  .await;
  if let Err(err) = update {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  let insert = sqlx::query(
    r#"
    INSERT INTO rebate_withdrawals (
      user_id, amount, method, account_payload, fee_rate, fee_amount, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#
  )
  .bind(user_id)
  .bind(amount)
  .bind(&method)
  .bind(account_payload.clone())
  .bind(fee_rate)
  .bind(fee_amount)
  .execute(&state.db)
  .await;
  let withdrawal_id = match insert {
    Ok(result) => result.last_insert_id() as i64,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let _ = insert_user_transaction(
    &state,
    user_id,
    -amount,
    "withdraw",
    "withdraw",
    Some(withdrawal_id),
    None,
    Some(&method)
  )
  .await;

  success(Value::Null, "提现申请已提交").into_response()
}

#[derive(Deserialize)]
struct TransferQuery {
  limit: Option<i64>
}

async fn get_transfers(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<TransferQuery>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

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

  let data: Vec<Value> = rows
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
    .collect();

  success(Value::Array(data), "Success").into_response()
}

#[derive(Deserialize)]
struct WithdrawalsQuery {
  page: Option<i64>,
  limit: Option<i64>
}

async fn get_withdrawals(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<WithdrawalsQuery>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let page = query.page.unwrap_or(1).max(1);
  let mut limit = query.limit.unwrap_or(10);
  if limit <= 0 {
    limit = 10;
  }
  if limit > 200 {
    limit = 200;
  }
  let offset = (page - 1) * limit;

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM rebate_withdrawals WHERE user_id = ?")
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

  let rows = sqlx::query(
    r#"
    SELECT id, amount, method, status, account_payload, review_note,
           fee_rate, fee_amount, created_at, updated_at, processed_at
    FROM rebate_withdrawals
    WHERE user_id = ?
    ORDER BY id DESC
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

  let records: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      let payload = row
        .try_get::<Option<String>, _>("account_payload")
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str::<Value>(&value).ok());
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
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
    .collect();

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

#[derive(Deserialize)]
struct TransactionsQuery {
  page: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>
}

async fn get_transactions(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<TransactionsQuery>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let page = query.page.unwrap_or(1).max(1);
  let mut page_size = query.page_size.unwrap_or(20);
  if page_size <= 0 {
    page_size = 20;
  }
  if page_size > 200 {
    page_size = 200;
  }
  let offset = (page - 1) * page_size;

  let rows = sqlx::query(
    r#"
    SELECT rt.*, u.email as inviter_email, u.username as inviter_username,
           iu.email as invitee_email, iu.username as invitee_username
    FROM rebate_transactions rt
    LEFT JOIN users u ON rt.inviter_id = u.id
    LEFT JOIN users iu ON rt.invitee_id = iu.id
    WHERE rt.inviter_id = ?
    ORDER BY rt.created_at DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(user_id)
  .bind(page_size)
  .bind(offset)
  .fetch_all(&state.db)
  .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let total_row = sqlx::query("SELECT COUNT(*) as total FROM rebate_transactions WHERE inviter_id = ?")
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

  let items: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "inviter_id": row.try_get::<i64, _>("inviter_id").unwrap_or(0),
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
    .collect();

  success(
    json!({
      "items": items,
      "pagination": {
        "page": page,
        "pageSize": page_size,
        "total": total
      }
    }),
    "Success"
  )
  .into_response()
}

#[derive(Deserialize)]
struct LedgerQuery {
  page: Option<i64>,
  limit: Option<i64>,
  event_type: Option<String>
}

async fn get_ledger(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<LedgerQuery>
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

  let mut filters = vec!["rt.inviter_id = ?"];
  let mut params = vec![SqlParam::I64(user_id)];
  if let Some(event_type) = query.event_type.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
    filters.push("rt.event_type = ?");
    params.push(SqlParam::String(event_type.to_string()));
  }
  let where_clause = format!("WHERE {}", filters.join(" AND "));

  let total_sql = format!("SELECT COUNT(*) as total FROM rebate_transactions rt {where_clause}");
  let mut total_query = sqlx::query(&total_sql);
  total_query = bind_params(total_query, &params);
  let total_row = total_query
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

  let data_sql = format!(
    r#"
    SELECT rt.id, rt.event_type, rt.amount, rt.source_type, rt.source_id,
           rt.trade_no, rt.status, rt.created_at, rt.invitee_id,
           u.email as invitee_email
    FROM rebate_transactions rt
    LEFT JOIN users u ON rt.invitee_id = u.id
    {where_clause}
    ORDER BY rt.created_at DESC
    LIMIT ? OFFSET ?
    "#
  );
  let mut data_query = sqlx::query(&data_sql);
  data_query = bind_params(data_query, &params);
  let rows = data_query
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let records: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "eventType": row.try_get::<Option<String>, _>("event_type").ok().flatten().unwrap_or_default(),
        "amount": parse_decimal(&row, "amount", 0.0),
        "sourceType": row.try_get::<Option<String>, _>("source_type").ok().flatten().unwrap_or_default(),
        "sourceId": row.try_get::<Option<i64>, _>("source_id").ok().flatten(),
        "tradeNo": row.try_get::<Option<String>, _>("trade_no").ok().flatten().unwrap_or_default(),
        "status": row.try_get::<Option<String>, _>("status").ok().flatten().unwrap_or_default(),
        "createdAt": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
        "inviteeEmail": row.try_get::<Option<String>, _>("invitee_email").ok().flatten().unwrap_or_default()
      })
    })
    .collect();

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

#[derive(Deserialize)]
struct TransferRequest {
  amount: Option<f64>
}

async fn post_transfer(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Json(body): Json<TransferRequest>
) -> Response {
  let user_id = match require_user_id(&state, &headers, None).await {
    Ok(value) => value,
    Err(resp) => return resp
  };

  let amount = fix_money_precision(body.amount.unwrap_or(0.0));
  if amount <= 0.0 {
    return error(StatusCode::BAD_REQUEST, "金额无效", None);
  }

  let row = sqlx::query("SELECT money, rebate_available FROM users WHERE id = ?")
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
  let rebate_available = parse_decimal(&row, "rebate_available", 0.0);
  if rebate_available + 1e-6 < amount {
    return error(StatusCode::BAD_REQUEST, "返利余额不足", None);
  }

  let update = sqlx::query(
    r#"
    UPDATE users
    SET rebate_available = rebate_available - ?, money = money + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(amount)
  .bind(amount)
  .bind(user_id)
  .execute(&state.db)
  .await;
  if let Err(err) = update {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  let _ = insert_user_transaction(
    &state,
    user_id,
    -amount,
    "transfer",
    "balance",
    None,
    None,
    None
  )
  .await;

  let balance_row = sqlx::query("SELECT money, rebate_available FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;
  let balance_row = match balance_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let balance_row = match balance_row {
    Some(value) => value,
    None => return error(StatusCode::NOT_FOUND, "用户不存在", None)
  };
  let money = parse_decimal(&balance_row, "money", 0.0);
  let rebate_available = parse_decimal(&balance_row, "rebate_available", 0.0);

  success(
    json!({
      "money": money,
      "rebateAvailable": rebate_available
    }),
    "Success"
  )
  .into_response()
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

#[derive(Clone)]
enum SqlParam {
  I64(i64),
  String(String)
}

fn bind_params<'a>(
  mut query: sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>,
  params: &[SqlParam]
) -> sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value.clone())
    };
  }
  query
}
