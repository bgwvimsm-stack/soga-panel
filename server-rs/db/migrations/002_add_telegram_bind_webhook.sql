-- 为 users 表增加 Telegram 绑定码字段
ALTER TABLE users
  ADD COLUMN telegram_bind_code VARCHAR(64) NULL COMMENT 'Telegram 绑定码（用于 /start 自动绑定）';

ALTER TABLE users
  ADD COLUMN telegram_bind_code_expires_at BIGINT NULL COMMENT 'Telegram 绑定码过期时间戳（Unix 秒）';

-- 追加系统配置项（已存在则忽略）
INSERT IGNORE INTO system_configs (`key`, value, description) VALUES
('telegram_bot_username', '', 'Telegram 机器人用户名（不含@，用于生成一键绑定链接）'),
('telegram_webhook_secret', '', 'Telegram Webhook Secret Token（可选）');
