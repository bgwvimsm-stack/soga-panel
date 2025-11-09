-- 008_create_shared_ids.sql
-- 创建苹果账号共享ID配置表

CREATE TABLE IF NOT EXISTS shared_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fetch_url TEXT NOT NULL,
    remote_account_id INTEGER NOT NULL,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_shared_ids_status ON shared_ids (status);
CREATE INDEX IF NOT EXISTS idx_shared_ids_remote_id ON shared_ids (remote_account_id);

