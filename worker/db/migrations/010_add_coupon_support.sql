-- 010_add_coupon_support.sql
-- 引入优惠券、适用套餐及使用记录表，并扩展套餐购买记录

-- 优惠券表
CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('amount', 'percentage')),
    discount_value DECIMAL(10,2) NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    max_usage INTEGER,
    per_user_limit INTEGER,
    total_used INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);

-- 优惠券指定套餐
CREATE TABLE IF NOT EXISTS coupon_packages (
    coupon_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    PRIMARY KEY (coupon_id, package_id),
    FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE CASCADE,
    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
);

-- 优惠券使用记录
CREATE TABLE IF NOT EXISTS coupon_usages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coupon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    order_id INTEGER,
    order_trade_no TEXT,
    used_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon_user ON coupon_usages (coupon_id, user_id);

-- 扩展套餐购买记录表
ALTER TABLE package_purchase_records ADD COLUMN coupon_id INTEGER;
ALTER TABLE package_purchase_records ADD COLUMN coupon_code TEXT;
ALTER TABLE package_purchase_records ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
