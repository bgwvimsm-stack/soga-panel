# Repository Guidelines

## 项目结构与模块组织
- `frontend/`：基于 Vue 3 + Vite 的管理面板，核心页面与组件位于 `src/views` 与 `src/components`，公共状态在 `src/store`（Pinia）。
- `worker/`：Cloudflare Worker 后端，`src/` 目录存放路由与服务，`db/` 下含 D1 schema 及迁移脚本。
- `docs/`：设计、部署与集成文档；向贡献者解释上下游依赖时请优先引用此处。
- `mock-epay/` 与 `vue-pure-admin/`：分别用于支付联调和 UI 底座示例，仅在调试或升级 UI 体系时需要改动。

## 构建、测试与开发命令
- 首次安装：`pnpm install --filter ./worker`、`pnpm install --filter ./frontend`（需 Node 18+，全局安装 `wrangler`）。
- 后端本地调试：在 `worker/` 内运行 `pnpm dev` 使用 `wrangler dev` 启动 18787 端口，自动加载 `.dev.vars`。
- 前端开发：在 `frontend/` 中执行 `pnpm dev` 热重载，`pnpm build` 构建，`pnpm deploy` 会构建并通过 Wrangler Pages 推送 `dist/`。
- 数据库初始化示例：`wrangler d1 execute soga-panel-d1 --file=./db/db.sql --remote`；不要忽略生产配置中的 JWT、Soga WebAPI 与支付密钥。

## 代码风格与命名约定
- TypeScript、Vue、Worker 均使用 2 空格缩进；保持 ESLint/Vite 默认的单引号和分号风格。
- 组件与 Pinia store 使用 PascalCase（如 `UserDashboard.vue`），组合式函数采用 `useXxx` 命名。
- Worker 中的 handler 以资源名命名（`userRouter`, `orderService`），并通过 `export const` 暴露。
- 提交前运行 `pnpm --filter ./frontend run typecheck` 与 `pnpm --filter ./worker run typecheck`；必要时使用 `vue-tsc` 或 `tsc` 确保无隐式 `any`。

## 测试指引
- 目前以手动与端到端验证为主：前端通过 `pnpm dev` 联动 Worker，核对主要通路（登录、套餐、支付回调）。
- Worker 层提供 `pnpm test:email` 以验证邮件发送脚本；可在 `wrangler dev --remote` 下对接真实 D1 进行冒烟。
- 建议新增脚本时配套 `c8` 覆盖统计，并遵循 `tests/<feature>.spec.ts` 命名；将测试命令写入 `package.json` 以便 CI 继承。

## 提交与 Pull Request 规范
- Git 历史以动词开头的简洁英文/中英混合信息为主（如 `fix: auth refresh`、`add: 新增二步认证`）；请保持同样格式并附带作用域描述。
- PR 描述需包含：变更摘要、影响模块（前端/Worker/文档）、测试方式（命令或截图），以及关联 issue/工单链接。
- 若改动涉及部署或安全配置，请在 PR 中标注所需的环境变量或 Cloudflare 资源调整，便于审核与回滚。

## 安全与配置提示
- 不要在仓库提交 `.dev.vars`、D1 导出的密钥或支付证书；本地调试使用 `.example` 模板复制。
- 修改 `deploy.sh` 或 `wrangler*.toml` 时请同步更新 `docs/deployment-guide.md`，确保上线流程一致。
