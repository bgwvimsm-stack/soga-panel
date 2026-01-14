use axum::http::header::{CACHE_CONTROL, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::Value;

pub fn generate_etag(content: &Value) -> String {
  let content_str = content.to_string();
  let mut hash: i32 = 0;
  for code in content_str.encode_utf16() {
    hash = hash.wrapping_shl(5).wrapping_sub(hash).wrapping_add(code as i32);
  }
  let abs_value = (hash as i64).abs();
  let hex = format!("{:x}", abs_value);
  format!("\"{}\"", hex)
}

pub fn is_etag_match(headers: &HeaderMap, etag: &str) -> bool {
  let header_value = headers
    .get(IF_NONE_MATCH)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("");
  if header_value.is_empty() {
    return false;
  }
  if header_value == "*" {
    return true;
  }
  let normalized = normalize_etag(etag);
  header_value
    .split(',')
    .map(normalize_etag)
    .any(|tag| tag == normalized || tag == etag)
}

fn normalize_etag(value: &str) -> String {
  value
    .trim()
    .trim_start_matches("W/")
    .trim()
    .to_string()
}

pub fn not_modified(etag: &str) -> Response {
  let mut headers = HeaderMap::new();
  headers.insert(ETAG, HeaderValue::from_str(etag).unwrap_or_else(|_| HeaderValue::from_static("")));
  headers.insert(CACHE_CONTROL, HeaderValue::from_static("max-age=3600"));
  (StatusCode::NOT_MODIFIED, headers).into_response()
}

pub fn json_with_etag(value: &Value, etag: &str) -> Response {
  let mut headers = HeaderMap::new();
  headers.insert(ETAG, HeaderValue::from_str(etag).unwrap_or_else(|_| HeaderValue::from_static("")));
  headers.insert(CACHE_CONTROL, HeaderValue::from_static("max-age=3600"));
  headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
  (StatusCode::OK, headers, value.to_string()).into_response()
}
