-- 016_create_passkeys.sql
-- 新增 Passkey 表用于存储 WebAuthn 凭证

CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  user_handle TEXT,
  rp_id TEXT,
  transports TEXT,
  sign_count INTEGER DEFAULT 0,
  device_name TEXT,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
  updated_at DATETIME DEFAULT (datetime('now', '+8 hours')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_rp ON passkeys (rp_id);
