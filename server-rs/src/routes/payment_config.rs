use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde_json::json;

use crate::payment::get_payment_methods;
use crate::response::success;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
  Router::new().route("/", get(get_payment_config))
}

async fn get_payment_config(State(state): State<AppState>) -> Response {
  let methods = get_payment_methods(&state.env);
  let values: Vec<String> = methods.iter().map(|item| item.value.clone()).collect();
  success(
    json!({
      "enabled": !methods.is_empty(),
      "methods": values,
      "payment_methods": methods
    }),
    "Success"
  )
  .into_response()
}
