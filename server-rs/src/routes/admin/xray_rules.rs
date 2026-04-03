use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::cache::cache_delete_by_prefix;
use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize, Clone)]
struct XrayRulesQuery {
    page: Option<i64>,
    limit: Option<i64>,
    #[serde(rename = "pageSize")]
    page_size: Option<i64>,
    search: Option<String>,
    #[serde(rename = "rule_type")]
    rule_type: Option<String>,
    #[serde(rename = "rule_format")]
    rule_format: Option<String>,
    enabled: Option<i64>,
}

#[derive(Deserialize, Clone)]
struct XrayRuleRequest {
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "rule_type")]
    rule_type: Option<String>,
    #[serde(rename = "rule_format")]
    rule_format: Option<String>,
    #[serde(rename = "rule_content")]
    rule_content: Option<Value>,
    #[serde(rename = "rule_json")]
    rule_json: Option<Value>,
    #[serde(rename = "node_ids")]
    node_ids: Option<Value>,
    enabled: Option<i64>,
}

struct NormalizedRulePayload {
    rule_type: String,
    rule_format: String,
    rule_content: String,
    rule_json: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/xray-rules", get(get_xray_rules))
        .route("/xray-rules", post(post_xray_rule))
        .route("/xray-rules/{id}", put(put_xray_rule))
        .route("/xray-rules/{id}", delete(delete_xray_rule))
}

async fn get_xray_rules(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Query(query): Query<XrayRulesQuery>,
) -> Response {
    list_xray_rules(state, headers, query).await
}

async fn list_xray_rules(state: AppState, headers: HeaderMap, query: XrayRulesQuery) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    let page = query.page.unwrap_or(1).max(1);
    let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
    let limit = limit_raw.max(1).min(200);
    let offset = (page - 1) * limit;

    let search = query.search.unwrap_or_default().trim().to_string();
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<SqlParam> = Vec::new();

    if !search.is_empty() {
        let pattern = format!("%{search}%");
        conditions.push("(name LIKE ? OR description LIKE ?)".to_string());
        params.push(SqlParam::String(pattern.clone()));
        params.push(SqlParam::String(pattern));
    }

    if let Some(rule_type) = query.rule_type {
        let normalized = match normalize_rule_type(&rule_type) {
            Some(value) => value,
            None => return error(StatusCode::BAD_REQUEST, "规则类型无效", None),
        };
        conditions.push("rule_type = ?".to_string());
        params.push(SqlParam::String(normalized.to_string()));
    }

    if let Some(rule_format) = query.rule_format {
        let normalized = match normalize_rule_format(&rule_format) {
            Some(value) => value,
            None => return error(StatusCode::BAD_REQUEST, "规则格式无效", None),
        };
        conditions.push("rule_format = ?".to_string());
        params.push(SqlParam::String(normalized.to_string()));
    }

    if let Some(enabled) = query.enabled {
        conditions.push("enabled = ?".to_string());
        params.push(SqlParam::I64(if enabled == 1 { 1 } else { 0 }));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let total_sql = format!("SELECT COUNT(*) as total FROM xray_rules {where_clause}");
    let mut total_query = sqlx::query(&total_sql);
    total_query = bind_params(total_query, &params);
    let total_row = match total_query.fetch_optional(&state.db).await {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };
    let total = total_row
        .and_then(|row| row.try_get::<Option<i64>, _>("total").ok().flatten())
        .unwrap_or(0);

    let list_sql = format!(
        r#"
    SELECT id, name, description, rule_type, rule_format,
           CAST(rule_content AS CHAR) AS rule_content,
           CAST(rule_json AS CHAR) AS rule_json,
           enabled, created_at, updated_at
    FROM xray_rules
    {where_clause}
    ORDER BY id ASC
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
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let rule_ids: Vec<i64> = rows
        .iter()
        .map(|row| row.try_get::<i64, _>("id").unwrap_or(0))
        .filter(|id| *id > 0)
        .collect();
    let node_ids_map = match collect_rule_node_ids_map(&state, &rule_ids).await {
        Ok(map) => map,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None),
    };

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<i64, _>("id").unwrap_or(0);
            let mut value = map_xray_rule_row(row);
            value["node_ids"] = json!(node_ids_map.get(&id).cloned().unwrap_or_default());
            value
        })
        .collect();

    success(
        json!({
          "data": items,
          "total": total,
          "pagination": {
            "total": total,
            "page": page,
            "limit": limit,
            "pages": if total > 0 { (total + limit - 1) / limit } else { 0 }
          }
        }),
        "Success",
    )
    .into_response()
}

async fn post_xray_rule(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Json(body): Json<XrayRuleRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }

    let name = body.name.clone().unwrap_or_default();
    if name.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "缺少规则名称", None);
    }

    let normalized = match normalize_rule_payload(&body) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::BAD_REQUEST, &message, None),
    };

    let node_ids = match normalize_node_ids(body.node_ids.clone()) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::BAD_REQUEST, &message, None),
    };

    match ensure_node_rule_type_unique(&state, &node_ids, &normalized.rule_type, None).await {
        Ok(conflicts) => {
            if !conflicts.is_empty() {
                return error(
                    StatusCode::CONFLICT,
                    "同一节点不能绑定多个同类型规则",
                    Some(json!({ "conflicts": conflicts })),
                );
            }
        }
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None),
    }

    let enabled = body.enabled.unwrap_or(1);
    let description = body.description.unwrap_or_default();

    let result = sqlx::query(
        r#"
        INSERT INTO xray_rules
          (name, description, rule_type, rule_format, rule_content, rule_json, enabled, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(name)
    .bind(description)
    .bind(&normalized.rule_type)
    .bind(&normalized.rule_format)
    .bind(&normalized.rule_content)
    .bind(&normalized.rule_json)
    .bind(enabled)
    .execute(&state.db)
    .await;

    let result = match result {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let rule_id = result.last_insert_id() as i64;
    if rule_id <= 0 {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "创建规则失败", None);
    }

    if let Err(err) = sync_rule_bindings(&state, rule_id, &node_ids).await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None);
    }

    cache_delete_by_prefix(&state, "xray_rules_").await;

    let row = sqlx::query(
        r#"
        SELECT id, name, description, rule_type, rule_format,
               CAST(rule_content AS CHAR) AS rule_content,
               CAST(rule_json AS CHAR) AS rule_json,
               enabled, created_at, updated_at
        FROM xray_rules
        WHERE id = ?
        "#,
    )
    .bind(rule_id)
    .fetch_optional(&state.db)
    .await;

    let row = match row {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let mut payload = row.map(map_xray_rule_row).unwrap_or(Value::Null);
    payload["node_ids"] = json!(node_ids);
    success(payload, "创建成功").into_response()
}

async fn put_xray_rule(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(id): Path<i64>,
    Json(body): Json<XrayRuleRequest>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if id <= 0 {
        return error(StatusCode::BAD_REQUEST, "ID 无效", None);
    }

    let name = body.name.clone().unwrap_or_default();
    if name.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "缺少规则名称", None);
    }

    let normalized = match normalize_rule_payload(&body) {
        Ok(value) => value,
        Err(message) => return error(StatusCode::BAD_REQUEST, &message, None),
    };

    let has_node_ids = body.node_ids.is_some();
    let node_ids = if has_node_ids {
        match normalize_node_ids(body.node_ids.clone()) {
            Ok(value) => Some(value),
            Err(message) => return error(StatusCode::BAD_REQUEST, &message, None),
        }
    } else {
        None
    };

    if let Some(ref ids) = node_ids {
        match ensure_node_rule_type_unique(&state, ids, &normalized.rule_type, Some(id)).await {
            Ok(conflicts) => {
                if !conflicts.is_empty() {
                    return error(
                        StatusCode::CONFLICT,
                        "同一节点不能绑定多个同类型规则",
                        Some(json!({ "conflicts": conflicts })),
                    );
                }
            }
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None),
        }
    }

    let enabled = body.enabled.unwrap_or(1);
    let description = body.description.unwrap_or_default();

    if let Err(err) = sqlx::query(
        r#"
        UPDATE xray_rules
        SET name = ?, description = ?, rule_type = ?, rule_format = ?,
            rule_content = ?, rule_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(name)
    .bind(description)
    .bind(&normalized.rule_type)
    .bind(&normalized.rule_format)
    .bind(&normalized.rule_content)
    .bind(&normalized.rule_json)
    .bind(enabled)
    .bind(id)
    .execute(&state.db)
    .await
    {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    if let Some(ref ids) = node_ids {
        if let Err(err) = sync_rule_bindings(&state, id, ids).await {
            return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None);
        }
    }

    cache_delete_by_prefix(&state, "xray_rules_").await;

    let row = sqlx::query(
        r#"
        SELECT id, name, description, rule_type, rule_format,
               CAST(rule_content AS CHAR) AS rule_content,
               CAST(rule_json AS CHAR) AS rule_json,
               enabled, created_at, updated_at
        FROM xray_rules
        WHERE id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await;

    let row = match row {
        Ok(value) => value,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None),
    };

    let mut payload = row.map(map_xray_rule_row).unwrap_or(Value::Null);
    let node_ids_map = match collect_rule_node_ids_map(&state, &[id]).await {
        Ok(map) => map,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None),
    };
    payload["node_ids"] = json!(node_ids_map.get(&id).cloned().unwrap_or_default());
    success(payload, "更新成功").into_response()
}

async fn delete_xray_rule(
    State(state): State<AppState>,
    Extension(headers): Extension<HeaderMap>,
    Path(id): Path<i64>,
) -> Response {
    if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
        return resp;
    }
    if id <= 0 {
        return error(StatusCode::BAD_REQUEST, "ID 无效", None);
    }

    if let Err(err) = sync_rule_bindings(&state, id, &[]).await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None);
    }

    if let Err(err) = sqlx::query("DELETE FROM xray_rules WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
    {
        return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
    }

    cache_delete_by_prefix(&state, "xray_rules_").await;
    success(Value::Null, "删除成功").into_response()
}

fn normalize_rule_type(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "dns" => Some("dns"),
        "routing" => Some("routing"),
        "outbounds" => Some("outbounds"),
        _ => None,
    }
}

fn normalize_rule_format(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "json" => Some("json"),
        "yaml" => Some("yaml"),
        _ => None,
    }
}

fn parse_json_value(value: &Value) -> Result<Value, String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Err("规则内容不能为空".to_string());
            }
            serde_json::from_str(trimmed).map_err(|_| "规则JSON无效".to_string())
        }
        other => Ok(other.clone()),
    }
}

fn normalize_rule_payload(body: &XrayRuleRequest) -> Result<NormalizedRulePayload, String> {
    let rule_type_raw = body.rule_type.clone().unwrap_or_else(|| "dns".to_string());
    let rule_type =
        normalize_rule_type(&rule_type_raw).ok_or_else(|| "规则类型无效".to_string())?;

    let rule_format_raw = body
        .rule_format
        .clone()
        .unwrap_or_else(|| "json".to_string());
    let rule_format =
        normalize_rule_format(&rule_format_raw).ok_or_else(|| "规则格式无效".to_string())?;

    let content_value = body
        .rule_content
        .clone()
        .or_else(|| body.rule_json.clone())
        .ok_or_else(|| "规则内容不能为空".to_string())?;

    let rule_content = match content_value {
        Value::String(text) => {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                return Err("规则内容不能为空".to_string());
            }
            trimmed
        }
        other => serde_json::to_string(&other).map_err(|_| "规则内容序列化失败".to_string())?,
    };

    let rule_json = if rule_format == "json" {
        let parsed =
            serde_json::from_str::<Value>(&rule_content).map_err(|_| "规则JSON无效".to_string())?;
        serde_json::to_string(&parsed).map_err(|_| "规则JSON无效".to_string())?
    } else {
        let parsed_source = body
            .rule_json
            .as_ref()
            .ok_or_else(|| "YAML规则解析失败，请提供rule_json".to_string())?;
        let parsed = parse_json_value(parsed_source)?;
        serde_json::to_string(&parsed).map_err(|_| "规则JSON无效".to_string())?
    };

    Ok(NormalizedRulePayload {
        rule_type: rule_type.to_string(),
        rule_format: rule_format.to_string(),
        rule_content,
        rule_json,
    })
}

fn normalize_node_ids(value: Option<Value>) -> Result<Vec<i64>, String> {
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
                if let Value::Array(items) = parsed {
                    items
                        .into_iter()
                        .filter_map(|item| match item {
                            Value::Number(num) => num.as_i64(),
                            Value::String(text) => text.trim().parse::<i64>().ok(),
                            _ => None,
                        })
                        .collect()
                } else {
                    trimmed
                        .split(',')
                        .filter_map(|item| item.trim().parse::<i64>().ok())
                        .collect()
                }
            } else {
                trimmed
                    .split(',')
                    .filter_map(|item| item.trim().parse::<i64>().ok())
                    .collect()
            }
        }
        _ => Vec::new(),
    };

    let mut unique = Vec::new();
    for item in raw_list {
        if item > 0 && !unique.contains(&item) {
            unique.push(item);
        }
    }
    Ok(unique)
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

async fn collect_rule_node_ids_map(
    state: &AppState,
    rule_ids: &[i64],
) -> Result<std::collections::HashMap<i64, Vec<i64>>, String> {
    let mut map: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    if rule_ids.is_empty() {
        return Ok(map);
    }

    let target: std::collections::HashSet<i64> = rule_ids.iter().copied().collect();
    let rows = sqlx::query("SELECT id, CAST(xray_rule_ids AS CHAR) AS xray_rule_ids FROM nodes")
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    for row in rows {
        let node_id = row.try_get::<i64, _>("id").unwrap_or(0);
        if node_id <= 0 {
            continue;
        }
        let raw = row
            .try_get::<Option<String>, _>("xray_rule_ids")
            .ok()
            .flatten()
            .unwrap_or_else(|| "[]".to_string());
        let ids = parse_id_list(&raw);
        for id in ids {
            if target.contains(&id) {
                map.entry(id).or_default().push(node_id);
            }
        }
    }

    Ok(map)
}

async fn sync_rule_bindings(
    state: &AppState,
    rule_id: i64,
    target_node_ids: &[i64],
) -> Result<(), String> {
    let target: std::collections::HashSet<i64> = target_node_ids.iter().copied().collect();
    let rows = sqlx::query("SELECT id, CAST(xray_rule_ids AS CHAR) AS xray_rule_ids FROM nodes")
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    for row in rows {
        let node_id = row.try_get::<i64, _>("id").unwrap_or(0);
        if node_id <= 0 {
            continue;
        }
        let raw = row
            .try_get::<Option<String>, _>("xray_rule_ids")
            .ok()
            .flatten()
            .unwrap_or_else(|| "[]".to_string());
        let mut ids = parse_id_list(&raw);
        let has_rule = ids.contains(&rule_id);
        let should_bind = target.contains(&node_id);

        if should_bind && !has_rule {
            ids.push(rule_id);
        } else if !should_bind && has_rule {
            ids.retain(|id| *id != rule_id);
        } else {
            continue;
        }

        ids.sort_unstable();
        ids.dedup();

        sqlx::query(
            "UPDATE nodes SET xray_rule_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string()))
        .bind(node_id)
        .execute(&state.db)
        .await
        .map_err(|err| err.to_string())?;
    }

    Ok(())
}

async fn ensure_node_rule_type_unique(
    state: &AppState,
    node_ids: &[i64],
    rule_type: &str,
    exclude_rule_id: Option<i64>,
) -> Result<Vec<Value>, String> {
    if node_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = node_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<&str>>()
        .join(",");
    let query_sql = format!(
        "SELECT id, CAST(xray_rule_ids AS CHAR) AS xray_rule_ids FROM nodes WHERE id IN ({placeholders})"
    );
    let mut query = sqlx::query(&query_sql);
    for node_id in node_ids {
        query = query.bind(node_id);
    }

    let rows = query
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    let mut existing_rule_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
    let mut node_bindings: std::collections::HashMap<i64, Vec<i64>> =
        std::collections::HashMap::new();

    for row in rows {
        let node_id = row.try_get::<i64, _>("id").unwrap_or(0);
        let raw = row
            .try_get::<Option<String>, _>("xray_rule_ids")
            .ok()
            .flatten()
            .unwrap_or_else(|| "[]".to_string());
        let ids = parse_id_list(&raw)
            .into_iter()
            .filter(|id| exclude_rule_id.map(|ex| *id != ex).unwrap_or(true))
            .collect::<Vec<i64>>();
        for id in &ids {
            existing_rule_ids.insert(*id);
        }
        node_bindings.insert(node_id, ids);
    }

    if existing_rule_ids.is_empty() {
        return Ok(Vec::new());
    }

    let existing_ids = existing_rule_ids.into_iter().collect::<Vec<i64>>();
    let placeholders = existing_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<&str>>()
        .join(",");
    let rules_sql =
        format!("SELECT id, name, rule_type FROM xray_rules WHERE id IN ({placeholders})");
    let mut rules_query = sqlx::query(&rules_sql);
    for id in &existing_ids {
        rules_query = rules_query.bind(id);
    }
    let rule_rows = rules_query
        .fetch_all(&state.db)
        .await
        .map_err(|err| err.to_string())?;

    let mut rule_map: std::collections::HashMap<i64, (String, String)> =
        std::collections::HashMap::new();
    for row in rule_rows {
        let id = row.try_get::<i64, _>("id").unwrap_or(0);
        let name = row
            .try_get::<Option<String>, _>("name")
            .ok()
            .flatten()
            .unwrap_or_default();
        let row_rule_type = row
            .try_get::<Option<String>, _>("rule_type")
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_lowercase();
        rule_map.insert(id, (name, row_rule_type));
    }

    let mut conflicts = Vec::new();
    for node_id in node_ids {
        let ids = node_bindings.get(node_id).cloned().unwrap_or_default();
        let mut same_type_rules = Vec::new();
        for id in ids {
            if let Some((name, t)) = rule_map.get(&id) {
                if t == rule_type {
                    same_type_rules.push(json!({
                        "id": id,
                        "name": name,
                        "rule_type": t
                    }));
                }
            }
        }
        if !same_type_rules.is_empty() {
            conflicts.push(json!({
                "node_id": node_id,
                "conflicts": same_type_rules
            }));
        }
    }

    Ok(conflicts)
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
    value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn map_xray_rule_row(row: sqlx::mysql::MySqlRow) -> Value {
    json!({
      "id": row.try_get::<i64, _>("id").unwrap_or(0),
      "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
      "description": row.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default(),
      "rule_type": row.try_get::<Option<String>, _>("rule_type").ok().flatten().unwrap_or_default(),
      "rule_format": row.try_get::<Option<String>, _>("rule_format").ok().flatten().unwrap_or_default(),
      "rule_content": row.try_get::<Option<String>, _>("rule_content").ok().flatten().unwrap_or_default(),
      "rule_json": row.try_get::<Option<String>, _>("rule_json").ok().flatten().unwrap_or_default(),
      "enabled": row.try_get::<Option<i64>, _>("enabled").unwrap_or(Some(1)).unwrap_or(1),
      "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
      "updated_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("updated_at").ok().flatten())
    })
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
    String(String),
    I64(i64),
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
    for param in params {
        query = match param {
            SqlParam::String(value) => query.bind(value),
            SqlParam::I64(value) => query.bind(value),
        };
    }
    query
}
