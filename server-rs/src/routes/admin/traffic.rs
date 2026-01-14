use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Router};
use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct OverviewQuery {
  days: Option<i64>
}

#[derive(Deserialize)]
struct DailyQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  date: Option<String>
}

#[derive(Deserialize)]
struct SystemSummaryQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  days: Option<i64>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/overview", get(get_overview))
    .route("/trends", get(get_overview))
    .route("/daily-reset", post(post_daily_reset))
    .route("/daily", get(get_daily))
    .route("/system-summary", get(get_system_summary))
    .route("/reset-today", post(post_reset_today))
}

async fn get_overview(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<OverviewQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let mut days = query.days.unwrap_or(30);
  if days <= 0 {
    days = 30;
  }
  if days > 365 {
    days = 365;
  }

  let rows = sqlx::query(
    r#"
    SELECT record_date, total_users, total_upload, total_download, total_traffic
    FROM system_traffic_summary
    WHERE record_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
    ORDER BY record_date DESC
    "#
  )
  .bind(days)
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
        "record_date": format_date(row.try_get::<Option<NaiveDate>, _>("record_date").ok().flatten()).unwrap_or_default(),
        "total_users": row.try_get::<Option<i64>, _>("total_users").unwrap_or(Some(0)).unwrap_or(0),
        "total_upload": row.try_get::<Option<i64>, _>("total_upload").unwrap_or(Some(0)).unwrap_or(0),
        "total_download": row.try_get::<Option<i64>, _>("total_download").unwrap_or(Some(0)).unwrap_or(0),
        "total_traffic": row.try_get::<Option<i64>, _>("total_traffic").unwrap_or(Some(0)).unwrap_or(0)
      })
    })
    .collect::<Vec<Value>>();

  success(records, "Success").into_response()
}

async fn post_daily_reset(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  if let Err(err) = sqlx::query("UPDATE users SET upload_today = 0, download_today = 0")
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "已执行每日流量重置").into_response()
}

async fn get_daily(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<DailyQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(50);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;
  let date = query
    .date
    .unwrap_or_default()
    .trim()
    .to_string();
  let date = if date.is_empty() {
    None
  } else {
    Some(date.chars().take(10).collect::<String>())
  };

  let where_clause = if date.is_some() {
    "WHERE dt.record_date = ?"
  } else {
    ""
  };

  let list_sql = format!(
    r#"
    SELECT dt.*, u.email, u.username
    FROM daily_traffic dt
    LEFT JOIN users u ON dt.user_id = u.id
    {where_clause}
    ORDER BY dt.record_date DESC, dt.user_id ASC
    LIMIT ? OFFSET ?
    "#
  );

  let mut list_query = sqlx::query(&list_sql);
  if let Some(value) = date.as_ref() {
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

  let count_sql = format!("SELECT COUNT(*) as total FROM daily_traffic dt {where_clause}");
  let mut count_query = sqlx::query(&count_sql);
  if let Some(value) = date.as_ref() {
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
      let node_usage_raw = row.try_get::<Option<String>, _>("node_usage").ok().flatten();
      let node_usage = node_usage_raw
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| node_usage_raw.map(Value::String).unwrap_or(Value::Null));

      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "user_id": row.try_get::<i64, _>("user_id").unwrap_or(0),
        "record_date": format_date(row.try_get::<Option<NaiveDate>, _>("record_date").ok().flatten()).unwrap_or_default(),
        "upload_traffic": row.try_get::<Option<i64>, _>("upload_traffic").unwrap_or(Some(0)).unwrap_or(0),
        "download_traffic": row.try_get::<Option<i64>, _>("download_traffic").unwrap_or(Some(0)).unwrap_or(0),
        "total_traffic": row.try_get::<Option<i64>, _>("total_traffic").unwrap_or(Some(0)).unwrap_or(0),
        "node_usage": node_usage,
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
        "email": row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default(),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default()
      })
    })
    .collect::<Vec<Value>>();

  success(json!({ "data": records, "total": total }), "Success").into_response()
}

async fn get_system_summary(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<SystemSummaryQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(30);
  let limit = limit_raw.max(1).min(365);
  let offset = (page - 1) * limit;
  let days = query.days.filter(|value| *value > 0);

  let where_clause = if days.is_some() {
    "WHERE record_date >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)"
  } else {
    ""
  };

  let list_sql = format!(
    r#"
    SELECT *
    FROM system_traffic_summary
    {where_clause}
    ORDER BY record_date DESC
    LIMIT ? OFFSET ?
    "#
  );
  let mut list_query = sqlx::query(&list_sql);
  if let Some(value) = days {
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

  let count_sql = format!("SELECT COUNT(*) as total FROM system_traffic_summary {where_clause}");
  let mut count_query = sqlx::query(&count_sql);
  if let Some(value) = days {
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
        "record_date": format_date(row.try_get::<Option<NaiveDate>, _>("record_date").ok().flatten()).unwrap_or_default(),
        "total_users": row.try_get::<Option<i64>, _>("total_users").unwrap_or(Some(0)).unwrap_or(0),
        "total_upload": row.try_get::<Option<i64>, _>("total_upload").unwrap_or(Some(0)).unwrap_or(0),
        "total_download": row.try_get::<Option<i64>, _>("total_download").unwrap_or(Some(0)).unwrap_or(0),
        "total_traffic": row.try_get::<Option<i64>, _>("total_traffic").unwrap_or(Some(0)).unwrap_or(0),
        "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten())
      })
    })
    .collect::<Vec<Value>>();

  success(json!({ "data": records, "total": total }), "Success").into_response()
}

async fn post_reset_today(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  if let Err(err) = sqlx::query("UPDATE users SET upload_today = 0, download_today = 0")
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "已重置今日流量").into_response()
}

fn format_date(value: Option<NaiveDate>) -> Option<String> {
  value.map(|date| date.format("%Y-%m-%d").to_string())
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}
