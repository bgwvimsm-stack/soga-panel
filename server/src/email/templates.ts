export function buildEmailSubject(purpose: string, siteName?: string) {
  const site = siteName || "Soga Panel";
  if (purpose === "password_reset") return `您的 ${site} 密码重置验证码`;
  if (purpose === "register") return `您的 ${site} 注册验证码`;
  return `您的 ${site} 验证码`;
}

export function buildEmailText(
  purpose: string,
  code: string,
  expireMinutes: number,
  siteName?: string
) {
  const site = siteName || "Soga Panel";
  const minutes = Number.isFinite(expireMinutes) && expireMinutes > 0 ? expireMinutes : 10;

  if (purpose === "password_reset") {
    return `您好，我们收到了您的密码重置请求。您的验证码是 ${code}，有效期 ${minutes} 分钟。如非本人操作请忽略。`;
  }

  if (purpose === "register") {
    return `您好，您的验证码是 ${code}，有效期 ${minutes} 分钟。如非本人操作请忽略。`;
  }

  return `您好，您的 ${site} 验证码是 ${code}，有效期 ${minutes} 分钟。如非本人操作请忽略。`;
}

export function getVerificationTitleText(purpose: string) {
  if (purpose === "password_reset") return "您的密码重置验证码";
  if (purpose === "register") return "您的注册验证码";
  return "您的验证码";
}

function escapeHtml(value: string) {
  const str = value ?? "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildVerificationHtml(params: {
  subject: string;
  siteName: string;
  siteUrl?: string;
  code: string;
  textContent: string;
  expireMinutes: number;
  titleText: string;
}) {
  const paragraphs = (params.textContent || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`)
    .join("");

  const siteUrl = (params.siteUrl || "").trim();
  const footer = siteUrl
    ? `<p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">访问 <a href="${escapeHtml(
        siteUrl
      )}" style="color:#2563eb;text-decoration:none;">${escapeHtml(
        siteUrl
      )}</a> 获取更多信息。</p>`
    : "";

  const expireMinutes =
    Number.isFinite(params.expireMinutes) && params.expireMinutes > 0
      ? params.expireMinutes
      : 10;

  return `
      <div style="background:#f1f5f9;padding:24px;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 16px 32px rgba(15,23,42,0.15);font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:28px;font-weight:700;color:#2563eb;">${escapeHtml(
              params.siteName
            )}</div>
            <div style="font-size:14px;color:#64748b;margin-top:6px;">${escapeHtml(
              params.subject
            )}</div>
          </div>
          <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:14px;color:#475569;margin-bottom:8px;">${escapeHtml(
              params.titleText
            )}</div>
            <div style="display:inline-block;padding:16px 24px;border-radius:14px;background:#1d4ed8;color:#ffffff;font-size:36px;font-weight:700;letter-spacing:10px;">${escapeHtml(
              params.code
            )}</div>
            <div style="font-size:13px;color:#64748b;margin-top:12px;">验证码将在 ${expireMinutes} 分钟后失效</div>
          </div>
          <div style="font-size:14px;line-height:1.7;color:#334155;margin-bottom:24px;">
            ${paragraphs}
          </div>
          <div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:32px;">
            如果这不是您的操作，请忽略此邮件。${footer}
          </div>
        </div>
      </div>
    `;
}
