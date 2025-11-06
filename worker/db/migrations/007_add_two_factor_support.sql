-- 007_add_two_factor_support.sql
-- 二步验证字段与可信设备表

ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_backup_codes TEXT;
ALTER TABLE users ADD COLUMN two_factor_temp_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_confirmed_at DATETIME;

CREATE TABLE IF NOT EXISTS two_factor_trusted_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    device_name TEXT,
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    last_used_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    disabled INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (user_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_two_factor_trusted_devices_user ON two_factor_trusted_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_two_factor_trusted_devices_expires ON two_factor_trusted_devices (expires_at);
