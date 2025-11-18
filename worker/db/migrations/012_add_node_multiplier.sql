-- 为节点增加倍率与流量日志扣费信息的迁移

-- 节点倍率：用于控制不同节点的流量扣费比例
ALTER TABLE nodes ADD COLUMN traffic_multiplier REAL DEFAULT 1;

-- 流量日志实际扣费和倍率
ALTER TABLE traffic_logs ADD COLUMN actual_upload_traffic INTEGER DEFAULT 0;
ALTER TABLE traffic_logs ADD COLUMN actual_download_traffic INTEGER DEFAULT 0;
ALTER TABLE traffic_logs ADD COLUMN actual_traffic INTEGER DEFAULT 0;
ALTER TABLE traffic_logs ADD COLUMN deduction_multiplier REAL DEFAULT 1;
