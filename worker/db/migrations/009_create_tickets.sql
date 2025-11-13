-- 009_create_tickets.sql
-- 新增工单系统表与索引

CREATE TABLE
    IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        last_reply_by_admin_id INTEGER,
        last_reply_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
        updated_at DATETIME DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (last_reply_by_admin_id) REFERENCES users (id) ON DELETE SET NULL
    );

CREATE TABLE
    IF NOT EXISTS ticket_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        author_role TEXT NOT NULL CHECK(author_role IN ('user', 'admin')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_last_reply_at ON tickets (last_reply_at);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_author_role ON ticket_replies (author_role);
