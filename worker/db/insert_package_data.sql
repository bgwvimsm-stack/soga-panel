-- 插入套餐测试数据
-- 时间: 2025-09-21
-- 描述: 为套餐功能添加一些测试套餐数据

-- Mini套餐
INSERT INTO packages (name, price, traffic_quota, validity_days, speed_limit, device_limit, level, status, is_recommended, sort_weight)
VALUES
    ('Mini月付套餐', 10, 100, 30, 100, 3, 1, 1, 0, 100),
    ('Mini季度套餐', 30, 300, 90, 100, 3, 1, 1, 1, 99),
    ('Mini半年套餐', 60, 600, 180, 100, 3, 1, 1, 0, 98),
    ('Mini年度套餐', 120, 1200, 365, 200, 5, 1, 1, 0, 97);

-- Pro套餐
INSERT INTO packages (name, price, traffic_quota, validity_days, speed_limit, device_limit, level, status, is_recommended, sort_weight)
VALUES
    ('Pro月付套餐', 20, 200, 30, 200, 5, 2, 1, 0, 90),
    ('Pro季度套餐', 60, 600, 90, 200, 5, 2, 1, 1, 89),
    ('Pro半年套餐', 120, 1200, 180, 200, 5, 2, 1, 0, 88),
    ('Pro年度套餐', 240, 2400, 365, 500, 8, 2, 1, 0, 87);

-- ProMax套餐
INSERT INTO packages (name, price, traffic_quota, validity_days, speed_limit, device_limit, level, status, is_recommended, sort_weight)
VALUES
    ('ProMax月付套餐', 30, 300, 30, 500, 8, 3, 1, 0, 80),
    ('ProMax季度套餐', 90, 900, 90, 500, 8, 3, 1, 1, 79),
    ('ProMax半年套餐', 180, 1800, 180, 500, 8, 3, 1, 0, 78),
    ('ProMax年度套餐', 360, 3600, 365, 800, 10, 3, 1, 0, 77);