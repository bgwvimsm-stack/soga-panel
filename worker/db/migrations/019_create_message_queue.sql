-- 创建消息队列表（用于公告异步通知）
CREATE TABLE IF NOT EXISTS message_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  scheduled_at INTEGER NOT NULL,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_queue_status_schedule ON message_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_message_queue_channel_status ON message_queue(channel, status);
CREATE INDEX IF NOT EXISTS idx_message_queue_announcement_id ON message_queue(announcement_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_user_id ON message_queue(user_id);

-- 消息队列发送分页大小（每分钟发送上限）
INSERT OR IGNORE INTO system_configs (key, value, description)
VALUES ('message_queue_page_size', '20', '消息队列每分钟发送分页大小');
