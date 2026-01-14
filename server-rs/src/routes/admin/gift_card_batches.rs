use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Router};
use chrono::{NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct GiftCardBatchQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  keyword: Option<String>,
  #[serde(rename = "card_type")]
  card_type: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/batches", get(get_gift_card_batches))
    .route("/batches/{id}/export-csv", get(export_batch_csv))
}

async fn get_gift_card_batches(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<GiftCardBatchQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(100);
  let offset = (page - 1) * limit;
  let keyword = query.keyword.unwrap_or_default().trim().to_string();
  let card_type = query.card_type.unwrap_or_default().trim().to_string();

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !keyword.is_empty() {
    conditions.push("(gb.name LIKE ? OR gb.code_prefix LIKE ?)".to_string());
    let pattern = format!("%{keyword}%");
    params.push(SqlParam::String(pattern.clone()));
    params.push(SqlParam::String(pattern));
  }

  if !card_type.is_empty() {
    conditions.push("gb.card_type = ?".to_string());
    params.push(SqlParam::String(card_type));
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM gift_card_batches gb {where_clause}");
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
      gb.*,
      p.name as package_name,
      u.email as creator_email,
      (
        SELECT COUNT(*)
        FROM gift_cards gc
        WHERE gc.batch_id = gb.id
      ) as card_count,
      (
        SELECT COALESCE(SUM(gc.used_count), 0)
        FROM gift_cards gc
        WHERE gc.batch_id = gb.id
      ) as used_count
    FROM gift_card_batches gb
    LEFT JOIN packages p ON gb.package_id = p.id
    LEFT JOIN users u ON gb.created_by = u.id
    {where_clause}
    ORDER BY gb.id DESC
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
    .map(|row| map_batch_row(&row))
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

async fn export_batch_csv(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(batch_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if batch_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "批次 ID 无效", None);
  }

  let batch_row = match sqlx::query("SELECT name FROM gift_card_batches WHERE id = ?")
    .bind(batch_id)
    .fetch_optional(&state.db)
    .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  if batch_row.is_none() {
    return error(StatusCode::NOT_FOUND, "礼品卡批次不存在", None);
  }

  let rows = match sqlx::query(
    r#"
    SELECT
      gc.*,
      p.name as package_name
    FROM gift_cards gc
    LEFT JOIN packages p ON gc.package_id = p.id
    WHERE gc.batch_id = ?
    ORDER BY gc.id DESC
    "#
  )
  .bind(batch_id)
  .fetch_all(&state.db)
  .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let headers = [
    "Code",
    "Name",
    "Type",
    "Status",
    "Balance Amount",
    "Duration Days",
    "Traffic Value GB",
    "Reset Traffic GB",
    "Package Id",
    "Package Name",
    "Max Usage",
    "Per User Limit",
    "Used Count",
    "Start At",
    "End At",
    "Created At"
  ];

  let mut csv = format!("{}\n", headers.join(","));
  for row in rows {
    let status = row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0);
    let balance_amount = read_optional_decimal(&row, "balance_amount").unwrap_or_default();
    let duration_days = row
      .try_get::<Option<i64>, _>("duration_days")
      .ok()
      .flatten()
      .map(|value| value.to_string())
      .unwrap_or_default();
    let traffic_value = row
      .try_get::<Option<i64>, _>("traffic_value_gb")
      .ok()
      .flatten()
      .map(|value| value.to_string())
      .unwrap_or_default();
    let reset_traffic = row
      .try_get::<Option<i64>, _>("reset_traffic_gb")
      .ok()
      .flatten()
      .map(|value| value.to_string())
      .unwrap_or_default();
    let package_id = row
      .try_get::<Option<i64>, _>("package_id")
      .ok()
      .flatten()
      .map(|value| value.to_string())
      .unwrap_or_default();
    let max_usage = row
      .try_get::<Option<i64>, _>("max_usage")
      .ok()
      .flatten()
      .map(|value| value.to_string())
      .unwrap_or_default();
    let per_user_limit = row
      .try_get::<Option<i64>, _>("per_user_limit")
      .ok()
      .flatten()
      .map(|value| value.to_string())
      .unwrap_or_default();
    let used_count = row
      .try_get::<Option<i64>, _>("used_count")
      .ok()
      .flatten()
      .unwrap_or(0)
      .to_string();

    let line = [
      escape_csv(row.try_get::<Option<String>, _>("code").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default()),
      escape_csv(row.try_get::<Option<String>, _>("card_type").ok().flatten().unwrap_or_default()),
      escape_csv(status.to_string()),
      escape_csv(balance_amount),
      escape_csv(duration_days),
      escape_csv(traffic_value),
      escape_csv(reset_traffic),
      escape_csv(package_id),
      escape_csv(row.try_get::<Option<String>, _>("package_name").ok().flatten().unwrap_or_default()),
      escape_csv(max_usage),
      escape_csv(per_user_limit),
      escape_csv(used_count),
      escape_csv(
        format_datetime(row.try_get::<Option<NaiveDateTime>, _>("start_at").ok().flatten())
          .unwrap_or_default()
      ),
      escape_csv(
        format_datetime(row.try_get::<Option<NaiveDateTime>, _>("end_at").ok().flatten()).unwrap_or_default()
      ),
      escape_csv(
        format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
          .unwrap_or_default()
      )
    ];
    csv.push_str(&format!("{}\n", line.join(",")));
  }

  let filename = format!("gift-card-batch-{}-{}.csv", batch_id, Utc::now().format("%Y-%m-%d"));
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

fn map_batch_row(row: &sqlx::mysql::MySqlRow) -> Value {
  let card_count = row.try_get::<Option<i64>, _>("card_count").ok().flatten().unwrap_or(0);
  let used_count = row.try_get::<Option<i64>, _>("used_count").ok().flatten().unwrap_or(0);
  let remaining = (card_count - used_count).max(0);

  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    "description": row.try_get::<Option<String>, _>("description").ok().flatten(),
    "card_type": row.try_get::<Option<String>, _>("card_type").ok().flatten().unwrap_or_default(),
    "quantity": row.try_get::<Option<i64>, _>("quantity").unwrap_or(Some(0)).unwrap_or(0),
    "code_prefix": row.try_get::<Option<String>, _>("code_prefix").ok().flatten().unwrap_or_default(),
    "balance_amount": parse_decimal(row, "balance_amount", 0.0),
    "duration_days": row.try_get::<Option<i64>, _>("duration_days").ok().flatten(),
    "traffic_value_gb": row.try_get::<Option<i64>, _>("traffic_value_gb").ok().flatten(),
    "reset_traffic_gb": row.try_get::<Option<i64>, _>("reset_traffic_gb").ok().flatten(),
    "package_id": row.try_get::<Option<i64>, _>("package_id").ok().flatten(),
    "package_name": row.try_get::<Option<String>, _>("package_name").ok().flatten(),
    "max_usage": row.try_get::<Option<i64>, _>("max_usage").ok().flatten(),
    "per_user_limit": row.try_get::<Option<i64>, _>("per_user_limit").ok().flatten(),
    "start_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("start_at").ok().flatten()),
    "end_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("end_at").ok().flatten()),
    "created_by": row.try_get::<Option<i64>, _>("created_by").ok().flatten(),
    "creator_email": row.try_get::<Option<String>, _>("creator_email").ok().flatten(),
    "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
    "card_count": card_count,
    "used_count": used_count,
    "remaining_count": remaining
  })
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
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

fn read_optional_decimal(row: &sqlx::mysql::MySqlRow, column: &str) -> Option<String> {
  if let Ok(value) = row.try_get::<Option<f64>, _>(column) {
    return value.map(|val| format!("{:.2}", val));
  }
  if let Ok(value) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(column) {
    return value.map(|val| {
      val
        .to_string()
        .parse::<f64>()
        .map(|num| format!("{:.2}", num))
        .unwrap_or_else(|_| val.to_string())
    });
  }
  if let Ok(value) = row.try_get::<Option<String>, _>(column) {
    return value;
  }
  None
}

fn escape_csv(value: impl ToString) -> String {
  format!("\"{}\"", value.to_string().replace('"', "\"\""))
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  String(String)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::String(value) => query.bind(value)
    };
  }
  query
}
