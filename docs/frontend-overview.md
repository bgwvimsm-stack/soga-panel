# 前端概览

本项目的前端基于 **Vue 3 + TypeScript + Vite** 构建，结合 Element Plus、Pinia、Vue Router 等组件库，实现用户端与后台管理端的完整界面。

## 目录结构

```
frontend/
├── src/
│   ├── api/        # Axios 封装与接口定义
│   ├── components/ # 通用组件
│   ├── layouts/    # 页面布局
│   ├── router/     # 路由与权限守卫
│   ├── store/      # Pinia 状态模块
│   ├── utils/      # 工具函数
│   └── views/      # 页面（用户端、管理员端）
├── public/         # 静态资源
├── vite.config.ts  # 构建配置
└── package.json    # 依赖列表
```

## 主要功能

- 登录 / 注册（支持开启注册邮箱验证码）
- 用户仪表盘、节点列表、流量统计、订阅管理、个人资料
- 管理员仪表盘、用户管理、公告管理、系统配置
- 多语言与暗黑主题切换（可按需扩展）
- Axios 拦截器、全局错误提示、权限路由守卫

## 本地开发

```bash
cd frontend
pnpm install
pnpm run dev
```

- 默认端口：`http://localhost:8848`
- API 代理指向本地或远程 Worker（见 `.env.*` 配置）

## 构建与部署

```bash
pnpm run build
pnpm run preview    # 构建后本地预览
```

生产构建输出至 `dist/` 目录，可部署至任意静态服务器（如 Nginx、Cloudflare Pages 等）。

## 环境变量示例

```
VITE_API_BASE_URL=/api
VITE_BACKEND_URL=https://your-worker.workers.dev
VITE_DEV_PROXY=true
```

根据部署环境调整后端地址、是否开启代理等。

## 设计与体验要点

- Element Plus 主题定制，整体风格简洁现代
- 所有表单具备实时校验与明确提示
- 异步请求有 Loading / 错误反馈
- 关键页面支持响应式布局，移动端可用

如需新增页面或模块，可参考现有 `views` 与 `api` 目录结构快速扩展。***
