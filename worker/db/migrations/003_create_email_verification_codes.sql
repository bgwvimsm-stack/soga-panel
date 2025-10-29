-- 创建邮箱验证码相关表与配置
-- 时间: 2025-10-xx
-- 描述: 为注册流程添加邮箱验证码支持

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    request_ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_email_verification_email ON email_verification_codes (email);
CREATE INDEX IF NOT EXISTS idx_email_verification_expires_at ON email_verification_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_used_at ON email_verification_codes (used_at);

INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('register_email_verification_enabled', '1', '注册是否需要邮箱验证码（1=开启，0=关闭）');
