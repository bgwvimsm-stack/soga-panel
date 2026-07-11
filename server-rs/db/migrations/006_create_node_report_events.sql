CREATE TABLE IF NOT EXISTS node_report_events (
  event_id VARCHAR(128) NOT NULL COMMENT '节点上报事件 ID',
  node_id BIGINT NOT NULL COMMENT '节点 ID',
  operation VARCHAR(64) NOT NULL COMMENT '上报操作类型',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件创建时间',
  PRIMARY KEY (node_id, operation, event_id),
  CONSTRAINT fk_node_report_events_node FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='节点上报事件幂等去重表';

CREATE INDEX idx_node_report_events_created_at
ON node_report_events (created_at);
