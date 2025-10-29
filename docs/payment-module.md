# 套餐与支付模块说明

## 功能概览

钱包与套餐模块覆盖以下场景：

- 用户余额查询、充值、充值记录
- 套餐列表、筛选、详情与购买记录
- 易支付（Epay）在线付款、支付回调、订单状态同步
- 管理端套餐 CRUD、统计、充值/购买记录查看

## 数据结构

- `users.money`：余额字段（DECIMAL，默认 0）
- `packages`：套餐定义，包含价格、流量、时长、等级等
- `recharge_records`：充值订单，记录支付方式、金额与状态
- `package_purchase_records`：套餐订单，记录支付方式、状态与发货详情

数据库迁移脚本位于 `worker/db/apply_migrations.sql`，演示数据见 `insert_package_data.sql`。

## 核心 API

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 钱包 | `GET /api/wallet/money` | 查询余额 |
| 钱包 | `POST /api/wallet/recharge` | 创建充值订单 |
| 钱包 | `GET /api/wallet/recharge-records` | 分页查询充值记录 |
| 套餐 | `GET /api/packages` | 套餐列表（支持筛选、排序） |
| 套餐 | `POST /api/packages/purchase` | 余额/在线购买 |
| 套餐 | `GET /api/packages/purchase-records` | 购买记录 |
| 支付 | `GET /api/payment/create` | 生成支付链接 |
| 支付 | `GET /api/payment/status/:trade_no` | 查询支付状态 |
| 支付 | `POST /api/payment/callback` | 易支付回调（服务器） |
| 支付 | `GET /api/payment/notify` | 易支付通知（浏览器） |
| 管理 | `GET /api/admin/packages` | 套餐管理列表 |
| 管理 | `POST /api/admin/packages` | 新建套餐 |
| 管理 | `GET /api/admin/recharge-records` | 查看充值记录 |
| 管理 | `GET /api/admin/purchase-records` | 查看购买记录 |

更多字段信息可直接查阅 `worker/src/api` 相关实现。

## 环境变量

易支付相关配置必须写入 Cloudflare 环境变量或 `wrangler secret`：

```
EPAY_PID            # 商户 ID
EPAY_KEY            # 商户密钥
EPAY_API_URL        # 易支付网关地址
EPAY_NOTIFY_URL     # 支付异步通知回调
EPAY_RETURN_URL     # 支付完成跳转地址
```

邮件验证码或其他支付方式可在后续扩展，详见 `docs/deployment-guide.md`。

## 业务流程

### 余额充值

1. 用户创建充值订单，系统记录状态为“待支付”。
2. 跳转易支付页面完成付款。
3. 易支付回调 `POST /api/payment/callback`，系统校验签名、更新状态，并增加余额。
4. 前端轮询 `GET /api/payment/status/:trade_no` 同步状态。

### 套餐购买

- **余额支付**：余额充足时直接扣减余额，立即激活套餐（更新等级、有效期、流量等）。
- **在线支付**：生成 `purchase_` 前缀的交易号；支付成功后回调同样走易支付流程，再补发套餐权益。

套餐激活遵循以下规则：

- 未过期等级：在原有效期基础上叠加。
- 已过期或无等级：从当前时间起重新计算。
- 流量：在当前额度基础上递增。
- 速度/设备限制：覆盖为套餐配置。

## 安全要点

- 所有支付回调均需校验签名，防止伪造请求。
- `recharge_records` 与 `package_purchase_records` 避免重复执行（使用状态字段与幂等更新）。
- 余额更新与套餐激活均封装在数据库事务中，避免并发冲突。
- 接口均要求 `Bearer Token`，管理员路径需额外校验 `is_admin`。

## 测试建议

1. **API 用例**：充值、购买、退款、余额不足等场景。
2. **回调模拟**：使用易支付沙箱或手动构造回调请求校验签名。
3. **异常流程**：网络中断、重复回调、支付失败等。
4. **并发测试**：同一订单多次请求，验证状态幂等。

更多细节与调试命令可在 `docs/backend-api.md` 和源码中查阅。欢迎根据业务继续扩展。***
