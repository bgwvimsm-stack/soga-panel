-- =============================================
-- 系统必要数据插入脚本
-- 包含系统正常运行所必需的初始化数据
-- =============================================

-- 插入默认管理员账户（第一个用户自动成为管理员）
INSERT OR IGNORE INTO users (
    id,
    email,
    username,
    password_hash,
    uuid,
    passwd,
    token,
    is_admin,
    transfer_enable,
    class,
    status
) VALUES (
    1,
    'admin@example.com',
    'admin',
    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', -- 密码: admin123
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'admin_proxy_password',
    'admin_subscription_token',
    1,
    1099511627776, -- 1TB
    999, -- 最高等级
    1
);

-- 插入系统默认配置
INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('site_name', '代理面板', '网站名称'),
('site_url', 'https://panel.example.com', '网站地址'),
('register_enabled', '1', '是否允许注册'),
('default_traffic', '10737418240', '默认流量10GB（字节）'),
('default_expire_days', '30', '默认等级到期天数'),
('default_account_expire_days', '3650', '默认账号到期天数（10年）'),
('default_class', '1', '默认用户等级'),
('traffic_reset_day', '0', '流量重置日（0=不执行每月定时任务，1-31=每月几号）'),
('subscription_url', '', '订阅链接地址（为空时使用默认面板地址）'),
('register_email_verification_enabled', '1', '注册是否需要邮箱验证码（1=开启，0=关闭）');

-- 插入默认审计规则
INSERT OR IGNORE INTO audit_rules (name, rule, description) VALUES
('种子下载', 'regexp:.*\.torrent', '种子文件'),
('成人内容', 'regexp:.*porn.*', '成人内容');

-- 插入默认白名单
INSERT OR IGNORE INTO white_list (rule, description) VALUES
('domain:api.telegram.org', 'Telegram API'),
('geoip:cn', '中国IP段'),
('port:80,443', '常用端口');

-- 插入欢迎公告
INSERT OR IGNORE INTO announcements (
    title, 
    content, 
    type, 
    is_active, 
    is_pinned, 
    priority, 
    created_by, 
    created_at
) VALUES (
    '欢迎使用 Soga Panel',
    '欢迎使用我们的轻量级代理面板服务！

## 功能特点

- **高性能**: 基于 Cloudflare Workers 架构
- **易管理**: 直观的用户界面
- **多协议**: 支持多种代理协议
- **实时监控**: 流量使用情况实时显示

## 使用指南

1. 查看您的节点列表
2. 获取订阅链接
3. 在客户端中配置使用
4. 定期检查流量使用情况

如有问题，请联系管理员。',
    'notice',
    1,
    1,
    100,
    1,
    strftime('%s', 'now')
),
(
    '系统维护通知',
    '为了提供更好的服务，我们将在以下时间进行系统维护：

**维护时间**: 2025年05月51日 05:00 - 20:00 (UTC+8)

**影响范围**: 
- 面板访问可能短暂中断
- 代理服务正常运行

维护完成后将提供更稳定的服务体验。

感谢您的理解与支持！',
    'warning',
    1,
    0,
    50,
    1,
    strftime('%s', 'now')
);

-- 插入示例节点数据（基础节点配置）
INSERT OR IGNORE INTO nodes (
    id,
    name,
    type,
    server,
    server_port,
    node_class,
    node_config
) VALUES 
-- Shadowsocks 节点
(1, 'ss-tcp', 'ss', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"cipher":"aes-128-gcm","password":"","obfs":"plain","path":"/path","host":"www.server.com"}}'),

-- V2Ray VMess 节点
(2, 'vmess-tcp', 'v2ray', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"tcp","tls_type":"none"}}'),
(3, 'vmess-tcp-tls', 'v2ray', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"tcp","tls_type":"tls"}}'),
(4, 'vmess-ws', 'v2ray', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"ws","tls_type":"none","path":"/112233"}}'),
(5, 'vmess-ws-tls', 'v2ray', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"ws","tls_type":"tls","path":"/112233"}}'),

-- VLESS 节点
(6, 'vless-tcp-tls', 'vless', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"tcp","tls_type":"tls"}}'),
(7, 'vless-ws-tls', 'vless', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"ws","tls_type":"tls","path":"/112233"}}'),

-- Trojan 节点
(8, 'trojan-tcp-tls', 'trojan', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"tcp","tls_type":"tls"}}'),
(9, 'trojan-ws-tls', 'trojan', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"stream_type":"ws","tls_type":"tls"}}'),

-- Hysteria 节点
(10, 'hysteria', 'hysteria', 'example.com', 8443, 1, '{"basic":{"pull_interval":120,"push_interval":120,"speed_limit":0},"config":{"port":8443,"obfs":"salamander","obfs_password":"","up_mbps":1000,"down_mbps":1000}}');

-- 验证必要数据插入
SELECT 'Required data inserted successfully' as status;
SELECT 'Admin user created: ' || email as admin FROM users WHERE id = 1;
SELECT 'System configs count: ' || COUNT(*) as configs FROM system_configs;
SELECT 'Nodes count: ' || COUNT(*) as nodes FROM nodes;
SELECT 'Announcements count: ' || COUNT(*) as announcements FROM announcements;
