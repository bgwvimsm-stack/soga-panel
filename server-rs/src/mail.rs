use lettre::message::{header, Mailbox, Message, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};

use crate::config::AppEnv;

pub struct EmailService {
  env: AppEnv
}

impl EmailService {
  pub fn new(env: &AppEnv) -> Self {
    Self { env: env.clone() }
  }

  pub async fn send_mail(
    &self,
    to: &str,
    subject: &str,
    text: &str,
    html: Option<&str>
  ) -> Result<(), String> {
    let provider = self.resolve_provider();
    let from = self.get_from_address(provider);

    match provider {
      MailProvider::Resend => self.send_via_resend(&from, to, subject, text, html).await,
      MailProvider::Smtp => self.send_via_smtp(&from, to, subject, text, html).await,
      MailProvider::Sendgrid => self.send_via_sendgrid(&from, to, subject, text, html).await,
      MailProvider::None => Err(
        "未配置邮件发送提供商：请设置 MAIL_PROVIDER 为 resend/smtp/sendgrid，并补齐对应密钥".to_string()
      )
    }
  }

  fn resolve_provider(&self) -> MailProvider {
    let raw = self.read_env("MAIL_PROVIDER").unwrap_or_default().to_lowercase();
    if raw == "resend" {
      return MailProvider::Resend;
    }
    if raw == "smtp" {
      return MailProvider::Smtp;
    }
    if raw == "sendgrid" {
      return MailProvider::Sendgrid;
    }
    if raw == "none" {
      return MailProvider::None;
    }

    if self.read_env("RESEND_API_KEY").is_some() || self.read_env("MAIL_RESEND_KEY").is_some() {
      return MailProvider::Resend;
    }
    if self.get_smtp_host().is_some() {
      return MailProvider::Smtp;
    }
    if self.read_env("SENDGRID_API_KEY").is_some() {
      return MailProvider::Sendgrid;
    }
    MailProvider::None
  }

  fn get_from_address(&self, provider: MailProvider) -> String {
    if let Some(value) = self.read_env("MAIL_FROM") {
      return value;
    }
    if provider == MailProvider::Smtp {
      if let Some(value) = self.get_smtp_user() {
        return value;
      }
    }
    if provider == MailProvider::Resend {
      return "onboarding@resend.dev".to_string();
    }
    "no-reply@example.com".to_string()
  }

  fn get_smtp_host(&self) -> Option<String> {
    self.read_env("MAIL_SMTP_HOST").or_else(|| self.read_env("SMTP_HOST"))
  }

  fn get_smtp_port(&self) -> Option<u16> {
    self.env
      .mail_smtp_port
      .or(self.env.smtp_port)
  }

  fn get_smtp_user(&self) -> Option<String> {
    self.read_env("MAIL_SMTP_USER").or_else(|| self.read_env("SMTP_USER"))
  }

  fn get_smtp_pass(&self) -> Option<String> {
    self.read_env("MAIL_SMTP_PASS").or_else(|| self.read_env("SMTP_PASS"))
  }

  fn read_env(&self, key: &str) -> Option<String> {
    match key {
      "MAIL_PROVIDER" => self.env.mail_provider.clone(),
      "MAIL_FROM" => self.env.mail_from.clone(),
      "MAIL_RESEND_KEY" => self.env.mail_resend_key.clone(),
      "RESEND_API_KEY" => self.env.resend_api_key.clone(),
      "SENDGRID_API_KEY" => self.env.sendgrid_api_key.clone(),
      "MAIL_SMTP_HOST" => self.env.mail_smtp_host.clone(),
      "SMTP_HOST" => self.env.smtp_host.clone(),
      "MAIL_SMTP_USER" => self.env.mail_smtp_user.clone(),
      "SMTP_USER" => self.env.smtp_user.clone(),
      "MAIL_SMTP_PASS" => self.env.mail_smtp_pass.clone(),
      "SMTP_PASS" => self.env.smtp_pass.clone(),
      "SMTP_SECURE" => self.env.smtp_secure.clone(),
      "SMTP_STARTTLS" => self.env.smtp_starttls.clone(),
      "SMTP_AUTH_TYPE" => self.env.smtp_auth_type.clone(),
      "MAIL_SMTP_DRIVER" => self.env.mail_smtp_driver.clone(),
      "SMTP_DRIVER" => self.env.smtp_driver.clone(),
      _ => None
    }
    .and_then(|value| {
      let trimmed = value.trim().to_string();
      if trimmed.is_empty() { None } else { Some(trimmed) }
    })
  }

  async fn send_via_resend(
    &self,
    from: &str,
    to: &str,
    subject: &str,
    text: &str,
    html: Option<&str>
  ) -> Result<(), String> {
    let api_key = self.read_env("RESEND_API_KEY").or_else(|| self.read_env("MAIL_RESEND_KEY"));
    let api_key = api_key.ok_or_else(|| "未配置 RESEND_API_KEY（或 MAIL_RESEND_KEY），无法发送邮件".to_string())?;
    self.assert_resend_from_domain(from)?;

    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
      "from": from,
      "to": [to],
      "subject": subject,
      "text": text
    });
    if let Some(html) = html {
      payload["html"] = serde_json::json!(html);
    }

    let resp = client
      .post("https://api.resend.com/emails")
      .header("Authorization", format!("Bearer {api_key}"))
      .json(&payload)
      .send()
      .await
      .map_err(|err| err.to_string())?;

    if !resp.status().is_success() {
      let body = resp.text().await.unwrap_or_default();
      return Err(format!("Resend 发送失败: {}", body));
    }
    Ok(())
  }

  async fn send_via_sendgrid(
    &self,
    from: &str,
    to: &str,
    subject: &str,
    text: &str,
    html: Option<&str>
  ) -> Result<(), String> {
    let api_key = self
      .read_env("SENDGRID_API_KEY")
      .ok_or_else(|| "未配置 SENDGRID_API_KEY，无法发送邮件".to_string())?;

    let mut content = vec![serde_json::json!({ "type": "text/plain", "value": text })];
    if let Some(html) = html {
      content.push(serde_json::json!({ "type": "text/html", "value": html }));
    }

    let body = serde_json::json!({
      "personalizations": [{
        "to": [{ "email": to }],
        "subject": subject
      }],
      "from": { "email": from, "name": from },
      "content": content
    });

    let resp = reqwest::Client::new()
      .post("https://api.sendgrid.com/v3/mail/send")
      .header("Authorization", format!("Bearer {api_key}"))
      .header("Content-Type", "application/json")
      .json(&body)
      .send()
      .await
      .map_err(|err| err.to_string())?;

    if resp.status().as_u16() >= 400 {
      let status = resp.status();
      let error_text = resp.text().await.unwrap_or_default();
      return Err(format!("SendGrid API 调用失败: {} {}", status, error_text));
    }
    Ok(())
  }

  async fn send_via_smtp(
    &self,
    from: &str,
    to: &str,
    subject: &str,
    text: &str,
    html: Option<&str>
  ) -> Result<(), String> {
    let host = self
      .get_smtp_host()
      .ok_or_else(|| "未配置 SMTP_HOST（或 MAIL_SMTP_HOST），无法发送邮件".to_string())?;
    let secure = matches!(self.read_env("SMTP_SECURE").as_deref(), Some("true") | Some("1"));
    let port = self.get_smtp_port().unwrap_or(if secure { 465 } else { 587 });
    let require_tls = match self.read_env("SMTP_STARTTLS") {
      Some(value) => value == "true" || value == "1",
      None => !secure
    };

    let user = self.get_smtp_user();
    let pass = self.get_smtp_pass();
    if is_gmail_host(&host) && (user.is_none() || pass.is_none()) {
      return Err(
        "Gmail SMTP 需要配置 SMTP_USER/SMTP_PASS（建议使用应用专用密码），否则无法发送邮件".to_string()
      );
    }

    let email = build_email(from, to, subject, text, html)?;
    let credentials = user
      .and_then(|user| pass.clone().map(|pass| Credentials::new(user, pass)));

    let mailer = build_smtp_transport(&host, port, secure, require_tls, credentials)?;
    mailer
      .send(email)
      .await
      .map_err(|err| wrap_smtp_error(&host, err.to_string()))
      .map(|_| ())
  }

  fn assert_resend_from_domain(&self, from: &str) -> Result<(), String> {
    let email = extract_email_address(from).ok_or_else(|| "MAIL_FROM 格式不正确，需为 email 或 `Name <email>`".to_string())?;
    let domain = email.split('@').nth(1).unwrap_or("").to_lowercase();
    if domain.is_empty() {
      return Err("MAIL_FROM 格式不正确，缺少域名部分".to_string());
    }
    if domain == "gmail.com" || domain == "googlemail.com" {
      return Err(
        "Resend 不支持使用 gmail.com 作为发件人域名；请将 MAIL_FROM 改为已在 Resend 验证的自有域名邮箱，或测试用 onboarding@resend.dev"
          .to_string()
      );
    }
    Ok(())
  }
}

#[derive(Copy, Clone, PartialEq)]
enum MailProvider {
  Resend,
  Smtp,
  Sendgrid,
  None
}

fn extract_email_address(from: &str) -> Option<String> {
  let trimmed = from.trim();
  if trimmed.is_empty() {
    return None;
  }
  let candidate = if let Some(start) = trimmed.find('<') {
    let end = trimmed.find('>').unwrap_or(trimmed.len());
    trimmed[start + 1..end].trim()
  } else {
    trimmed
  };
  if candidate.is_empty() {
    return None;
  }
  if !candidate.contains('@') || !candidate.contains('.') {
    return None;
  }
  Some(candidate.to_string())
}

fn build_email(
  from: &str,
  to: &str,
  subject: &str,
  text: &str,
  html: Option<&str>
) -> Result<Message, String> {
  let from_mailbox: Mailbox = from.parse::<Mailbox>().map_err(|err| err.to_string())?;
  let to_mailbox: Mailbox = to.parse::<Mailbox>().map_err(|err| err.to_string())?;
  let builder = Message::builder()
    .from(from_mailbox)
    .to(to_mailbox)
    .subject(subject);

  let text_part = SinglePart::builder()
    .header(header::ContentType::TEXT_PLAIN)
    .body(text.to_string());

  let message = if let Some(html) = html {
    let html_part = SinglePart::builder()
      .header(header::ContentType::TEXT_HTML)
      .body(html.to_string());
    builder
      .multipart(MultiPart::alternative().singlepart(text_part).singlepart(html_part))
      .map_err(|err| err.to_string())?
  } else {
    builder.singlepart(text_part).map_err(|err| err.to_string())?
  };

  Ok(message)
}

fn build_smtp_transport(
  host: &str,
  port: u16,
  secure: bool,
  require_tls: bool,
  credentials: Option<Credentials>
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
  let transport = if secure {
    let tls = TlsParameters::new(host.to_string()).map_err(|err| err.to_string())?;
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host);
    builder = builder.port(port).tls(Tls::Wrapper(tls));
    if let Some(creds) = credentials {
      builder = builder.credentials(creds);
    }
    builder.build()
  } else if require_tls {
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
      .map_err(|err| err.to_string())?
      .port(port);
    if let Some(creds) = credentials {
      builder = builder.credentials(creds);
    }
    builder.build()
  } else {
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).port(port);
    if let Some(creds) = credentials {
      builder = builder.credentials(creds);
    }
    builder.build()
  };
  Ok(transport)
}

fn is_gmail_host(host: &str) -> bool {
  let host = host.to_lowercase();
  host == "smtp.gmail.com" || host == "smtp.googlemail.com"
}

fn wrap_smtp_error(host: &str, message: String) -> String {
  let is_gmail = is_gmail_host(host);
  let is_bad_credentials = message.contains("535")
    || message.contains("BadCredentials")
    || message.contains("Username and Password not accepted");
  if is_gmail && is_bad_credentials {
    return [
      "Gmail SMTP 鉴权失败（535 5.7.8 BadCredentials）。",
      "请确认：",
      "1) SMTP_USER 使用完整 Gmail 地址；",
      "2) SMTP_PASS 使用“应用专用密码”（需开启两步验证后生成），不要用账号登录密码；",
      "3) 建议使用 smtp.gmail.com:465（SMTP_SECURE=true）或 587（SMTP_STARTTLS=true）。",
      &format!("原始错误：{message}")
    ]
    .join("\n");
  }
  message
}
