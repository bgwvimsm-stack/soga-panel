-- 为 users 表增加 Telegram 通知字段
ALTER TABLE users ADD COLUMN telegram_id TEXT;
ALTER TABLE users ADD COLUMN telegram_enabled INTEGER DEFAULT 0;

UPDATE users
SET telegram_enabled = 0
WHERE telegram_enabled IS NULL;
