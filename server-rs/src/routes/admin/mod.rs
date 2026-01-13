mod announcements;
mod audit;
mod cache;
mod coupons;
mod gift_card_batches;
mod gift_cards;
mod login_logs;
mod maintenance;
mod task;
mod traffic;
mod online_ips;
mod nodes;
mod packages;
mod purchase_records;
mod recharge_records;
mod rebate;
mod shared_ids;
mod system_configs;
mod subscription_logs;
mod tickets;
mod users;
mod whitelist;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use chrono::{Duration, Local, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::auth::require_admin_user_id;

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/system-stats", get(get_system_stats))
    .route("/node-status", get(get_node_status))
    .nest("/users", users::router())
    .nest("/nodes", nodes::router())
    .nest("/system-configs", system_configs::router())
    .nest("/tickets", tickets::router())
    .nest("/announcements", announcements::router())
    .nest("/coupons", coupons::router())
    .nest("/gift-cards", gift_cards::router().merge(gift_card_batches::router()))
    .nest("/traffic", traffic::router())
    .nest("/task", task::router())
    .nest("/packages", packages::router())
    .nest("/shared-ids", shared_ids::router())
    .nest("/rebate", rebate::router())
    .nest("/login-logs", login_logs::router())
    .nest("/subscription-logs", subscription_logs::router())
    .merge(audit::router())
    .merge(whitelist::router())
    .merge(online_ips::router())
    .merge(cache::router())
    .merge(maintenance::router())
    .merge(packages::stats_router())
    .merge(recharge_records::router())
    .merge(purchase_records::router())
}

async fn get_system_stats(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let users_row = sqlx::query(
    r#"
    SELECT
      COUNT(*) AS total_users,
      SUM(CASE WHEN transfer_total > 0 THEN 1 ELSE 0 END) AS active_users,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS disabled_users,
      SUM(CASE WHEN is_admin = 1 THEN 1 ELSE 0 END) AS admin_users
    FROM users
    "#
  )
  .fetch_optional(&state.db)
  .await;

  let nodes_row = sqlx::query(
    r#"
    SELECT
      COUNT(*) AS total_nodes,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active_nodes
    FROM nodes
    "#
  )
  .fetch_optional(&state.db)
  .await;

  let online_nodes_row = sqlx::query(
    r#"
    SELECT COUNT(DISTINCT node_id) AS online_nodes
    FROM node_status
    WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)
    "#
  )
  .fetch_optional(&state.db)
  .await;

  let traffic_row = sqlx::query(
    r#"
    SELECT
      COALESCE(SUM(transfer_enable), 0) AS total_traffic,
      COALESCE(SUM(upload_today + download_today), 0) AS today_traffic,
      COALESCE(AVG(transfer_enable), 0) AS average_quota
    FROM users
    "#
  )
  .fetch_optional(&state.db)
  .await;

  let users_row = match users_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let nodes_row = match nodes_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let online_nodes_row = match online_nodes_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let traffic_row = match traffic_row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let total_users = users_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_users").ok().flatten())
    .unwrap_or(0);
  let active_users = users_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("active_users").ok().flatten())
    .unwrap_or(0);
  let disabled_users = users_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("disabled_users").ok().flatten())
    .unwrap_or(0);
  let admin_users = users_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("admin_users").ok().flatten())
    .unwrap_or(0);

  let total_nodes = nodes_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_nodes").ok().flatten())
    .unwrap_or(0);
  let active_nodes = nodes_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("active_nodes").ok().flatten())
    .unwrap_or(0);
  let online_nodes = online_nodes_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("online_nodes").ok().flatten())
    .unwrap_or(0);
  let offline_nodes = (active_nodes - online_nodes).max(0);

  let total_traffic = traffic_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_traffic").ok().flatten())
    .unwrap_or(0);
  let today_traffic = traffic_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("today_traffic").ok().flatten())
    .unwrap_or(0);
  let average_quota = traffic_row
    .as_ref()
    .and_then(|row| row.try_get::<Option<f64>, _>("average_quota").ok().flatten())
    .unwrap_or(0.0);

  Json(json!({
    "code": 0,
    "message": "Success",
    "data": {
      "users": {
        "total": total_users,
        "active": active_users,
        "disabled": disabled_users,
        "admins": admin_users
      },
      "nodes": {
        "total": total_nodes,
        "active": active_nodes,
        "online": online_nodes,
        "offline": offline_nodes
      },
      "traffic": {
        "total": total_traffic,
        "today": today_traffic,
        "average_quota": average_quota
      }
    }
  }))
  .into_response()
}

#[derive(Deserialize)]
struct NodeStatusQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  keyword: Option<String>,
  status: Option<String>,
  online: Option<String>
}

async fn get_node_status(
  State(state): State<AppState>,
  Extension(headers): Extension<axum::http::HeaderMap>,
  Query(query): Query<NodeStatusQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(200);
  let offset = (page - 1) * limit;
  let keyword = query.keyword.as_ref().map(|value| value.trim().to_string()).unwrap_or_default();
  let status = parse_optional_i64(query.status.as_deref());
  let online = parse_optional_i64(query.online.as_deref());

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();
  if !keyword.is_empty() {
    let pattern = format!("%{keyword}%");
    conditions.push("(n.name LIKE ? OR n.type LIKE ?)".to_string());
    params.push(SqlParam::String(pattern.clone()));
    params.push(SqlParam::String(pattern));
  }
  if let Some(value) = status {
    conditions.push("n.status = ?".to_string());
    params.push(SqlParam::I64(if value == 1 { 1 } else { 0 }));
  }
  if let Some(value) = online {
    if value == 1 {
      conditions.push("ns.created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)".to_string());
    } else if value == 0 {
      conditions.push(
        "(ns.created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE) OR ns.created_at IS NULL)".to_string()
      );
    }
  }

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!(
    r#"
    SELECT COUNT(*) as total
    FROM nodes n
    LEFT JOIN node_status ns
      ON ns.id = (
        SELECT id
        FROM node_status
        WHERE node_id = n.id
        ORDER BY created_at DESC
        LIMIT 1
      )
    {where_clause}
    "#
  );
  let mut total_query = sqlx::query(&total_sql);
  total_query = bind_params(total_query, &params);
  let total_row = match total_query.fetch_optional(&state.db).await {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };
  let total = total_row
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0);

  let list_sql = format!(
    r#"
    SELECT
      n.id,
      n.name,
      n.type,
      n.node_class,
      n.status,
      n.node_config,
      n.created_at,
      n.updated_at,
      ns.cpu_usage,
      ns.memory_total,
      ns.memory_used,
      ns.swap_total,
      ns.swap_used,
      ns.disk_total,
      ns.disk_used,
      ns.uptime,
      ns.created_at as last_reported
    FROM nodes n
    LEFT JOIN node_status ns
      ON ns.id = (
        SELECT id
        FROM node_status
        WHERE node_id = n.id
        ORDER BY created_at DESC
        LIMIT 1
      )
    {where_clause}
    ORDER BY n.id DESC
    LIMIT ? OFFSET ?
    "#
  );

  let mut list_query = sqlx::query(&list_sql);
  list_query = bind_params(list_query, &params);
  let rows = match list_query
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
  {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let now = Local::now();
  let nodes = rows
    .into_iter()
    .map(|row| {
      let raw_config = row.try_get::<Option<String>, _>("node_config").ok().flatten();
      let (client, config) = parse_node_config(raw_config.as_deref());
      let server = read_string(&client, "server").unwrap_or_default();
      let server_port = read_i64(&client, "port")
        .or_else(|| read_i64(&config, "port"))
        .unwrap_or(443);
      let tls_host = read_string(&client, "tls_host")
        .or_else(|| read_string(&config, "host"))
        .unwrap_or_default();
      let last_reported = row
        .try_get::<Option<NaiveDateTime>, _>("last_reported")
        .ok()
        .flatten();
      let last_reported_text = last_reported.map(|value| value.format("%Y-%m-%d %H:%M:%S").to_string());
      let is_online = last_reported
        .map(|value| value >= (now - Duration::minutes(5)).naive_local())
        .unwrap_or(false);

      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
        "type": row.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default(),
        "node_class": row.try_get::<Option<i64>, _>("node_class").unwrap_or(Some(0)).unwrap_or(0),
        "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0),
        "server": server,
        "server_port": server_port,
        "tls_host": if tls_host.is_empty() { Value::Null } else { json!(tls_host) },
        "cpu_usage": row.try_get::<Option<f64>, _>("cpu_usage").unwrap_or(Some(0.0)).unwrap_or(0.0),
        "memory_total": row.try_get::<Option<i64>, _>("memory_total").unwrap_or(Some(0)).unwrap_or(0),
        "memory_used": row.try_get::<Option<i64>, _>("memory_used").unwrap_or(Some(0)).unwrap_or(0),
        "swap_total": row.try_get::<Option<i64>, _>("swap_total").unwrap_or(Some(0)).unwrap_or(0),
        "swap_used": row.try_get::<Option<i64>, _>("swap_used").unwrap_or(Some(0)).unwrap_or(0),
        "disk_total": row.try_get::<Option<i64>, _>("disk_total").unwrap_or(Some(0)).unwrap_or(0),
        "disk_used": row.try_get::<Option<i64>, _>("disk_used").unwrap_or(Some(0)).unwrap_or(0),
        "uptime": row.try_get::<Option<i64>, _>("uptime").unwrap_or(Some(0)).unwrap_or(0),
        "last_reported": last_reported_text,
        "is_online": is_online
      })
    })
    .collect::<Vec<Value>>();

  let total_nodes = fetch_count(&state, "SELECT COUNT(*) as total FROM nodes").await;
  let enabled_nodes = fetch_count(&state, "SELECT COUNT(*) as total FROM nodes WHERE status = 1").await;
  let online_nodes = fetch_count(
    &state,
    r#"
    SELECT COUNT(DISTINCT n.id) as total
    FROM nodes n
    LEFT JOIN node_status ns ON ns.node_id = n.id
    WHERE ns.created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    "#
  )
  .await;
  let offline_nodes = (total_nodes - online_nodes).max(0);

  success(
    json!({
      "nodes": nodes,
      "statistics": {
        "total": total_nodes,
        "online": online_nodes,
        "offline": offline_nodes,
        "enabled": enabled_nodes,
        "disabled": (total_nodes - enabled_nodes).max(0)
      },
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit
      }
    }),
    "Success"
  )
  .into_response()
}

fn parse_optional_i64(value: Option<&str>) -> Option<i64> {
  value
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .and_then(|value| value.parse::<i64>().ok())
}

fn parse_node_config(raw: Option<&str>) -> (Value, Value) {
  let raw = raw.unwrap_or("{}");
  let parsed = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!({}));
  if let Value::Object(map) = parsed {
    let client = map.get("client").cloned().unwrap_or_else(|| json!({}));
    let config = map
      .get("config")
      .cloned()
      .unwrap_or_else(|| Value::Object(map.clone()));
    (client, config)
  } else {
    (json!({}), json!({}))
  }
}

fn read_string(value: &Value, key: &str) -> Option<String> {
  match value.get(key) {
    Some(Value::String(value)) => Some(value.clone()),
    Some(Value::Number(value)) => Some(value.to_string()),
    _ => None
  }
}

fn read_i64(value: &Value, key: &str) -> Option<i64> {
  match value.get(key) {
    Some(Value::Number(value)) => value.as_i64(),
    Some(Value::String(value)) => value.trim().parse::<i64>().ok(),
    _ => None
  }
}

async fn fetch_count(state: &AppState, sql: &str) -> i64 {
  let row = sqlx::query(sql).fetch_optional(&state.db).await.ok();
  row
    .flatten()
    .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
    .unwrap_or(0)
}

enum SqlParam {
  I64(i64),
  String(String)
}

fn bind_params<'a>(
  mut query: sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>,
  params: &'a [SqlParam]
) -> sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value)
    };
  }
  query
}
