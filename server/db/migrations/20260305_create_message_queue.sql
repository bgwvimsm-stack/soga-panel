-- 20260305_create_message_queue.sql
-- 新增公告消息队列表（支持多通知通道扩展）

CREATE TABLE IF NOT EXISTS message_queue (
  id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '消息队列 ID',
  announcement_id BIGINT NOT NULL COMMENT '关联公告 ID',
  user_id BIGINT NOT NULL COMMENT '接收用户 ID',
  channel VARCHAR(32) NOT NULL COMMENT '通知通道（email/bark/...)',
  recipient VARCHAR(512) NOT NULL COMMENT '接收地址（邮箱/Bark Key）',
  payload LONGTEXT NOT NULL COMMENT '消息快照 JSON',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '状态（0待发送 1发送中 2成功 3失败）',
  attempt_count INT NOT NULL DEFAULT 0 COMMENT '已尝试次数',
  max_attempts INT NOT NULL DEFAULT 3 COMMENT '最大尝试次数',
  last_error TEXT COMMENT '最近一次错误',
  scheduled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计划发送时间',
  sent_at DATETIME COMMENT '发送成功时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  CONSTRAINT fk_message_queue_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_queue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_message_queue_status_schedule ON message_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_channel_status ON message_queue (channel, status);
CREATE INDEX IF NOT EXISTS idx_message_queue_announcement ON message_queue (announcement_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_user ON message_queue (user_id);

INSERT IGNORE INTO system_configs (`key`, value, description)
VALUES ('message_queue_page_size', '20', '消息队列每分钟发送分页大小');
