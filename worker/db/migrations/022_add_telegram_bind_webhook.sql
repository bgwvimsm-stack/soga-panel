-- Telegram Bot 自动绑定能力：绑定码字段 + webhook 配置
ALTER TABLE users ADD COLUMN telegram_bind_code TEXT;
ALTER TABLE users ADD COLUMN telegram_bind_code_expires_at INTEGER;

-- 新增 Telegram 相关系统配置（已存在则忽略）
INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('telegram_bot_username', '', 'Telegram 机器人用户名（不含@，用于生成一键绑定链接）'),
('telegram_bot_token', '', 'Telegram Bot Token（用于公告和流量推送）'),
('telegram_webhook_secret', '', 'Telegram Webhook Secret Token（可选）');
