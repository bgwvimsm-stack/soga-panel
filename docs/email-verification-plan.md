# 邮箱验证码注册方案

## 1. 现有注册流程梳理

- **后端接口**：`POST /api/auth/register` 由 `worker/src/api/auth.ts` 的 `register` 方法提供，当前逻辑仅校验邮箱、用户名、密码是否填写，检查重复用户后直接创建账号并自动登录。
- **系统配置依赖**：注册流程依赖 `system_configs` 表中的 `register_enabled`、`default_traffic`、`default_expire_days`、`default_account_expire_days`、`default_class` 等字段，不包含任何邮件相关配置。
- **缓存处理**：注册成功后会在 `CacheService` 中写入 `session_${token}`，并调用 `deleteByPrefix("user_")` 以刷新用户缓存。
- **前端交互**：`frontend/src/views/auth/register.vue` 使用 `/auth/register` 接口提交邮箱、用户名、密码，成功后直接登录并跳转仪表盘，页面上没有验证码输入或发送邮件的交互。
- **其他相关模块**：当前项目没有邮件发送服务或验证码数据表，数据库 `db.sql` 和迁移目录中也没有与注册验证码相关的结构。

## 2. 邮件服务方案评估

### Resend
- **优势**
  - 提供面向 Cloudflare Workers 的 `@resend/cloudflare` SDK，可直接在 Edge 环境内调用。
  - 支持模板管理、抄送/密送、丰富的 API 响应，便于追踪邮件状态。
  - 配置简单，只需 `RESEND_API_KEY` 且默认使用 Resend 域或已验证域名。
- **注意事项**
  - 需要付费/限额，需在文档中提示管理员申请 API Key。
  - 发送域名需要在 Resend 平台完成验证。

### SMTP（worker-mailer）
- **优势**
  - 兼容传统邮件服务商（如自建 Postfix、腾讯企业邮等），灵活度高。
  - `worker-mailer` 库封装 SMTP over Cloudflare Workers 的细节，可直接复用。
- **注意事项**
  - 需要维护 SMTP 凭据（主机、端口、用户名、密码、加密方式），在配置上更复杂。
  - 对于部分供应商可能需要额外处理 TLS/STARTTLS 兼容性，需在文档中注明。
  - 需要额外关注重试策略，避免 SMTP 失败重试造成阻塞。

### 推荐方案
- 通过配置项选择 `MAIL_PROVIDER`（`resend` 或 `smtp`），默认推荐使用 Resend（更符合 Workers 环境且实现简单）。
- 抽象统一的 `EmailService` 接口，根据配置注入对应驱动，实现可插拔。
- 针对两种驱动都提供配置检测与错误日志，防止运行时因缺少凭据导致失败。

## 3. 验证码生命周期策略

- **验证码格式**：6 位数字验证码，生成时即写入数据库，存储哈希值（使用 SHA-256）以避免明文泄露。
- **有效期**：10 分钟，字段 `expires_at` 记录到期时间；注册时校验当前时间需在有效期内。
- **请求频率限制**：
  - 单邮箱：60 秒内仅允许请求一次验证码，24 小时最多 5 次（可通过查询近 24 小时记录判断）。
  - 单 IP：每小时最多 10 次，超过则返回提示，防止批量滥用。
- **验证次数限制**：每条记录最多允许 5 次尝试，字段 `attempts` 记录失败次数；超过限制后强制失效。
- **清理策略**：
  - 注册成功或验证码验证通过后立即删除/标记 `used_at`。
  - 定时任务（Scheduler）每日清理过期并已失效的记录；若短期内无法实现定时任务，则在发送/验证时执行惰性清理。
- **安全校验**：
  - 对请求加上 `CF-Connecting-IP` 记录，必要时结合 `user-agent` 做简易风控。
  - 对连续失败的邮箱/IP 触发短暂封禁（例如 15 分钟内拒绝新的验证码发送），利用 `CacheService` 保存封禁状态。
  - 所有关键路径打印结构化日志，便于排查发送、验证问题。

## 4. 环境变量规划

| 变量名 | 示例值 | 说明 |
| --- | --- | --- |
| `MAIL_PROVIDER` | `resend` / `smtp` | 选择邮件发送驱动 |
| `MAIL_FROM` | `no-reply@example.com` | 默认发件人地址（需在邮箱服务商验证） |
| `RESEND_API_KEY` | `re_xxx` | Resend API Key，`MAIL_PROVIDER=resend` 时必填 |
| `SMTP_HOST` | `smtp.example.com` | SMTP 主机地址，`MAIL_PROVIDER=smtp` 时使用 |
| `SMTP_PORT` | `587` | SMTP 端口，字符串形式存储，便于从环境变量读取 |
| `SMTP_USER` / `SMTP_PASS` | `user@example.com` / `secret` | SMTP 认证凭据 |
| `SMTP_SECURE` | `true` / `false` | 是否启用 TLS（`true`=SMTPS/STARTTLS） |
| `SENDGRID_API_KEY` | `sg_xxx` | 当使用 SendGrid 发送邮件时需要配置 |
| `MAIL_VERIFICATION_EXPIRE_MINUTES` | `10` | 验证码有效期（分钟），提供代码默认值 |
| `MAIL_VERIFICATION_COOLDOWN_SECONDS` | `60` | 单邮箱发送冷却时间 |
| `MAIL_VERIFICATION_DAILY_LIMIT` | `5` | 单邮箱每日发送上限 |
| `MAIL_VERIFICATION_IP_HOURLY_LIMIT` | `10` | 单 IP 每小时发送上限 |
| `MAIL_VERIFICATION_ATTEMPT_LIMIT` | `5` | 验证码校验失败次数上限 |

> 这些变量在 `wrangler.toml`、`wrangler-dev.toml` 与 `wrangler.toml.template` 中提供默认值或占位符，并在代码中作为系统配置的默认回退。

## 5. 系统配置扩展

- `register_email_verification_enabled`：是否启用注册验证码（默认 `1`，可通过后台关闭）。
- 邮件模板与文案放置于 `worker/src/api/email/` 目录，由代码集中维护；环境变量负责有效期、冷却时间等运行参数。

## 6. 数据库设计

### 新增表：`email_verification_codes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PK | 主键，自增 |
| `email` | TEXT | 接收验证码的邮箱地址 |
| `purpose` | TEXT | 验证码用途（`register`/`password_reset` 等） |
| `code_hash` | TEXT | 验证码 SHA-256 哈希 |
| `expires_at` | DATETIME | 到期时间（UTC+8） |
| `attempts` | INTEGER | 已尝试验证次数 |
| `request_ip` | TEXT | 请求验证码的 IP |
| `user_agent` | TEXT | 请求时的 User-Agent |
| `created_at` | DATETIME | 发送时间 |
| `used_at` | DATETIME | 验证成功时间（用于清理） |

索引：
- `idx_email_verification_email`：按邮箱快速查询最新验证码记录。
- `idx_email_verification_expires_at`：按到期时间清理过期记录。
- `idx_email_verification_used_at`：辅助删除已使用的记录。

## 7. API 设计

- `POST /api/auth/send-email-code`
  - 请求参数：`{ email: string }`
  - 返回数据：`{ message, cooldown, expire_minutes }`
  - 限速策略：单邮箱冷却、每日上限、单 IP 每小时上限。
  - 侧写：发送前会失效旧验证码，发送失败回滚插入记录。
- `POST /api/auth/register`
  - 新增参数：`verificationCode`（或 `verification_code`）。
  - 提交前需在 `email_verification_codes` 中校验哈希、有效期和失败次数，成功后标记 `used_at`。
- 日志策略：关键流程通过结构化日志记录成功、失败与限流原因，便于排查。

## 8. 前端改造

- 注册页新增验证码输入和发送按钮，支持倒计时显示和请求状态提示。
- `RegisterRequest` 类型扩展 `verificationCode` 字段，`auth.ts` 新增 `sendRegisterEmailCode` API。
- UI 调整：移除测试用一键注册入口，优化验证码按钮样式与响应式表现。
- 提示文案：默认中文提示已包含验证码说明，后续需在中英文文案文件中补充。

## 9. 本地验证脚本

- 新增 `worker/test/email-verification.mjs`，可通过 `npm run test:email`（在 `worker` 目录）交互式验证发送验证码与注册流程。
- 支持从命令行输入测试邮箱、自动生成用户名/密码，并在注册接口返回后输出结果。
- 依赖运行中的 `wrangler dev`，方便在开发环境快速回归邮箱验证码链路。

## 10. 找回密码流程扩展

- 在 `email_verification_codes` 中使用 `purpose=password_reset` 保存密码重置验证码，与注册流程隔离限流策略。
- 新增接口：
  - `POST /api/auth/password-reset/request`：校验邮箱存在后发送验证码，遵循与注册类似的冷却/频率限制。
  - `POST /api/auth/password-reset/confirm`：验证验证码、设置新密码、失效所有会话并清理历史验证码。
- 新增系统配置项 `password_reset_*` 系列（启用开关、模板、限流参数），默认与注册保持一致，可独立调整。
- 前端新增 `/auth/forgot-password` 页面，提供发送验证码与重置密码表单；登录页追加「忘记密码」入口。
