-- 017_create_dns_rules.sql
-- 新增 DNS 规则表

CREATE TABLE IF NOT EXISTS dns_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  rule_json TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  node_ids TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
  updated_at DATETIME DEFAULT (datetime('now', '+8 hours'))
);
