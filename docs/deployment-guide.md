# 部署指南（Cloudflare Workers + Pages）

本项目包含 Cloudflare Workers 后端与 Vue 前端两部分，可按以下步骤完成部署。

## 1. 准备工作

- Node.js 22 LTS（建议使用 [nvm](https://github.com/nvm-sh/nvm) 安装）  
- pnpm ≥ 8（`npm i -g pnpm`）  
- 全局 Wrangler CLI（`npm i -g wrangler`）  
- 已登录的 Cloudflare 账号

## 2. 安装依赖

```bash
pnpm install --filter ./worker
pnpm install --filter ./frontend
```

或分别进入目录执行 `pnpm install`。

## 3. 创建并绑定 D1 数据库

```bash
cd worker
wrangler d1 create soga-panel-d1
```

在 `wrangler.toml` 的 `[[d1_databases]]` 节写入返回的 `database_id`，例如：

```toml
[[d1_databases]]
binding = "DB"
database_name = "soga-panel-d1"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## 4. 初始化数据库

```bash
wrangler d1 execute soga-panel-d1 --file=./db/db.sql --remote
wrangler d1 execute soga-panel-d1 --file=./db/insert_required_data.sql --remote
# 可选：导入演示套餐数据
wrangler d1 execute soga-panel-d1 --file=./db/insert_package_data.sql --remote
```

## 5. 配置环境变量

在 `wrangler.toml` 的 `[vars]` 区域设置：

```toml
JWT_SECRET = "your-secure-secret"
WEBAPI_KEY = "your-soga-api-key"
MAIL_PROVIDER = "none"           # none / resend / smtp / sendgrid
MAIL_FROM = "no-reply@example.com"
```

若启用邮件验证码，请在 Cloudflare 控制台写入对应密钥（如 `RESEND_API_KEY` 或 `SMTP_*`）。易支付等支付相关变量请参考《payment-module.md》。

## 6. 部署后端 Worker

```bash
cd worker
wrangler deploy
```

部署完成后，访问 `https://<worker-name>.workers.dev/api/health` 验证服务状态。

## 7. 构建并部署前端

```bash
cd frontend
pnpm run deploy
```

也可将 `dist/` 部署到其他静态托管服务。

## 8. 运行时检查

- `wrangler tail` 查看实时日志  
- `wrangler d1 execute ... --command="SELECT * FROM users LIMIT 5"` 检查数据  
- 前端登录后台（默认账号 `admin@example.com / admin123`，上线后请尽快修改）  

更多安装脚本与自动化步骤可参考 `docs/frontend-guides.md`、`docs/backend-overview.md`。***
