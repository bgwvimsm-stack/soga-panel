use crate::config::AppEnv;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
  pub env: AppEnv,
  pub db: MySqlPool,
  pub redis: Option<ConnectionManager>,
  pub redis_status: RedisStatus,
  pub oauth_pending: Arc<RwLock<HashMap<String, PendingOAuthCache>>>,
  pub passkey_challenges: Arc<RwLock<HashMap<String, PasskeyChallengeCache>>>
}

#[derive(Clone)]
pub enum RedisStatus {
  Disabled,
  Ready,
  #[allow(dead_code)]
  Error(String)
}

impl RedisStatus {
  pub fn as_str(&self) -> &str {
    match self {
      RedisStatus::Disabled => "disabled",
      RedisStatus::Ready => "ready",
      RedisStatus::Error(_) => "error"
    }
  }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PendingOAuthRegistration {
  pub provider: String,
  pub email: String,
  pub provider_id: String,
  pub username_candidates: Vec<String>,
  pub fallback_username_seed: String,
  pub remember: bool,
  pub client_ip: Option<String>,
  pub user_agent: Option<String>
}

#[derive(Clone)]
pub struct PendingOAuthCache {
  pub payload: PendingOAuthRegistration,
  pub expires_at: i64
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PasskeyChallenge {
  pub challenge_type: String,
  pub user_id: i64,
  pub challenge: String,
  pub rp_id: String,
  pub origin: String,
  pub remember: bool,
  pub created_at: i64
}

#[derive(Clone)]
pub struct PasskeyChallengeCache {
  pub payload: PasskeyChallenge,
  pub expires_at: i64
}
