pub fn build_email_subject(purpose: &str, site_name: &str) -> String {
  let site = if site_name.is_empty() { "Soga Panel" } else { site_name };
  match purpose {
    "password_reset" => format!("您的 {site} 密码重置验证码"),
    "register" => format!("您的 {site} 注册验证码"),
    _ => format!("您的 {site} 验证码")
  }
}

pub fn build_email_text(purpose: &str, code: &str, expire_minutes: i64, site_name: &str) -> String {
  let site = if site_name.is_empty() { "Soga Panel" } else { site_name };
  let minutes = if expire_minutes > 0 { expire_minutes } else { 10 };

  match purpose {
    "password_reset" => format!(
      "您好，我们收到了您的密码重置请求。您的验证码是 {code}，有效期 {minutes} 分钟。如非本人操作请忽略。"
    ),
    "register" => format!(
      "您好，您的验证码是 {code}，有效期 {minutes} 分钟。如非本人操作请忽略。"
    ),
    _ => format!(
      "您好，您的 {site} 验证码是 {code}，有效期 {minutes} 分钟。如非本人操作请忽略。"
    )
  }
}

pub fn get_verification_title_text(purpose: &str) -> &'static str {
  match purpose {
    "password_reset" => "您的密码重置验证码",
    "register" => "您的注册验证码",
    _ => "您的验证码"
  }
}

pub fn build_verification_html(
  subject: &str,
  site_name: &str,
  site_url: &str,
  code: &str,
  text_content: &str,
  expire_minutes: i64,
  title_text: &str
) -> String {
  let site = if site_name.is_empty() { "Soga Panel" } else { site_name };
  let minutes = if expire_minutes > 0 { expire_minutes } else { 10 };
  let paragraphs = text_content
    .split('\n')
    .map(|line| line.trim())
    .filter(|line| !line.is_empty())
    .map(|line| format!("<p style=\"margin:0 0 12px;\">{}</p>", escape_html(line)))
    .collect::<Vec<String>>()
    .join("");

  let footer = if site_url.trim().is_empty() {
    "".to_string()
  } else {
    format!(
      "<p style=\"margin:0;color:#94a3b8;font-size:12px;text-align:center;\">访问 <a href=\"{}\" style=\"color:#2563eb;text-decoration:none;\">{}</a> 获取更多信息。</p>",
      escape_html(site_url),
      escape_html(site_url)
    )
  };

  format!(
    r#"
      <div style="background:#f1f5f9;padding:24px;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 16px 32px rgba(15,23,42,0.15);font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:28px;font-weight:700;color:#2563eb;">{}</div>
            <div style="font-size:14px;color:#64748b;margin-top:6px;">{}</div>
          </div>
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:14px;color:#475569;margin-bottom:8px;">{}</div>
            <div style="display:inline-block;padding:16px 24px;border-radius:14px;background:#1d4ed8;color:#ffffff;font-size:36px;font-weight:700;letter-spacing:10px;">{}</div>
            <div style="font-size:13px;color:#64748b;margin-top:12px;">验证码将在 {} 分钟后失效</div>
          </div>
          <div style="font-size:14px;line-height:1.7;color:#334155;margin-bottom:24px;">
            {}
          </div>
          <div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:32px;">
            如果这不是您的操作，请忽略此邮件。{}
          </div>
        </div>
      </div>
    "#,
    escape_html(site),
    escape_html(subject),
    escape_html(title_text),
    escape_html(code),
    minutes,
    paragraphs,
    footer
  )
}

fn escape_html(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&#39;")
}
