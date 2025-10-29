-- 数据库升级脚本 - 2025年9月21日
-- 功能：添加套餐推荐标识、排序权重和智能补差额购买支持

-- 1. 为 package_purchase_records 表添加 package_price 字段
-- 用于存储套餐原价，支持智能补差额购买功能
ALTER TABLE package_purchase_records ADD COLUMN package_price DECIMAL(10,2);

-- 2. 为 packages 表添加 is_recommended 字段
-- 用于标识推荐套餐（0-否，1-是）
ALTER TABLE packages ADD COLUMN is_recommended INTEGER DEFAULT 0;

-- 3. 为 packages 表添加 sort_weight 字段
-- 用于套餐排序权重（数字越大排序越靠前）
ALTER TABLE packages ADD COLUMN sort_weight INTEGER DEFAULT 0;

-- 4. 设置高级套餐为推荐套餐并给予最高权重
UPDATE packages SET is_recommended = 1, sort_weight = 100 WHERE name = '高级套餐';

-- 升级说明：
-- 1. package_price 字段支持智能补差额购买，当用户余额不足时只需支付差额
-- 2. is_recommended 字段控制套餐是否显示推荐标签和特殊边框
-- 3. sort_weight 字段控制套餐显示顺序，权重越高排序越靠前
-- 4. 所有新字段都有默认值，不会影响现有数据