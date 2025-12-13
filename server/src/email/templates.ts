export function buildEmailSubject(purpose: string, siteName?: string) {
  const site = siteName || "Soga Panel";
  if (purpose === "password_reset") return `[${site}] 重置密码验证码`;
  if (purpose === "register") return `[${site}] 注册验证码`;
  return `[${site}] 验证码`;
}

export function buildEmailText(purpose: string, code: string, expires: string, siteName?: string) {
  const site = siteName || "Soga Panel";
  return `【${site}】验证码：${code}\n用途：${purpose}\n有效期至：${expires}\n如非本人操作请忽略本邮件。`;
}
