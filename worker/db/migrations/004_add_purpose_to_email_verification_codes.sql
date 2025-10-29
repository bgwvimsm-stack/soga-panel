-- 为邮箱验证码表添加 purpose 字段，用于区分用途（注册、找回密码等）

ALTER TABLE email_verification_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'register';

-- 重新创建索引以包含 purpose 维度
CREATE INDEX IF NOT EXISTS idx_email_verification_email_purpose ON email_verification_codes (email, purpose);
