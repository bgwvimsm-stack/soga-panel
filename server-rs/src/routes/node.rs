use axum::body::to_bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::StatusCode;
use axum::http::{HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashSet;

use crate::cache::{cache_get, cache_set};
use crate::etag::{generate_etag, is_etag_match, json_with_etag, not_modified};
use crate::response::error;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ws", get(websocket))
        .route("/node", get(get_node))
        .route("/users", get(get_users))
        .route("/audit_rules", get(get_audit_rules))
        .route("/xray_rules", get(get_xray_rules))
        .route("/white_list", get(get_white_list))
        .route("/report", post(post_report))
        .route("/traffic", post(post_traffic))
        .route("/alive_ip", post(post_alive_ip))
        .route("/audit_log", post(post_audit_log))
        .route("/status", post(post_status))
}

const MAX_WS_MESSAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, serde::Deserialize)]
struct WsRequest {
    v: Option<u8>,
    id: Option<Value>,
    op: Option<String>,
    payload: Option<Value>,
    event_id: Option<String>,
}

async fn claim_report_event(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    operation: &str,
) -> Result<Option<String>, Response> {
    let Some(event_id) = headers
        .get("x-event-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if event_id.len() > 128 {
        return Err(error(StatusCode::BAD_REQUEST, "上报事件 ID 无效", None));
    }

    let _ = sqlx::query(
        "DELETE FROM node_report_events WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)",
    )
    .execute(&state.db)
    .await;

    let result = sqlx::query(
        "INSERT IGNORE INTO node_report_events (event_id, node_id, operation, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(event_id)
    .bind(node_id)
    .bind(operation)
    .execute(&state.db)
    .await
    .map_err(|err| error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None))?;

    if result.rows_affected() == 0 {
        Ok(Some(String::new()))
    } else {
        Ok(Some(event_id.to_string()))
    }
}

async fn release_report_event(
    state: &AppState,
    event_id: Option<&str>,
    node_id: i64,
    operation: &str,
) {
    let Some(event_id) = event_id.filter(|value| !value.is_empty()) else {
        return;
    };
    let _ = sqlx::query(
        "DELETE FROM node_report_events WHERE event_id = ? AND node_id = ? AND operation = ?",
    )
    .bind(event_id)
    .bind(node_id)
    .bind(operation)
    .execute(&state.db)
    .await;
}

async fn websocket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        return response;
    }
    ws.on_upgrade(move |socket| handle_websocket(socket, state, headers))
        .into_response()
}

async fn response_json(response: Response) -> Result<(StatusCode, Value), Response> {
    let status = response.status();
    let body = to_bytes(response.into_body(), MAX_WS_MESSAGE_BYTES)
        .await
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "面板响应过大", None))?;
    let data = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&body).into_owned()))
    };
    Ok((status, data))
}

async fn get_sync(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let node = get_node(State(state.clone()), headers.clone()).await;
    if !node.status().is_success() {
        return node;
    }
    let users = get_users(State(state.clone()), headers.clone()).await;
    if !users.status().is_success() {
        return users;
    }
    let audit_rules = get_audit_rules(State(state.clone()), headers.clone()).await;
    if !audit_rules.status().is_success() {
        return audit_rules;
    }
    let white_list = get_white_list(State(state.clone()), headers).await;
    if !white_list.status().is_success() {
        return white_list;
    }

    let node = match response_json(node).await {
        Ok((_, value)) => value,
        Err(response) => return response,
    };
    let users = match response_json(users).await {
        Ok((_, value)) => value,
        Err(response) => return response,
    };
    let audit_rules = match response_json(audit_rules).await {
        Ok((_, value)) => value,
        Err(response) => return response,
    };
    let white_list = match response_json(white_list).await {
        Ok((_, value)) => value,
        Err(response) => return response,
    };
    Json(json!({
        "code": 0,
        "message": "ok",
        "data": { "node": node, "users": users, "audit_rules": audit_rules, "white_list": white_list }
    }))
    .into_response()
}

async fn post_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let Some(values) = body.as_object() else {
        return error(StatusCode::BAD_REQUEST, "上报数据无效", None);
    };
    let operations = [
        ("status", "submit_status"),
        ("traffic", "submit_traffic"),
        ("alive_ip", "submit_alive_ip"),
        ("audit_log", "submit_audit_log"),
    ];
    let mut completed = Vec::new();
    for (field, operation) in operations {
        let Some(value) = values.get(field) else {
            continue;
        };
        let response = match operation {
            "submit_status" => {
                post_status(State(state.clone()), headers.clone(), Json(value.clone())).await
            }
            "submit_traffic" => {
                post_traffic(State(state.clone()), headers.clone(), Json(value.clone())).await
            }
            "submit_alive_ip" => {
                post_alive_ip(State(state.clone()), headers.clone(), Json(value.clone())).await
            }
            "submit_audit_log" => {
                post_audit_log(State(state.clone()), headers.clone(), Json(value.clone())).await
            }
            _ => unreachable!(),
        };
        if !response.status().is_success() {
            return response;
        }
        completed.push(operation);
    }
    Json(json!({ "code": 0, "message": "ok", "data": { "operations": completed } })).into_response()
}

async fn handle_websocket(mut socket: WebSocket, state: AppState, headers: HeaderMap) {
    while let Some(result) = socket.recv().await {
        let message = match result {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!("node WebSocket receive failed: {error}");
                return;
            }
        };

        match message {
            Message::Text(text) => {
                if text.len() > MAX_WS_MESSAGE_BYTES {
                    let _ = socket
                        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1009,
                            reason: "Message too large".into(),
                        })))
                        .await;
                    return;
                }
                let response =
                    dispatch_websocket_message(&mut socket, &state, &headers, text.as_ref()).await;
                if response.is_err() {
                    return;
                }
            }
            Message::Ping(payload) => {
                if socket.send(Message::Pong(payload)).await.is_err() {
                    return;
                }
            }
            Message::Pong(_) => {}
            Message::Binary(_) => {
                if send_ws_error(
                    &mut socket,
                    Value::Null,
                    400,
                    "WebSocket requires text messages",
                )
                .await
                .is_err()
                {
                    return;
                }
            }
            Message::Close(_) => return,
        }
    }
}

async fn dispatch_websocket_message(
    socket: &mut WebSocket,
    state: &AppState,
    headers: &HeaderMap,
    text: &str,
) -> Result<(), ()> {
    let message: WsRequest = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => return send_ws_error(socket, Value::Null, 400, "Invalid JSON").await,
    };
    let id = message.id.unwrap_or(Value::Null);
    if message.v != Some(1) || message.op.is_none() {
        return send_ws_error(socket, id, 400, "Unsupported protocol message").await;
    }

    let op = message.op.as_deref().unwrap_or_default();
    let mut operation_headers = headers.clone();
    if let Some(event_id) = message.event_id.as_deref() {
        let value = HeaderValue::from_str(event_id).map_err(|_| ())?;
        operation_headers.insert("x-event-id", value);
    }
    let payload = Json(message.payload.unwrap_or(Value::Null));
    let response = match op {
        "sync" => get_sync(State(state.clone()), operation_headers.clone()).await,
        "get_node" => get_node(State(state.clone()), operation_headers.clone()).await,
        "get_users" => get_users(State(state.clone()), operation_headers.clone()).await,
        "get_audit_rules" => get_audit_rules(State(state.clone()), operation_headers.clone()).await,
        "get_xray_rules" => get_xray_rules(State(state.clone()), operation_headers.clone()).await,
        "get_white_list" => get_white_list(State(state.clone()), operation_headers.clone()).await,
        "submit_traffic" => {
            post_traffic(State(state.clone()), operation_headers.clone(), payload).await
        }
        "submit_alive_ip" => {
            post_alive_ip(State(state.clone()), operation_headers.clone(), payload).await
        }
        "submit_audit_log" => {
            post_audit_log(State(state.clone()), operation_headers.clone(), payload).await
        }
        "submit_status" => post_status(State(state.clone()), operation_headers, payload).await,
        "report" => post_report(State(state.clone()), operation_headers, payload).await,
        _ => return send_ws_error(socket, id, 404, "Unknown operation").await,
    };

    let status = response.status();
    let body = match to_bytes(response.into_body(), MAX_WS_MESSAGE_BYTES).await {
        Ok(body) => body,
        Err(_) => return send_ws_error(socket, id, 502, "Response too large").await,
    };
    let data = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&body).into_owned()))
    };
    let ok = status.is_success();
    tracing::info!(
        operation = op,
        status = status.as_u16(),
        ok,
        "node WebSocket operation completed"
    );
    let message = if ok {
        Value::Null
    } else {
        json!(extract_ws_message(&data))
    };
    send_ws_json(
        socket,
        json!({
            "v": 1,
            "id": id,
            "ok": ok,
            "status": status.as_u16(),
            "data": data,
            "message": message,
        }),
    )
    .await
}

async fn send_ws_error(
    socket: &mut WebSocket,
    id: Value,
    status: u16,
    message: &str,
) -> Result<(), ()> {
    send_ws_json(
        socket,
        json!({
            "v": 1,
            "id": id,
            "ok": false,
            "status": status,
            "data": Value::Null,
            "message": message,
        }),
    )
    .await
}

async fn send_ws_json(socket: &mut WebSocket, value: Value) -> Result<(), ()> {
    let text = serde_json::to_string(&value).map_err(|_| ())?;
    if text.len() > MAX_WS_MESSAGE_BYTES {
        return Err(());
    }
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| ())
}

fn extract_ws_message(data: &Value) -> String {
    data.get("message")
        .and_then(Value::as_str)
        .unwrap_or("Soga API request failed")
        .to_string()
}

async fn get_node(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
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
            None => return error(StatusCode::NOT_FOUND, "节点不存在", None),
        },
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let node_bandwidth: i64 = row
        .try_get::<Option<i64>, _>("node_bandwidth")
        .unwrap_or(Some(0))
        .unwrap_or(0);
    let node_bandwidth_limit: i64 = row
        .try_get::<Option<i64>, _>("node_bandwidth_limit")
        .unwrap_or(Some(0))
        .unwrap_or(0);
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
    let mut config = config_value
        .get("config")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if is_ssr_node_type(&auth.node_type) {
        config = normalize_ssr_node_config(&config_value, config);
    }

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
        Err(resp) => return resp,
    };

    let node_row =
        sqlx::query("SELECT CAST(node_config AS CHAR) AS node_config FROM nodes WHERE id = ?")
            .bind(auth.node_id)
            .fetch_optional(&state.db)
            .await;
    let node_row = match node_row {
        Ok(row) => row,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };
    let config_raw = node_row
        .and_then(|row| {
            row.try_get::<Option<String>, _>("node_config")
                .ok()
                .flatten()
        })
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
    "#,
    )
    .bind(auth.node_id)
    .fetch_all(&state.db)
    .await;

    let users_rows = match users_rows {
        Ok(rows) => rows,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let mut users = Vec::with_capacity(users_rows.len());
    for row in users_rows {
        let user_id: i64 = row.try_get::<i64, _>("id").unwrap_or(0);
        let speed_limit: i64 = row
            .try_get::<Option<i64>, _>("speed_limit")
            .unwrap_or(Some(0))
            .unwrap_or(0);
        let device_limit: i64 = row
            .try_get::<Option<i64>, _>("device_limit")
            .unwrap_or(Some(0))
            .unwrap_or(0);
        let tcp_limit: i64 = row
            .try_get::<Option<i64>, _>("tcp_limit")
            .unwrap_or(Some(0))
            .unwrap_or(0);
        let uuid: String = row
            .try_get::<Option<String>, _>("uuid")
            .unwrap_or(Some("".to_string()))
            .unwrap_or_default();
        let password: String = row
            .try_get::<Option<String>, _>("password")
            .unwrap_or(Some("".to_string()))
            .unwrap_or_default();

        let mut entry = json!({
          "id": user_id,
          "speed_limit": speed_limit,
          "device_limit": device_limit,
          "tcp_limit": tcp_limit
        });

        if auth.node_type == "v2ray" || auth.node_type == "vmess" || auth.node_type == "vless" {
            entry["uuid"] = json!(uuid);
        } else if is_shadowsocks_node_type(&auth.node_type) {
            let resolved = build_ss_password(&ss_config, &password);
            entry["password"] = json!(resolved);
        } else if is_ssr_node_type(&auth.node_type) {
            entry["password"] = json!(password);
        } else {
            entry["password"] = json!(resolve_uuid_password(&uuid, &password));
        }

        users.push(entry);
    }

    Json(Value::Array(users)).into_response()
}

async fn get_audit_rules(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
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
        let rows =
            sqlx::query("SELECT id, rule FROM audit_rules WHERE enabled = 1 ORDER BY id ASC")
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
                let _ = cache_set(
                    &state,
                    cache_key,
                    &serde_json::to_string(&rules).unwrap_or_default(),
                    86400,
                )
                .await;
            }
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
        }
    }

    let payload = Value::Array(rules);
    let etag = generate_etag(&payload);
    if is_etag_match(&headers, &etag) {
        return not_modified(&etag);
    }
    json_with_etag(&payload, &etag)
}

fn parse_id_list(raw: &str) -> Vec<i64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let parsed = serde_json::from_str::<Value>(trimmed);
    let Ok(value) = parsed else {
        return trimmed
            .split(',')
            .filter_map(|item| item.trim().parse::<i64>().ok())
            .filter(|id| *id > 0)
            .collect();
    };

    match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| match item {
                Value::Number(num) => num.as_i64(),
                Value::String(text) => text.trim().parse::<i64>().ok(),
                _ => None,
            })
            .filter(|id| *id > 0)
            .collect(),
        _ => Vec::new(),
    }
}

async fn build_xray_rules_payload(state: &AppState, node_id: i64) -> Result<Value, Response> {
    let node_row =
        sqlx::query("SELECT CAST(xray_rule_ids AS CHAR) AS xray_rule_ids FROM nodes WHERE id = ?")
            .bind(node_id)
            .fetch_optional(&state.db)
            .await;

    let node_row = match node_row {
        Ok(Some(value)) => value,
        Ok(None) => return Err(error(StatusCode::NOT_FOUND, "节点不存在", None)),
        Err(err) => {
            return Err(error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &err.to_string(),
                None,
            ))
        }
    };

    let raw_ids = node_row
        .try_get::<Option<String>, _>("xray_rule_ids")
        .ok()
        .flatten()
        .unwrap_or_else(|| "[]".to_string());
    let rule_ids = parse_id_list(&raw_ids);
    if rule_ids.is_empty() {
        return Err(error(StatusCode::NOT_FOUND, "Xray规则不存在", None));
    }

    let placeholders = rule_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<&str>>()
        .join(",");
    let sql = format!(
        "SELECT id, rule_type, CAST(rule_json AS CHAR) AS rule_json FROM xray_rules WHERE enabled = 1 AND id IN ({placeholders}) ORDER BY id ASC"
    );
    let mut query = sqlx::query(&sql);
    for id in &rule_ids {
        query = query.bind(id);
    }
    let rows = match query.fetch_all(&state.db).await {
        Ok(records) => records,
        Err(err) => {
            return Err(error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &err.to_string(),
                None,
            ))
        }
    };
    if rows.is_empty() {
        return Err(error(StatusCode::NOT_FOUND, "Xray规则不存在", None));
    }

    let mut payload = json!({
      "dns": {},
      "routing": {},
      "outbounds": []
    });
    let mut type_set: HashSet<String> = HashSet::new();

    for row in rows {
        let rule_type = row
            .try_get::<Option<String>, _>("rule_type")
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_lowercase();
        if rule_type != "dns" && rule_type != "routing" && rule_type != "outbounds" {
            continue;
        }
        if type_set.contains(&rule_type) {
            return Err(error(
                StatusCode::CONFLICT,
                &format!("节点已绑定多条{rule_type}规则"),
                None,
            ));
        }
        type_set.insert(rule_type.clone());

        let raw = row
            .try_get::<Option<String>, _>("rule_json")
            .ok()
            .flatten()
            .unwrap_or_default();
        let parsed = match serde_json::from_str::<Value>(&raw) {
            Ok(value) => value,
            Err(_) => {
                return Err(error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Xray规则JSON无效",
                    None,
                ))
            }
        };

        if rule_type == "outbounds" {
            if parsed.is_array() {
                payload["outbounds"] = parsed;
            } else {
                payload["outbounds"] = Value::Array(vec![parsed]);
            }
        } else if rule_type == "dns" {
            payload["dns"] = parsed;
        } else if rule_type == "routing" {
            payload["routing"] = parsed;
        }
    }

    if type_set.is_empty() {
        return Err(error(StatusCode::NOT_FOUND, "Xray规则不存在", None));
    }

    Ok(payload)
}

async fn load_xray_rules_payload(state: &AppState, node_id: i64) -> Result<Value, Response> {
    let cache_key = format!("xray_rules_{node_id}");
    let cached = cache_get(state, &cache_key).await;
    if let Some(json_str) = cached {
        if let Ok(parsed) = serde_json::from_str::<Value>(&json_str) {
            return Ok(parsed);
        }
    }

    let payload = build_xray_rules_payload(state, node_id).await?;
    let _ = cache_set(
        state,
        &cache_key,
        &serde_json::to_string(&payload).unwrap_or_default(),
        86400,
    )
    .await;
    Ok(payload)
}

async fn get_xray_rules(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
    };

    let payload = match load_xray_rules_payload(&state, auth.node_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let etag = generate_etag(&payload);
    if is_etag_match(&headers, &etag) {
        return not_modified(&etag);
    }
    json_with_etag(&payload, &etag)
}

async fn get_white_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
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
                    86400,
                )
                .await;
            }
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
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
    Json(body): Json<Value>,
) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
    };
    let report_event_id =
        match claim_report_event(&state, &headers, auth.node_id, "submit_traffic").await {
            Ok(Some(event_id)) if event_id.is_empty() => {
                return Json(json!({ "code": 0, "message": "Already processed" })).into_response();
            }
            Ok(event_id) => event_id,
            Err(resp) => return resp,
        };
    let data = match body {
        Value::Array(items) => items,
        Value::Object(map) => {
            if let Some(value) = map.get("data") {
                match value {
                    Value::Array(items) => items.clone(),
                    Value::Object(_) => vec![value.clone()],
                    _ => Vec::new(),
                }
            } else {
                vec![Value::Object(map)]
            }
        }
        _ => Vec::new(),
    };

    let multiplier_row = sqlx::query(
        "SELECT CAST(traffic_multiplier AS DOUBLE) AS traffic_multiplier FROM nodes WHERE id = ?",
    )
    .bind(auth.node_id)
    .fetch_optional(&state.db)
    .await;
    let raw_multiplier = match multiplier_row {
        Ok(row) => row
            .and_then(|r| {
                r.try_get::<Option<f64>, _>("traffic_multiplier")
                    .ok()
                    .flatten()
            })
            .unwrap_or(1.0),
        Err(err) => {
            release_report_event(
                &state,
                report_event_id.as_deref(),
                auth.node_id,
                "submit_traffic",
            )
            .await;
            return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
        }
    };
    let multiplier = if raw_multiplier > 0.0 {
        raw_multiplier
    } else {
        1.0
    };

    let date = (Utc::now() + Duration::hours(8)).date_naive();
    let mut total_traffic: i64 = 0;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(err) => {
            release_report_event(
                &state,
                report_event_id.as_deref(),
                auth.node_id,
                "submit_traffic",
            )
            .await;
            return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
        }
    };

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

        if let Err(err) = sqlx::query(
            r#"
      UPDATE users
      SET upload_traffic = upload_traffic + ?,
          download_traffic = download_traffic + ?,
          upload_today = upload_today + ?,
          download_today = download_today + ?,
          transfer_total = transfer_total + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#,
        )
        .bind(upload)
        .bind(download)
        .bind(upload)
        .bind(download)
        .bind(deducted_total)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        {
            release_report_event(
                &state,
                report_event_id.as_deref(),
                auth.node_id,
                "submit_traffic",
            )
            .await;
            return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
        }

        if let Err(err) = sqlx::query(
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
    .execute(&mut *tx)
    .await
    {
        release_report_event(&state, report_event_id.as_deref(), auth.node_id, "submit_traffic").await;
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

        total_traffic = total_traffic.saturating_add(total);
    }

    if let Err(err) = sqlx::query(
        r#"
    UPDATE nodes
    SET node_bandwidth = node_bandwidth + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#,
    )
    .bind(total_traffic)
    .bind(auth.node_id)
    .execute(&mut *tx)
    .await
    {
        release_report_event(
            &state,
            report_event_id.as_deref(),
            auth.node_id,
            "submit_traffic",
        )
        .await;
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    if let Err(err) = tx.commit().await {
        release_report_event(
            &state,
            report_event_id.as_deref(),
            auth.node_id,
            "submit_traffic",
        )
        .await;
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    Json(json!({ "code": 0, "message": "ok" })).into_response()
}

async fn post_alive_ip(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
    };
    let report_event_id =
        match claim_report_event(&state, &headers, auth.node_id, "submit_alive_ip").await {
            Ok(Some(event_id)) if event_id.is_empty() => {
                return Json(json!({ "code": 0, "message": "Already processed" })).into_response();
            }
            Ok(event_id) => event_id,
            Err(resp) => return resp,
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
            _ => Vec::new(),
        };
        if ips.is_empty() {
            if let Some(value) = item.get("ip") {
                match value {
                    Value::String(value) => ips.push(value.to_string()),
                    Value::Array(items) => ips.extend(
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string())),
                    ),
                    _ => {}
                }
            } else if let Some(value) = item.get("ip_address") {
                match value {
                    Value::String(value) => ips.push(value.to_string()),
                    Value::Array(items) => ips.extend(
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string())),
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
        "#,
            )
            .bind(user_id)
            .bind(auth.node_id)
            .bind(ip)
            .execute(&state.db)
            .await
            {
                release_report_event(
                    &state,
                    report_event_id.as_deref(),
                    auth.node_id,
                    "submit_alive_ip",
                )
                .await;
                return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
            }
        }
    }

    Json(json!({ "code": 0, "message": "ok" })).into_response()
}

async fn post_audit_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
    };
    let report_event_id =
        match claim_report_event(&state, &headers, auth.node_id, "submit_audit_log").await {
            Ok(Some(event_id)) if event_id.is_empty() => {
                return Json(json!({ "code": 0, "message": "Already processed" })).into_response();
            }
            Ok(event_id) => event_id,
            Err(resp) => return resp,
        };
    let data = body.as_array().cloned().unwrap_or_default();
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(err) => {
            release_report_event(
                &state,
                report_event_id.as_deref(),
                auth.node_id,
                "submit_audit_log",
            )
            .await;
            return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
        }
    };

    for item in data {
        let user_id = value_to_i64(item.get("user_id")).unwrap_or(0);
        let audit_id = value_to_i64(item.get("audit_id")).unwrap_or(0);
        if user_id <= 0 || audit_id <= 0 {
            continue;
        }
        let ip_address = item.get("ip_address").and_then(Value::as_str);

        if let Err(err) = sqlx::query(
            r#"
      INSERT INTO audit_logs (user_id, node_id, audit_rule_id, ip_address, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      "#,
        )
        .bind(user_id)
        .bind(auth.node_id)
        .bind(audit_id)
        .bind(ip_address)
        .execute(&mut *tx)
        .await
        {
            release_report_event(
                &state,
                report_event_id.as_deref(),
                auth.node_id,
                "submit_audit_log",
            )
            .await;
            return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
        }
    }

    if let Err(err) = tx.commit().await {
        release_report_event(
            &state,
            report_event_id.as_deref(),
            auth.node_id,
            "submit_audit_log",
        )
        .await;
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    Json(json!({ "code": 0, "message": "ok" })).into_response()
}

async fn post_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let auth = match validate_soga_auth(&headers, state.env.node_api_key.as_deref()) {
        Ok(auth) => auth,
        Err(resp) => return resp,
    };
    let report_event_id =
        match claim_report_event(&state, &headers, auth.node_id, "submit_status").await {
            Ok(Some(event_id)) if event_id.is_empty() => {
                return Json(json!({ "code": 0, "message": "Already processed" })).into_response();
            }
            Ok(event_id) => event_id,
            Err(resp) => return resp,
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

    if let Err(err) = sqlx::query(
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
  .await
    {
        release_report_event(&state, report_event_id.as_deref(), auth.node_id, "submit_status").await;
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    Json(json!({ "code": 0, "message": "ok" })).into_response()
}

fn validate_soga_auth(
    headers: &HeaderMap,
    expected_key: Option<&str>,
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
    let needs = if cipher.to_lowercase().contains("aes-128") {
        16
    } else {
        32
    };
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
        let selected = if user_password.is_empty() {
            node_password
        } else {
            user_password
        };
        return derive_ss2022_user_key(&cipher, selected);
    }

    if !user_password.is_empty() {
        user_password.to_string()
    } else {
        node_password.to_string()
    }
}

fn resolve_uuid_password(uuid: &str, fallback_password: &str) -> String {
    let trimmed = uuid.trim();
    if !trimmed.is_empty() {
        trimmed.to_string()
    } else {
        fallback_password.to_string()
    }
}

fn is_shadowsocks_node_type(node_type: &str) -> bool {
    matches!(node_type, "ss" | "shadowsocks")
}

fn is_ssr_node_type(node_type: &str) -> bool {
    matches!(node_type, "ssr" | "shadowsocksr")
}

fn value_as_trimmed_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn normalize_ssr_node_config(root: &Value, config: Value) -> Value {
    let mut map = match config {
        Value::Object(value) => value,
        _ => serde_json::Map::new(),
    };
    let client = root.get("client");

    let mut password = value_as_trimmed_string(map.get("password"));
    if password.is_empty() {
        password = value_as_trimmed_string(map.get("passwd"));
    }
    if password.is_empty() {
        password = value_as_trimmed_string(root.get("password"));
    }
    if password.is_empty() {
        password = value_as_trimmed_string(root.get("passwd"));
    }
    if password.is_empty() {
        password = value_as_trimmed_string(client.and_then(|value| value.get("password")));
    }
    if password.is_empty() {
        password = value_as_trimmed_string(client.and_then(|value| value.get("passwd")));
    }

    if !password.is_empty() || !map.contains_key("password") {
        map.insert("password".to_string(), Value::String(password));
    }

    Value::Object(map)
}

#[derive(Clone)]
struct NodeAuth {
    node_id: i64,
    node_type: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_messages_decode_with_event_id() {
        let request: WsRequest = serde_json::from_value(json!({
            "v": 1,
            "id": 7,
            "op": "report",
            "event_id": "evt-7",
            "payload": {"traffic": [{"id": 1, "u": 2, "d": 3}]}
        }))
        .expect("decode aggregate report");

        assert_eq!(request.v, Some(1));
        assert_eq!(request.op.as_deref(), Some("report"));
        assert_eq!(request.event_id.as_deref(), Some("evt-7"));
    }

    #[test]
    fn websocket_error_message_falls_back_to_protocol_default() {
        assert_eq!(extract_ws_message(&json!({})), "Soga API request failed");
        assert_eq!(
            extract_ws_message(&json!({"message": "bad request"})),
            "bad request"
        );
    }
}
