-- 为套餐购买记录表添加 paid_at 字段
-- paid_at: 支付完成时间（UTC+8时区）
-- 用于记录套餐订单的实际支付时间，与 created_at（订单创建时间）区分

ALTER TABLE package_purchase_records ADD COLUMN paid_at DATETIME;

-- 为 paid_at 字段创建索引，方便按支付时间查询
CREATE INDEX IF NOT EXISTS idx_package_purchase_records_paid_at ON package_purchase_records (paid_at);

-- 对于已经支付的历史订单（status=1），将 paid_at 设置为 created_at
-- 这样历史数据也有支付时间记录
UPDATE package_purchase_records
SET paid_at = created_at
WHERE status = 1 AND paid_at IS NULL;
