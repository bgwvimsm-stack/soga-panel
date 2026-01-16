use std::env;
use std::net::IpAddr;

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct AppEnv {
  pub listen: IpAddr,
  pub port: u16,
  pub db_host: String,
  pub db_port: u16,
  pub db_user: String,
  pub db_password: String,
  pub db_name: String,
  pub db_connection_limit: u32,
  pub db_timezone: String,
  pub redis_host: Option<String>,
  pub redis_port: u16,
  pub redis_password: Option<String>,
  pub redis_db: i64,
  pub redis_prefix: String,
  pub mail_provider: Option<String>,
  pub mail_from: Option<String>,
  pub mail_resend_key: Option<String>,
  pub resend_api_key: Option<String>,
  pub sendgrid_api_key: Option<String>,
  pub mail_smtp_host: Option<String>,
  pub mail_smtp_port: Option<u16>,
  pub mail_smtp_user: Option<String>,
  pub mail_smtp_pass: Option<String>,
  pub mail_smtp_driver: Option<String>,
  pub smtp_host: Option<String>,
  pub smtp_port: Option<u16>,
  pub smtp_user: Option<String>,
  pub smtp_pass: Option<String>,
  pub smtp_secure: Option<String>,
  pub smtp_starttls: Option<String>,
  pub smtp_auth_type: Option<String>,
  pub smtp_driver: Option<String>,
  pub google_client_id: Option<String>,
  pub google_client_secret: Option<String>,
  pub google_redirect_uri: Option<String>,
  pub github_client_id: Option<String>,
  pub github_client_secret: Option<String>,
  pub github_redirect_uri: Option<String>,
  pub jwt_secret: Option<String>,
  pub two_factor_secret_key: Option<String>,
  pub turnstile_secret_key: Option<String>,
  pub node_api_key: Option<String>,
  pub epay_key: Option<String>,
  pub epay_pid: Option<String>,
  pub epay_api_url: Option<String>,
  pub epay_notify_url: Option<String>,
  pub epay_return_url: Option<String>,
  pub payment_alipay: Option<String>,
  pub payment_wxpay: Option<String>,
  pub payment_crypto: Option<String>,
  pub epusdt_token: Option<String>,
  pub epusdt_api_url: Option<String>,
  pub epusdt_notify_url: Option<String>,
  pub epusdt_return_url: Option<String>,
  pub epusdt_trade_type: Option<String>,
  pub epusdt_timeout: Option<u64>,
  pub site_name: Option<String>,
  pub site_url: Option<String>,
  pub mail_verification_expire_minutes: Option<String>,
  pub mail_verification_cooldown_seconds: Option<String>,
  pub mail_verification_daily_limit: Option<String>,
  pub mail_verification_ip_hourly_limit: Option<String>,
  pub mail_verification_attempt_limit: Option<String>,
  pub passkey_rp_id: Option<String>,
  pub passkey_origin: Option<String>
}

pub fn apply_dotenv(path: Option<&str>) -> Result<(), String> {
  if let Some(custom_path) = path {
    dotenvy::from_path(custom_path).map_err(|err| err.to_string())?;
    return Ok(());
  }
  let _ = dotenvy::from_path("../server/.env");
  let _ = dotenvy::dotenv();
  Ok(())
}

fn get_env(key: &str) -> Option<String> {
  env::var(key).ok().and_then(|value| {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed)
    }
  })
}

fn parse_u16(key: &str, default: u16) -> Result<u16, String> {
  match get_env(key) {
    Some(value) => value
      .parse::<u16>()
      .map_err(|_| format!("{key} must be a positive integer")),
    None => Ok(default)
  }
}

fn parse_u32(key: &str, default: u32) -> Result<u32, String> {
  match get_env(key) {
    Some(value) => value
      .parse::<u32>()
      .map_err(|_| format!("{key} must be a positive integer")),
    None => Ok(default)
  }
}

fn parse_i64(key: &str, default: i64) -> Result<i64, String> {
  match get_env(key) {
    Some(value) => value
      .parse::<i64>()
      .map_err(|_| format!("{key} must be an integer")),
    None => Ok(default)
  }
}

fn parse_u64_opt(key: &str) -> Result<Option<u64>, String> {
  match get_env(key) {
    Some(value) => value
      .parse::<u64>()
      .map(Some)
      .map_err(|_| format!("{key} must be a positive integer")),
    None => Ok(None)
  }
}

fn parse_ip(key: &str, default: &str) -> Result<IpAddr, String> {
  match get_env(key) {
    Some(value) => value
      .parse::<IpAddr>()
      .map_err(|_| format!("{key} must be a valid IP address")),
    None => default
      .parse::<IpAddr>()
      .map_err(|_| format!("{key} default must be a valid IP address"))
  }
}

pub fn load_env() -> Result<AppEnv, String> {
  let listen = parse_ip("LISTEN", "127.0.0.1")?;
  let port = parse_u16("PORT", 18787)?;
  let db_host = get_env("DB_HOST").ok_or_else(|| "DB_HOST is required".to_string())?;
  let db_port = parse_u16("DB_PORT", 3306)?;
  let db_user = get_env("DB_USER").ok_or_else(|| "DB_USER is required".to_string())?;
  let db_password = get_env("DB_PASSWORD").unwrap_or_default();
  let db_name = get_env("DB_NAME").ok_or_else(|| "DB_NAME is required".to_string())?;
  let db_connection_limit = parse_u32("DB_CONNECTION_LIMIT", 10)?;
  let db_timezone = get_env("DB_TIMEZONE").unwrap_or_else(|| "+08:00".to_string());

  let redis_host = get_env("REDIS_HOST");
  let redis_port = parse_u16("REDIS_PORT", 6379)?;
  let redis_password = get_env("REDIS_PASSWORD");
  let redis_db = parse_i64("REDIS_DB", 0)?;
  let redis_prefix = get_env("REDIS_PREFIX").unwrap_or_else(|| "soga:".to_string());

  Ok(AppEnv {
    listen,
    port,
    db_host,
    db_port,
    db_user,
    db_password,
    db_name,
    db_connection_limit,
    db_timezone,
    redis_host,
    redis_port,
    redis_password,
    redis_db,
    redis_prefix,
    mail_provider: get_env("MAIL_PROVIDER"),
    mail_from: get_env("MAIL_FROM"),
    mail_resend_key: get_env("MAIL_RESEND_KEY"),
    resend_api_key: get_env("RESEND_API_KEY"),
    sendgrid_api_key: get_env("SENDGRID_API_KEY"),
    mail_smtp_host: get_env("MAIL_SMTP_HOST"),
    mail_smtp_port: get_env("MAIL_SMTP_PORT").and_then(|value| value.parse::<u16>().ok()),
    mail_smtp_user: get_env("MAIL_SMTP_USER"),
    mail_smtp_pass: get_env("MAIL_SMTP_PASS"),
    mail_smtp_driver: get_env("MAIL_SMTP_DRIVER"),
    smtp_host: get_env("SMTP_HOST"),
    smtp_port: get_env("SMTP_PORT").and_then(|value| value.parse::<u16>().ok()),
    smtp_user: get_env("SMTP_USER"),
    smtp_pass: get_env("SMTP_PASS"),
    smtp_secure: get_env("SMTP_SECURE"),
    smtp_starttls: get_env("SMTP_STARTTLS"),
    smtp_auth_type: get_env("SMTP_AUTH_TYPE"),
    smtp_driver: get_env("SMTP_DRIVER"),
    google_client_id: get_env("GOOGLE_CLIENT_ID"),
    google_client_secret: get_env("GOOGLE_CLIENT_SECRET"),
    google_redirect_uri: get_env("GOOGLE_REDIRECT_URI"),
    github_client_id: get_env("GITHUB_CLIENT_ID"),
    github_client_secret: get_env("GITHUB_CLIENT_SECRET"),
    github_redirect_uri: get_env("GITHUB_REDIRECT_URI"),
    jwt_secret: get_env("JWT_SECRET"),
    two_factor_secret_key: get_env("TWO_FACTOR_SECRET_KEY"),
    turnstile_secret_key: get_env("TURNSTILE_SECRET_KEY"),
    node_api_key: get_env("NODE_API_KEY"),
    epay_key: get_env("EPAY_KEY"),
    epay_pid: get_env("EPAY_PID"),
    epay_api_url: get_env("EPAY_API_URL"),
    epay_notify_url: get_env("EPAY_NOTIFY_URL"),
    epay_return_url: get_env("EPAY_RETURN_URL"),
    payment_alipay: get_env("PAYMENT_ALIPAY"),
    payment_wxpay: get_env("PAYMENT_WXPAY"),
    payment_crypto: get_env("PAYMENT_CRYPTO"),
    epusdt_token: get_env("EPUSDT_TOKEN"),
    epusdt_api_url: get_env("EPUSDT_API_URL"),
    epusdt_notify_url: get_env("EPUSDT_NOTIFY_URL"),
    epusdt_return_url: get_env("EPUSDT_RETURN_URL"),
    epusdt_trade_type: get_env("EPUSDT_TRADE_TYPE"),
    epusdt_timeout: parse_u64_opt("EPUSDT_TIMEOUT")?,
    site_name: get_env("SITE_NAME"),
    site_url: get_env("SITE_URL"),
    mail_verification_expire_minutes: get_env("MAIL_VERIFICATION_EXPIRE_MINUTES"),
    mail_verification_cooldown_seconds: get_env("MAIL_VERIFICATION_COOLDOWN_SECONDS"),
    mail_verification_daily_limit: get_env("MAIL_VERIFICATION_DAILY_LIMIT"),
    mail_verification_ip_hourly_limit: get_env("MAIL_VERIFICATION_IP_HOURLY_LIMIT"),
    mail_verification_attempt_limit: get_env("MAIL_VERIFICATION_ATTEMPT_LIMIT"),
    passkey_rp_id: get_env("PASSKEY_RP_ID"),
    passkey_origin: get_env("PASSKEY_ORIGIN")
  })
}
