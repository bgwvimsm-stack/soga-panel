# 后端 API 摘要

按模块汇总常用接口，所有响应均采用 `{ success, data, message }` 格式。用户端请求需要 `Authorization: Bearer <token>`，Soga 节点请求需携带 `API-KEY / NODE-ID / NODE-TYPE` 头。

## Soga 兼容接口 `/api/v1/*`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/node` | 获取节点配置（Soga 拉取） |
| GET | `/api/v1/users` | 获取节点可用用户列表 |
| GET | `/api/v1/audit_rules` | 获取审计规则 |
| GET | `/api/v1/white_list` | 获取白名单 |
| POST | `/api/v1/traffic` | 上报用户流量 |
| POST | `/api/v1/alive_ip` | 上报在线 IP |
| POST | `/api/v1/audit_log` | 上报审计日志 |
| POST | `/api/v1/status` | 上报节点状态 |

## 认证与账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 邮箱密码登录 |
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/logout` | 注销（失效服务端会话） |
| POST | `/api/auth/send-email-code` | 注册验证码（需启用邮箱） |
| POST | `/api/auth/password-reset/request` | 密码重置验证码 |
| POST | `/api/auth/password-reset/confirm` | 重置密码 |
| GET | `/api/auth/register-config` | 返回注册/验证码开关状态 |
| POST | `/api/auth/google` | Google OAuth 登录 |
| POST | `/api/auth/github` | GitHub OAuth 登录 |

## 用户功能 `/api/user/*`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/user/profile` | 获取个人信息与流量统计 |
| PUT | `/api/user/profile` | 更新邮箱 / 用户名 |
| POST | `/api/user/change-password` | 修改密码 |
| GET | `/api/user/nodes` | 可访问节点列表（含状态） |
| GET | `/api/user/traffic/trends` | 流量趋势（天数查询） |
| GET | `/api/user/traffic/summary` | 周/月流量汇总 |
| POST | `/api/user/traffic/manual-update` | 手动触发流量同步 |
| POST | `/api/user/reset-subscription-token` | 重置订阅令牌 |
| GET | `/api/subscription/{client}` | 生成订阅（`v2ray` / `clash` / `quantumult` 等） |

## 管理后台 `/api/admin/*`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/users` | 用户列表、搜索筛选 |
| POST | `/api/admin/users` | 创建用户 |
| PUT | `/api/admin/users/:id` | 更新用户信息 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| GET | `/api/admin/user-stats` | 用户统计概览 |
| GET | `/api/admin/level-stats` | 等级统计 / 即将过期名单 |
| POST | `/api/admin/check-expired-levels` | 手动检测等级过期 |
| POST | `/api/admin/set-level-expiry` | 批量设置等级有效期 |
| GET | `/api/admin/traffic/trends` | 系统流量趋势 |
| POST | `/api/admin/traffic/daily-reset` | 手动执行每日流量重置 |
| GET | `/api/admin/traffic/overview` | 流量与活跃度概览 |
| GET | `/api/admin/announcements` | 公告列表（含禁用） |
| POST | `/api/admin/announcements` | 新建公告 |
| PUT | `/api/admin/announcements/:id` | 更新公告 |
| DELETE | `/api/admin/announcements/:id` | 删除公告 |
| GET | `/api/admin/system-configs` | 获取系统配置 |
| PUT | `/api/admin/system-configs` | 更新配置（单项/批量） |
| POST | `/api/admin/trigger-traffic-reset` | 触发调度任务 |
| GET | `/api/admin/scheduler-status` | 查看调度器状态 |

## 公共接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/announcements` | 用户端公告列表 |

更多业务细节请查阅源码及服务层实现。***
