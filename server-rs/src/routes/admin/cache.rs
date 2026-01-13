use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Router};
use chrono::Utc;
use serde_json::json;

use crate::cache::cache_delete_by_prefix;
use crate::response::success;
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/cache-status", get(get_cache_status))
    .route("/clear-cache/audit-rules", post(post_clear_audit_rules))
    .route("/clear-cache/whitelist", post(post_clear_whitelist))
    .route("/clear-cache/all", post(post_clear_all))
    .route("/clear-cache/nodes", post(post_clear_nodes))
}

async fn get_cache_status(State(state): State<AppState>, Extension(headers): Extension<HeaderMap>) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let cache_keys = list_redis_keys(&state, 2000).await;
  let categories = json!({
    "node_config": cache_keys.iter().filter(|k| k.starts_with("node_config_")).count(),
    "node_users": cache_keys.iter().filter(|k| k.starts_with("node_users_") || k.starts_with("node_users")).count(),
    "audit_rules": cache_keys.iter().filter(|k| *k == "audit_rules" || k.starts_with("audit_rules")).count(),
    "white_list": cache_keys.iter().filter(|k| *k == "white_list" || k.starts_with("white_list") || k.starts_with("whitelist")).count(),
    "others": cache_keys
      .iter()
      .filter(|k| {
        !k.starts_with("node_config_")
          && !k.starts_with("node_users_")
          && !k.starts_with("node_users")
          && !(*k == "audit_rules" || k.starts_with("audit_rules"))
          && !(*k == "white_list" || k.starts_with("white_list") || k.starts_with("whitelist"))
      })
      .count()
  });

  success(
    json!({
      "cache_status": {
        "total_keys": cache_keys.len(),
        "categories": categories,
        "cache_keys": cache_keys
      },
      "timestamp": Utc::now().to_rfc3339()
    }),
    "Success"
  )
  .into_response()
}

async fn post_clear_audit_rules(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  cache_delete_by_prefix(&state, "audit_rules").await;
  success(
    json!({ "message": "审计规则缓存已清除", "cleared_at": Utc::now().to_rfc3339() }),
    "审计规则缓存已清除"
  )
  .into_response()
}

async fn post_clear_whitelist(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  cache_delete_by_prefix(&state, "white_list").await;
  cache_delete_by_prefix(&state, "whitelist").await;
  success(
    json!({ "message": "白名单缓存已清除", "cleared_at": Utc::now().to_rfc3339() }),
    "白名单缓存已清除"
  )
  .into_response()
}

async fn post_clear_all(State(state): State<AppState>, Extension(headers): Extension<HeaderMap>) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  cache_delete_by_prefix(&state, "node_config_").await;
  cache_delete_by_prefix(&state, "node_users_").await;
  cache_delete_by_prefix(&state, "audit_rules").await;
  cache_delete_by_prefix(&state, "white_list").await;
  cache_delete_by_prefix(&state, "whitelist").await;
  cache_delete_by_prefix(&state, "system_config").await;
  cache_delete_by_prefix(&state, "site_config").await;

  let _ = sqlx::query("UPDATE nodes SET updated_at = CURRENT_TIMESTAMP WHERE status = 1")
    .execute(&state.db)
    .await;

  success(
    json!({
      "message": "所有缓存已清除",
      "cleared_at": Utc::now().to_rfc3339(),
      "cleared_types": ["节点相关", "审计规则", "白名单", "系统配置"]
    }),
    "所有缓存已清除"
  )
  .into_response()
}

async fn post_clear_nodes(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  cache_delete_by_prefix(&state, "node_config_").await;
  cache_delete_by_prefix(&state, "node_users_").await;
  let _ = sqlx::query("UPDATE nodes SET updated_at = CURRENT_TIMESTAMP WHERE status = 1")
    .execute(&state.db)
    .await;

  success(
    json!({
      "message": "节点相关缓存已清除",
      "cleared_at": Utc::now().to_rfc3339(),
      "cleared_types": ["节点配置", "节点用户"]
    }),
    "节点相关缓存已清除"
  )
  .into_response()
}

async fn list_redis_keys(state: &AppState, max_keys: usize) -> Vec<String> {
  let redis = match state.redis.clone() {
    Some(conn) => conn,
    None => return Vec::new()
  };
  let mut conn = redis;
  let mut keys: Vec<String> = Vec::new();
  let mut cursor: u64 = 0;

  loop {
    let scan_result: redis::RedisResult<(u64, Vec<String>)> = redis::cmd("SCAN")
      .arg(cursor)
      .arg("MATCH")
      .arg("*")
      .arg("COUNT")
      .arg(200)
      .query_async(&mut conn)
      .await;
    let (next_cursor, batch) = match scan_result {
      Ok(value) => value,
      Err(_) => break
    };
    for key in batch {
      keys.push(strip_prefix(state, &key));
      if keys.len() >= max_keys {
        return keys;
      }
    }
    if next_cursor == 0 {
      break;
    }
    cursor = next_cursor;
  }

  keys
}

fn strip_prefix(state: &AppState, key: &str) -> String {
  let prefix = state.env.redis_prefix.as_str();
  if prefix.is_empty() {
    key.to_string()
  } else {
    key.strip_prefix(prefix).unwrap_or(key).to_string()
  }
}
