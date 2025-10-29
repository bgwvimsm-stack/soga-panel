-- 为用户表添加金额字段的迁移脚本
-- 时间: 2025-09-21
-- 描述: 添加用户钱包功能，为用户表增加 money 字段用于存储用户余额

-- 添加金额字段
ALTER TABLE users ADD COLUMN money DECIMAL(10,2) DEFAULT 0.00;

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_users_money ON users (money);

-- 更新现有用户的默认金额为0
UPDATE users SET money = 0.00 WHERE money IS NULL;