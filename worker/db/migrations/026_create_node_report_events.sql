-- 节点上报事件幂等去重表
-- event_id: 节点生成的稳定事件 ID
-- node_id: 节点 ID
-- operation: 上报操作类型
-- created_at: 事件创建时间，用于定期清理过期事件
CREATE TABLE IF NOT EXISTS node_report_events (
  event_id TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  operation TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
  PRIMARY KEY (node_id, operation, event_id),
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_node_report_events_created_at
ON node_report_events (created_at);
