-- Google OAuth 支持
-- 时间: 2025-XX-XX
-- 描述: 为 users 与 login_logs 表增加 Google OAuth 相关字段

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN oauth_provider TEXT;
ALTER TABLE users ADD COLUMN first_oauth_login_at DATETIME;
ALTER TABLE users ADD COLUMN last_oauth_login_at DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
CREATE INDEX IF NOT EXISTS idx_users_oauth_provider ON users (oauth_provider);

ALTER TABLE login_logs ADD COLUMN login_method TEXT DEFAULT 'password';
