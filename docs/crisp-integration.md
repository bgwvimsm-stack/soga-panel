# Crisp 实时客服接入指南

项目默认支持集成 [Crisp](https://crisp.chat/) 在线客服。按以下步骤完成配置即可在前端展示客服窗口，并自动推送已登录用户信息。

## 1. 创建 Crisp 站点

1. 登录 [Crisp 后台](https://app.crisp.chat)。
2. 创建站点，记录 `Website ID`（UUID 形式）。

## 2. 配置前端环境变量

```bash
cd frontend
cp .env.production.example .env.production
```

在 `.env.production` 中填写：

```
VITE_CRISP_WEBSITE_ID=your-website-id
```

保存后重新部署生产环境 `pnpm run deploy`。

## 3. 功能说明

| 功能 | 描述 |
| --- | --- |
| 客服窗口显示 | 登录后的页面自动加载 Crisp，登录/错误页面自动隐藏。 |
| 用户信息推送 | 当用户已登录时，自动推送邮箱、用户名、等级、流量等信息到 Crisp 侧边面板。 |
| 路由更新 | 切换页面时会重新推送，确保信息实时同步。 |

## 4. 可选配置

- **隐藏指定页面**：在 `src/App.vue` 的 `hideOnRoutes` 数组中新增路径。
- **禁用用户信息推送**：在 Crisp 组件上设置 `:push-user-info="false"`。
- **手动推送信息**：通过组件引用调用 `pushUserInfoToCrisp()` 方法。

## 5. 常见问题

- **客服窗口未显示**：检查环境变量是否配置正确；确认 Crisp 脚本未被浏览器阻止。
- **用户信息缺失**：确保用户已登录且接口返回完整资料；可查看浏览器控制台日志定位错误。
- **某些页面需要隐藏**：将路径加入 `hideOnRoutes` 或增加自定义逻辑。

更多高级配置可参考 Crisp 官方文档：<https://docs.crisp.chat>。***
