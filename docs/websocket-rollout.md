# WebSocket 灰度与故障排查

## 上线前

1. Worker 执行 `worker/db/migrations/026_create_node_report_events.sql`。
2. server-rs 执行 `server-rs/db/migrations/006_create_node_report_events.sql`。
3. 确认节点的 `ApiHost` 使用正确的站点根地址，HTTPS 会自动转换为 `wss`。
4. 先保持节点 `PanelTransport: http`，只选择一个测试节点切换为 `websocket`。

## 本地验证

代码级验证可在仓库根目录分别执行：

```bash
cd worker && pnpm typecheck
cd ../server-rs && cargo fmt --all -- --check && cargo check && cargo test
cd ../peach && cargo fmt --all -- --check && cargo test
```

真实数据联调前，先执行对应数据库迁移；然后在 peach 节点配置中设置：

```yaml
PanelTransport: auto
```

确认 `auto` 能优先建立 `/api/v1/ws`，并在服务端不可用时回退 HTTP 后，再切换到 `websocket` 做强制长连接验证。

## 灰度步骤

1. 观察一个完整的 `pull_interval` 和 `push_interval` 周期。
2. 查看 Worker 日志中的 `Soga WebSocket message`，关注 `op`、`status`、`latencyMs`。
3. 查看 server-rs 的 `node WebSocket operation completed` 日志，确认认证和业务状态均成功。
4. 对比节点用户数、审计规则、白名单、节点状态和流量扣除结果。
5. 验证断开连接后 peach 会重新连接，并且重复 `event_id` 不会重复扣流量。
6. 逐步扩大节点范围；任何异常节点先切回 `PanelTransport: auto`，稳定后再切回 `websocket`。

## 回滚

- `websocket`：只使用 WebSocket，连接失败会报告错误。
- `auto`：优先聚合 WebSocket，失败后使用聚合 HTTP；旧面板不支持 `/api/v1/report` 时再回退到原单操作 HTTP。
- `http`：完全恢复原有 HTTP 请求路径，不使用 WebSocket 聚合。

## 观测指标

至少记录以下字段：连接建立/关闭次数、重连次数、`sync`/`report` 消息数、失败状态码、处理延迟、HTTP 回退次数、重复事件数。
Worker 的连接上限是单个 isolate 内的 best-effort 保护，不是跨 isolate 的全局配额；全局配额应通过边缘限流或 WAF 配置。
建议将连续 3 次 `sync` 或 `report` 失败、重复事件异常增长、流量扣除与节点上报不一致设置为告警。

## 数据库策略

`report` 已经把多个上报动作合并为一次协议消息，减少网络往返；数据库层仍按用户或 IP 行执行，以保持现有业务语义和错误边界。
Worker 在 D1 失败时释放事件，server-rs 在可识别的 SQL 失败时释放事件，客户端会按照同一事件 ID 重试。
去重事件保留 7 天，并在上报时清理过期记录。
