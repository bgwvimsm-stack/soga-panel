# Soga Panel Server（MariaDB 版，自托管）

Node/Express 后端，复用 Worker 逻辑但改用 MariaDB/Redis，支持本地或服务器部署。

## 功能覆盖
- 授权与账户：注册/登录/登出、OAuth、邮件验证码、2FA、密码重置、会话缓存。
- 用户侧：资料修改、可用节点、订阅 Token 重置、订阅/流量/登录日志、在线 IP/设备、Bark 设置。
- 订阅输出：V2Ray/Clash/QuantumultX/Shadowrocket/Surge。
- Soga Node 接口：节点列表/用户列表/审计规则/白名单、流量/在线 IP/审计日志上报、节点状态上报。
- 商店与支付：套餐购买（优惠券）、钱包充值、礼品卡（余额/时长/流量/重置/套餐）、Epay/Epusdt 回调、支付状态查询、订单/充值导出。
- 返利与邀请：邀请码生成/重置、邀请列表、返利流水、提现申请与管理员审核、返利导出。
- 工单与公告：用户/管理员 CRUD、回复、状态更新。
- 管理端：用户/节点/共享 ID/礼品卡/配置管理、日志查看、缓存清理、系统统计、数据导出、任务工具（流量重置、流量汇总）。
- 定时任务：每日流量重置、等级过期检查、订阅日志清理、每日流量汇总（`daily_traffic`、`system_traffic_summary`）。

## 运行步骤
1. 复制 `.env.example` 为 `.env`，填写 MariaDB/Redis/邮件/支付参数（需要 Node 18+，全局 `pnpm`）。
2. 安装依赖：`pnpm install --filter ./server`。
3. 初始化数据库（示例）：`mysql -u <user> -p <db> < db/schema.mysql.sql`，或用 GUI 导入。
4. 开发启动：`pnpm --filter ./server dev`（默认端口 18787）。生产可用 `pnpm --filter ./server start` 或以 PM2/Systemd 托管。
5. 健康检查：访问 `/api/health`、`/api/database/test`。

## 主要配置（`.env`）
- 数据库：`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_CONNECTION_LIMIT/DB_TIMEZONE`
- Redis（可选）：`REDIS_HOST/REDIS_PORT/REDIS_DB/REDIS_PASSWORD/REDIS_PREFIX`
- 邮件：`MAIL_PROVIDER`（none/resend/smtp/sendgrid）、`MAIL_FROM`（Resend 需使用已验证域名或 `onboarding@resend.dev`）
  - Resend：`RESEND_API_KEY`（或兼容 `MAIL_RESEND_KEY`）
  - SMTP：`MAIL_SMTP_HOST/PORT/USER/PASS`（或兼容 `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS`）
  - SendGrid：`SENDGRID_API_KEY`
- 节点鉴权：`NODE_API_KEY`
- 支付：`EPAY_PID/EPAY_KEY/EPAY_API_URL/EPAY_NOTIFY_URL/EPAY_RETURN_URL`、`EPUSDT_TOKEN/EPUSDT_API_URL/EPUSDT_NOTIFY_URL/EPUSDT_RETURN_URL`
- 站点：`SITE_NAME/SITE_URL`

## 目录说明
- `src/app.ts`：Express 入口与中间件
- `src/config/`：环境变量、数据库/Redis 连接
- `src/db/`：D1 适配器
- `src/routes/`：业务路由
- `src/services/`：数据库/缓存/业务服务
- `src/utils/`：通用工具
- `src/scheduler.ts`：定时任务
- `db/schema.mysql.sql`：MariaDB 全量建表

## 流量汇总与任务
- 定时任务每日 00:05 重置今日流量；00:10 重置过期等级；00:20 汇总前一日流量到 `daily_traffic/system_traffic_summary`；01:00 清理 30 天前订阅日志。
- 管理员可调用 `POST /api/admin/task/traffic-reset`（支持指定用户）、`POST /api/admin/task/traffic-aggregate`（可指定日期，默认昨天）手动执行。

## 其他
- 登录/注册/支付等接口返回结构与 Worker 版保持一致，便于前端/客户端复用。
- 提交前可运行 `pnpm --filter ./server run build` 做类型与构建检查。
