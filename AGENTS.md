# Repository Guidelines

## 语言要求
- 始终使用中文交流与文档说明。

## 项目结构与模块组织
- `frontend/`：Vue 3 + Vite 前端（用户端 + 管理端），核心目录为 `src/views`、`src/components`、`src/api`、`src/store`。
- `worker/`：Cloudflare Workers 后端（D1 数据库），包含 `src/` 业务逻辑与 `db/` SQL/迁移脚本。
- `server/`：Node/Express 自托管后端（MariaDB/Redis），用于非 Cloudflare 部署场景。
- `server-rs/`：Rust + Axum 自托管后端（MariaDB/Redis），接口目标与 `worker/server` 保持兼容。
- `docs/`：部署、架构与模块文档，涉及流程或配置调整时优先同步此目录。
- `mock-epay/`：支付联调 mock 服务；`vue-pure-admin/`：前端底座参考工程（仅升级底座时改动）。

## 推荐开发路径
- 默认主链路：`worker + frontend`（Cloudflare Workers + Pages）。
- 自托管链路：`server + frontend` 或 `server-rs + frontend`。
- 变更接口/字段时，优先确认三套后端的一致性（至少保证当前目标部署链路完整可用）。

## 构建、测试与开发命令
- 环境要求：Node.js >= 18.12（CI 使用 Node 20）、pnpm、Wrangler；Rust 链路需安装稳定版 Rust/Cargo。
- 前端开发（`frontend/`）：
  - `pnpm install`
  - `pnpm dev`
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm deploy`（构建并发布 Pages）
- Worker 开发（`worker/`）：
  - `pnpm install`
  - `pnpm dev`（默认 18787，使用 `wrangler-dev.toml`）
  - `pnpm deploy`
  - `pnpm typecheck`
  - `pnpm test:email`
- Node 后端开发（`server/`）：
  - `pnpm install`
  - `pnpm dev`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm start`
- Rust 后端开发（`server-rs/`）：
  - `cargo check`
  - `cargo run -- -c ../server/.env`
  - `cargo build --release`
  - `bash scripts/build-binaries.sh`（多目标构建）

## 数据库初始化与迁移
- Worker（D1）常用初始化：
  - `wrangler d1 execute <db-name> --file=./db/db.sql --remote`
  - `wrangler d1 execute <db-name> --file=./db/insert_required_data.sql --remote`
  - `wrangler d1 execute <db-name> --file=./db/insert_package_data.sql --remote`（可选）
- Node/Rust（MariaDB）常用初始化：
  - `mysql -u <user> -p <db> < server/db/schema.mysql.sql`
  - `mysql -u <user> -p <db> < server/db/insert_required_data.mysql.sql`
  - `mysql -u <user> -p <db> < server/db/insert_package_data.mysql.sql`（可选）
- 修改数据模型时，需同步检查：
  - `worker/db/db.sql` 与 `worker/db/migrations/`
  - `server/db/schema.mysql.sql` 与 `server/db/migrations/`
  - 受影响的 API 与前端字段映射

## 代码风格与命名约定
- 默认 UTF-8、LF、2 空格缩进（参照 `frontend/.editorconfig`）。
- TypeScript/Vue 现有代码风格以双引号和分号为主，遵循仓库既有格式，不混用风格。
- Vue 页面文件多采用 kebab-case（如 `shared-ids.vue`），通用组件使用 PascalCase（如 `LanguageSwitcher.vue`）。
- 组合式函数使用 `useXxx` 命名；后端服务/路由文件按领域命名（`auth`、`traffic`、`ticket` 等）。
- Rust 代码提交前运行 `cargo fmt`（如环境已安装 rustfmt）。

## 测试与验证指引
- 提交前至少执行目标模块的类型检查与构建：
  - `frontend`: `pnpm typecheck` + `pnpm build`
  - `worker`: `pnpm typecheck`
  - `server`: `pnpm typecheck` + `pnpm build`
  - `server-rs`: `cargo check`
- 当前项目仍以联调验证为主，关键回归路径：
  - 登录/注册/找回密码
  - 套餐购买与支付回调
  - 订阅链接生成与节点拉取（`/api/v1/*`）
  - 管理端用户、节点、公告、工单、流量统计

## 提交与 Pull Request 规范
- Commit 建议使用动词开头 + 作用域：`fix(auth): ...`、`feat(payment): ...`、`docs(deploy): ...`。
- PR 必填信息：
  - 变更摘要
  - 影响模块（`frontend/worker/server/server-rs/docs`）
  - 验证方式（命令、截图、关键接口）
  - 关联 issue/工单
- 涉及部署或配置变更时，明确列出新增/修改的环境变量与 Cloudflare/MariaDB/Redis 资源需求。

## 安全与配置提示
- 禁止提交密钥与敏感配置：`.env`、`.dev.vars`、`wrangler.toml` 实例、支付证书、数据库导出。
- 本地调试优先使用模板文件（如 `*.template`、`.env.*.example`）复制后再改。
- 修改 `deploy.sh`、`wrangler*.toml*`、数据库初始化脚本时，需同步更新 `docs/deployment-guide.md` 与相关模块文档。
