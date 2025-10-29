#!/bin/bash
# 模拟易支付服务 Docker 构建脚本

set -e

echo "🚀 开始构建模拟易支付 Docker 镜像..."

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 package.json 是否存在
if [ ! -f "package.json" ]; then
    echo "❌ 错误: package.json 文件不存在"
    exit 1
fi

# 构建 Docker 镜像
echo "📦 构建 Docker 镜像..."
if docker build -t mock-epay-server:latest .; then
    echo "✅ Docker 镜像构建成功！"
    echo ""
    echo "🔧 使用方法:"
    echo "1. 使用 Docker Compose 启动服务:"
    echo "   docker-compose up -d"
    echo ""
    echo "2. 或者直接运行 Docker 容器:"
    echo "   docker run -d -p 3001:3001 --name mock-epay mock-epay-server:latest"
    echo ""
    echo "3. 查看服务状态:"
    echo "   docker-compose ps"
    echo ""
    echo "4. 查看服务日志:"
    echo "   docker-compose logs -f mock-epay"
    echo ""
    echo "5. 停止服务:"
    echo "   docker-compose down"
    echo ""
    echo "📱 服务将在 http://localhost:3001 启动"
    echo "💰 支付接口: http://localhost:3001/submit.php"
    echo "🏥 健康检查: http://localhost:3001/health"
else
    echo "❌ Docker 镜像构建失败！"
    exit 1
fi