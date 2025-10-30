# Soga Panel

一体化的代理面板方案：后端运行在 **Cloudflare Workers + D1**，前端基于 **Vue 3 + TypeScript + Element Plus**。兼容 Soga v1 WebAPI，即开即用。

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [`docs/frontend-overview.md`](docs/frontend-overview.md) | 前端架构、目录与启动指引 |
| [`docs/backend-overview.md`](docs/backend-overview.md) | Worker 结构、数据库脚本、运行环境 |
| [`docs/backend-api.md`](docs/backend-api.md) | 常用 API 入口速览 |
| [`docs/deployment-guide.md`](docs/deployment-guide.md) | 详细部署步骤（依赖、D1、环境变量、发布） |
| [`docs/payment-module.md`](docs/payment-module.md) | 套餐 / 钱包 / 支付模块设计与流程 |
| [`docs/crisp-integration.md`](docs/crisp-integration.md) | Crisp 客服集成配置 |

## 仓库结构

```
soga-panel/
├── worker/    # 后端 Cloudflare Worker 与数据库脚本
├── frontend/  # Vue 3 前端应用
└── docs/      # 维护文档与模块说明
```

## 快速开始

```bash
# 安装依赖（Node.js 22+、pnpm）
npm install -g wrangler
pnpm install --filter ./worker
pnpm install --filter ./frontend

# 初始化 D1（需先登录 Cloudflare）
cd worker
wrangler d1 create soga-panel-d1
wrangler d1 execute soga-panel-d1 --file=./db/db.sql --remote

# 部署 Worker
wrangler deploy

# 构建并部署前端
cd ../frontend
pnpm run build
wrangler pages deploy dist --project-name=soga-panel-frontend
```

部署过程中需要配置 JWT、Soga WebAPI 密钥、邮件与支付参数等环境变量，详见《docs/deployment-guide.md》《docs/payment-module.md》。

默认管理员账号：`admin@example.com / admin123`（请上线后立即修改）。***
