use chrono::{Datelike, Duration, NaiveDateTime, Utc};
use reqwest::Url;
use serde_json::json;
use sqlx::Row;

use crate::cache::cache_delete_by_prefix;
use crate::state::AppState;

#[derive(Clone, Copy)]
pub enum JobKind {
  UserExpirationCheck,
  DailyTasks,
  SubscriptionCleanup
}

impl JobKind {
  pub fn from_name(name: &str) -> Option<Self> {
    match name.trim() {
      "userExpirationCheck" | "user-expiration-check" => Some(Self::UserExpirationCheck),
      "dailyTasks" | "daily-tasks" | "daily" => Some(Self::DailyTasks),
      "subscriptionCleanup" | "subscription-cleanup" => Some(Self::SubscriptionCleanup),
      _ => None
    }
  }
}

pub fn job_descriptions() -> Vec<(&'static str, &'static str)> {
  vec![
    ("userExpirationCheck", "检查账号/等级过期并重置"),
    ("dailyTasks", "每日流量汇总、Bark 通知、日/月重置、节点状态清理"),
    ("subscriptionCleanup", "清理 7 天前订阅记录并刷新订阅缓存")
  ]
}

pub async fn run_job(state: &AppState, job: JobKind) -> Result<(), String> {
  match job {
    JobKind::UserExpirationCheck => run_user_expiration_check(state).await,
    JobKind::DailyTasks => run_daily_tasks(state).await,
    JobKind::SubscriptionCleanup => run_subscription_cleanup(state).await
  }
}

async fn run_user_expiration_check(state: &AppState) -> Result<(), String> {
  let expired_accounts = sqlx::query(
    r#"
    SELECT id
    FROM users
    WHERE expire_time IS NOT NULL
      AND expire_time <= CURRENT_TIMESTAMP
      AND status = 1
    "#
  )
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let mut expired_account_ids: Vec<i64> = expired_accounts
    .iter()
    .filter_map(|row| row.try_get::<Option<i64>, _>("id").ok().flatten())
    .filter(|id| *id > 0)
    .collect();
  expired_account_ids.sort_unstable();
  expired_account_ids.dedup();

  if !expired_account_ids.is_empty() {
    let placeholders = expired_account_ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
    let sql = format!(
      "UPDATE users SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})"
    );
    let mut query = sqlx::query(&sql);
    for id in &expired_account_ids {
      query = query.bind(id);
    }
    query.execute(&state.db).await.map_err(|err| err.to_string())?;
    for id in &expired_account_ids {
      cache_delete_by_prefix(state, &format!("user_{id}_")).await;
    }
  }

  let expired_levels = sqlx::query(
    r#"
    SELECT id, email, username, class, class_expire_time
    FROM users
    WHERE class_expire_time IS NOT NULL
      AND class_expire_time <= CURRENT_TIMESTAMP
      AND class > 0
      AND status = 1
    "#
  )
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let mut expired_level_ids: Vec<i64> = Vec::new();
  for row in &expired_levels {
    let user_id = row.try_get::<Option<i64>, _>("id").ok().flatten().unwrap_or(0);
    if user_id <= 0 {
      continue;
    }
    expired_level_ids.push(user_id);
  }
  expired_level_ids.sort_unstable();
  expired_level_ids.dedup();

  if !expired_level_ids.is_empty() {
    let placeholders = expired_level_ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
    let sql = format!(
      r#"
      UPDATE users
      SET class = 0,
          class_expire_time = NULL,
          upload_traffic = 0,
          download_traffic = 0,
          upload_today = 0,
          download_today = 0,
          transfer_total = 0,
          transfer_enable = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN ({placeholders})
      "#
    );
    let mut query = sqlx::query(&sql);
    for id in &expired_level_ids {
      query = query.bind(id);
    }
    query.execute(&state.db).await.map_err(|err| err.to_string())?;
    for id in &expired_level_ids {
      cache_delete_by_prefix(state, &format!("user_{id}_")).await;
    }
  }

  println!(
    "[job] userExpirationCheck done: expired_accounts={}, expired_levels={}",
    expired_account_ids.len(),
    expired_level_ids.len()
  );
  Ok(())
}

async fn run_daily_tasks(state: &AppState) -> Result<(), String> {
  let now = Utc::now() + Duration::hours(8);
  let date = (now.date_naive() - Duration::days(1))
    .format("%Y-%m-%d")
    .to_string();

  let agg = aggregate_traffic_for_date(state, &date).await?;
  println!(
    "[job] daily traffic aggregation done: {date} users={} total_users={} total_upload={} total_download={} total_traffic={}",
    agg.user_count,
    agg.total_users,
    agg.total_upload,
    agg.total_download,
    agg.total_traffic
  );

  let bark_result = send_daily_bark_notifications(state).await;
  println!(
    "[job] daily Bark notifications: success={}, sent={}, failed={}",
    bark_result.success, bark_result.sent_count, bark_result.failed_count
  );

  let _ = sqlx::query(
    r#"
    UPDATE users
    SET upload_today = 0,
        download_today = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE upload_today > 0 OR download_today > 0
    "#
  )
  .execute(&state.db)
  .await;
  println!("[job] daily transfer reset done");

  try_monthly_reset(state).await;

  let _ = sqlx::query("DELETE FROM node_status").execute(&state.db).await;
  println!("[job] node status cleanup done");

  Ok(())
}

async fn run_subscription_cleanup(state: &AppState) -> Result<(), String> {
  let now = Utc::now() + Duration::hours(8);
  let cutoff = now - Duration::days(7);
  let cutoff_str = cutoff.format("%Y-%m-%d %H:%M:%S").to_string();

  let result = sqlx::query("DELETE FROM subscriptions WHERE request_time < ?")
    .bind(cutoff_str)
    .execute(&state.db)
    .await
    .map_err(|err| err.to_string())?;
  cache_delete_by_prefix(state, "sub_token_").await;

  println!(
    "[job] subscriptionCleanup done: deleted_rows={}",
    result.rows_affected()
  );
  Ok(())
}

async fn aggregate_traffic_for_date(state: &AppState, record_date: &str) -> Result<AggregateResult, String> {
  let user_count = aggregate_daily_traffic(state, record_date).await?;
  let system_stats = aggregate_system_traffic(state, record_date).await?;
  Ok(AggregateResult {
    user_count,
    total_users: system_stats.total_users,
    total_upload: system_stats.total_upload,
    total_download: system_stats.total_download,
    total_traffic: system_stats.total_traffic
  })
}

async fn aggregate_daily_traffic(state: &AppState, record_date: &str) -> Result<i64, String> {
  let rows = sqlx::query(
    r#"
    SELECT user_id,
           COALESCE(SUM(actual_upload_traffic), 0) as upload,
           COALESCE(SUM(actual_download_traffic), 0) as download,
           COALESCE(SUM(actual_traffic), 0) as total
    FROM traffic_logs
    WHERE date = ?
    GROUP BY user_id
    "#
  )
  .bind(record_date)
  .fetch_all(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  for row in &rows {
    let user_id = row.try_get::<Option<i64>, _>("user_id").ok().flatten().unwrap_or(0);
    let upload = row.try_get::<Option<i64>, _>("upload").unwrap_or(Some(0)).unwrap_or(0);
    let download = row
      .try_get::<Option<i64>, _>("download")
      .unwrap_or(Some(0))
      .unwrap_or(0);
    let total = row.try_get::<Option<i64>, _>("total").unwrap_or(Some(0)).unwrap_or(0);

    let _ = sqlx::query(
      r#"
      INSERT INTO daily_traffic (user_id, record_date, upload_traffic, download_traffic, total_traffic, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        upload_traffic = VALUES(upload_traffic),
        download_traffic = VALUES(download_traffic),
        total_traffic = VALUES(total_traffic)
      "#
    )
    .bind(user_id)
    .bind(record_date)
    .bind(upload)
    .bind(download)
    .bind(total)
    .execute(&state.db)
    .await;
  }

  Ok(rows.len() as i64)
}

async fn aggregate_system_traffic(state: &AppState, record_date: &str) -> Result<SystemTrafficStats, String> {
  let row = sqlx::query(
    r#"
    SELECT
      COUNT(DISTINCT user_id) as users,
      COALESCE(SUM(actual_upload_traffic), 0) as total_upload,
      COALESCE(SUM(actual_download_traffic), 0) as total_download,
      COALESCE(SUM(actual_traffic), 0) as total_traffic
    FROM traffic_logs
    WHERE date = ?
    "#
  )
  .bind(record_date)
  .fetch_optional(&state.db)
  .await
  .map_err(|err| err.to_string())?;

  let total_users = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("users").ok().flatten())
    .unwrap_or(0);
  let total_upload = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_upload").ok().flatten())
    .unwrap_or(0);
  let total_download = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_download").ok().flatten())
    .unwrap_or(0);
  let total_traffic = row
    .as_ref()
    .and_then(|row| row.try_get::<Option<i64>, _>("total_traffic").ok().flatten())
    .unwrap_or(0);

  let _ = sqlx::query(
    r#"
    INSERT INTO system_traffic_summary (record_date, total_users, total_upload, total_download, total_traffic, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      total_users = VALUES(total_users),
      total_upload = VALUES(total_upload),
      total_download = VALUES(total_download),
      total_traffic = VALUES(total_traffic)
    "#
  )
  .bind(record_date)
  .bind(total_users)
  .bind(total_upload)
  .bind(total_download)
  .bind(total_traffic)
  .execute(&state.db)
  .await;

  Ok(SystemTrafficStats {
    total_users,
    total_upload,
    total_download,
    total_traffic
  })
}

async fn try_monthly_reset(state: &AppState) {
  let row = sqlx::query("SELECT `value` FROM system_configs WHERE `key` = 'traffic_reset_day'")
    .fetch_optional(&state.db)
    .await;
  let reset_day = match row {
    Ok(value) => value
      .and_then(|row| row.try_get::<Option<String>, _>("value").ok().flatten())
      .and_then(|value| value.parse::<i64>().ok())
      .unwrap_or(0),
    Err(_) => 0
  };

  if reset_day <= 0 || reset_day > 31 {
    return;
  }

  let beijing = Utc::now() + Duration::hours(8);
  let current_day = beijing.day() as i64;
  if current_day != reset_day {
    return;
  }

  let _ = sqlx::query(
    r#"
    UPDATE users
    SET transfer_total = 0,
        upload_traffic = 0,
        download_traffic = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE transfer_enable > 0
    "#
  )
  .execute(&state.db)
  .await;
  println!("[job] monthly traffic reset done (day={reset_day})");
}

async fn send_daily_bark_notifications(state: &AppState) -> BarkResult {
  let mut site_name = state.env.site_name.clone().unwrap_or_else(|| "Soga Panel".to_string());
  let mut site_url = state.env.site_url.clone().unwrap_or_default();

  let config_rows = sqlx::query(
    "SELECT `key`, `value` FROM system_configs WHERE `key` IN ('site_name','site_url')"
  )
  .fetch_all(&state.db)
  .await
  .unwrap_or_default();
  for row in config_rows {
    let key = row.try_get::<Option<String>, _>("key").ok().flatten().unwrap_or_default();
    let value = row.try_get::<Option<String>, _>("value").ok().flatten().unwrap_or_default();
    if value.is_empty() {
      continue;
    }
    if key == "site_name" {
      site_name = value.clone();
    } else if key == "site_url" {
      site_url = value;
    }
  }

  let users = sqlx::query(
    r#"
    SELECT id, username, email, bark_key, upload_today, download_today,
           transfer_enable, transfer_total, class_expire_time, class
    FROM users
    WHERE bark_enabled = 1
      AND bark_key IS NOT NULL
      AND bark_key != ''
      AND class > 0
    ORDER BY id
    "#
  )
  .fetch_all(&state.db)
  .await
  .unwrap_or_default();

  if users.is_empty() {
    return BarkResult::empty();
  }

  let client = reqwest::Client::new();
  let mut sent = 0;
  let mut failed = 0;

  for row in users {
    match send_bark_notification(state, &client, row, &site_name, &site_url).await {
      Ok(true) => sent += 1,
      _ => failed += 1
    }
  }

  BarkResult {
    success: true,
    sent_count: sent,
    failed_count: failed
  }
}

async fn send_bark_notification(
  state: &AppState,
  client: &reqwest::Client,
  row: sqlx::mysql::MySqlRow,
  site_name: &str,
  site_url: &str
) -> Result<bool, String> {
  let user_id = row.try_get::<Option<i64>, _>("id").ok().flatten().unwrap_or(0);
  let username = row
    .try_get::<Option<String>, _>("username")
    .ok()
    .flatten()
    .unwrap_or_default();
  let bark_key = row
    .try_get::<Option<String>, _>("bark_key")
    .ok()
    .flatten()
    .unwrap_or_default();
  if bark_key.is_empty() {
    return Ok(false);
  }

  let upload_today = row
    .try_get::<Option<i64>, _>("upload_today")
    .unwrap_or(Some(0))
    .unwrap_or(0);
  let download_today = row
    .try_get::<Option<i64>, _>("download_today")
    .unwrap_or(Some(0))
    .unwrap_or(0);
  let transfer_enable = row
    .try_get::<Option<i64>, _>("transfer_enable")
    .unwrap_or(Some(0))
    .unwrap_or(0);
  let transfer_total = row
    .try_get::<Option<i64>, _>("transfer_total")
    .unwrap_or(Some(0))
    .unwrap_or(0);
  let class_expire_time = row
    .try_get::<Option<NaiveDateTime>, _>("class_expire_time")
    .ok()
    .flatten();

  let today_usage = upload_today + download_today;
  let today_total_traffic = format_bytes(today_usage);
  let remain_traffic = format_bytes((transfer_enable - transfer_total).max(0));

  let class_expire_text = match class_expire_time {
    Some(value) => value.format("%Y-%m-%d %H:%M").to_string(),
    None => "永不过期".to_string()
  };

  let title = "每日流量使用情况";
  let body = if today_usage > 0 {
    format!(
      "{username}，您好！\n\n您今日已用流量为 {today_total_traffic}\n剩余流量为 {remain_traffic}\n\n您的等级到期时间为 {class_expire_text}\n\n祝您使用愉快！"
    )
  } else {
    format!(
      "{username}，您好！\n\n今日您未使用流量\n剩余流量为 {remain_traffic}\n\n您的等级到期时间为 {class_expire_text}\n\n祝您使用愉快！"
    )
  };

  let mut endpoint = "https://api.day.app".to_string();
  let mut key_path = bark_key.clone();
  if bark_key.starts_with("http://") || bark_key.starts_with("https://") {
    if let Ok(url) = Url::parse(&bark_key) {
      if let Some(host) = url.host_str() {
        endpoint = format!("{}://{}", url.scheme(), host);
      }
      let path = url.path().trim_start_matches('/');
      key_path = if path.is_empty() { "push".to_string() } else { path.to_string() };
    }
  }

  let mut payload = json!({
    "title": title,
    "body": body,
    "badge": 1,
    "sound": "default",
    "action": "none",
    "group": if site_name.is_empty() { "流量管理" } else { site_name }
  });
  if !site_url.is_empty() {
    let icon = format!("{}/favicon.ico", site_url.trim_end_matches('/'));
    payload["icon"] = json!(icon);
    payload["url"] = json!(site_url);
  }

  let endpoint = endpoint.trim_end_matches('/');
  let url = format!("{}/{}", endpoint, key_path.trim_start_matches('/'));

  let resp = client
    .post(url)
    .header("User-Agent", "Soga-Panel-Server/1.0")
    .json(&payload)
    .send()
    .await
    .map_err(|err| err.to_string())?;

  if !resp.status().is_success() {
    let _ = sqlx::query(
      "UPDATE users SET bark_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .bind(user_id)
    .execute(&state.db)
    .await;
    return Ok(false);
  }

  Ok(true)
}

fn format_bytes(bytes: i64) -> String {
  if bytes <= 0 {
    return "0 B".to_string();
  }
  let sizes = ["B", "KB", "MB", "GB", "TB"];
  let mut value = bytes as f64;
  let mut idx = 0;
  while value >= 1024.0 && idx < sizes.len() - 1 {
    value /= 1024.0;
    idx += 1;
  }
  format!("{:.2} {}", value, sizes[idx])
}

#[derive(Debug)]
struct AggregateResult {
  user_count: i64,
  total_users: i64,
  total_upload: i64,
  total_download: i64,
  total_traffic: i64
}

struct SystemTrafficStats {
  total_users: i64,
  total_upload: i64,
  total_download: i64,
  total_traffic: i64
}

struct BarkResult {
  success: bool,
  sent_count: i64,
  failed_count: i64
}

impl BarkResult {
  fn empty() -> Self {
    Self {
      success: true,
      sent_count: 0,
      failed_count: 0
    }
  }
}
