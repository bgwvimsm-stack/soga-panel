use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ApiResponse<T> {
  pub code: i32,
  pub message: String,
  pub data: T
}

pub fn success<T: Serialize>(data: T, message: &str) -> impl IntoResponse {
  let payload = ApiResponse {
    code: 0,
    message: message.to_string(),
    data
  };
  (StatusCode::OK, Json(payload))
}

pub fn error(status: StatusCode, message: &str, data: Option<Value>) -> Response {
  let payload = ApiResponse {
    code: status.as_u16() as i32,
    message: message.to_string(),
    data: data.unwrap_or(Value::Null)
  };
  (status, Json(payload)).into_response()
}
