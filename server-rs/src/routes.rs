use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use std::time::Instant;

mod auth;
mod admin;
mod announcement;
mod node;
mod payment_config;
mod payment_callback;
mod rebate;
mod store;
mod subscription;
mod user;
mod wallet;

use crate::response::{error, ApiResponse};
use crate::state::AppState;

#[derive(Serialize)]
struct RootResponse {
  status: &'static str,
  message: &'static str,
  health: &'static str,
  version: String
}

#[derive(Serialize)]
struct HealthResponse {
  status: &'static str,
  message: &'static str,
  timestamp: String,
  version: String,
  build_time: Option<String>,
  redis: String
}

#[derive(Serialize)]
struct DbTestResponse {
  status: &'static str,
  message: &'static str,
  latency_ms: u128,
  timestamp: String,
  result: Value
}

pub fn create_router(state: AppState) -> Router {
  let user_router = user::router().merge(wallet::user_shortcut_router());
  Router::new()
    .route("/", get(root))
    .route("/api/health", get(health))
    .route("/api/api/health", get(health))
    .route("/api/database/test", get(database_test))
    .route("/api/site/settings", get(site_settings))
    .nest("/api/announcements", announcement::router())
    .nest("/api/admin", admin::router())
    .nest("/api/subscription", subscription::router())
    .nest("/api/api/subscription", subscription::router())
    .nest("/subscription", subscription::router())
    .nest("/api/payment/callback", payment_callback::router())
    .nest("/api/payment", payment_callback::notify_router())
    .nest("/api/payment/config", payment_config::router())
    .nest("/api/rebate", rebate::router())
    .nest("/api/user/rebate", rebate::router())
    .nest("/api/wallet", wallet::router())
    .nest("/api/user/wallet", wallet::router())
    .nest("/api", store::router())
    .nest("/api/auth", auth::router())
    .nest("/api/user", user_router)
    .nest("/api/v1", node::router())
    .fallback(not_found)
    .with_state(state)
}

async fn root(State(state): State<AppState>) -> Json<RootResponse> {
  let version = state
    .env
    .site_name
    .clone()
    .unwrap_or_else(|| "soga-panel-server".to_string());
  Json(RootResponse {
    status: "ok",
    message: "Soga Panel server is running",
    health: "/api/health",
    version
  })
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
  let version = state
    .env
    .site_name
    .clone()
    .unwrap_or_else(|| "soga-panel-server".to_string());
  let build_time = std::env::var("BUILD_TIME")
    .ok()
    .or_else(|| option_env!("BUILD_TIME").map(|value| value.to_string()));
  let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
  let redis_status = state.redis_status.as_str().to_string();
  let data = HealthResponse {
    status: "healthy",
    message: "Node server is running",
    timestamp: timestamp.clone(),
    version: version.clone(),
    build_time: build_time.clone(),
    redis: redis_status.clone()
  };
  let message = data.message;
  Json(json!({
    "code": 0,
    "message": message,
    "data": data,
    "status": "healthy",
    "timestamp": timestamp,
    "version": version,
    "build_time": build_time,
    "redis": redis_status
  }))
}

async fn database_test(State(state): State<AppState>) -> impl IntoResponse {
  let start = Instant::now();
  let query = sqlx::query("SELECT 1 AS test");
  match query.fetch_one(&state.db).await {
    Ok(row) => {
      let test_value: i32 = row.try_get("test").unwrap_or(1);
      let payload = DbTestResponse {
        status: "connected",
        message: "Database connection ok",
        latency_ms: start.elapsed().as_millis(),
        timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        result: json!({ "test": test_value })
      };
      Json(payload).into_response()
    }
    Err(err) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(json!({ "status": "error", "message": err.to_string() }))
    )
      .into_response()
  }
}

async fn site_settings(State(state): State<AppState>) -> impl IntoResponse {
  let rows = sqlx::query("SELECT `key`, `value` FROM system_configs WHERE `key` IN ('site_name','site_url','docs_url')")
    .fetch_all(&state.db)
    .await;

  match rows {
    Ok(records) => {
      let mut configs: HashMap<String, String> = HashMap::new();
      for row in records {
        let key: String = row.try_get("key").unwrap_or_default();
        let value: Option<String> = row.try_get("value").ok();
        configs.insert(key, value.unwrap_or_default());
      }

      let site_name = configs
        .get("site_name")
        .filter(|value| !value.is_empty())
        .cloned()
        .or_else(|| state.env.site_name.clone())
        .unwrap_or_else(|| "Soga Panel".to_string());
      let site_url = configs
        .get("site_url")
        .filter(|value| !value.is_empty())
        .cloned()
        .or_else(|| state.env.site_url.clone())
        .unwrap_or_default();
      let docs_url = configs.get("docs_url").cloned().unwrap_or_default();

      let payload = ApiResponse {
        code: 0,
        message: "ok".to_string(),
        data: json!({
          "siteName": site_name,
          "siteUrl": site_url,
          "docsUrl": docs_url
        })
      };
      Json(payload).into_response()
    }
    Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  }
}

async fn not_found() -> impl IntoResponse {
  error(
    StatusCode::NOT_FOUND,
    "Endpoint not implemented in Node server yet",
    None
  )
}
