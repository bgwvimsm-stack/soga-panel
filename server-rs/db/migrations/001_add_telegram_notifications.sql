-- 为 users 表增加 Telegram 通知字段
ALTER TABLE users
  ADD COLUMN telegram_id VARCHAR(64) NULL COMMENT 'Telegram Chat ID';

ALTER TABLE users
  ADD COLUMN telegram_enabled TINYINT DEFAULT 0 COMMENT '是否启用 Telegram 推送';

-- 追加系统配置项（已存在则忽略）
INSERT IGNORE INTO system_configs (`key`, value, description) VALUES
('telegram_bot_token', '', 'Telegram Bot Token（用于公告和流量推送）'),
('telegram_bot_api_base', 'https://api.telegram.org', 'Telegram Bot API 基础地址');
