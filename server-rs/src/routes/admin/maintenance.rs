use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, post};
use axum::{Extension, Json, Router};
use chrono::{Datelike, Duration, Utc};
use rand::Rng;
use serde_json::json;
use sqlx::Row;

use crate::crypto::{generate_uuid, random_base64, random_string};
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/reset-daily-traffic", post(post_reset_daily_traffic))
    .route("/reset-all-passwords", post(post_reset_all_passwords))
    .route("/reset-all-subscriptions", post(post_reset_all_subscriptions))
    .route("/trigger-traffic-reset", post(post_trigger_traffic_reset))
    .route("/invite-codes/reset", post(post_reset_invite_codes))
    .route("/pending-records", delete(delete_pending_records))
    .route("/generate-traffic-test-data", post(post_generate_traffic_test_data))
}

async fn post_reset_daily_traffic(
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

  let count_row = sqlx::query("SELECT COUNT(*) as total FROM users WHERE status = 1")
    .fetch_optional(&state.db)
    .await;
  let count = match count_row {
    Ok(value) => value
      .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
      .unwrap_or(0),
    Err(_) => 0
  };

  success(
    json!({ "message": "已重置所有用户今日流量", "count": count }),
    "已重置所有用户今日流量"
  )
  .into_response()
}

async fn post_trigger_traffic_reset(
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

  success(
    json!({ "success": true, "message": "已触发每日流量重置" }),
    "已触发每日流量重置"
  )
  .into_response()
}

async fn post_reset_all_passwords(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let users = sqlx::query("SELECT id FROM users WHERE status = 1")
    .fetch_all(&state.db)
    .await;
  let users = match users {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let mut count = 0;
  for row in users {
    let user_id = row.try_get::<i64, _>("id").unwrap_or(0);
    if user_id <= 0 {
      continue;
    }
    let uuid = generate_uuid();
    let passwd = random_base64(32);
    if sqlx::query("UPDATE users SET uuid = ?, passwd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(uuid)
      .bind(passwd)
      .bind(user_id)
      .execute(&state.db)
      .await
      .is_ok()
    {
      count += 1;
    }
  }

  success(
    json!({ "count": count, "message": format!("已重置 {} 个用户的 UUID/节点密码", count) }),
    "已重置所有用户 UUID/密码"
  )
  .into_response()
}

async fn post_reset_all_subscriptions(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let users = sqlx::query("SELECT id FROM users WHERE status = 1")
    .fetch_all(&state.db)
    .await;
  let users = match users {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let mut count = 0;
  for row in users {
    let user_id = row.try_get::<i64, _>("id").unwrap_or(0);
    if user_id <= 0 {
      continue;
    }
    let token = random_string(32);
    if sqlx::query("UPDATE users SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(token)
      .bind(user_id)
      .execute(&state.db)
      .await
      .is_ok()
    {
      count += 1;
    }
  }

  success(
    json!({ "count": count, "message": format!("已重置 {} 个用户的订阅链接", count) }),
    "已重置所有用户订阅链接"
  )
  .into_response()
}

async fn post_reset_invite_codes(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let users = sqlx::query("SELECT id FROM users WHERE status = 1")
    .fetch_all(&state.db)
    .await;
  let users = match users {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let mut count = 0;
  for row in users {
    let user_id = row.try_get::<i64, _>("id").unwrap_or(0);
    if user_id <= 0 {
      continue;
    }
    let invite_code = format!("U{}{}", user_id, random_string(4));
    if sqlx::query("UPDATE users SET invite_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(invite_code)
      .bind(user_id)
      .execute(&state.db)
      .await
      .is_ok()
    {
      count += 1;
    }
  }

  success(
    json!({ "count": count, "message": format!("已重置 {} 个用户的邀请码", count) }),
    "已重置所有邀请码"
  )
  .into_response()
}

async fn delete_pending_records(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let _ = sqlx::query("DELETE FROM recharge_records WHERE status = 0")
    .execute(&state.db)
    .await;
  let _ = sqlx::query("DELETE FROM package_purchase_records WHERE status = 0")
    .execute(&state.db)
    .await;

  success(json!({ "message": "已清理待支付记录" }), "已清理待支付记录").into_response()
}

#[derive(serde::Deserialize)]
struct TrafficTestRequest {
  user_id: Option<i64>,
  days: Option<i64>
}

async fn post_generate_traffic_test_data(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<TrafficTestRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let user_id = body.user_id.unwrap_or(1);
  if user_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "user_id 无效", None);
  }

  let days_raw = body.days.unwrap_or(30);
  let days = days_raw.clamp(1, 365);

  let node_rows = sqlx::query("SELECT id FROM nodes ORDER BY id ASC LIMIT 10")
    .fetch_all(&state.db)
    .await;
  let node_rows = match node_rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let mut node_ids: Vec<i64> = node_rows
    .iter()
    .filter_map(|row| row.try_get::<Option<i64>, _>("id").ok().flatten())
    .filter(|id| *id > 0)
    .collect();
  node_ids.sort_unstable();
  node_ids.dedup();
  if node_ids.is_empty() {
    return error(StatusCode::BAD_REQUEST, "请先创建至少一个节点", None);
  }

  let start_date = (Utc::now() + Duration::hours(8))
    .date_naive()
    .checked_sub_signed(Duration::days(days - 1))
    .unwrap_or_else(|| (Utc::now() + Duration::hours(8)).date_naive());
  let start_date_str = start_date.format("%Y-%m-%d").to_string();

  let _ = sqlx::query("DELETE FROM traffic_logs WHERE user_id = ? AND date >= ?")
    .bind(user_id)
    .bind(&start_date_str)
    .execute(&state.db)
    .await;
  let _ = sqlx::query("DELETE FROM daily_traffic WHERE user_id = ? AND record_date >= ?")
    .bind(user_id)
    .bind(&start_date_str)
    .execute(&state.db)
    .await;

  for day in 0..days {
    let date = start_date + Duration::days(day);
    let date_str = date.format("%Y-%m-%d").to_string();
    let nodes_for_day = std::cmp::min(3, rand::thread_rng().gen_range(1..=3));
    let mut daily_upload: i64 = 0;
    let mut daily_download: i64 = 0;
    let mut node_usage: Vec<serde_json::Value> = Vec::new();
    let is_weekend = matches!(date.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun);
    let base_multiplier: f64 = if is_weekend { 0.7 } else { 1.0 };

    for idx in 0..nodes_for_day {
      let node_id = node_ids[(idx as usize + day as usize) % node_ids.len()];
      let upload = ((50.0_f64 + rand::thread_rng().gen_range(0.0_f64..450.0_f64)) * 1024.0 * 1024.0 * base_multiplier).floor() as i64;
      let download =
        ((200.0_f64 + rand::thread_rng().gen_range(0.0_f64..1800.0_f64)) * 1024.0 * 1024.0 * base_multiplier).floor() as i64;
      daily_upload += upload;
      daily_download += download;
      node_usage.push(json!({
        "node_id": node_id,
        "upload": upload,
        "download": download,
        "total": upload + download
      }));

      let _ = sqlx::query(
        r#"
        INSERT INTO traffic_logs (
          user_id, node_id, upload_traffic, download_traffic,
          actual_upload_traffic, actual_download_traffic, actual_traffic,
          deduction_multiplier, date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        "#
      )
      .bind(user_id)
      .bind(node_id)
      .bind(upload)
      .bind(download)
      .bind(upload)
      .bind(download)
      .bind(upload + download)
      .bind(1)
      .bind(&date_str)
      .execute(&state.db)
      .await;
    }

    let _ = sqlx::query(
      r#"
      INSERT INTO daily_traffic (
        user_id, record_date, upload_traffic, download_traffic, total_traffic, node_usage, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      "#
    )
    .bind(user_id)
    .bind(&date_str)
    .bind(daily_upload)
    .bind(daily_download)
    .bind(daily_upload + daily_download)
    .bind(json!({ "nodes": node_usage }).to_string())
    .execute(&state.db)
    .await;
  }

  let total_row = sqlx::query(
    r#"
    SELECT
      COALESCE(SUM(upload_traffic), 0) as total_upload,
      COALESCE(SUM(download_traffic), 0) as total_download
    FROM daily_traffic
    WHERE user_id = ? AND record_date >= ?
    "#
  )
  .bind(user_id)
  .bind(&start_date_str)
  .fetch_optional(&state.db)
  .await;
  let total_row = match total_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total_upload = total_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_upload").ok().flatten())
    .unwrap_or(0);
  let total_download = total_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_download").ok().flatten())
    .unwrap_or(0);
  let total_traffic = total_upload + total_download;

  let today = (Utc::now() + Duration::hours(8))
    .date_naive()
    .format("%Y-%m-%d")
    .to_string();
  let today_row = sqlx::query(
    r#"
    SELECT upload_traffic, download_traffic
    FROM daily_traffic
    WHERE user_id = ? AND record_date = ?
    "#
  )
  .bind(user_id)
  .bind(&today)
  .fetch_optional(&state.db)
  .await;
  let today_row = match today_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let upload_today = today_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("upload_traffic").ok().flatten())
    .unwrap_or(0);
  let download_today = today_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("download_traffic").ok().flatten())
    .unwrap_or(0);

  let _ = sqlx::query(
    r#"
    UPDATE users
    SET upload_traffic = ?, download_traffic = ?, transfer_total = ?, upload_today = ?, download_today = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(total_upload)
  .bind(total_download)
  .bind(total_traffic)
  .bind(upload_today)
  .bind(download_today)
  .bind(user_id)
  .execute(&state.db)
  .await;

  success(
    json!({
      "message": "测试流量数据生成完成",
      "user_id": user_id,
      "days": days,
      "total_upload": total_upload,
      "total_download": total_download,
      "total_traffic": total_traffic
    }),
    "测试流量数据生成完成"
  )
  .into_response()
}
