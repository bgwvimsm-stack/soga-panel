# 模拟易支付服务 Docker 版本

## 简介

这是一个易支付接口的模拟服务器，使用 Node.js + Express 构建，支持 Docker 容器化部署。主要用于 soga-panel 项目的支付功能测试，无需真实的易支付商户账号即可测试完整的支付流程。

## 功能特性

- ✅ 完整的易支付接口模拟
- ✅ 支持多种支付方式（支付宝、微信、QQ钱包）
- ✅ MD5 签名验证
- ✅ 支付回调通知
- ✅ 订单状态查询
- ✅ Docker 容器化部署
- ✅ 健康检查
- ✅ 安全配置（非 root 用户运行）

## 快速开始

### 方法一：使用 Docker Compose（推荐）

1. 确保已安装 Docker 和 Docker Compose

2. 启动服务：
```bash
docker-compose up -d
```

3. 查看服务状态：
```bash
docker-compose ps
```

4. 查看日志：
```bash
docker-compose logs -f mock-epay
```

5. 停止服务：
```bash
docker-compose down
```

### 方法二：使用构建脚本

1. 运行构建脚本：
```bash
./build.sh
```

2. 使用 Docker Compose 启动：
```bash
docker-compose up -d
```

### 方法三：多架构构建并推送到 Docker Hub

如果你需要构建支持多架构（AMD64 + ARM64）的镜像并推送到 Docker Hub：

1. 设置环境变量：
```bash
export DOCKER_USERNAME=你的Docker Hub用户名
export IMAGE_NAME=mock-epay-server
export VERSION=latest
```

2. 运行多架构构建脚本：
```bash
./build-multiarch.sh
```

3. 使用 Docker Hub 镜像：
```bash
# 修改 docker-compose.hub.yml 中的用户名
# 然后启动服务
docker-compose -f docker-compose.hub.yml up -d
```

### 方法四：手动 Docker 构建

1. 构建镜像：
```bash
docker build -t mock-epay-server:latest .
```

2. 运行容器：
```bash
docker run -d -p 3001:3001 --name mock-epay mock-epay-server:latest
```

### 方法四：本地开发

如果需要修改代码或本地开发：

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start
```

## 配置说明

### 环境变量

可以通过环境变量自定义商户配置：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | 3001 | 服务端口 |
| `NODE_ENV` | production | 运行环境 |
| `MERCHANT_PID` | 114514 | 商户ID |
| `MERCHANT_KEY` | C4D038B4BED09FDB1471EF51EC3A32CD | 商户密钥 |
| `MERCHANT_NAME` | 测试商户 | 商户名称 |

### 修改配置

编辑 `docker-compose.yml` 文件中的 `environment` 部分：

```yaml
environment:
  - NODE_ENV=production
  - PORT=3001
  - MERCHANT_PID=你的商户ID
  - MERCHANT_KEY=你的商户密钥
  - MERCHANT_NAME=你的商户名称
```

## 接口说明

### 服务地址

- **服务地址**: http://localhost:3001
- **支付接口**: http://localhost:3001/submit.php
- **健康检查**: http://localhost:3001/health

### 主要接口

1. **支付提交接口**: `POST/GET /submit.php`
   - 处理支付请求，验证签名，生成支付订单

2. **订单查询接口**: `GET /api/order/:trade_no`
   - 获取指定订单的详细信息

3. **模拟支付完成**: `POST /api/pay/:trade_no`
   - 模拟用户完成支付操作

4. **订单状态查询**: `GET /api/query`
   - 查询订单支付状态

5. **健康检查接口**: `GET /health`
   - 检查服务运行状态

## 在 soga-panel 中使用

1. 修改 `worker/wrangler.toml` 配置：
```toml
[vars]
EPAY_API_URL = "http://localhost:3001"
```

2. 重启 soga-panel 后端服务

3. 在前端进行支付测试

## 支付流程

1. 用户发起支付请求
2. 系统调用 `/submit.php` 创建支付订单
3. 重定向到支付页面 `/pay.html`
4. 用户点击"支付成功"按钮模拟支付
5. 系统发送回调通知到 soga-panel
6. 支付流程完成

## 监控和日志

### 查看实时日志
```bash
docker-compose logs -f mock-epay
```

### 健康检查
```bash
curl http://localhost:3001/health
```

### 容器状态
```bash
docker-compose ps
```

## 故障排除

### 常见问题

1. **端口冲突**
   - 修改 `docker-compose.yml` 中的端口映射
   - 例如：`"3002:3001"` 改为使用 3002 端口

2. **签名验证失败**
   - 检查商户密钥配置是否正确
   - 确认 soga-panel 中的密钥与 Docker 容器中的一致

3. **无法访问服务**
   - 确认 Docker 服务正在运行
   - 检查防火墙设置
   - 验证端口映射配置

### 重置服务

如果遇到问题需要重置：

```bash
# 停止并删除容器
docker-compose down

# 重新构建和启动
docker-compose up -d --build
```

## 开发说明

### 重新构建镜像

代码修改后需要重新构建 Docker 镜像：

```bash
docker-compose down
docker-compose up -d --build
```

## 安全注意事项

- ⚠️ 此服务仅用于测试，不要在生产环境中使用
- ⚠️ 默认密钥仅供测试，生产环境请使用安全的密钥
- ⚠️ 建议运行在内网环境，避免暴露在公网

## 技术栈

- **后端**: Node.js + Express
- **签名算法**: MD5
- **容器化**: Docker + Docker Compose
- **基础镜像**: node:18-alpine

## 版本信息

- **版本**: 1.0.0
- **Node.js**: 18.x
- **Docker**: 支持 Docker Compose v3.8+