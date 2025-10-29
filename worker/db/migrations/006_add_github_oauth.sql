-- GitHub OAuth 支持
-- 描述：为 users 表新增 GitHub 相关字段

ALTER TABLE users ADD COLUMN github_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users (github_id);
CREATE INDEX IF NOT EXISTS idx_users_oauth_provider_github ON users (oauth_provider) WHERE oauth_provider = 'github';
