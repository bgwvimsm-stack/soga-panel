-- 应用迁移脚本：用于将新的数据库变更应用到现有数据库
-- 时间: 2025-09-21
-- 描述: 套餐功能和支付功能的数据库变更

-- 检查并添加用户表的money字段
-- 如果字段不存在则添加
ALTER TABLE users ADD COLUMN money DECIMAL(10,2) DEFAULT 0.00;

-- 更新现有用户的money字段为0.00（如果为NULL）
UPDATE users SET money = 0.00 WHERE money IS NULL;

-- 创建money字段的索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_users_money ON users (money);

-- 注意：套餐相关的表和索引已经在主数据库文件中定义
-- 如果需要在现有数据库中创建这些表，请运行以下命令：

-- 套餐表
CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    traffic_quota INTEGER NOT NULL DEFAULT 0,
    validity_days INTEGER NOT NULL DEFAULT 30,
    speed_limit INTEGER DEFAULT 0,
    device_limit INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);

-- 充值记录表
CREATE TABLE IF NOT EXISTS recharge_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'alipay',
    trade_no TEXT UNIQUE NOT NULL,
    status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    paid_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 套餐购买记录表
CREATE TABLE IF NOT EXISTS package_purchase_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    purchase_type TEXT NOT NULL DEFAULT 'balance',
    trade_no TEXT UNIQUE NOT NULL,
    status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
);

-- 套餐相关索引
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages (status);
CREATE INDEX IF NOT EXISTS idx_packages_level ON packages (level);
CREATE INDEX IF NOT EXISTS idx_packages_price ON packages (price);

-- 充值记录索引
CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records (user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_records_trade_no ON recharge_records (trade_no);
CREATE INDEX IF NOT EXISTS idx_recharge_records_status ON recharge_records (status);
CREATE INDEX IF NOT EXISTS idx_recharge_records_created_at ON recharge_records (created_at);

-- 套餐购买记录索引
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_user_id ON package_purchase_records (user_id);
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_package_id ON package_purchase_records (package_id);
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_trade_no ON package_purchase_records (trade_no);
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_status ON package_purchase_records (status);
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_created_at ON package_purchase_records (created_at);
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_expires_at ON package_purchase_records (expires_at);

-- 邮箱验证码表
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'register',
    code_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    request_ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
    used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_email_verification_email ON email_verification_codes (email);
CREATE INDEX IF NOT EXISTS idx_email_verification_email_purpose ON email_verification_codes (email, purpose);
CREATE INDEX IF NOT EXISTS idx_email_verification_expires_at ON email_verification_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_used_at ON email_verification_codes (used_at);

-- 注册验证码相关配置
INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('register_email_verification_enabled', '1', '注册是否需要邮箱验证码（1=开启，0=关闭）');
