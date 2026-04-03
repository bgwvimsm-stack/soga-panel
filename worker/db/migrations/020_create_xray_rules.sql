-- 020_create_xray_rules.sql
-- 新增 Xray 路由规则表与节点绑定字段

CREATE TABLE IF NOT EXISTS xray_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('dns', 'routing', 'outbounds')),
  rule_format TEXT NOT NULL CHECK (rule_format IN ('json', 'yaml')),
  rule_content TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
  updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);

ALTER TABLE nodes ADD COLUMN xray_rule_ids TEXT NOT NULL DEFAULT '[]';

UPDATE nodes
SET xray_rule_ids = '[]'
WHERE xray_rule_ids IS NULL OR TRIM(xray_rule_ids) = '';

-- 将旧 dns_rules 数据迁移到 xray_rules（仅迁移 DNS 类型）
INSERT INTO xray_rules (
  id,
  name,
  description,
  rule_type,
  rule_format,
  rule_content,
  rule_json,
  enabled,
  created_at,
  updated_at
)
SELECT
  dr.id,
  dr.name,
  dr.description,
  'dns',
  'json',
  dr.rule_json,
  dr.rule_json,
  dr.enabled,
  dr.created_at,
  dr.updated_at
FROM dns_rules dr
WHERE NOT EXISTS (
  SELECT 1
  FROM xray_rules xr
  WHERE xr.id = dr.id
);
