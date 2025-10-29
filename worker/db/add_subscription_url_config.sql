-- 添加订阅链接配置项
-- 执行命令: wrangler d1 execute soga-panel --file=./db/add_subscription_url_config.sql

INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('subscription_url', '', '订阅链接地址（为空时使用默认面板地址）');

-- 验证配置已添加
SELECT key, value, description FROM system_configs WHERE key = 'subscription_url';