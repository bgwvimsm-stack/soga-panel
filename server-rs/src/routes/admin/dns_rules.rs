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

#[derive(Deserialize)]
struct DnsRulesQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  search: Option<String>
}

#[derive(Deserialize)]
struct DnsRuleRequest {
  name: Option<String>,
  description: Option<String>,
  #[serde(rename = "rule_json")]
  rule_json: Option<Value>,
  #[serde(rename = "node_ids")]
  node_ids: Option<Value>,
  enabled: Option<i64>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/dns-rules", get(get_dns_rules))
    .route("/dns-rules", post(post_dns_rule))
    .route("/dns-rules/{id}", put(put_dns_rule))
    .route("/dns-rules/{id}", delete(delete_dns_rule))
}

async fn get_dns_rules(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<DnsRulesQuery>
) -> Response {
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

  let where_clause = if conditions.is_empty() {
    String::new()
  } else {
    format!("WHERE {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM dns_rules {where_clause}");
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
    SELECT id, name, description,
           CAST(rule_json AS CHAR) AS rule_json,
           CAST(node_ids AS CHAR) AS node_ids,
           enabled, created_at, updated_at
    FROM dns_rules
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
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let items: Vec<Value> = rows.into_iter().map(map_dns_rule_row).collect();

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
    "Success"
  )
  .into_response()
}

async fn post_dns_rule(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<DnsRuleRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let name = body.name.unwrap_or_default();
  if name.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少规则名称", None);
  }

  let rule_json = match normalize_rule_json(body.rule_json) {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };

  let node_ids = match normalize_node_ids(body.node_ids) {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  if node_ids.is_empty() {
    return error(StatusCode::BAD_REQUEST, "请绑定至少一个节点", None);
  }

  match ensure_dns_rule_unique(&state, &node_ids, None).await {
    Ok(conflicts) => {
      if !conflicts.is_empty() {
        return error(
          StatusCode::CONFLICT,
          "节点已被其他DNS规则绑定",
          Some(json!({ "conflicts": conflicts }))
        );
      }
    }
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None)
  }

  let enabled = body.enabled.unwrap_or(1);
  let description = body.description.unwrap_or_default();

  if let Err(err) = sqlx::query(
    r#"
    INSERT INTO dns_rules (name, description, rule_json, node_ids, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#
  )
  .bind(name)
  .bind(description)
  .bind(rule_json)
  .bind(serde_json::to_string(&node_ids).unwrap_or_else(|_| "[]".to_string()))
  .bind(enabled)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  let row = sqlx::query(
    "SELECT id, name, description, CAST(rule_json AS CHAR) AS rule_json, CAST(node_ids AS CHAR) AS node_ids, enabled, created_at, updated_at FROM dns_rules ORDER BY id DESC LIMIT 1"
  )
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  cache_delete_by_prefix(&state, "dns_rules_").await;
  success(row.map(map_dns_rule_row).unwrap_or(Value::Null), "创建成功").into_response()
}

async fn put_dns_rule(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(id): Path<i64>,
  Json(body): Json<DnsRuleRequest>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let name = body.name.unwrap_or_default();
  if name.trim().is_empty() {
    return error(StatusCode::BAD_REQUEST, "缺少规则名称", None);
  }

  let rule_json = match normalize_rule_json(body.rule_json) {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };

  let node_ids = match normalize_node_ids(body.node_ids) {
    Ok(value) => value,
    Err(message) => return error(StatusCode::BAD_REQUEST, &message, None)
  };
  if node_ids.is_empty() {
    return error(StatusCode::BAD_REQUEST, "请绑定至少一个节点", None);
  }

  match ensure_dns_rule_unique(&state, &node_ids, Some(id)).await {
    Ok(conflicts) => {
      if !conflicts.is_empty() {
        return error(
          StatusCode::CONFLICT,
          "节点已被其他DNS规则绑定",
          Some(json!({ "conflicts": conflicts }))
        );
      }
    }
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err, None)
  }

  let enabled = body.enabled.unwrap_or(1);
  let description = body.description.unwrap_or_default();

  if let Err(err) = sqlx::query(
    r#"
    UPDATE dns_rules
    SET name = ?, description = ?, rule_json = ?, node_ids = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(name)
  .bind(description)
  .bind(rule_json)
  .bind(serde_json::to_string(&node_ids).unwrap_or_else(|_| "[]".to_string()))
  .bind(enabled)
  .bind(id)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  let row = sqlx::query(
    "SELECT id, name, description, CAST(rule_json AS CHAR) AS rule_json, CAST(node_ids AS CHAR) AS node_ids, enabled, created_at, updated_at FROM dns_rules WHERE id = ?"
  )
    .bind(id)
    .fetch_optional(&state.db)
    .await;
  let row = match row {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  cache_delete_by_prefix(&state, "dns_rules_").await;
  success(row.map(map_dns_rule_row).unwrap_or(Value::Null), "更新成功").into_response()
}

async fn delete_dns_rule(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  if let Err(err) = sqlx::query("DELETE FROM dns_rules WHERE id = ?")
    .bind(id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  cache_delete_by_prefix(&state, "dns_rules_").await;
  success(Value::Null, "删除成功").into_response()
}

fn normalize_rule_json(value: Option<Value>) -> Result<String, String> {
  let value = match value {
    Some(val) => val,
    None => return Err("缺少规则JSON".to_string())
  };

  if let Value::String(text) = value {
    let trimmed = text.trim();
    if trimmed.is_empty() {
      return Err("缺少规则JSON".to_string());
    }
    let parsed: Value = serde_json::from_str(trimmed).map_err(|_| "DNS规则JSON无效".to_string())?;
    return serde_json::to_string(&parsed).map_err(|_| "DNS规则JSON无效".to_string());
  }

  serde_json::to_string(&value).map_err(|_| "DNS规则JSON无效".to_string())
}

fn normalize_node_ids(value: Option<Value>) -> Result<Vec<i64>, String> {
  let value = match value {
    Some(val) => val,
    None => return Err("请绑定至少一个节点".to_string())
  };

  let raw_list: Vec<i64> = match value {
    Value::Array(items) => items
      .into_iter()
      .filter_map(|item| match item {
        Value::Number(num) => num.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None
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
              _ => None
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
    _ => Vec::new()
  };

  let mut unique = Vec::new();
  for item in raw_list {
    if item > 0 && !unique.contains(&item) {
      unique.push(item);
    }
  }
  Ok(unique)
}

async fn ensure_dns_rule_unique(
  state: &AppState,
  node_ids: &[i64],
  exclude_id: Option<i64>
) -> Result<Vec<Value>, String> {
  if node_ids.is_empty() {
    return Ok(Vec::new());
  }

  let conditions = node_ids
    .iter()
    .map(|_| "JSON_CONTAINS(node_ids, JSON_ARRAY(?))")
    .collect::<Vec<&str>>()
    .join(" OR ");
  let mut sql = format!("SELECT id, name, CAST(node_ids AS CHAR) AS node_ids FROM dns_rules WHERE {conditions}");
  if let Some(_) = exclude_id {
    sql.push_str(" AND id != ?");
  }

  let mut query = sqlx::query(&sql);
  for node_id in node_ids {
    query = query.bind(node_id);
  }
  if let Some(id) = exclude_id {
    query = query.bind(id);
  }

  let rows = match query.fetch_all(&state.db).await {
    Ok(value) => value,
    Err(err) => return Err(err.to_string())
  };
  if rows.is_empty() {
    return Ok(Vec::new());
  }

  let conflicts: Vec<Value> = rows
    .into_iter()
    .map(|row| {
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
        "node_ids": row.try_get::<Option<String>, _>("node_ids").ok().flatten().unwrap_or_default()
      })
    })
    .collect();

  Ok(conflicts)
}

fn format_datetime(value: Option<NaiveDateTime>) -> Option<String> {
  value.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn map_dns_rule_row(row: sqlx::mysql::MySqlRow) -> Value {
  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    "description": row.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default(),
    "rule_json": row.try_get::<Option<String>, _>("rule_json").ok().flatten().unwrap_or_default(),
    "node_ids": row.try_get::<Option<String>, _>("node_ids").ok().flatten().unwrap_or_default(),
    "enabled": row.try_get::<Option<i64>, _>("enabled").unwrap_or(Some(1)).unwrap_or(1),
    "created_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("created_at").ok().flatten()),
    "updated_at": format_datetime(row.try_get::<Option<NaiveDateTime>, _>("updated_at").ok().flatten())
  })
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  String(String)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::String(value) => query.bind(value)
    };
  }
  query
}
