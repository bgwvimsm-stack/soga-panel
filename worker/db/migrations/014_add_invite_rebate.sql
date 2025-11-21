-- 014_add_invite_rebate.sql
-- 为用户表添加邀请码、邀请关系、返利流水等功能所需的结构

-- 用户表新增字段
ALTER TABLE users ADD COLUMN invite_code TEXT;
ALTER TABLE users ADD COLUMN invited_by INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN rebate_available DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE users ADD COLUMN rebate_total DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE users ADD COLUMN invite_limit INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN invite_used INTEGER DEFAULT 0;

-- 为已有用户生成唯一的邀请码
UPDATE users
SET invite_code = lower(hex(randomblob(6))) || printf('%04x', id)
WHERE invite_code IS NULL OR invite_code = '';

-- 确保 invited_by 字段没有 NULL
UPDATE users SET invited_by = 0 WHERE invited_by IS NULL;
UPDATE users SET invite_limit = 0 WHERE invite_limit IS NULL;
UPDATE users SET invite_used = 0 WHERE invite_used IS NULL;

-- 创建索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users (invite_code);
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users (invited_by);

-- 邀请关系表
CREATE TABLE IF NOT EXISTS referral_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL,
    invitee_id INTEGER NOT NULL UNIQUE,
    invite_code TEXT NOT NULL,
    invite_ip TEXT,
    registered_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    first_payment_type TEXT,
    first_payment_id INTEGER,
    first_paid_at DATETIME,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_referral_relations_inviter ON referral_relations (inviter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_relations_status ON referral_relations (status);

-- 返利流水表
CREATE TABLE IF NOT EXISTS rebate_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL,
    referral_id INTEGER,
    invitee_id INTEGER,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    trade_no TEXT,
    event_type TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    remark TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (referral_id) REFERENCES referral_relations (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rebate_transactions_user ON rebate_transactions (inviter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rebate_transactions_source ON rebate_transactions (source_type, source_id);

-- 返利划转记录
CREATE TABLE IF NOT EXISTS rebate_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance_before DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    rebate_before DECIMAL(10,2) NOT NULL,
    rebate_after DECIMAL(10,2) NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rebate_transfers_user ON rebate_transfers (user_id, created_at);

-- 返利提现表
CREATE TABLE IF NOT EXISTS rebate_withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    method TEXT NOT NULL DEFAULT 'manual',
    account_payload TEXT,
    fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
    fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_id INTEGER,
    review_note TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    processed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rebate_withdrawals_user ON rebate_withdrawals (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rebate_withdrawals_status ON rebate_withdrawals (status);

-- 预置配置项
INSERT OR IGNORE INTO system_configs (key, value, description)
VALUES ('rebate_rate', '0', '邀请返利比例（0-1之间，例如0.1表示10%）');

INSERT OR IGNORE INTO system_configs (key, value, description)
VALUES ('rebate_mode', 'every_order', '返利模式：first_order（首单）或 every_order（循环）');

INSERT OR IGNORE INTO system_configs (key, value, description)
VALUES ('invite_default_limit', '0', '默认邀请码可使用次数（0表示不限）');

INSERT OR IGNORE INTO system_configs (key, value, description)
VALUES ('rebate_withdraw_fee_rate', '0.05', '返利提现手续费比例（0-1之间，例如0.05=5%）');

INSERT OR IGNORE INTO system_configs (key, value, description)
VALUES ('rebate_withdraw_min_amount', '200', '返利提现最低金额（元）');
