use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{Duration, Utc};
use redis::AsyncCommands;
use serde_json::{json, Value};
use sqlx::Row;

use crate::etag::{generate_etag, is_etag_match, json_with_etag, not_modified};
use crate::response::error;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/node", get(get_node))
    .route("/users", get(get_users))
    .route("/audit_rules", get(get_audit_rules))
    .route("/dns_rules", get(get_dns_rules))
    .route("/white_list", get(get_white_list))
    .route("/traffic", post(post_traffic))
    .route("/alive_ip", post(post_alive_ip))
    .route("/audit_log", post(post_audit_log))
    .route("/status", post(post_status))
}

async fn get_node(State(state): State<AppState>, headers: HeaderMap) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };

  let row = sqlx::query(
    "SELECT node_bandwidth, node_bandwidth_limit, CAST(node_config AS CHAR) AS node_config FROM nodes WHERE id = ?"
  )
    .bind(auth.node_id)
    .fetch_optional(&state.db)
    .await;

  let row = match row {
    Ok(result) => match result {
      Some(r) => r,
      None => return error(StatusCode::NOT_FOUND, "节点不存在", None)
    },
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let node_bandwidth: i64 = row.try_get::<Option<i64>, _>("node_bandwidth").unwrap_or(Some(0)).unwrap_or(0);
  let node_bandwidth_limit: i64 =
    row.try_get::<Option<i64>, _>("node_bandwidth_limit").unwrap_or(Some(0)).unwrap_or(0);
  if node_bandwidth_limit > 0 && node_bandwidth > node_bandwidth_limit {
    return error(StatusCode::NOT_FOUND, "节点流量限制", None);
  }

  let config_raw: String = row
    .try_get::<Option<String>, _>("node_config")
    .unwrap_or(Some("{}".to_string()))
    .unwrap_or_else(|| "{}".to_string());
  let config_value = serde_json::from_str::<Value>(&config_raw).unwrap_or_else(|_| json!({}));
  let basic = config_value
    .get("basic")
    .cloned()
    .unwrap_or_else(|| json!({ "pull_interval": 60, "push_interval": 60, "speed_limit": 0 }));
  let config = config_value
    .get("config")
    .cloned()
    .unwrap_or_else(|| json!({}));

  let payload = json!({ "basic": basic, "config": config });
  let etag = generate_etag(&payload);
  if is_etag_match(&headers, &etag) {
    return not_modified(&etag);
  }
  json_with_etag(&payload, &etag)
}

async fn get_users(State(state): State<AppState>, headers: HeaderMap) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };

  let node_row =
    sqlx::query("SELECT CAST(node_config AS CHAR) AS node_config FROM nodes WHERE id = ?")
    .bind(auth.node_id)
    .fetch_optional(&state.db)
    .await;
  let node_row = match node_row {
    Ok(row) => row,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let config_raw = node_row
    .and_then(|row| row.try_get::<Option<String>, _>("node_config").ok().flatten())
    .unwrap_or_else(|| "{}".to_string());
  let config_value = serde_json::from_str::<Value>(&config_raw).unwrap_or_else(|_| json!({}));
  let ss_config = config_value
    .get("config")
    .cloned()
    .unwrap_or_else(|| config_value.clone());

  let users_rows = sqlx::query(
    r#"
    SELECT u.id, u.uuid, u.passwd AS password,
           u.speed_limit, u.device_limit, u.tcp_limit
    FROM users u, nodes n
    WHERE n.id = ?
      AND u.status = 1
      AND (u.expire_time IS NULL OR u.expire_time > CURRENT_TIMESTAMP)
      AND (u.class_expire_time IS NULL OR u.class_expire_time > CURRENT_TIMESTAMP)
      AND u.transfer_enable > u.transfer_total
      AND u.class >= n.node_class
    "#
  )
  .bind(auth.node_id)
  .fetch_all(&state.db)
  .await;

  let users_rows = match users_rows {
    Ok(rows) => rows,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let mut users = Vec::with_capacity(users_rows.len());
  for row in users_rows {
    let user_id: i64 = row.try_get::<i64, _>("id").unwrap_or(0);
    let speed_limit: i64 = row.try_get::<Option<i64>, _>("speed_limit").unwrap_or(Some(0)).unwrap_or(0);
    let device_limit: i64 = row.try_get::<Option<i64>, _>("device_limit").unwrap_or(Some(0)).unwrap_or(0);
    let tcp_limit: i64 = row.try_get::<Option<i64>, _>("tcp_limit").unwrap_or(Some(0)).unwrap_or(0);
    let uuid: String = row.try_get::<Option<String>, _>("uuid").unwrap_or(Some("".to_string())).unwrap_or_default();
    let password: String =
      row.try_get::<Option<String>, _>("password").unwrap_or(Some("".to_string())).unwrap_or_default();

    let mut entry = json!({
      "id": user_id,
      "speed_limit": speed_limit,
      "device_limit": device_limit,
      "tcp_limit": tcp_limit
    });

    if auth.node_type == "v2ray" || auth.node_type == "vmess" || auth.node_type == "vless" {
      entry["uuid"] = json!(uuid);
    } else if auth.node_type == "ss" || auth.node_type == "shadowsocks" {
      let resolved = build_ss_password(&ss_config, &password);
      entry["password"] = json!(resolved);
    } else {
      entry["password"] = json!(password);
    }

    users.push(entry);
  }

  Json(Value::Array(users)).into_response()
}

async fn get_audit_rules(State(state): State<AppState>, headers: HeaderMap) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };
  let _ = auth;

  let cache_key = "audit_rules";
  let cached = cache_get(&state, cache_key).await;

  let mut rules: Vec<Value> = Vec::new();
  if let Some(json_str) = cached {
    if let Ok(parsed) = serde_json::from_str::<Vec<Value>>(&json_str) {
      rules = parsed;
    }
  }

  if rules.is_empty() {
    let rows = sqlx::query("SELECT id, rule FROM audit_rules WHERE enabled = 1 ORDER BY id ASC")
      .fetch_all(&state.db)
      .await;
    match rows {
      Ok(records) => {
        rules = records
          .into_iter()
          .map(|row| {
            let id: i64 = row.try_get("id").unwrap_or(0);
            let rule: Option<String> = row.try_get("rule").ok();
            json!({ "id": id, "rule": rule })
          })
          .collect();
        let _ = cache_set(&state, cache_key, &serde_json::to_string(&rules).unwrap_or_default(), 86400).await;
      }
      Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
    }
  }

  let payload = Value::Array(rules);
  let etag = generate_etag(&payload);
  if is_etag_match(&headers, &etag) {
    return not_modified(&etag);
  }
  json_with_etag(&payload, &etag)
}

async fn get_dns_rules(State(state): State<AppState>, headers: HeaderMap) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };

  let cache_key = format!("dns_rules_{}", auth.node_id);
  let cached = cache_get(&state, &cache_key).await;
  let mut rule_value: Option<Value> = None;

  if let Some(json_str) = cached {
    if let Ok(parsed) = serde_json::from_str::<Value>(&json_str) {
      rule_value = Some(parsed);
    }
  }

  if rule_value.is_none() {
    let rows = sqlx::query(
      "SELECT id, CAST(rule_json AS CHAR) AS rule_json FROM dns_rules WHERE enabled = 1 AND JSON_CONTAINS(node_ids, JSON_ARRAY(?)) ORDER BY id ASC LIMIT 2"
    )
      .bind(auth.node_id)
      .fetch_all(&state.db)
      .await;

    match rows {
      Ok(records) => {
        if records.is_empty() {
          return error(StatusCode::NOT_FOUND, "DNS规则不存在", None);
        }
        if records.len() > 1 {
          return error(StatusCode::CONFLICT, "节点已绑定多条DNS规则", None);
        }

        let raw = records[0]
          .try_get::<Option<String>, _>("rule_json")
          .unwrap_or(None)
          .unwrap_or_else(|| "{}".to_string());
        let parsed = match serde_json::from_str::<Value>(&raw) {
          Ok(value) => value,
          Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DNS规则JSON无效", None)
        };
        rule_value = Some(parsed);
        let _ = cache_set(
          &state,
          &cache_key,
          &serde_json::to_string(rule_value.as_ref().unwrap()).unwrap_or_default(),
          86400
        )
        .await;
      }
      Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
    }
  }

  let payload = rule_value.unwrap_or_else(|| json!({}));
  let etag = generate_etag(&payload);
  if is_etag_match(&headers, &etag) {
    return not_modified(&etag);
  }
  json_with_etag(&payload, &etag)
}

async fn get_white_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };
  let _ = auth;

  let cache_key = "white_list";
  let cached = cache_get(&state, cache_key).await;
  let mut white_list: Vec<String> = Vec::new();

  if let Some(json_str) = cached {
    if let Ok(parsed) = serde_json::from_str::<Vec<String>>(&json_str) {
      white_list = parsed;
    }
  }

  if white_list.is_empty() {
    let rows = sqlx::query("SELECT rule FROM white_list WHERE status = 1 ORDER BY id ASC")
      .fetch_all(&state.db)
      .await;
    match rows {
      Ok(records) => {
        let mut flattened: Vec<String> = Vec::new();
        for row in records {
          let rule: Option<String> = row.try_get("rule").ok();
          let rule = rule.unwrap_or_default();
          if rule.contains('\n') || rule.contains('\r') {
            for part in rule.split(&['\n', '\r'][..]) {
              let trimmed = part.trim();
              if !trimmed.is_empty() {
                flattened.push(trimmed.to_string());
              }
            }
          } else if !rule.trim().is_empty() {
            flattened.push(rule);
          }
        }
        white_list = flattened;
        let _ = cache_set(
          &state,
          cache_key,
          &serde_json::to_string(&white_list).unwrap_or_default(),
          86400
        )
        .await;
      }
      Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
    }
  }

  let payload = Value::Array(white_list.into_iter().map(Value::String).collect());
  let etag = generate_etag(&payload);
  if is_etag_match(&headers, &etag) {
    return not_modified(&etag);
  }
  json_with_etag(&payload, &etag)
}

async fn post_traffic(
  State(state): State<AppState>,
  headers: HeaderMap,
  Json(body): Json<Value>
) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };
  let data = match body {
    Value::Array(items) => items,
    Value::Object(map) => {
      if let Some(value) = map.get("data") {
        match value {
          Value::Array(items) => items.clone(),
          Value::Object(_) => vec![value.clone()],
          _ => Vec::new()
        }
      } else {
        vec![Value::Object(map)]
      }
    }
    _ => Vec::new()
  };

  let multiplier_row = sqlx::query("SELECT CAST(traffic_multiplier AS DOUBLE) AS traffic_multiplier FROM nodes WHERE id = ?")
    .bind(auth.node_id)
    .fetch_optional(&state.db)
    .await;
  let raw_multiplier = match multiplier_row {
    Ok(row) => row
      .and_then(|r| r.try_get::<Option<f64>, _>("traffic_multiplier").ok().flatten())
      .unwrap_or(1.0),
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let multiplier = if raw_multiplier > 0.0 { raw_multiplier } else { 1.0 };

  let date = (Utc::now() + Duration::hours(8)).date_naive();
  let mut total_traffic: i64 = 0;

  for item in data {
    let user_id = value_to_i64(item.get("id"))
      .or_else(|| value_to_i64(item.get("user_id")))
      .or_else(|| value_to_i64(item.get("uid")))
      .unwrap_or(0);
    if user_id <= 0 {
      continue;
    }
    let upload = value_to_i64(item.get("u")).unwrap_or(0).max(0);
    let download = value_to_i64(item.get("d")).unwrap_or(0).max(0);
    let total = upload.saturating_add(download);
    let actual_upload = ((upload as f64) * multiplier).round().max(0.0) as i64;
    let actual_download = ((download as f64) * multiplier).round().max(0.0) as i64;
    let deducted_total = actual_upload.saturating_add(actual_download);

    let _ = sqlx::query(
      r#"
      UPDATE users
      SET upload_traffic = upload_traffic + ?,
          download_traffic = download_traffic + ?,
          upload_today = upload_today + ?,
          download_today = download_today + ?,
          transfer_total = transfer_total + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#
    )
    .bind(upload)
    .bind(download)
    .bind(upload)
    .bind(download)
    .bind(deducted_total)
    .bind(user_id)
    .execute(&state.db)
    .await;

    let _ = sqlx::query(
      r#"
      INSERT INTO traffic_logs
      (user_id, node_id, upload_traffic, download_traffic, actual_upload_traffic, actual_download_traffic, actual_traffic, deduction_multiplier, date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      "#
    )
    .bind(user_id)
    .bind(auth.node_id)
    .bind(upload)
    .bind(download)
    .bind(actual_upload)
    .bind(actual_download)
    .bind(deducted_total)
    .bind(multiplier)
    .bind(date)
    .execute(&state.db)
    .await;

    total_traffic = total_traffic.saturating_add(total);
  }

  let _ = sqlx::query(
    r#"
    UPDATE nodes
    SET node_bandwidth = node_bandwidth + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(total_traffic)
  .bind(auth.node_id)
  .execute(&state.db)
  .await;

  Json(json!({ "code": 0, "message": "ok" })).into_response()
}

async fn post_alive_ip(
  State(state): State<AppState>,
  headers: HeaderMap,
  Json(body): Json<Value>
) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };
  let data = body
    .as_array()
    .cloned()
    .or_else(|| body.get("data").and_then(Value::as_array).cloned())
    .unwrap_or_default();

  for item in data {
    let user_id = value_to_i64(item.get("id"))
      .or_else(|| value_to_i64(item.get("user_id")))
      .or_else(|| value_to_i64(item.get("uid")))
      .unwrap_or(0);
    if user_id <= 0 {
      continue;
    }
    let mut ips = match item.get("ips") {
      Some(Value::Array(items)) => items
        .iter()
        .filter_map(|value| value.as_str().map(|s| s.to_string()))
        .collect::<Vec<String>>(),
      Some(Value::String(value)) => vec![value.to_string()],
      _ => Vec::new()
    };
    if ips.is_empty() {
      if let Some(value) = item.get("ip") {
        match value {
          Value::String(value) => ips.push(value.to_string()),
          Value::Array(items) => ips.extend(
            items
              .iter()
              .filter_map(|item| item.as_str().map(|s| s.to_string()))
          ),
          _ => {}
        }
      } else if let Some(value) = item.get("ip_address") {
        match value {
          Value::String(value) => ips.push(value.to_string()),
          Value::Array(items) => ips.extend(
            items
              .iter()
              .filter_map(|item| item.as_str().map(|s| s.to_string()))
          ),
          _ => {}
        }
      }
    }

    for ip in ips {
      if let Err(err) = sqlx::query(
        r#"
        INSERT INTO online_ips (user_id, node_id, ip, last_seen)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)
        "#
      )
      .bind(user_id)
      .bind(auth.node_id)
      .bind(ip)
      .execute(&state.db)
      .await
      {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
      }
    }
  }

  Json(json!({ "code": 0, "message": "ok" })).into_response()
}

async fn post_audit_log(
  State(state): State<AppState>,
  headers: HeaderMap,
  Json(body): Json<Value>
) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };
  let data = body.as_array().cloned().unwrap_or_default();

  for item in data {
    let user_id = value_to_i64(item.get("user_id")).unwrap_or(0);
    let audit_id = value_to_i64(item.get("audit_id")).unwrap_or(0);
    if user_id <= 0 || audit_id <= 0 {
      continue;
    }
    let ip_address = item.get("ip_address").and_then(Value::as_str);

    let _ = sqlx::query(
      r#"
      INSERT INTO audit_logs (user_id, node_id, audit_rule_id, ip_address, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      "#
    )
    .bind(user_id)
    .bind(auth.node_id)
    .bind(audit_id)
    .bind(ip_address)
    .execute(&state.db)
    .await;
  }

  Json(json!({ "code": 0, "message": "ok" })).into_response()
}

async fn post_status(
  State(state): State<AppState>,
  headers: HeaderMap,
  Json(body): Json<Value>
) -> Response {
  let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
    Ok(auth) => auth,
    Err(resp) => return resp
  };
  let obj = body.as_object().cloned().unwrap_or_default();

  let cpu = value_to_f64(obj.get("cpu")).unwrap_or(0.0);
  let uptime = value_to_i64(obj.get("uptime")).unwrap_or(0);
  let mem = obj.get("mem").and_then(Value::as_object);
  let swap = obj.get("swap").and_then(Value::as_object);
  let disk = obj.get("disk").and_then(Value::as_object);

  let mem_total = value_to_i64(mem.and_then(|m| m.get("total"))).unwrap_or(0);
  let mem_used = value_to_i64(mem.and_then(|m| m.get("used"))).unwrap_or(0);
  let swap_total = value_to_i64(swap.and_then(|m| m.get("total"))).unwrap_or(0);
  let swap_used = value_to_i64(swap.and_then(|m| m.get("used"))).unwrap_or(0);
  let disk_total = value_to_i64(disk.and_then(|m| m.get("total"))).unwrap_or(0);
  let disk_used = value_to_i64(disk.and_then(|m| m.get("used"))).unwrap_or(0);

  let _ = sqlx::query(
    r#"
    INSERT INTO node_status
    (node_id, cpu_usage, memory_total, memory_used, swap_total, swap_used, disk_total, disk_used, uptime, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(auth.node_id)
  .bind(cpu)
  .bind(mem_total)
  .bind(mem_used)
  .bind(swap_total)
  .bind(swap_used)
  .bind(disk_total)
  .bind(disk_used)
  .bind(uptime)
  .execute(&state.db)
  .await;

  Json(json!({ "code": 0, "message": "ok" })).into_response()
}

fn validate_soga_auth(
  headers: &HeaderMap,
  expected_key: Option<&str>
) -> Result<NodeAuth, Response> {
  let api_key = headers
    .get("api-key")
    .or_else(|| headers.get("x-api-key"))
    .or_else(|| headers.get("api_key"))
    .and_then(|value| value.to_str().ok());
  let node_id = headers
    .get("node-id")
    .or_else(|| headers.get("x-node-id"))
    .or_else(|| headers.get("node_id"))
    .or_else(|| headers.get("nodeid"))
    .and_then(|value| value.to_str().ok());
  let node_type = headers
    .get("node-type")
    .or_else(|| headers.get("x-node-type"))
    .or_else(|| headers.get("node_type"))
    .or_else(|| headers.get("nodetype"))
    .and_then(|value| value.to_str().ok());

  if api_key.is_none() || node_id.is_none() || node_type.is_none() {
    return Err(error(StatusCode::UNAUTHORIZED, "缺少认证信息", None));
  }

  if let Some(expected) = expected_key {
    if api_key.unwrap_or_default() != expected {
      return Err(error(StatusCode::UNAUTHORIZED, "认证失败", None));
    }
  }

  let node_id = node_id.unwrap_or_default().parse::<i64>().unwrap_or(0);
  let node_type = node_type.unwrap_or_default().to_lowercase();
  if node_id <= 0 {
    return Err(error(StatusCode::UNAUTHORIZED, "节点信息无效", None));
  }

  Ok(NodeAuth { node_id, node_type })
}

fn decode_base64_safe(value: &str) -> Option<Vec<u8>> {
  let cleaned = value.trim();
  if cleaned.is_empty() {
    return None;
  }
  STANDARD.decode(cleaned.as_bytes()).ok()
}

fn derive_ss2022_user_key(cipher: &str, user_password: &str) -> String {
  let needs = if cipher.to_lowercase().contains("aes-128") { 16 } else { 32 };
  let mut bytes = decode_base64_safe(user_password).unwrap_or_default();
  if bytes.is_empty() {
    bytes = user_password.as_bytes().to_vec();
  }
  if bytes.is_empty() {
    bytes = vec![0];
  }

  let mut out = vec![0u8; needs];
  for i in 0..needs {
    out[i] = bytes[i % bytes.len()];
  }
  STANDARD.encode(out)
}

fn build_ss_password(node_config: &Value, user_password: &str) -> String {
  let cipher = node_config
    .get("cipher")
    .or_else(|| node_config.get("method"))
    .and_then(Value::as_str)
    .unwrap_or("")
    .to_lowercase();
  let node_password = node_config
    .get("password")
    .and_then(Value::as_str)
    .unwrap_or("");

  if cipher.contains("2022-blake3") {
    let selected = if user_password.is_empty() { node_password } else { user_password };
    return derive_ss2022_user_key(&cipher, selected);
  }

  if !user_password.is_empty() {
    user_password.to_string()
  } else {
    node_password.to_string()
  }
}

#[derive(Clone)]
struct NodeAuth {
  node_id: i64,
  node_type: String
}

fn value_to_i64(value: Option<&Value>) -> Option<i64> {
  let value = value?;
  if let Some(num) = value.as_i64() {
    return Some(num);
  }
  if let Some(num) = value.as_f64() {
    return Some(num as i64);
  }
  if let Some(text) = value.as_str() {
    return text.trim().parse::<i64>().ok();
  }
  None
}

fn value_to_f64(value: Option<&Value>) -> Option<f64> {
  let value = value?;
  if let Some(num) = value.as_f64() {
    return Some(num);
  }
  if let Some(num) = value.as_i64() {
    return Some(num as f64);
  }
  if let Some(text) = value.as_str() {
    return text.trim().parse::<f64>().ok();
  }
  None
}

async fn cache_get(state: &AppState, key: &str) -> Option<String> {
  let redis = state.redis.clone()?;
  let mut conn = redis;
  let result: redis::RedisResult<Option<String>> = conn.get(key).await;
  result.ok().flatten()
}

async fn cache_set(state: &AppState, key: &str, value: &str, ttl: u64) -> Result<(), String> {
  let redis = match state.redis.clone() {
    Some(conn) => conn,
    None => return Ok(())
  };
  let mut conn = redis;
  conn
    .set_ex::<_, _, ()>(key, value, ttl)
    .await
    .map_err(|err| err.to_string())
}
