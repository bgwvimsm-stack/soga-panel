-- 为 users 表新增注册 IP 字段，记录用户注册来源
ALTER TABLE users ADD COLUMN register_ip TEXT;
