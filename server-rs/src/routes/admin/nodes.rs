use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::cache::cache_delete_by_prefix;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct NodesQuery {
    page: Option<i64>,
    limit: Option<i64>,
    #[serde(rename = "pageSize")]
    page_size: Option<i64>,
    keyword: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct CreateNodeRequest {
    name: String,
    #[serde(rename = "type")]
    node_type: String,
    node_class: Option<i64>,
    node_bandwidth_limit: Option<i64>,
    traffic_multiplier: Option<f64>,
    bandwidthlimit_resetday: Option<i64>,
    node_config: Option<Value>,
    status: Option<i64>,
    server: Option<String>,
    server_port: Option<i64>,
    tls_host: Option<String>,
    ech_key: Option<String>,
    ech_config: Option<String>,
    xray_rule_ids: Option<Value>,
}

#[derive(Deserialize)]
struct UpdateNodeRequest {
    name: Option<String>,
    #[serde(rename = "type")]
    node_type: Option<String>,
    node_class: Option<i64>,
    node_bandwidth_limit: Option<i64>,
    traffic_multiplier: Option<f64>,
    bandwidthlimit_resetday: Option<i64>,
    node_config: Option<Value>,
    status: Option<i64>,
    xray_rule_ids: Option<Value>,
}

#[derive(Deserialize)]
struct BatchRequest {
    action: String,
    node_ids: Vec<i64>,
}

#[derive(Deserialize)]
struct StatusRequest {
    status: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_nodes))
        .route("/", post(post_node))
        .route("/export", get(export_nodes))
        .route("/batch", post(post_batch))
        .route("/{id}", put(put_node))
        .route("/{id}", delete(delete_node))
        .route("/{id}/traffic", post(post_node_traffic))
        .route("/{id}/status", post(post_node_status))
}

async fn get_nodes(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Query(query): Query<NodesQuery>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    let page = query.page.unwrap_or(1).max(1);
    let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
    let limit = limit_raw.max(1).min(200);
    let offset = (page - 1) * limit;
    let keyword = query
        .keyword
        .as_ref()
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let status = parse_optional_i64(query.status.as_deref());

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<SqlParam> = Vec::new();

    if !keyword.is_empty() {
        conditions.push("name LIKE ?".to_string());
        params.push(SqlParam::String(format!("%{keyword}%")));
    }
    if let Some(status_value) = status {
        conditions.push("status = ?".to_string());
        params.push(SqlParam::I64(status_value));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        r#"
    SELECT
      id,
      name,
      type,
      node_class,
      node_bandwidth,
      node_bandwidth_limit,
      CAST(traffic_multiplier AS DOUBLE) AS traffic_multiplier,
      bandwidthlimit_resetday,
      CAST(node_config AS CHAR) AS node_config,
      CAST(xray_rule_ids AS CHAR) AS xray_rule_ids,
      status,
      created_at,
      updated_at
    FROM nodes
    {where_clause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
    "#
    );

    let mut query_builder = sqlx::query(&sql);
    query_builder = bind_params(query_builder, &params);
    let rows = match query_builder
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
    {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let count_sql = format!("SELECT COUNT(*) as total FROM nodes {where_clause}");
    let mut count_query = sqlx::query(&count_sql);
    count_query = bind_params(count_query, &params);
    let total_row = match count_query.fetch_optional(&state.db).await {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };
    let total = total_row
        .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
        .unwrap_or(0);

    let nodes = rows.into_iter().map(map_node_row).collect::<Vec<Value>>();

    success(
        json!({
          "data": nodes,
          "total": total,
          "page": page,
          "limit": limit
        }),
        "Success",
    )
    .into_response()
}

async fn post_node(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Json(body): Json<CreateNodeRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    if body.name.trim().is_empty() || body.node_type.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "Name and type are required", None);
    }

    let node_config = build_node_config(
        body.node_config,
        body.server,
        body.server_port,
        body.tls_host,
        body.ech_key,
        body.ech_config,
    );
    let status = body.status.unwrap_or(1);
    let node_class = body.node_class.unwrap_or(1);
    let bandwidth_limit = body.node_bandwidth_limit.unwrap_or(0);
    let reset_day = body.bandwidthlimit_resetday.unwrap_or(1);
    let multiplier = normalize_multiplier(body.traffic_multiplier);
    let xray_rule_ids = match normalize_rule_ids(body.xray_rule_ids) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::BAD_REQUEST, &message, None),
    };
    if let Err(message) = validate_node_xray_rule_ids(&state, &xray_rule_ids).await {
        return error(StatusCode::CONFLICT, &message, None);
    }
    let xray_rule_ids_json =
        serde_json::to_string(&xray_rule_ids).unwrap_or_else(|_| "[]".to_string());

    let result = sqlx::query(
    r#"
    INSERT INTO nodes
      (name, type, node_class, node_bandwidth_limit, traffic_multiplier, bandwidthlimit_resetday, node_config, xray_rule_ids, status)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#
  )
  .bind(body.name.trim())
  .bind(body.node_type.trim())
  .bind(node_class)
  .bind(bandwidth_limit)
  .bind(multiplier)
  .bind(reset_day)
  .bind(node_config)
  .bind(xray_rule_ids_json)
  .bind(status)
  .execute(&state.db)
  .await;

    if let Err(err) = result {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    cache_delete_by_prefix(&state, "node_config_").await;
    cache_delete_by_prefix(&state, "xray_rules_").await;

    success(Value::Null, "节点已创建").into_response()
}

async fn put_node(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(node_id): Path<i64>,
    Json(body): Json<UpdateNodeRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if node_id <= 0 {
        return error(StatusCode::BAD_REQUEST, "ID 无效", None);
    }

    let mut updates: Vec<String> = Vec::new();
    let mut params: Vec<SqlParam> = Vec::new();

    if let Some(value) = body.name {
        updates.push("name = ?".to_string());
        params.push(SqlParam::String(value));
    }
    if let Some(value) = body.node_type {
        updates.push("type = ?".to_string());
        params.push(SqlParam::String(value));
    }
    if let Some(value) = body.node_class {
        updates.push("node_class = ?".to_string());
        params.push(SqlParam::I64(value));
    }
    if let Some(value) = body.node_bandwidth_limit {
        updates.push("node_bandwidth_limit = ?".to_string());
        params.push(SqlParam::I64(value));
    }
    if let Some(value) = body.traffic_multiplier {
        updates.push("traffic_multiplier = ?".to_string());
        params.push(SqlParam::F64(normalize_multiplier(Some(value))));
    }
    if let Some(value) = body.bandwidthlimit_resetday {
        updates.push("bandwidthlimit_resetday = ?".to_string());
        params.push(SqlParam::I64(value));
    }
    if let Some(value) = body.status {
        updates.push("status = ?".to_string());
        params.push(SqlParam::I64(value));
    }
    if let Some(value) = body.node_config {
        updates.push("node_config = ?".to_string());
        params.push(SqlParam::String(normalize_node_config(value)));
    }
    if body.xray_rule_ids.is_some() {
        let xray_rule_ids = match normalize_rule_ids(body.xray_rule_ids) {
            Ok(value) => value,
            Err(message) => return error(StatusCode::BAD_REQUEST, &message, None),
        };
        if let Err(message) = validate_node_xray_rule_ids(&state, &xray_rule_ids).await {
            return error(StatusCode::CONFLICT, &message, None);
        }
        updates.push("xray_rule_ids = ?".to_string());
        params.push(SqlParam::String(
            serde_json::to_string(&xray_rule_ids).unwrap_or_else(|_| "[]".to_string()),
        ));
    }

    if updates.is_empty() {
        return error(StatusCode::BAD_REQUEST, "没有需要更新的字段", None);
    }

    let sql = format!(
        "UPDATE nodes SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        updates.join(", ")
    );
    let mut query_builder = sqlx::query(&sql);
    query_builder = bind_params(query_builder, &params);
    let result = query_builder.bind(node_id).execute(&state.db).await;
    match result {
        Ok(outcome) => {
            if outcome.rows_affected() == 0 {
                return error(StatusCode::NOT_FOUND, "节点不存在或未更新任何字段", None);
            }
        }
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    }

    cache_delete_by_prefix(&state, "node_config_").await;
    cache_delete_by_prefix(&state, "xray_rules_").await;

    success(Value::Null, "节点已更新").into_response()
}

async fn post_node_traffic(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(node_id): Path<i64>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if node_id <= 0 {
        return error(StatusCode::BAD_REQUEST, "ID 无效", None);
    }

    let result = sqlx::query(
        "UPDATE nodes SET node_bandwidth = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(node_id)
    .execute(&state.db)
    .await;
    if let Err(err) = result {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    cache_delete_by_prefix(&state, &format!("node_config_{node_id}")).await;
    success(
        json!({ "message": "Node traffic reset successfully" }),
        "Success",
    )
    .into_response()
}

async fn export_nodes(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    let rows = match sqlx::query(
        r#"
    SELECT id, name, type, node_class, status, node_bandwidth, node_bandwidth_limit,
           CAST(traffic_multiplier AS DOUBLE) AS traffic_multiplier,
           bandwidthlimit_resetday,
           CAST(node_config AS CHAR) AS node_config,
           created_at, updated_at
    FROM nodes
    ORDER BY id DESC
    "#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let headers = [
        "Name",
        "Type",
        "Server",
        "Server Port",
        "Class",
        "Status",
        "Bandwidth Used",
        "Bandwidth Limit",
        "Traffic Multiplier",
        "Reset Day",
        "Created At",
        "Updated At",
    ];

    let mut csv = format!("{}\n", headers.join(","));
    for row in rows {
        let raw_config = row
            .try_get::<Option<String>, _>("node_config")
            .ok()
            .flatten();
        let (client, config) = parse_node_config(raw_config.as_deref());
        let server = read_string(&client, "server");
        let port = read_i64(&client, "port")
            .or_else(|| read_i64(&config, "port"))
            .unwrap_or(0);

        let status = row
            .try_get::<Option<i64>, _>("status")
            .unwrap_or(Some(0))
            .unwrap_or(0);
        let line = [
            escape_csv(
                row.try_get::<Option<String>, _>("name")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
            ),
            escape_csv(
                row.try_get::<Option<String>, _>("type")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
            ),
            escape_csv(server),
            escape_csv(port.to_string()),
            escape_csv(
                row.try_get::<Option<i64>, _>("node_class")
                    .unwrap_or(Some(0))
                    .unwrap_or(0)
                    .to_string(),
            ),
            escape_csv(if status == 1 { "Online" } else { "Offline" }),
            escape_csv(
                row.try_get::<Option<i64>, _>("node_bandwidth")
                    .unwrap_or(Some(0))
                    .unwrap_or(0)
                    .to_string(),
            ),
            escape_csv(
                row.try_get::<Option<i64>, _>("node_bandwidth_limit")
                    .unwrap_or(Some(0))
                    .unwrap_or(0)
                    .to_string(),
            ),
            escape_csv(
                row.try_get::<Option<f64>, _>("traffic_multiplier")
                    .unwrap_or(Some(1.0))
                    .unwrap_or(1.0)
                    .to_string(),
            ),
            escape_csv(
                row.try_get::<Option<i64>, _>("bandwidthlimit_resetday")
                    .unwrap_or(Some(1))
                    .unwrap_or(1)
                    .to_string(),
            ),
            escape_csv(
                row.try_get::<Option<chrono::NaiveDateTime>, _>("created_at")
                    .ok()
                    .flatten()
                    .map(format_datetime)
                    .unwrap_or_default(),
            ),
            escape_csv(
                row.try_get::<Option<chrono::NaiveDateTime>, _>("updated_at")
                    .ok()
                    .flatten()
                    .map(format_datetime)
                    .unwrap_or_default(),
            ),
        ];
        csv.push_str(&format!("{}\n", line.join(",")));
    }

    let filename = format!("nodes-{}.csv", Utc::now().format("%Y-%m-%d"));
    let mut response = Response::new(csv.into());
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename={filename}")) {
        response
            .headers_mut()
            .insert(header::CONTENT_DISPOSITION, value);
    }
    response
}

async fn delete_node(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(node_id): Path<i64>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if node_id <= 0 {
        return error(StatusCode::BAD_REQUEST, "ID 无效", None);
    }

    let result = sqlx::query("DELETE FROM nodes WHERE id = ?")
        .bind(node_id)
        .execute(&state.db)
        .await;
    match result {
        Ok(outcome) => {
            if outcome.rows_affected() == 0 {
                return error(StatusCode::NOT_FOUND, "节点不存在", None);
            }
        }
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    }

    cache_delete_by_prefix(&state, "node_config_").await;
    cache_delete_by_prefix(&state, "xray_rules_").await;

    success(Value::Null, "节点已删除").into_response()
}

async fn post_batch(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Json(body): Json<BatchRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    if body.action.trim().is_empty() || body.node_ids.is_empty() {
        return error(StatusCode::BAD_REQUEST, "action 和 node_ids 必填", None);
    }

    let ids: Vec<i64> = body.node_ids.into_iter().filter(|id| *id > 0).collect();
    if ids.is_empty() {
        return error(StatusCode::BAD_REQUEST, "节点 ID 无效", None);
    }

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
    let (sql, message) = match body.action.as_str() {
        "enable" => (
            format!(
        "UPDATE nodes SET status = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})"
      ),
            format!("{} 个节点已启用", ids.len()),
        ),
        "disable" => (
            format!(
        "UPDATE nodes SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})"
      ),
            format!("{} 个节点已禁用", ids.len()),
        ),
        "delete" => (
            format!("DELETE FROM nodes WHERE id IN ({placeholders})"),
            format!("{} 个节点已删除", ids.len()),
        ),
        _ => return error(StatusCode::BAD_REQUEST, "无效的 action 参数", None),
    };

    let mut query_builder = sqlx::query(&sql);
    for id in ids.iter() {
        query_builder = query_builder.bind(id);
    }
    let result = match query_builder.execute(&state.db).await {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    success(
        json!({
          "message": message,
          "affected_count": result.rows_affected(),
          "processed_ids": ids
        }),
        "Success",
    )
    .into_response()
}

async fn post_node_status(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(node_id): Path<i64>,
    Json(body): Json<StatusRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if node_id <= 0 {
        return error(StatusCode::BAD_REQUEST, "ID 无效", None);
    }
    let status = body.status.unwrap_or(-1);
    if status != 0 && status != 1 {
        return error(StatusCode::BAD_REQUEST, "状态无效", None);
    }

    if let Err(err) =
        sqlx::query("UPDATE nodes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(status)
            .bind(node_id)
            .execute(&state.db)
            .await
    {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    success(Value::Null, "状态已更新").into_response()
}

fn parse_optional_i64(value: Option<&str>) -> Option<i64> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<i64>().ok())
}

fn normalize_multiplier(value: Option<f64>) -> f64 {
    match value {
        Some(multiplier) if multiplier > 0.0 => multiplier,
        _ => 1.0,
    }
}

fn normalize_rule_ids(value: Option<Value>) -> Result<Vec<i64>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };

    let raw_list: Vec<i64> = match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| match item {
                Value::Number(num) => num.as_i64(),
                Value::String(text) => text.trim().parse::<i64>().ok(),
                _ => None,
            })
            .collect(),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                match parsed {
                    Value::Array(items) => items
                        .into_iter()
                        .filter_map(|item| match item {
                            Value::Number(num) => num.as_i64(),
                            Value::String(text) => text.trim().parse::<i64>().ok(),
                            _ => None,
                        })
                        .collect(),
                    _ => Vec::new(),
                }
            } else {
                trimmed
                    .split(',')
                    .filter_map(|item| item.trim().parse::<i64>().ok())
                    .collect()
            }
        }
        Value::Null => Vec::new(),
        _ => return Err("xray_rule_ids 格式无效".to_string()),
    };

    let mut unique = Vec::new();
    for item in raw_list {
        if item > 0 && !unique.contains(&item) {
            unique.push(item);
        }
    }
    Ok(unique)
}

fn parse_rule_ids(raw: Option<&str>) -> Vec<i64> {
    let raw = raw.unwrap_or("[]");
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(trimmed) {
        let mut ids: Vec<i64> = items
            .into_iter()
            .filter_map(|item| match item {
                Value::Number(num) => num.as_i64(),
                Value::String(text) => text.trim().parse::<i64>().ok(),
                _ => None,
            })
            .filter(|id| *id > 0)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        return ids;
    }

    let mut ids: Vec<i64> = trimmed
        .split(',')
        .filter_map(|item| item.trim().parse::<i64>().ok())
        .filter(|id| *id > 0)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

async fn validate_node_xray_rule_ids(state: &AppState, rule_ids: &[i64]) -> Result<(), String> {
    if rule_ids.is_empty() {
        return Ok(());
    }

    let placeholders = rule_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<&str>>()
        .join(",");
    let sql = format!("SELECT id, rule_type, enabled FROM xray_rules WHERE id IN ({placeholders})");
    let mut query = sqlx::query(&sql);
    for id in rule_ids {
        query = query.bind(id);
    }
    let rows = query
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    if rows.len() != rule_ids.len() {
        return Err("存在不存在的路由规则".to_string());
    }

    let mut type_set = std::collections::HashSet::<String>::new();
    for row in rows {
        let enabled = row
            .try_get::<Option<i64>, _>("enabled")
            .unwrap_or(Some(1))
            .unwrap_or(1);
        if enabled != 1 {
            return Err("存在已禁用的路由规则，无法绑定".to_string());
        }

        let rule_type = row
            .try_get::<Option<String>, _>("rule_type")
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_lowercase();
        if rule_type != "dns" && rule_type != "routing" && rule_type != "outbounds" {
            return Err("存在无效的路由规则类型".to_string());
        }
        if type_set.contains(&rule_type) {
            return Err("同一节点不能绑定多个同类型规则".to_string());
        }
        type_set.insert(rule_type);
    }

    Ok(())
}

fn ech_allowed_by_tls_type(config: &serde_json::Map<String, Value>) -> bool {
    match config.get("tls_type").and_then(|value| value.as_str()) {
        Some(tls_type) if !tls_type.trim().is_empty() => {
            tls_type.trim().eq_ignore_ascii_case("tls")
        }
        _ => true,
    }
}

fn strip_ech_when_not_tls(value: &mut Value) {
    let Some(root) = value.as_object_mut() else {
        return;
    };

    let has_structured = root.get("basic").and_then(Value::as_object).is_some()
        || root.get("config").and_then(Value::as_object).is_some()
        || root.get("client").and_then(Value::as_object).is_some();

    if has_structured {
        let ech_allowed = root
            .get("config")
            .and_then(Value::as_object)
            .map(ech_allowed_by_tls_type)
            .unwrap_or(true);
        if !ech_allowed {
            if let Some(config) = root.get_mut("config").and_then(Value::as_object_mut) {
                config.remove("ech");
            }
            if let Some(client) = root.get_mut("client").and_then(Value::as_object_mut) {
                client.remove("ech");
            }
        }
        return;
    }

    if !ech_allowed_by_tls_type(root) {
        root.remove("ech");
    }
}

fn normalize_node_config(value: Value) -> String {
    match value {
        Value::String(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(mut parsed) => {
                strip_ech_when_not_tls(&mut parsed);
                parsed.to_string()
            }
            Err(_) => raw,
        },
        mut other => {
            strip_ech_when_not_tls(&mut other);
            other.to_string()
        }
    }
}

fn build_node_config(
    node_config: Option<Value>,
    server: Option<String>,
    port: Option<i64>,
    tls_host: Option<String>,
    ech_key: Option<String>,
    ech_config: Option<String>,
) -> String {
    if let Some(value) = node_config {
        return normalize_node_config(value);
    }

    let mut client = serde_json::Map::new();
    let mut config = serde_json::Map::new();
    if let Some(value) = server {
        if !value.trim().is_empty() {
            client.insert("server".to_string(), json!(value.trim()));
        }
    }
    if let Some(value) = port {
        if value > 0 {
            client.insert("port".to_string(), json!(value));
            config.insert("port".to_string(), json!(value));
        }
    }
    if let Some(value) = tls_host {
        if !value.trim().is_empty() {
            client.insert("tls_host".to_string(), json!(value.trim()));
        }
    }
    if let Some(value) = ech_key {
        if !value.trim().is_empty() {
            config.insert("ech".to_string(), json!({ "key": value.trim() }));
        }
    }
    if let Some(value) = ech_config {
        if !value.trim().is_empty() {
            client.insert("ech".to_string(), json!({ "config": value.trim() }));
        }
    }
    json!({
      "basic": {
        "pull_interval": 60,
        "push_interval": 60,
        "speed_limit": 0
      },
      "client": Value::Object(client),
      "config": Value::Object(config)
    })
    .to_string()
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

fn read_string(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn read_i64(value: &Value, key: &str) -> Option<i64> {
    match value.get(key) {
        Some(Value::Number(value)) => value.as_i64(),
        Some(Value::String(value)) => value.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn map_node_row(row: sqlx::mysql::MySqlRow) -> Value {
    let raw_config = row
        .try_get::<Option<String>, _>("node_config")
        .ok()
        .flatten();
    let raw_rule_ids = row
        .try_get::<Option<String>, _>("xray_rule_ids")
        .ok()
        .flatten();
    let (client, config) = parse_node_config(raw_config.as_deref());
    let mut server = read_string(&client, "server");
    if server.is_empty() {
        server = read_string(&config, "server");
    }
    if server.is_empty() {
        server = read_string(&config, "host");
    }
    let server_port = read_i64(&client, "port")
        .or_else(|| read_i64(&config, "port"))
        .unwrap_or(443);
    let mut tls_host = read_string(&client, "tls_host");
    if tls_host.is_empty() {
        tls_host = read_string(&config, "tls_host");
    }
    if tls_host.is_empty() {
        tls_host = read_string(&config, "host");
    }

    let mut normalized_config = raw_config.clone().unwrap_or_else(|| "{}".to_string());
    if let Some(raw) = raw_config.as_deref() {
        if let Ok(mut parsed) = serde_json::from_str::<Value>(raw) {
            if let Value::Object(ref mut map) = parsed {
                let client_value = map.get("client").cloned().unwrap_or_else(|| json!({}));
                let mut client_map = match client_value {
                    Value::Object(value) => value,
                    _ => serde_json::Map::new(),
                };
                let server_value = client_map
                    .get("server")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if server_value.is_empty() && !server.is_empty() {
                    client_map.insert("server".to_string(), json!(server.clone()));
                }
                if !client_map.contains_key("port") && server_port > 0 {
                    client_map.insert("port".to_string(), json!(server_port));
                }
                let tls_value = client_map
                    .get("tls_host")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if tls_value.is_empty() && !tls_host.is_empty() {
                    client_map.insert("tls_host".to_string(), json!(tls_host.clone()));
                }
                map.insert("client".to_string(), Value::Object(client_map));
            }
            normalized_config = parsed.to_string();
        }
    }

    json!({
      "id": row.try_get::<i64, _>("id").unwrap_or(0),
      "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
      "type": row.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default(),
      "server": server,
      "server_port": server_port,
      "tls_host": if tls_host.is_empty() { Value::Null } else { json!(tls_host) },
      "node_class": row.try_get::<Option<i64>, _>("node_class").unwrap_or(Some(0)).unwrap_or(0),
      "node_bandwidth": row.try_get::<Option<i64>, _>("node_bandwidth").unwrap_or(Some(0)).unwrap_or(0),
      "node_bandwidth_limit": row.try_get::<Option<i64>, _>("node_bandwidth_limit").unwrap_or(Some(0)).unwrap_or(0),
      "traffic_multiplier": row.try_get::<Option<f64>, _>("traffic_multiplier").unwrap_or(Some(1.0)).unwrap_or(1.0),
      "bandwidthlimit_resetday": row.try_get::<Option<i64>, _>("bandwidthlimit_resetday").unwrap_or(Some(1)).unwrap_or(1),
      "node_config": normalized_config,
      "xray_rule_ids": parse_rule_ids(raw_rule_ids.as_deref()),
      "status": row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0),
      "created_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("created_at").ok().flatten().map(format_datetime),
      "updated_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("updated_at").ok().flatten().map(format_datetime)
    })
}

fn escape_csv(value: impl ToString) -> String {
    format!("\"{}\"", value.to_string().replace('"', "\"\""))
}

fn format_datetime(value: chrono::NaiveDateTime) -> String {
    value.format("%Y-%m-%d %H:%M:%S").to_string()
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
    I64(i64),
    F64(f64),
    String(String),
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
    for param in params {
        query = match param {
            SqlParam::I64(value) => query.bind(*value),
            SqlParam::F64(value) => query.bind(*value),
            SqlParam::String(value) => query.bind(value),
        };
    }
    query
}
