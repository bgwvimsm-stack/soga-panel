-- MariaDB 版 Schema（迁移自 worker/db/db.sql）
-- 说明：默认时区建议设置为 +08:00；时间字段使用 CURRENT_TIMESTAMP，并在更新时自动更新时间。

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  uuid VARCHAR(255) NOT NULL UNIQUE,
  passwd VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  invite_code VARCHAR(255) UNIQUE,
  invited_by BIGINT NOT NULL DEFAULT 0,
  invite_used INT DEFAULT 0,
  invite_limit INT DEFAULT 0,
  google_sub VARCHAR(255),
  oauth_provider VARCHAR(50),
  first_oauth_login_at DATETIME,
  last_oauth_login_at DATETIME,
  github_id VARCHAR(255),
  is_admin TINYINT DEFAULT 0,
  speed_limit INT DEFAULT 0,
  device_limit INT DEFAULT 0,
  tcp_limit INT DEFAULT 0,
  upload_traffic BIGINT DEFAULT 0,
  download_traffic BIGINT DEFAULT 0,
  upload_today BIGINT DEFAULT 0,
  download_today BIGINT DEFAULT 0,
  transfer_total BIGINT DEFAULT 0,
  transfer_enable BIGINT DEFAULT 10737418240,
  status TINYINT DEFAULT 1,
  reg_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  expire_time DATETIME,
  last_login_time DATETIME,
  last_login_ip VARCHAR(255),
  class INT DEFAULT 1,
  class_expire_time DATETIME,
  bark_key VARCHAR(255),
  bark_enabled TINYINT DEFAULT 0,
  two_factor_enabled TINYINT DEFAULT 0,
  two_factor_secret TEXT,
  two_factor_backup_codes TEXT,
  two_factor_temp_secret TEXT,
  two_factor_confirmed_at DATETIME,
  money DECIMAL(10,2) DEFAULT 0.00,
  rebate_available DECIMAL(10,2) DEFAULT 0.00,
  rebate_total DECIMAL(10,2) DEFAULT 0.00,
  register_ip VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users (invite_code);

CREATE TABLE IF NOT EXISTS nodes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  node_class INT DEFAULT 1,
  node_bandwidth BIGINT DEFAULT 0,
  node_bandwidth_limit BIGINT DEFAULT 0,
  traffic_multiplier DECIMAL(10,4) DEFAULT 1,
  bandwidthlimit_resetday INT DEFAULT 1,
  node_config JSON NOT NULL,
  status TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rule TEXT NOT NULL,
  enabled TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS white_list (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rule TEXT NOT NULL,
  description TEXT,
  status TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(50) NOT NULL,
  request_ip VARCHAR(255),
  request_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  request_user_agent TEXT,
  CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS online_ips (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  node_id BIGINT NOT NULL,
  ip VARCHAR(255) NOT NULL,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_online_ips (user_id, node_id, ip),
  CONSTRAINT fk_online_ips_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_online_ips_node FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  node_id BIGINT NOT NULL,
  audit_rule_id BIGINT NOT NULL,
  ip_address VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_logs_node FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_logs_rule FOREIGN KEY (audit_rule_id) REFERENCES audit_rules (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS node_status (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id BIGINT NOT NULL,
  cpu_usage DECIMAL(6,3),
  memory_total BIGINT,
  memory_used BIGINT,
  swap_total BIGINT,
  swap_used BIGINT,
  disk_total BIGINT,
  disk_used BIGINT,
  uptime BIGINT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_node_status_node FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS traffic_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  node_id BIGINT NOT NULL,
  upload_traffic BIGINT DEFAULT 0,
  download_traffic BIGINT DEFAULT 0,
  actual_upload_traffic BIGINT DEFAULT 0,
  actual_download_traffic BIGINT DEFAULT 0,
  actual_traffic BIGINT DEFAULT 0,
  deduction_multiplier DECIMAL(10,4) DEFAULT 1,
  date DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_traffic_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_traffic_logs_node FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_traffic (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  record_date DATE NOT NULL,
  upload_traffic BIGINT DEFAULT 0,
  download_traffic BIGINT DEFAULT 0,
  total_traffic BIGINT DEFAULT 0,
  node_usage JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_daily_traffic_user_date (user_id, record_date),
  CONSTRAINT fk_daily_traffic_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_traffic_summary (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  record_date DATE NOT NULL UNIQUE,
  total_users BIGINT DEFAULT 0,
  total_upload BIGINT DEFAULT 0,
  total_download BIGINT DEFAULT 0,
  total_traffic BIGINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  content_html TEXT,
  type VARCHAR(50) DEFAULT 'info',
  is_active TINYINT DEFAULT 1,
  is_pinned TINYINT DEFAULT 0,
  priority INT DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  expires_at BIGINT,
  CONSTRAINT fk_announcements_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_configs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(255) NOT NULL UNIQUE,
  value TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  login_ip VARCHAR(255) NOT NULL,
  login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  login_status TINYINT DEFAULT 1,
  failure_reason TEXT,
  login_method VARCHAR(50) DEFAULT 'password',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  purpose VARCHAR(50) NOT NULL DEFAULT 'register',
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  request_ip VARCHAR(255),
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME,
  INDEX idx_email_verification_email (email),
  INDEX idx_email_verification_email_purpose (email, purpose),
  INDEX idx_email_verification_expires_at (expires_at),
  INDEX idx_email_verification_used_at (used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(255) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  user_data JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS two_factor_trusted_devices (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  device_name VARCHAR(255),
  user_agent TEXT,
  expires_at DATETIME NOT NULL,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  disabled TINYINT DEFAULT 0,
  UNIQUE KEY uniq_two_factor_token (user_id, token_hash),
  CONSTRAINT fk_two_factor_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_two_factor_user (user_id),
  INDEX idx_two_factor_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shared_ids (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  fetch_url TEXT NOT NULL,
  remote_account_id BIGINT NOT NULL,
  status TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shared_ids_status (status),
  INDEX idx_shared_ids_remote_id (remote_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS packages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  traffic_quota BIGINT NOT NULL DEFAULT 0,
  validity_days INT NOT NULL DEFAULT 30,
  speed_limit INT DEFAULT 0,
  device_limit INT DEFAULT 0,
  level INT DEFAULT 1,
  status TINYINT DEFAULT 1,
  is_recommended TINYINT DEFAULT 0,
  sort_weight INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(255) NOT NULL UNIQUE,
  discount_type ENUM('amount','percentage') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  start_at BIGINT NOT NULL,
  end_at BIGINT NOT NULL,
  max_usage INT,
  per_user_limit INT,
  total_used INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_packages (
  coupon_id BIGINT NOT NULL,
  package_id BIGINT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (coupon_id, package_id),
  CONSTRAINT fk_coupon_packages_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE CASCADE,
  CONSTRAINT fk_coupon_packages_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_usages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  coupon_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  order_id BIGINT,
  order_trade_no VARCHAR(255),
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coupon_usages_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE CASCADE,
  CONSTRAINT fk_coupon_usages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_coupon_usages_coupon (coupon_id),
  INDEX idx_coupon_usages_coupon_user (coupon_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gift_card_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  card_type VARCHAR(50) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  code_prefix VARCHAR(100),
  balance_amount DECIMAL(10,2),
  duration_days INT,
  traffic_value_gb INT,
  reset_traffic_gb INT,
  package_id BIGINT,
  max_usage INT,
  start_at DATETIME,
  end_at DATETIME,
  created_by BIGINT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gift_card_batches_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL,
  CONSTRAINT fk_gift_card_batches_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gift_cards (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(255) NOT NULL UNIQUE,
  card_type VARCHAR(50) NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  balance_amount DECIMAL(10,2),
  duration_days INT,
  traffic_value_gb INT,
  reset_traffic_gb INT,
  package_id BIGINT,
  max_usage INT DEFAULT 1,
  used_count INT DEFAULT 0,
  start_at DATETIME,
  end_at DATETIME,
  created_by BIGINT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_gift_cards_batch FOREIGN KEY (batch_id) REFERENCES gift_card_batches (id) ON DELETE SET NULL,
  CONSTRAINT fk_gift_cards_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL,
  CONSTRAINT fk_gift_cards_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_gift_cards_status (status),
  INDEX idx_gift_cards_type (card_type),
  INDEX idx_gift_cards_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_relations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  inviter_id BIGINT NOT NULL,
  invitee_id BIGINT NOT NULL UNIQUE,
  invite_code VARCHAR(255) NOT NULL,
  invite_ip VARCHAR(255),
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  first_payment_type VARCHAR(50),
  first_payment_id BIGINT,
  first_paid_at DATETIME,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_referral_relations_inviter FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_referral_relations_inviter (inviter_id, created_at),
  INDEX idx_referral_relations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rebate_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  inviter_id BIGINT NOT NULL,
  referral_id BIGINT,
  invitee_id BIGINT,
  source_type VARCHAR(50) NOT NULL,
  source_id BIGINT,
  trade_no VARCHAR(255),
  event_type VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'confirmed',
  remark TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rebate_transactions_user FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_rebate_transactions_referral FOREIGN KEY (referral_id) REFERENCES referral_relations (id) ON DELETE SET NULL,
  INDEX idx_rebate_transactions_user (inviter_id, created_at),
  INDEX idx_rebate_transactions_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rebate_transfers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  balance_before DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  rebate_before DECIMAL(10,2) NOT NULL,
  rebate_after DECIMAL(10,2) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rebate_transfers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_rebate_transfers_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rebate_withdrawals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(50) NOT NULL DEFAULT 'manual',
  account_payload JSON,
  fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  reviewer_id BIGINT,
  review_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  processed_at DATETIME,
  CONSTRAINT fk_rebate_withdrawals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_rebate_withdrawals_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_rebate_withdrawals_user (user_id, created_at),
  INDEX idx_rebate_withdrawals_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'alipay',
  trade_no VARCHAR(255) NOT NULL UNIQUE,
  status TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME,
  CONSTRAINT fk_recharge_records_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_recharge_records_user_id (user_id),
  INDEX idx_recharge_records_trade_no (trade_no),
  INDEX idx_recharge_records_status (status),
  INDEX idx_recharge_records_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_purchase_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  package_id BIGINT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  package_price DECIMAL(10,2),
  coupon_id BIGINT,
  coupon_code VARCHAR(255),
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  purchase_type VARCHAR(50) NOT NULL DEFAULT 'balance',
  trade_no VARCHAR(255) NOT NULL UNIQUE,
  status TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME,
  expires_at DATETIME,
  CONSTRAINT fk_package_purchase_records_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_package_purchase_records_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_package_purchase_records_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE SET NULL,
  INDEX idx_package_purchase_records_user_id (user_id),
  INDEX idx_package_purchase_records_package_id (package_id),
  INDEX idx_package_purchase_records_trade_no (trade_no),
  INDEX idx_package_purchase_records_status (status),
  INDEX idx_package_purchase_records_created_at (created_at),
  INDEX idx_package_purchase_records_paid_at (paid_at),
  INDEX idx_package_purchase_records_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gift_card_redemptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  card_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  code VARCHAR(255) NOT NULL,
  card_type VARCHAR(50) NOT NULL,
  change_amount DECIMAL(10,2),
  duration_days INT,
  traffic_value_gb INT,
  reset_traffic_gb INT,
  package_id BIGINT,
  recharge_record_id BIGINT,
  purchase_record_id BIGINT,
  trade_no VARCHAR(255),
  result_status VARCHAR(50) NOT NULL DEFAULT 'success',
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gift_card_redemptions_card FOREIGN KEY (card_id) REFERENCES gift_cards (id) ON DELETE CASCADE,
  CONSTRAINT fk_gift_card_redemptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gift_card_redemptions_recharge FOREIGN KEY (recharge_record_id) REFERENCES recharge_records (id) ON DELETE SET NULL,
  CONSTRAINT fk_gift_card_redemptions_purchase FOREIGN KEY (purchase_record_id) REFERENCES package_purchase_records (id) ON DELETE SET NULL,
  INDEX idx_gift_card_redemptions_card_id (card_id),
  INDEX idx_gift_card_redemptions_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  last_reply_by_admin_id BIGINT,
  last_reply_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_admin FOREIGN KEY (last_reply_by_admin_id) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_tickets_user_id (user_id),
  INDEX idx_tickets_status (status),
  INDEX idx_tickets_last_reply_at (last_reply_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_replies (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  author_id BIGINT NOT NULL,
  author_role VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_replies_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_replies_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_ticket_replies_ticket_id (ticket_id),
  INDEX idx_ticket_replies_author_role (author_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 额外索引（若已在表定义中创建则可忽略重复）
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users (uuid);
CREATE INDEX IF NOT EXISTS idx_users_token ON users (token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users (invite_code);
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users (invited_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users (github_id);
CREATE INDEX IF NOT EXISTS idx_users_oauth_provider ON users (oauth_provider);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_expire_time ON users (expire_time);
CREATE INDEX IF NOT EXISTS idx_users_class ON users (class);
CREATE INDEX IF NOT EXISTS idx_users_money ON users (money);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes (type);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes (status);
CREATE INDEX IF NOT EXISTS idx_nodes_class ON nodes (node_class);

CREATE INDEX IF NOT EXISTS idx_traffic_logs_user_date ON traffic_logs (user_id, date);
CREATE INDEX IF NOT EXISTS idx_traffic_logs_node_date ON traffic_logs (node_id, date);

CREATE INDEX IF NOT EXISTS idx_daily_traffic_user_date ON daily_traffic (user_id, record_date);
CREATE INDEX IF NOT EXISTS idx_daily_traffic_date ON daily_traffic (record_date);
CREATE INDEX IF NOT EXISTS idx_daily_traffic_created ON daily_traffic (created_at);

CREATE INDEX IF NOT EXISTS idx_online_ips_user ON online_ips (user_id);
CREATE INDEX IF NOT EXISTS idx_online_ips_last_seen ON online_ips (last_seen);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);

CREATE INDEX IF NOT EXISTS idx_node_status_node_time ON node_status (node_id, created_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions (token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements (is_pinned);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements (created_at);
CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON announcements (expires_at);

CREATE INDEX IF NOT EXISTS idx_packages_status ON packages (status);
CREATE INDEX IF NOT EXISTS idx_packages_level ON packages (level);
CREATE INDEX IF NOT EXISTS idx_packages_price ON packages (price);
