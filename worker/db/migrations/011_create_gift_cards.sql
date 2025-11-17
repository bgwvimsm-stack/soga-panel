-- 011_create_gift_cards.sql
-- 2025年11月17日18:48:07
-- 新增礼品卡批次、礼品卡、礼品卡兑换记录表

CREATE TABLE IF NOT EXISTS gift_card_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    card_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    code_prefix TEXT,
    balance_amount DECIMAL(10,2),
    duration_days INTEGER,
    traffic_value_gb INTEGER,
    reset_traffic_gb INTEGER,
    package_id INTEGER,
    max_usage INTEGER,
    start_at DATETIME,
    end_at DATETIME,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS gift_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    card_type TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 1,
    balance_amount DECIMAL(10,2),
    duration_days INTEGER,
    traffic_value_gb INTEGER,
    reset_traffic_gb INTEGER,
    package_id INTEGER,
    max_usage INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    start_at DATETIME,
    end_at DATETIME,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (batch_id) REFERENCES gift_card_batches (id) ON DELETE SET NULL,
    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS gift_card_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    card_type TEXT NOT NULL,
    change_amount DECIMAL(10,2),
    duration_days INTEGER,
    traffic_value_gb INTEGER,
    reset_traffic_gb INTEGER,
    package_id INTEGER,
    recharge_record_id INTEGER,
    purchase_record_id INTEGER,
    trade_no TEXT,
    result_status TEXT NOT NULL DEFAULT 'success',
    message TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (card_id) REFERENCES gift_cards (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (recharge_record_id) REFERENCES recharge_records (id) ON DELETE SET NULL,
    FOREIGN KEY (purchase_record_id) REFERENCES package_purchase_records (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards (status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_type ON gift_cards (card_type);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards (code);
CREATE INDEX IF NOT EXISTS idx_gift_card_redemptions_card_id ON gift_card_redemptions (card_id);
CREATE INDEX IF NOT EXISTS idx_gift_card_redemptions_user_id ON gift_card_redemptions (user_id);
