use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

use super::super::auth::require_admin_user_id;

#[derive(Deserialize)]
struct PackageQuery {
  page: Option<i64>,
  limit: Option<i64>,
  #[serde(rename = "pageSize")]
  page_size: Option<i64>,
  status: Option<String>,
  level: Option<String>
}

#[derive(Deserialize)]
struct PackagePayload {
  name: Option<String>,
  price: Option<f64>,
  traffic_quota: Option<i64>,
  validity_days: Option<i64>,
  speed_limit: Option<i64>,
  device_limit: Option<i64>,
  level: Option<i64>,
  status: Option<i64>,
  is_recommended: Option<i64>,
  sort_weight: Option<i64>
}

pub fn router() -> Router<AppState> {
  Router::new()
    .route("/", get(get_packages))
    .route("/", post(post_package))
    .route("/{id}", put(put_package))
    .route("/{id}", delete(delete_package))
}

pub fn stats_router() -> Router<AppState> {
  Router::new().route("/package-stats", get(get_package_stats))
}

async fn get_packages(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Query(query): Query<PackageQuery>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let page = query.page.unwrap_or(1).max(1);
  let limit_raw = query.limit.or(query.page_size).unwrap_or(20);
  let limit = limit_raw.max(1).min(100);
  let offset = (page - 1) * limit;
  let status = query.status.as_deref().map(|value| value.trim()).unwrap_or("");
  let level = query.level.as_deref().map(|value| value.trim()).unwrap_or("");

  let mut conditions: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if !status.is_empty() {
    if let Ok(value) = status.parse::<i64>() {
      conditions.push("p.status = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }
  if !level.is_empty() {
    if let Ok(value) = level.parse::<i64>() {
      conditions.push("p.level = ?".to_string());
      params.push(SqlParam::I64(value));
    }
  }

  let where_clause = if conditions.is_empty() {
    "WHERE 1=1".to_string()
  } else {
    format!("WHERE 1=1 AND {}", conditions.join(" AND "))
  };

  let total_sql = format!("SELECT COUNT(*) as total FROM packages p {where_clause}");
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
      p.id,
      p.name,
      CAST(p.price AS DOUBLE) AS price,
      p.traffic_quota,
      p.validity_days,
      p.speed_limit,
      p.device_limit,
      p.level,
      p.status,
      p.is_recommended,
      p.sort_weight,
      p.created_at,
      p.updated_at,
      (
        SELECT COUNT(*)
        FROM package_purchase_records pr
        WHERE pr.package_id = p.id AND pr.status = 1
      ) as sales_count
    FROM packages p
    {where_clause}
    ORDER BY p.id DESC
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

  let packages = rows
    .into_iter()
    .map(|row| map_package_row(&row))
    .collect::<Vec<Value>>();

  success(
    json!({
      "packages": packages,
      "pagination": {
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": if total > 0 { ((total as f64) / (limit as f64)).ceil() as i64 } else { 0 }
      }
    }),
    "Success"
  )
  .into_response()
}

async fn post_package(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Json(body): Json<PackagePayload>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let name = body.name.unwrap_or_default().trim().to_string();
  let price = body.price.unwrap_or(-1.0);
  let traffic_quota = body.traffic_quota.unwrap_or(-1);
  let validity_days = body.validity_days.unwrap_or(-1);
  if name.is_empty() || price < 0.0 || traffic_quota < 0 || validity_days < 0 {
    return error(StatusCode::BAD_REQUEST, "必填字段缺失", None);
  }

  let speed_limit = body.speed_limit.unwrap_or(0);
  let device_limit = body.device_limit.unwrap_or(0);
  let level = body.level.unwrap_or(1);
  let status = body.status.unwrap_or(1);
  let is_recommended = body.is_recommended.unwrap_or(0);
  let sort_weight = body.sort_weight.unwrap_or(0);

  if let Err(err) = sqlx::query(
    r#"
    INSERT INTO packages
      (name, price, traffic_quota, validity_days, speed_limit, device_limit, level, status, is_recommended, sort_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#
  )
  .bind(&name)
  .bind(price)
  .bind(traffic_quota)
  .bind(validity_days)
  .bind(speed_limit)
  .bind(device_limit)
  .bind(level)
  .bind(status)
  .bind(is_recommended)
  .bind(sort_weight)
  .execute(&state.db)
  .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "套餐已创建").into_response()
}

async fn put_package(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(package_id): Path<i64>,
  Json(body): Json<PackagePayload>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if package_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  let mut updates: Vec<String> = Vec::new();
  let mut params: Vec<SqlParam> = Vec::new();

  if let Some(value) = body.name {
    let trimmed = value.trim().to_string();
    if !trimmed.is_empty() {
      updates.push("name = ?".to_string());
      params.push(SqlParam::String(trimmed));
    }
  }
  if let Some(value) = body.price {
    updates.push("price = ?".to_string());
    params.push(SqlParam::F64(value));
  }
  if let Some(value) = body.traffic_quota {
    updates.push("traffic_quota = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.validity_days {
    updates.push("validity_days = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.speed_limit {
    updates.push("speed_limit = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.device_limit {
    updates.push("device_limit = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.level {
    updates.push("level = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.status {
    updates.push("status = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.is_recommended {
    updates.push("is_recommended = ?".to_string());
    params.push(SqlParam::I64(value));
  }
  if let Some(value) = body.sort_weight {
    updates.push("sort_weight = ?".to_string());
    params.push(SqlParam::I64(value));
  }

  if updates.is_empty() {
    return error(StatusCode::BAD_REQUEST, "没有需要更新的字段", None);
  }

  let sql = format!(
    "UPDATE packages SET {}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    updates.join(", ")
  );
  let mut query_builder = sqlx::query(&sql);
  query_builder = bind_params(query_builder, &params);
  if let Err(err) = query_builder.bind(package_id).execute(&state.db).await {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "套餐已更新").into_response()
}

async fn delete_package(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>,
  Path(package_id): Path<i64>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }
  if package_id <= 0 {
    return error(StatusCode::BAD_REQUEST, "ID 无效", None);
  }

  if let Err(err) = sqlx::query("DELETE FROM packages WHERE id = ?")
    .bind(package_id)
    .execute(&state.db)
    .await
  {
    return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None);
  }

  success(Value::Null, "套餐已删除").into_response()
}

async fn get_package_stats(
  State(state): State<AppState>,
  Extension(headers): Extension<HeaderMap>
) -> Response {
  if let Err(resp) = require_admin_user_id(&state, &headers, None).await {
    return resp;
  }

  let package_stats = sqlx::query(
    r#"
    SELECT
      COUNT(*) as total_packages,
      COUNT(CASE WHEN status = 1 THEN 1 END) as active_packages,
      COUNT(CASE WHEN status = 0 THEN 1 END) as inactive_packages
    FROM packages
    "#
  )
  .fetch_optional(&state.db)
  .await;
  let package_stats = match package_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let sales_stats = sqlx::query(
    r#"
    SELECT
      COUNT(*) as total_purchases,
      COUNT(CASE WHEN status = 1 THEN 1 END) as completed_purchases,
      COALESCE(SUM(CASE WHEN status = 1 THEN price ELSE 0 END), 0) as total_revenue
    FROM package_purchase_records
    "#
  )
  .fetch_optional(&state.db)
  .await;
  let sales_stats = match sales_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let recharge_stats = sqlx::query(
    r#"
    SELECT
      COUNT(*) as total_recharges,
      COUNT(CASE WHEN status = 1 THEN 1 END) as completed_recharges,
      COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as total_recharged
    FROM recharge_records
    "#
  )
  .fetch_optional(&state.db)
  .await;
  let recharge_stats = match recharge_stats {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let popular_rows = sqlx::query(
    r#"
    SELECT
      p.id,
      p.name,
      p.price,
      COUNT(ppr.id) as purchase_count,
      COALESCE(SUM(CASE WHEN ppr.status = 1 THEN ppr.price ELSE 0 END), 0) as revenue
    FROM packages p
    LEFT JOIN package_purchase_records ppr ON p.id = ppr.package_id
    GROUP BY p.id
    ORDER BY purchase_count DESC
    LIMIT 5
    "#
  )
  .fetch_all(&state.db)
  .await;
  let popular_rows = match popular_rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let popular_packages = popular_rows
    .into_iter()
    .map(|row| {
      let price = parse_decimal(&row, "price", 0.0);
      let revenue = parse_decimal(&row, "revenue", 0.0);
      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
        "price": price,
        "purchase_count": row.try_get::<Option<i64>, _>("purchase_count").ok().flatten().unwrap_or(0),
        "revenue": revenue
      })
    })
    .collect::<Vec<Value>>();

  success(
    json!({
      "package_stats": {
        "total": package_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("total_packages").ok().flatten()).unwrap_or(0),
        "active": package_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("active_packages").ok().flatten()).unwrap_or(0),
        "inactive": package_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("inactive_packages").ok().flatten()).unwrap_or(0)
      },
      "sales_stats": {
        "total_purchases": sales_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("total_purchases").ok().flatten()).unwrap_or(0),
        "completed_purchases": sales_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("completed_purchases").ok().flatten()).unwrap_or(0),
        "total_revenue": sales_stats.as_ref().map(|row| parse_decimal(row, "total_revenue", 0.0)).unwrap_or(0.0)
      },
      "recharge_stats": {
        "total_recharges": recharge_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("total_recharges").ok().flatten()).unwrap_or(0),
        "completed_recharges": recharge_stats.as_ref().and_then(|row| row.try_get::<Option<i64>, _>("completed_recharges").ok().flatten()).unwrap_or(0),
        "total_recharged": recharge_stats.as_ref().map(|row| parse_decimal(row, "total_recharged", 0.0)).unwrap_or(0.0)
      },
      "popular_packages": popular_packages
    }),
    "Success"
  )
  .into_response()
}

fn map_package_row(row: &sqlx::mysql::MySqlRow) -> Value {
  let price = parse_decimal(row, "price", 0.0);
  let traffic_quota = row.try_get::<Option<i64>, _>("traffic_quota").unwrap_or(Some(0)).unwrap_or(0);
  let validity_days = row.try_get::<Option<i64>, _>("validity_days").unwrap_or(Some(0)).unwrap_or(0);
  let speed_limit = row.try_get::<Option<i64>, _>("speed_limit").unwrap_or(Some(0)).unwrap_or(0);
  let device_limit = row.try_get::<Option<i64>, _>("device_limit").unwrap_or(Some(0)).unwrap_or(0);
  let level = row.try_get::<Option<i64>, _>("level").unwrap_or(Some(0)).unwrap_or(0);
  let status = row.try_get::<Option<i64>, _>("status").unwrap_or(Some(0)).unwrap_or(0);
  let sort_weight = row.try_get::<Option<i64>, _>("sort_weight").unwrap_or(Some(0)).unwrap_or(0);
  let is_recommended = row.try_get::<Option<i64>, _>("is_recommended").unwrap_or(Some(0)).unwrap_or(0);
  let sales_count = row.try_get::<Option<i64>, _>("sales_count").unwrap_or(Some(0)).unwrap_or(0);

  json!({
    "id": row.try_get::<i64, _>("id").unwrap_or(0),
    "name": row.try_get::<Option<String>, _>("name").ok().flatten().unwrap_or_default(),
    "price": price,
    "traffic_quota": traffic_quota,
    "validity_days": validity_days,
    "speed_limit": speed_limit,
    "device_limit": device_limit,
    "level": level,
    "status": status,
    "is_recommended": is_recommended,
    "sort_weight": sort_weight,
    "sales_count": sales_count,
    "created_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("created_at").ok().flatten().map(format_datetime),
    "updated_at": row.try_get::<Option<chrono::NaiveDateTime>, _>("updated_at").ok().flatten().map(format_datetime),
    "status_text": if status == 1 { "启用" } else { "禁用" },
    "traffic_quota_text": format!("{traffic_quota} GB"),
    "validity_text": format!("{validity_days} 天"),
    "speed_limit_text": if speed_limit == 0 { "无限制".to_string() } else { format!("{speed_limit} Mbps") },
    "device_limit_text": if device_limit == 0 { "无限制".to_string() } else { format!("{device_limit} 个设备") }
  })
}

fn format_datetime(value: chrono::NaiveDateTime) -> String {
  value.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn parse_decimal(row: &sqlx::mysql::MySqlRow, column: &str, fallback: f64) -> f64 {
  if let Ok(value) = row.try_get::<Option<f64>, _>(column) {
    return value.unwrap_or(fallback);
  }
  if let Ok(value) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(column) {
    return value
      .map(|val| val.to_string().parse::<f64>().unwrap_or(fallback))
      .unwrap_or(fallback);
  }
  if let Ok(value) = row.try_get::<Option<String>, _>(column) {
    return value
      .and_then(|val| val.parse::<f64>().ok())
      .unwrap_or(fallback);
  }
  fallback
}

type SqlxQuery<'a> = sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>;

enum SqlParam {
  I64(i64),
  F64(f64),
  String(String)
}

fn bind_params<'a>(mut query: SqlxQuery<'a>, params: &'a [SqlParam]) -> SqlxQuery<'a> {
  for param in params {
    query = match param {
      SqlParam::I64(value) => query.bind(*value),
      SqlParam::F64(value) => query.bind(*value),
      SqlParam::String(value) => query.bind(value)
    };
  }
  query
}
