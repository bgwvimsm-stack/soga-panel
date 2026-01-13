use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use crate::response::{error, success};
use crate::state::AppState;

#[derive(Deserialize)]
struct AnnouncementQuery {
  limit: Option<i64>,
  offset: Option<i64>
}

pub fn router() -> Router<AppState> {
  Router::new().route("/", get(get_announcements))
}

async fn get_announcements(
  State(state): State<AppState>,
  Query(query): Query<AnnouncementQuery>
) -> Response {
  let limit = query.limit.unwrap_or(10).max(1).min(100);
  let offset = query.offset.unwrap_or(0).max(0);
  let now = (Utc::now() + Duration::hours(8)).timestamp();

  let rows = sqlx::query(
    r#"
    SELECT id, title, content, content_html, type, is_pinned, priority, created_at, expires_at
    FROM announcements
    WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY is_pinned DESC, priority DESC, created_at DESC
    LIMIT ? OFFSET ?
    "#
  )
  .bind(now)
  .bind(limit)
  .bind(offset)
  .fetch_all(&state.db)
  .await;
  let rows = match rows {
    Ok(value) => value,
    Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string(), None)
  };

  let items = rows
    .into_iter()
    .map(|row| {
      let created_at = row.try_get::<Option<i64>, _>("created_at").ok().flatten().unwrap_or(0);
      let expires_at = row.try_get::<Option<i64>, _>("expires_at").ok().flatten();
      let is_pinned = row.try_get::<Option<i64>, _>("is_pinned").unwrap_or(Some(0)).unwrap_or(0) == 1;
      let is_expired = expires_at.map(|value| value < now).unwrap_or(false);

      json!({
        "id": row.try_get::<i64, _>("id").unwrap_or(0),
        "title": row.try_get::<Option<String>, _>("title").ok().flatten().unwrap_or_default(),
        "content": row.try_get::<Option<String>, _>("content").ok().flatten().unwrap_or_default(),
        "content_html": row.try_get::<Option<String>, _>("content_html").ok().flatten().unwrap_or_default(),
        "type": row.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default(),
        "is_pinned": is_pinned,
        "priority": row.try_get::<Option<i64>, _>("priority").unwrap_or(Some(0)).unwrap_or(0),
        "created_at": created_at,
        "expires_at": expires_at,
        "is_expired": is_expired
      })
    })
    .collect::<Vec<_>>();

  success(items, "Success").into_response()
}
