use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct TrafficResetRequest {
  #[serde(rename = "user_ids")]
  user_ids: Option<Vec<i64>>
}

#[derive(Deserialize)]
struct TrafficAggregateRequest {
  date: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/traffic-reset-preview", get(get_traffic_reset_preview))
    .route("/traffic-reset", post(post_traffic_reset))
    .route("/traffic-aggregate", post(post_traffic_aggregate))
}

async fn get_traffic_reset_preview(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let rows = sqlx::query(
    r#"
    SELECT id, email, username, upload_today, download_today,
           (upload_today + download_today) AS transfer_today,
           transfer_total, transfer_enable
    FROM users
    WHERE upload_today > 0 OR download_today > 0
    "#
  )
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
        "email": row.try_get::<Option<String>, _>("email").ok().flatten().unwrap_or_default(),
        "username": row.try_get::<Option<String>, _>("username").ok().flatten().unwrap_or_default(),
        "upload_today": row.try_get::<Option<i64>, _>("upload_today").unwrap_or(Some(0)).unwrap_or(0),
        "download_today": row.try_get::<Option<i64>, _>("download_today").unwrap_or(Some(0)).unwrap_or(0),
        "transfer_today": row.try_get::<Option<i64>, _>("transfer_today").unwrap_or(Some(0)).unwrap_or(0),
        "transfer_total": row.try_get::<Option<i64>, _>("transfer_total").unwrap_or(Some(0)).unwrap_or(0),
        "transfer_enable": row.try_get::<Option<i64>, _>("transfer_enable").unwrap_or(Some(0)).unwrap_or(0)
      })
    })
    .collect::<Vec<Value>>();

  success(records, "Success").into_response()
}

async fn post_traffic_reset(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<TrafficResetRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let mut ids = body.user_ids.unwrap_or_default();
  ids.retain(|id| *id > 0);
  ids.sort_unstable();
  ids.dedup();

  if ids.is_empty() {
    if let Err(err) = sqlx::query("UPDATE users SET upload_today = 0, download_today = 0")
      .execute(&state.db)
      .await
    {
      return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }
    return success(Value::Null, "已重置全部用户今日流量").into_response();
  }

  let placeholders = ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
  let sql = format!(
    "UPDATE users SET upload_today = 0, download_today = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})"
  );
  let mut query = sqlx::query(&sql);
  for id in &ids {
    query = query.bind(id);
  }
  if let Err(err) = query.execute(&state.db).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, &format!("已重置 {} 个用户今日流量", ids.len())).into_response()
}

async fn post_traffic_aggregate(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<TrafficAggregateRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let record_date = body
    .date
    .unwrap_or_default()
    .trim()
    .to_string();
  let record_date = if record_date.is_empty() {
    let now = Utc::now() + Duration::hours(8);
    let date = now.date_naive() - Duration::days(1);
    date.format("%Y-%m-%d").to_string()
  } else {
    record_date.chars().take(10).collect::<String>()
  };

  match aggregate_traffic_for_date(&state, &record_date).await {
    Ok((user_count, system_stats)) => success(
      json!({ "record_date": record_date, "userCount": user_count, "systemStats": system_stats }),
      "汇总完成"
    )
    .into_response(),
    Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  }
}

async fn aggregate_traffic_for_date(state: &AppState, record_date: &str) -> Result<(i64, Value), String> {
  let user_count = aggregate_daily_traffic(state, record_date).await?;
  let system_stats = aggregate_system_traffic(state, record_date).await?;
  Ok((user_count, system_stats))
}

async fn aggregate_daily_traffic(state: &AppState, record_date: &str) -> Result<i64, String> {
  let rows = sqlx::query(
    r#"
    SELECT user_id,
           COALESCE(SUM(actual_upload_traffic), 0) as upload,
           COALESCE(SUM(actual_download_traffic), 0) as download,
           COALESCE(SUM(actual_traffic), 0) as total
    FROM traffic_logs
    WHERE date = ?
    GROUP BY user_id
    "#
  )
  .bind(record_date)
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  for row in &rows {
    let user_id = row.try_get::<i64, _>("user_id").unwrap_or(0);
    let upload = row.try_get::<Option<i64>, _>("upload").unwrap_or(Some(0)).unwrap_or(0);
    let download = row.try_get::<Option<i64>, _>("download").unwrap_or(Some(0)).unwrap_or(0);
    let total = row.try_get::<Option<i64>, _>("total").unwrap_or(Some(0)).unwrap_or(0);

    sqlx::query(
      r#"
      INSERT INTO daily_traffic (user_id, record_date, upload_traffic, download_traffic, total_traffic, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        upload_traffic = VALUES(upload_traffic),
        download_traffic = VALUES(download_traffic),
        total_traffic = VALUES(total_traffic)
      "#
    )
    .bind(user_id)
    .bind(record_date)
    .bind(upload)
    .bind(download)
    .bind(total)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  }

  Ok(rows.len() as i64)
}

async fn aggregate_system_traffic(state: &AppState, record_date: &str) -> Result<Value, String> {
  let row = sqlx::query(
    r#"
    SELECT
      COUNT(DISTINCT user_id) as users,
      COALESCE(SUM(actual_upload_traffic), 0) as total_upload,
      COALESCE(SUM(actual_download_traffic), 0) as total_download,
      COALESCE(SUM(actual_traffic), 0) as total_traffic
    FROM traffic_logs
    WHERE date = ?
    "#
  )
  .bind(record_date)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let users = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("users").ok().flatten())
    .unwrap_or(0);
  let total_upload = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_upload").ok().flatten())
    .unwrap_or(0);
  let total_download = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_download").ok().flatten())
    .unwrap_or(0);
  let total_traffic = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_traffic").ok().flatten())
    .unwrap_or(0);

  sqlx::query(
    r#"
    INSERT INTO system_traffic_summary (record_date, total_users, total_upload, total_download, total_traffic, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      total_users = VALUES(total_users),
      total_upload = VALUES(total_upload),
      total_download = VALUES(total_download),
      total_traffic = VALUES(total_traffic)
    "#
  )
  .bind(record_date)
  .bind(users)
  .bind(total_upload)
  .bind(total_download)
  .bind(total_traffic)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(json!({
    "total_users": users,
    "total_upload": total_upload,
    "total_download": total_download,
    "total_traffic": total_traffic
  }))
}
