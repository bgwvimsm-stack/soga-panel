use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use chrono::Local;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use urlencoding::encode;

use super::auth::list_system_configs;
use crate::response::error;
use crate::state::AppState;
use crate::subscription::{
  generate_clash_config,
  generate_quantumultx_config,
  generate_shadowrocket_config,
  generate_singbox_config,
  generate_surge_config,
  generate_v2ray_config,
  subscription_expire_timestamp,
  SubscriptionNode,
  SubscriptionUser
};

#[derive(Clone, Copy)]
enum SubscriptionKind {
  V2ray,
  Clash,
  QuantumultX,
  Singbox,
  Shadowrocket,
  Surge
}

impl SubscriptionKind {
  fn as_str(&self) -> &'static str {
    match self {
      SubscriptionKind::V2ray => "v2ray",
      SubscriptionKind::Clash => "clash",
      SubscriptionKind::QuantumultX => "quantumultx",
      SubscriptionKind::Singbox => "singbox",
      SubscriptionKind::Shadowrocket => "shadowrocket",
      SubscriptionKind::Surge => "surge"
    }
  }

  fn content_type(&self) -> &'static str {
    match self {
      SubscriptionKind::V2ray => "text/plain",
      SubscriptionKind::Clash => "text/yaml",
      SubscriptionKind::QuantumultX => "text/plain",
      SubscriptionKind::Singbox => "application/json",
      SubscriptionKind::Shadowrocket => "text/plain",
      SubscriptionKind::Surge => "text/plain"
    }
  }

  fn extension(&self) -> &'static str {
    match self {
      SubscriptionKind::V2ray => "txt",
      SubscriptionKind::Clash => "yaml",
      SubscriptionKind::QuantumultX => "txt",
      SubscriptionKind::Singbox => "json",
      SubscriptionKind::Shadowrocket => "txt",
      SubscriptionKind::Surge => "conf"
    }
  }
}

#[derive(Deserialize)]
struct SubscriptionQuery {
  token: Option<String>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/v2ray", get(get_v2ray))
    .route("/clash", get(get_clash))
    .route("/quantumultx", get(get_quantumultx))
    .route("/singbox", get(get_singbox))
    .route("/shadowrocket", get(get_shadowrocket))
    .route("/surge", get(get_surge))
}

async fn get_v2ray(
  State(state): State<AppState>,
  headers: HeaderMap,
  Query(query): Query<SubscriptionQuery>
) -> Response {
  handle_subscription(state, headers, query, SubscriptionKind::V2ray).await
}

async fn get_clash(
  State(state): State<AppState>,
  headers: HeaderMap,
  Query(query): Query<SubscriptionQuery>
) -> Response {
  handle_subscription(state, headers, query, SubscriptionKind::Clash).await
}

async fn get_quantumultx(
  State(state): State<AppState>,
  headers: HeaderMap,
  Query(query): Query<SubscriptionQuery>
) -> Response {
  handle_subscription(state, headers, query, SubscriptionKind::QuantumultX).await
}

async fn get_singbox(
  State(state): State<AppState>,
  headers: HeaderMap,
  Query(query): Query<SubscriptionQuery>
) -> Response {
  handle_subscription(state, headers, query, SubscriptionKind::Singbox).await
}

async fn get_shadowrocket(
  State(state): State<AppState>,
  headers: HeaderMap,
  Query(query): Query<SubscriptionQuery>
) -> Response {
  handle_subscription(state, headers, query, SubscriptionKind::Shadowrocket).await
}

async fn get_surge(
  State(state): State<AppState>,
  headers: HeaderMap,
  Query(query): Query<SubscriptionQuery>
) -> Response {
  handle_subscription(state, headers, query, SubscriptionKind::Surge).await
}

async fn handle_subscription(
  state: AppState,
  headers: HeaderMap,
  query: SubscriptionQuery,
  kind: SubscriptionKind
) -> Response {
  let token = match query.token.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
    Some(value) => value,
    None => return error(StatusCode::BAD_REQUEST, "缺少订阅 token", None)
  };

  let user = match fetch_user_by_token(&state, token).await {
    Ok(Some(value)) => value,
    Ok(None) => return error(StatusCode::UNAUTHORIZED, "订阅 token 无效", None),
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };

  let now = Local::now().naive_local();
  if user.expire_time.map(|value| value <= now).unwrap_or(false) {
    return error(StatusCode::FORBIDDEN, "账号已过期", None);
  }
  if user.transfer_enable > 0 && user.transfer_total >= user.transfer_enable {
    return error(StatusCode::FORBIDDEN, "流量已用完", None);
  }

  if let Err(message) = insert_subscription_log(&state, user.id, kind.as_str(), &headers).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None);
  }

  let nodes = match fetch_accessible_nodes(&state, user.id).await {
    Ok(value) => value,
    Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, &message, None)
  };
  if nodes.is_empty() {
    return error(StatusCode::NOT_FOUND, "暂无可用节点", None);
  }

  let config = match kind {
    SubscriptionKind::V2ray => generate_v2ray_config(&nodes, &user),
    SubscriptionKind::Clash => generate_clash_config(&nodes, &user),
    SubscriptionKind::QuantumultX => generate_quantumultx_config(&nodes, &user),
    SubscriptionKind::Singbox => generate_singbox_config(&nodes, &user),
    SubscriptionKind::Shadowrocket => generate_shadowrocket_config(&nodes, &user),
    SubscriptionKind::Surge => generate_surge_config(&nodes, &user)
  };

  let site_url = resolve_site_url(&state).await;
  let filename = build_subscription_filename(&state, kind).await;
  let content_disposition = build_content_disposition(&filename);

  let mut response = Response::new(Body::from(config));
  *response.status_mut() = StatusCode::OK;
  let headers_mut = response.headers_mut();
  headers_mut.insert(CONTENT_TYPE, HeaderValue::from_static(kind.content_type()));
  if let Ok(value) = HeaderValue::from_str(&content_disposition) {
    headers_mut.insert(CONTENT_DISPOSITION, value);
  }
  headers_mut.insert(
    HeaderName::from_static("profile-update-interval"),
    HeaderValue::from_static("24")
  );
  let expire_timestamp = subscription_expire_timestamp(resolve_subscription_expire_time(&user));
  let subscription_userinfo = format!(
    "upload={}; download={}; total={}; expire={}",
    user.upload_traffic, user.download_traffic, user.transfer_enable, expire_timestamp
  );
  if let Ok(value) = HeaderValue::from_str(&subscription_userinfo) {
    headers_mut.insert(HeaderName::from_static("subscription-userinfo"), value);
  }
  if !site_url.is_empty() {
    if let Ok(value) = HeaderValue::from_str(&site_url) {
      headers_mut.insert(HeaderName::from_static("profile-web-page-url"), value);
    }
  }

  response
}

fn resolve_subscription_expire_time(user: &SubscriptionUser) -> Option<chrono::NaiveDateTime> {
  user.class_expire_time.or(user.expire_time)
}

async fn fetch_user_by_token(state: &AppState, token: &str) -> Result<Option<SubscriptionUser>, String> {
  let row = sqlx::query(
    r#"
    SELECT id, uuid, passwd, transfer_enable, transfer_total, upload_traffic, download_traffic,
           class_expire_time, expire_time
    FROM users
    WHERE token = ? AND status = 1
    "#
  )
  .bind(token)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(row.map(|row| SubscriptionUser {
    id: row.try_get::<i64, _>("id").unwrap_or(0),
    uuid: row.try_get::<Option<String>, _>("uuid").ok().flatten(),
    passwd: row.try_get::<Option<String>, _>("passwd").ok().flatten(),
    transfer_enable: row
      .try_get::<Option<i64>, _>("transfer_enable")
      .unwrap_or(Some(0))
      .unwrap_or(0),
    transfer_total: row
      .try_get::<Option<i64>, _>("transfer_total")
      .unwrap_or(Some(0))
      .unwrap_or(0),
    upload_traffic: row
      .try_get::<Option<i64>, _>("upload_traffic")
      .unwrap_or(Some(0))
      .unwrap_or(0),
    download_traffic: row
      .try_get::<Option<i64>, _>("download_traffic")
      .unwrap_or(Some(0))
      .unwrap_or(0),
    class_expire_time: row.try_get::<Option<chrono::NaiveDateTime>, _>("class_expire_time").ok().flatten(),
    expire_time: row.try_get::<Option<chrono::NaiveDateTime>, _>("expire_time").ok().flatten()
  }))
}

async fn fetch_accessible_nodes(state: &AppState, user_id: i64) -> Result<Vec<SubscriptionNode>, String> {
  let rows = sqlx::query(
    r#"
    SELECT n.id, n.name, n.type, CAST(n.node_config AS CHAR) AS node_config
    FROM nodes n, users u
    WHERE u.id = ?
      AND u.status = 1
      AND (u.expire_time IS NULL OR u.expire_time > CURRENT_TIMESTAMP)
      AND (u.class_expire_time IS NULL OR u.class_expire_time > CURRENT_TIMESTAMP)
      AND n.status = 1
      AND n.node_class <= u.class
    ORDER BY n.node_class ASC, n.id ASC
    "#
  )
  .bind(user_id)
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let nodes = rows
    .into_iter()
    .map(|row| {
      let raw_config: String = row
        .try_get::<Option<String>, _>("node_config")
        .unwrap_or(Some("{}".to_string()))
        .unwrap_or_else(|| "{}".to_string());
      let parsed_config = serde_json::from_str::<serde_json::Value>(&raw_config).unwrap_or_else(|_| json!({}));
      SubscriptionNode {
        id: row.try_get::<i64, _>("id").unwrap_or(0),
        name: row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
        node_type: row.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default(),
        node_config: parsed_config
      }
    })
    .collect();
  Ok(nodes)
}

async fn insert_subscription_log(
  state: &AppState,
  user_id: i64,
  subscription_type: &str,
  headers: &HeaderMap
) -> Result<(), String> {
  let request_ip = get_client_ip(headers);
  let user_agent = headers
    .get("user-agent")
    .and_then(|value| value.to_str().ok())
    .unwrap_or_default()
    .to_string();
  sqlx::query(
    r#"
    INSERT INTO subscriptions (user_id, type, request_ip, request_user_agent)
    VALUES (?, ?, ?, ?)
    "#
  )
  .bind(user_id)
  .bind(subscription_type)
  .bind(request_ip)
  .bind(user_agent)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

fn extract_ip(value: Option<&str>) -> String {
  let first = value
    .unwrap_or_default()
    .split(',')
    .next()
    .unwrap_or("")
    .trim()
    .to_string();
  if first.is_empty() {
    return String::new();
  }
  if first.starts_with("::ffff:") {
    return first.trim_start_matches("::ffff:").to_string();
  }
  if first == "::1" {
    return "127.0.0.1".to_string();
  }
  first
}

fn get_client_ip(headers: &HeaderMap) -> String {
  let header_value = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
  let candidates = [
    header_value("x-client-ip"),
    header_value("x-forwarded-for"),
    header_value("cf-connecting-ip"),
    header_value("true-client-ip"),
    header_value("x-real-ip")
  ];
  for candidate in candidates {
    let ip = extract_ip(candidate);
    if !ip.is_empty() {
      return ip;
    }
  }
  String::new()
}

async fn resolve_site_name(state: &AppState) -> String {
  if let Ok(configs) = list_system_configs(state).await {
    if let Some(value) = configs.get("site_name").filter(|value| !value.trim().is_empty()) {
      return value.clone();
    }
  }
  state
    .env
    .site_name
    .clone()
    .unwrap_or_else(|| "Soga Panel".to_string())
}

async fn resolve_site_url(state: &AppState) -> String {
  if let Ok(configs) = list_system_configs(state).await {
    if let Some(value) = configs.get("site_url").filter(|value| !value.trim().is_empty()) {
      return value.clone();
    }
  }
  state.env.site_url.clone().unwrap_or_default()
}

async fn build_subscription_filename(state: &AppState, kind: SubscriptionKind) -> String {
  if matches!(kind, SubscriptionKind::Clash | SubscriptionKind::Surge) {
    let site_name = resolve_site_name(state).await;
    let safe = sanitize_filename(&site_name);
    return format!("{safe}.{}", kind.extension());
  }
  format!("{}.{}", kind.as_str(), kind.extension())
}

fn sanitize_filename(value: &str) -> String {
  let mut output = String::new();
  let mut last_is_separator = false;
  for ch in value.chars() {
    let replaced = if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
      '_'
    } else if ch.is_whitespace() {
      '_'
    } else {
      ch
    };
    if replaced == '_' {
      if last_is_separator {
        continue;
      }
      last_is_separator = true;
      output.push('_');
    } else {
      last_is_separator = false;
      output.push(replaced);
    }
  }
  let trimmed = output.trim_matches('_').to_string();
  if trimmed.is_empty() {
    "soga_panel".to_string()
  } else {
    trimmed
  }
}

fn force_ascii_filename(value: &str) -> String {
  let sanitized = sanitize_filename(value);
  let mut output = String::new();
  let mut last_is_separator = false;
  for ch in sanitized.chars() {
    let replaced = if ch.is_ascii() { ch } else { '_' };
    if replaced == '_' {
      if last_is_separator {
        continue;
      }
      last_is_separator = true;
      output.push('_');
    } else {
      last_is_separator = false;
      output.push(replaced);
    }
  }
  let trimmed = output.trim_matches('_').to_string();
  if trimmed.is_empty() {
    "soga_panel".to_string()
  } else {
    trimmed
  }
}

fn build_content_disposition(filename: &str) -> String {
  let fallback = force_ascii_filename(filename);
  if filename.is_ascii() {
    return format!("attachment; filename={fallback}");
  }
  let encoded = encode(filename);
  format!("attachment; filename={fallback}; filename*=UTF-8''{encoded}")
}
