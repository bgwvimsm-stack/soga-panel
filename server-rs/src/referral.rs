use rand::Rng;
use sqlx::Row;

use crate::state::AppState;

const INVITE_CHARS: &str = "abcdefghjkmnpqrstuvwxyz23456789";

pub fn normalize_invite_code(raw: &str) -> String {
  raw.trim().to_lowercase()
}

pub async fn find_inviter_by_code(
  state: &AppState,
  code: &str
) -> Result<Option<InviterInfo>, String> {
  let normalized = normalize_invite_code(code);
  if normalized.is_empty() {
    return Ok(None);
  }
  let row = sqlx::query(
    "SELECT id, invite_limit, invite_used FROM users WHERE LOWER(invite_code) = ? LIMIT 1"
  )
  .bind(normalized)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  Ok(row.map(|r| InviterInfo {
    id: r.try_get::<i64, _>("id").unwrap_or(0),
    invite_limit: r.try_get::<Option<i64>, _>("invite_limit").unwrap_or(Some(0)).unwrap_or(0),
    invite_used: r.try_get::<Option<i64>, _>("invite_used").unwrap_or(Some(0)).unwrap_or(0)
  }))
}

pub async fn increment_invite_usage(state: &AppState, inviter_id: i64) {
  let _ = sqlx::query(
    r#"
    UPDATE users
    SET invite_used = CASE
          WHEN invite_limit > 0 AND invite_used >= invite_limit THEN invite_limit
          ELSE invite_used + 1
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(inviter_id)
  .execute(&state.db)
  .await;
}

pub async fn save_referral_relation(
  state: &AppState,
  inviter_id: i64,
  invitee_id: i64,
  invite_code: &str,
  invite_ip: Option<String>
) {
  if inviter_id == 0 || invitee_id == 0 || inviter_id == invitee_id {
    return;
  }
  let _ = sqlx::query(
    r#"
    INSERT INTO referral_relations (
      inviter_id, invitee_id, invite_code, invite_ip, registered_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      inviter_id = VALUES(inviter_id),
      invite_code = VALUES(invite_code),
      invite_ip = COALESCE(VALUES(invite_ip), referral_relations.invite_ip),
      updated_at = CURRENT_TIMESTAMP
    "#
  )
  .bind(inviter_id)
  .bind(invitee_id)
  .bind(invite_code)
  .bind(invite_ip)
  .execute(&state.db)
  .await;
}

pub async fn ensure_user_invite_code(state: &AppState, user_id: i64) -> Result<String, String> {
  ensure_user_invite_code_with_length(state, user_id, 6).await
}

pub async fn ensure_user_invite_code_with_length(
  state: &AppState,
  user_id: i64,
  length: usize
) -> Result<String, String> {
  let row = sqlx::query("SELECT invite_code FROM users WHERE id = ?")
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  if let Some(row) = row {
    let existing = row.try_get::<Option<String>, _>("invite_code").unwrap_or(None);
    let normalized = existing.map(|value| normalize_invite_code(&value)).unwrap_or_default();
    if !normalized.is_empty() {
      return Ok(normalized);
    }
  }

  let code = generate_unique_invite_code(state, length).await?;
  sqlx::query("UPDATE users SET invite_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(&code)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  Ok(code)
}

pub async fn regenerate_invite_code(
  state: &AppState,
  user_id: i64,
  length: usize
) -> Result<String, String> {
  let code = generate_unique_invite_code(state, length).await?;
  sqlx::query(
    "UPDATE users SET invite_code = ?, invite_used = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  )
  .bind(&code)
  .bind(user_id)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(code)
}

async fn generate_unique_invite_code(state: &AppState, length: usize) -> Result<String, String> {
  for _ in 0..10 {
    let code: String = {
      let mut rng = rand::thread_rng();
      (0..length)
        .map(|_| {
          let idx = rng.gen_range(0..INVITE_CHARS.len());
          INVITE_CHARS.chars().nth(idx).unwrap_or('a')
        })
        .collect()
    };
    let exists = sqlx::query("SELECT id FROM users WHERE invite_code = ? LIMIT 1")
      .bind(&code)
      .fetch_optional(&state.db)
      .await
      .map_err(|err| err.to_string())?;
    if exists.is_none() {
      return Ok(code);
    }
  }
  let fallback = {
    let mut rng = rand::thread_rng();
    format!(
      "{}{}",
      chrono::Utc::now().timestamp_millis().to_string(),
      rng.gen_range(10..99)
    )
  };
  Ok(fallback.chars().take(length).collect())
}

pub struct InviterInfo {
  pub id: i64,
  pub invite_limit: i64,
  pub invite_used: i64
}

pub async fn insert_user_transaction(
  state: &AppState,
  user_id: i64,
  amount: f64,
  event_type: &str,
  source_type: &str,
  source_id: Option<i64>,
  trade_no: Option<&str>,
  remark: Option<&str>
) -> Result<(), String> {
  let fixed_amount = fix_money_precision(amount);
  if user_id == 0 || fixed_amount == 0.0 {
    return Ok(());
  }
  sqlx::query(
    r#"
    INSERT INTO rebate_transactions (
      inviter_id, referral_id, invitee_id, source_type, source_id, trade_no, event_type, amount, status, remark, created_at
    ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'confirmed', ?, CURRENT_TIMESTAMP)
    "#
  )
  .bind(user_id)
  .bind(source_type)
  .bind(source_id)
  .bind(trade_no)
  .bind(event_type)
  .bind(fixed_amount)
  .bind(remark)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub async fn award_rebate(
  state: &AppState,
  invitee_id: i64,
  amount: f64,
  source_type: &str,
  source_id: Option<i64>,
  trade_no: Option<&str>,
  event_type: Option<&str>
) -> Result<bool, String> {
  if invitee_id == 0 || amount <= 0.0 {
    return Ok(false);
  }

  let settings = fetch_rebate_settings(state).await?;
  if settings.rate <= 0.0 {
    return Ok(false);
  }

  let inviter_id = sqlx::query("SELECT invited_by FROM users WHERE id = ?")
    .bind(invitee_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?
    .and_then(|row| row.try_get::<Option<i64>, _>("invited_by").ok().flatten())
    .unwrap_or(0);
  if inviter_id <= 0 {
    return Ok(false);
  }

  let inviter_ok = sqlx::query(
    r#"
    SELECT id
    FROM users
    WHERE id = ?
      AND status = 1
      AND class > 0
      AND (class_expire_time IS NULL OR class_expire_time > CURRENT_TIMESTAMP)
    LIMIT 1
    "#
  )
  .bind(inviter_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?
  .is_some();
  if !inviter_ok {
    return Ok(false);
  }

  if let Some(source_id) = source_id {
    let exists = sqlx::query(
      "SELECT id FROM rebate_transactions WHERE source_type = ? AND source_id = ? AND amount > 0 LIMIT 1"
    )
    .bind(source_type)
    .bind(source_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| err.to_string())?;
    if exists.is_some() {
      return Ok(false);
    }
  }

  let mut relation = get_referral_relation(state, invitee_id).await?;
  if relation.is_none() {
    let invite_code = ensure_user_invite_code_with_length(state, inviter_id, 6).await?;
    save_referral_relation(state, inviter_id, invitee_id, &invite_code, None).await;
    relation = get_referral_relation(state, invitee_id).await?;
  }
  let relation = match relation {
    Some(value) => value,
    None => return Ok(false)
  };

  if settings.mode == "first_order" && relation.first_payment_id.is_some() {
    return Ok(false);
  }

  let rebate_amount = fix_money_precision(amount * settings.rate);
  if rebate_amount <= 0.0 {
    return Ok(false);
  }

  sqlx::query(
    r#"
    INSERT INTO rebate_transactions (
      inviter_id, referral_id, invitee_id, source_type, source_id, trade_no, event_type, amount, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP)
    "#
  )
  .bind(inviter_id)
  .bind(relation.id)
  .bind(invitee_id)
  .bind(source_type)
  .bind(source_id)
  .bind(trade_no)
  .bind(event_type.unwrap_or(source_type))
  .bind(rebate_amount)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  sqlx::query(
    r#"
    UPDATE users
    SET rebate_available = rebate_available + ?, rebate_total = rebate_total + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    "#
  )
  .bind(rebate_amount)
  .bind(rebate_amount)
  .bind(inviter_id)
  .execute(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  if relation.first_payment_id.is_none() {
    sqlx::query(
      r#"
      UPDATE referral_relations
      SET first_payment_type = ?,
          first_payment_id = ?,
          first_paid_at = CURRENT_TIMESTAMP,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
      WHERE invitee_id = ?
      "#
    )
    .bind(source_type)
    .bind(source_id)
    .bind(invitee_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  } else if relation.status != "active" {
    sqlx::query(
      r#"
      UPDATE referral_relations
      SET status = 'active',
          updated_at = CURRENT_TIMESTAMP
      WHERE invitee_id = ?
      "#
    )
    .bind(invitee_id)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  }

  Ok(true)
}

struct RebateSettings {
  rate: f64,
  mode: String
}

async fn fetch_rebate_settings(state: &AppState) -> Result<RebateSettings, String> {
  let rows = sqlx::query("SELECT `key`, `value` FROM system_configs WHERE `key` IN ('rebate_rate','rebate_mode')")
    .fetch_all(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  let mut rate = 0.0;
  let mut mode = "every_order".to_string();
  for row in rows {
    let key: String = row.try_get("key").unwrap_or_default();
    let value: String = row.try_get::<Option<String>, _>("value").unwrap_or(None).unwrap_or_default();
    match key.as_str() {
      "rebate_rate" => {
        let parsed = value.parse::<f64>().unwrap_or(0.0);
        rate = parsed.clamp(0.0, 1.0);
      }
      "rebate_mode" => {
        if value.trim() == "first_order" {
          mode = "first_order".to_string();
        }
      }
      _ => {}
    }
  }
  Ok(RebateSettings { rate, mode })
}

#[derive(Clone)]
struct ReferralRelation {
  id: i64,
  status: String,
  first_payment_id: Option<i64>
}

async fn get_referral_relation(
  state: &AppState,
  invitee_id: i64
) -> Result<Option<ReferralRelation>, String> {
  let row = sqlx::query(
    r#"
    SELECT id, status, first_payment_id
    FROM referral_relations
    WHERE invitee_id = ?
    LIMIT 1
    "#
  )
  .bind(invitee_id)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;
  Ok(row.map(|row| ReferralRelation {
    id: row.try_get::<i64, _>("id").unwrap_or(0),
    status: row.try_get::<Option<String>, _>("status").ok().flatten().unwrap_or_else(|| "pending".to_string()),
    first_payment_id: row.try_get::<Option<i64>, _>("first_payment_id").ok().flatten()
  }))
}

fn fix_money_precision(amount: f64) -> f64 {
  (amount * 100.0).round() / 100.0
}
