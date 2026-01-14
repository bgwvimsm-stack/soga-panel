use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::cache::cache_delete_by_prefix;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct ConfigRequest {
  key: Option<String>,
  value: Option<String>,
  description: Option<String>
}

#[derive(Deserialize)]
struct BatchConfigRequest {
  configs: Option<Vec<ConfigRequest>>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_configs))
    .route("/", post(post_config))
    .route("/", put(put_config))
    .route("/batch", put(put_batch))
    .route("/", delete(delete_config))
    .route("/{key}", delete(delete_config_by_key))
}

async fn get_configs(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let rows = sqlx::query("SELECT id, `key`, value, description FROM system_configs")
    .fetch_all(&state.db)
    .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let mut items: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "key": row.try_get::<Option<String>, _>("key").ok().flatten().unwrap_or_default(),
        "value": row.try_get::<Option<String>, _>("value").ok().flatten().unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default()
      })
    })
    .collect();

  let has_docs_url = items.iter().any(|item| item.get("key").and_then(Value::as_str) == Some("docs_url"));
  if !has_docs_url {
    items.push(json!({
      "id": 0,
      "key": "docs_url",
      "value": "",
      "description": "用户文档地址"
    }));
  }

  success(items, "Success").into_response()
}

async fn post_config(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<ConfigRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let key = body.key.unwrap_or_default().trim().to_string();
  if key.is_empty() {
    return error(StatusCode::BAD_REQUEST, "key 必填", None);
  }

  let existing = sqlx::query("SELECT id FROM system_configs WHERE `key` = ?")
    .bind(&key)
    .fetch_optional(&state.db)
    .await;
  let existing = match existing {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  if existing.is_some() {
    return error(StatusCode::BAD_REQUEST, "配置项已存在", None);
  }

  if let Err(err) = sqlx::query(
    r#"
    INSERT INTO system_configs (`key`, value, description, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#
  )
  .bind(&key)
  .bind(body.value.unwrap_or_default())
  .bind(body.description.unwrap_or_default())
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  clear_config_cache(&state).await;
  success(Value::Null, "配置添加成功").into_response()
}

async fn put_config(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<ConfigRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  let key = body.key.unwrap_or_default().trim().to_string();
  if key.is_empty() {
    return error(StatusCode::BAD_REQUEST, "key 必填", None);
  }
  if let Err(err) = sqlx::query(
    r#"
    INSERT INTO system_configs (`key`, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP
    "#
  )
  .bind(&key)
  .bind(body.value.unwrap_or_default())
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  clear_config_cache(&state).await;
  success(Value::Null, "已保存").into_response()
}

async fn put_batch(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<BatchConfigRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  let configs = match body.configs {
    Some(value) => value,
    None => return error(StatusCode::BAD_REQUEST, "configs 格式错误", None)
  };

  let mut success_count = 0;
  let mut failed_count = 0;
  let mut results: Vec<Value> = Vec::new();

  for config in configs {
    let key = config.key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
      failed_count += 1;
      results.push(json!({ "key": key, "success": false, "error": "配置键不能为空" }));
      continue;
    }
    let result = sqlx::query(
      r#"
      INSERT INTO system_configs (`key`, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP
      "#
    )
    .bind(&key)
    .bind(config.value.unwrap_or_default())
    .execute(&state.db)
    .await;
    match result {
      Ok(_) => {
        success_count += 1;
        results.push(json!({ "key": key, "success": true }));
      }
      Err(err) => {
        failed_count += 1;
        results.push(json!({ "key": key, "success": false, "error": err.to_string() }));
      }
    }
  }

  clear_config_cache(&state).await;
  success(
    json!({
      "message": "批量更新完成",
      "summary": {
        "total": success_count + failed_count,
        "success": success_count,
        "failed": failed_count
      },
      "details": results
    }),
    "Success"
  )
  .into_response()
}

async fn delete_config(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<ConfigRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  let key = body.key.unwrap_or_default().trim().to_string();
  if key.is_empty() {
    return error(StatusCode::BAD_REQUEST, "key 必填", None);
  }
  if let Err(err) = sqlx::query("DELETE FROM system_configs WHERE `key` = ?")
    .bind(&key)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  clear_config_cache(&state).await;
  success(Value::Null, "已删除").into_response()
}

async fn delete_config_by_key(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(key): Path<String>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  let key = key.trim().to_string();
  if key.is_empty() {
    return error(StatusCode::BAD_REQUEST, "key 必填", None);
  }
  if let Err(err) = sqlx::query("DELETE FROM system_configs WHERE `key` = ?")
    .bind(&key)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }
  clear_config_cache(&state).await;
  success(Value::Null, "已删除").into_response()
}

async fn clear_config_cache(state: &AppState) {
  cache_delete_by_prefix(state, "system_config").await;
  cache_delete_by_prefix(state, "site_config").await;
}
