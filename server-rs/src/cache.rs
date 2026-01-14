use chrono::{Duration, Utc};
use redis::AsyncCommands;
use serde_json::Value;
use sqlx::Row;

use crate::state::AppState;

fn redis_key(state: &AppState, key: &str) -> String {
  let prefix = state.env.redis_prefix.as_str();
  if prefix.is_empty() || key.starts_with(prefix) {
    key.to_string()
  } else {
    format!("{prefix}{key}")
  }
}

#[allow(dead_code)]
pub async fn cache_get(state: &AppState, key: &str) -> Option<String> {
  if let Some(redis) = state.redis.clone() {
    let mut conn = redis;
    let redis_key = redis_key(state, key);
    let result: redis::RedisResult<Option<String>> = conn.get(redis_key).await;
    if let Ok(Some(value)) = result {
      return Some(value);
    }
  }

  if key.starts_with("session_") {
    return get_session_from_db(state, key).await;
  }

  if key.starts_with("sub_token_") {
    return get_subscription_from_db(state, key).await;
  }

  None
}

pub async fn cache_set(state: &AppState, key: &str, value: &str, ttl_seconds: u64) {
  if let Some(redis) = state.redis.clone() {
    let mut conn = redis;
    let redis_key = redis_key(state, key);
    let _ = conn.set_ex::<_, _, ()>(redis_key, value, ttl_seconds).await;
  }

  if key.starts_with("session_") {
    let _ = set_session_to_db(state, key, value, ttl_seconds).await;
  }
}

pub async fn cache_delete(state: &AppState, key: &str) {
  if let Some(redis) = state.redis.clone() {
    let mut conn = redis;
    let redis_key = redis_key(state, key);
    let _ = conn.del::<_, i32>(redis_key).await;
  }

  if key.starts_with("session_") {
    let token = key.trim_start_matches("session_");
    let _ = sqlx::query("DELETE FROM user_sessions WHERE token = ?")
      .bind(token)
      .execute(&state.db)
      .await;
  }
}

pub async fn cache_set_redis_only(state: &AppState, key: &str, value: &str, ttl_seconds: u64) {
  if let Some(redis) = state.redis.clone() {
    let mut conn = redis;
    let redis_key = redis_key(state, key);
    let _ = conn.set_ex::<_, _, ()>(redis_key, value, ttl_seconds).await;
  }
}

pub async fn cache_get_redis_only(state: &AppState, key: &str) -> Option<String> {
  if let Some(redis) = state.redis.clone() {
    let mut conn = redis;
    let redis_key = redis_key(state, key);
    let result: redis::RedisResult<Option<String>> = conn.get(redis_key).await;
    if let Ok(value) = result {
      return value;
    }
  }
  None
}

pub async fn cache_delete_by_prefix(state: &AppState, prefix: &str) {
  let redis = match state.redis.clone() {
    Some(conn) => conn,
    None => return
  };
  let mut conn = redis;
  let base = redis_key(state, prefix);
  let pattern = format!("{base}*");
  let mut cursor: u64 = 0;

  loop {
    let scan_result: redis::RedisResult<(u64, Vec<String>)> = redis::cmd("SCAN")
      .arg(cursor)
      .arg("MATCH")
      .arg(&pattern)
      .arg("COUNT")
      .arg(200)
      .query_async(&mut conn)
      .await;
    let (next_cursor, keys) = match scan_result {
      Ok(value) => value,
      Err(_) => break
    };
    if !keys.is_empty() {
      let _: redis::RedisResult<()> = redis::cmd("DEL").arg(keys).query_async(&mut conn).await;
    }
    if next_cursor == 0 {
      break;
    }
    cursor = next_cursor;
  }
}

#[allow(dead_code)]
async fn get_session_from_db(state: &AppState, key: &str) -> Option<String> {
  let token = key.trim_start_matches("session_");
  let row = sqlx::query(
    r#"
    SELECT user_data FROM user_sessions
    WHERE token = ? AND expires_at > CURRENT_TIMESTAMP
    "#
  )
  .bind(token)
  .fetch_optional(&state.db)
  .await
  .ok()?;
  row.and_then(|r| r.try_get::<Option<String>, _>("user_data").ok().flatten())
}

async fn set_session_to_db(
  state: &AppState,
  key: &str,
  value: &str,
  ttl_seconds: u64
) -> Result<(), String> {
  let token = key.trim_start_matches("session_");
  let user_data: Value = serde_json::from_str(value).map_err(|err| err.to_string())?;
  let user_id = user_data
    .get("id")
    .and_then(Value::as_i64)
    .unwrap_or(0);
  let expires_at = (Utc::now() + Duration::seconds(ttl_seconds as i64)).format("%F %T").to_string();

  sqlx::query(
    r#"
    INSERT INTO user_sessions (token, user_id, user_data, expires_at, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      user_data = VALUES(user_data),
      expires_at = VALUES(expires_at)
    "#
  )
  .bind(token)
  .bind(user_id)
  .bind(value)
  .bind(expires_at)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(())
}

#[allow(dead_code)]
async fn get_subscription_from_db(state: &AppState, key: &str) -> Option<String> {
  let token = key.trim_start_matches("sub_token_");
  let row = sqlx::query("SELECT id AS user_id FROM users WHERE token = ?")
    .bind(token)
    .fetch_optional(&state.db)
    .await
    .ok()?;
  let user_id = row.and_then(|r| r.try_get::<Option<i64>, _>("user_id").ok().flatten())?;
  if let Some(redis) = state.redis.clone() {
    let mut conn = redis;
    let _ = conn
      .set_ex::<_, _, ()>(redis_key(state, key), user_id.to_string(), 300u64)
      .await;
  }
  Some(user_id.to_string())
}
