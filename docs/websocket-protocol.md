# Soga 面板 WebSocket 协议 v1

该协议用于节点后端（peach）与面板 Worker 或 server-rs 之间的长连接通信。
保留原有 HTTP API，并支持聚合 `sync`/`report` 操作；单操作消息仍可用于兼容、灰度和回退。

## 连接

- 地址：`/api/v1/ws`
- 方法：HTTP `GET` + WebSocket Upgrade
- 认证请求头：`API-KEY`、`NODE-ID`、`NODE-TYPE`
- 密钥只放在握手请求头，不放入 URL 或 query string。
- `https` 面板地址转换为 `wss`，`http` 转换为 `ws`。
- 服务端直接使用 Worker WebSocket，不使用 Durable Objects。

## 请求

```json
{
  "v": 1,
  "id": 1,
  "op": "get_node",
  "payload": null,
  "event_id": null
}
```

`id` 在当前连接内唯一，服务端在响应中原样返回。`payload` 与对应 HTTP API 的 JSON body 一致。
上报操作必须带稳定的 `event_id`；同一节点、同一操作和同一 `event_id` 重复到达时，服务端返回成功但不再次执行数据库写入。

支持的操作：

| op | HTTP 对应 | 方法 |
| --- | --- | --- |
| `sync` | `/api/v1/node`、`/users`、`/audit_rules`、`/white_list` | 聚合 GET |
| `report` | `/api/v1/report` | 聚合 POST |
| `get_node` | `/api/v1/node` | GET |
| `get_users` | `/api/v1/users` | GET |
| `get_audit_rules` | `/api/v1/audit_rules` | GET |
| `get_xray_rules` | `/api/v1/xray_rules` | GET |
| `get_white_list` | `/api/v1/white_list` | GET |
| `submit_traffic` | `/api/v1/traffic` | POST |
| `submit_alive_ip` | `/api/v1/alive_ip` | POST |
| `submit_audit_log` | `/api/v1/audit_log` | POST |
| `submit_status` | `/api/v1/status` | POST |

`sync` 的 `data` 包含 `node`、`users`、`audit_rules`、`white_list`。
`report` 的 `payload` 使用以下字段，字段为空时不会执行对应操作：

```json
{
  "status": {},
  "traffic": [{"id": 1, "u": 10, "d": 20}],
  "alive_ip": [{"id": 1, "ips": ["203.0.113.1"]}],
  "audit_log": [{"user_id": 1, "audit_id": 2}]
}
```

## 响应

```json
{
  "v": 1,
  "id": 1,
  "ok": true,
  "status": 200,
  "data": {},
  "message": null
}
```

业务处理完成后才返回 `ok: true`。HTTP 业务错误会保留原状态码并返回 `ok: false`，`message` 为错误说明。

## 控制行为

- 服务端接受 WebSocket 后可发送 `ping`，客户端回复 WebSocket Pong。
- 收到非法 JSON、版本不支持或未知 `op` 时返回带原 `id`（若可解析）的错误响应，连接保持打开。
- 单个文本消息最大 4 MiB；超过限制后服务端以 1009 关闭连接。
- 连接异常或请求超时由客户端重连；`auto` 传输模式在连接失败时回退到 HTTP。
- `report` 内部按状态、流量、在线 IP、审计日志顺序执行；每个子操作使用同一事件 ID 和各自操作名去重。
- 上报去重事件保留 7 天；业务处理失败会释放事件，允许客户端重试。
