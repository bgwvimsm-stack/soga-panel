#!/bin/bash
# 多架构 Docker 镜像构建和发布脚本
# 支持 AMD64 (X86_64) 和 ARM64 (Apple Silicon) 架构

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
DOCKER_USERNAME="${DOCKER_USERNAME:-}"
IMAGE_NAME="${IMAGE_NAME:-mock-epay-server}"
VERSION="${VERSION:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

echo -e "${BLUE}🚀 多架构 Docker 镜像构建脚本${NC}"
echo -e "${BLUE}支持架构: ${PLATFORMS}${NC}"
echo ""

# 检查必要的工具
echo -e "${YELLOW}🔍 检查依赖工具...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ 错误: Docker 未安装${NC}"
    exit 1
fi

if ! docker buildx version &> /dev/null; then
    echo -e "${RED}❌ 错误: Docker Buildx 不可用${NC}"
    echo -e "${YELLOW}请确保 Docker Desktop 已安装并启用 Buildx${NC}"
    exit 1
fi

# 检查 package.json
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ 错误: package.json 文件不存在${NC}"
    exit 1
fi

# 如果没有设置用户名，提示输入
if [ -z "$DOCKER_USERNAME" ]; then
    echo -e "${YELLOW}📝 请输入 Docker Hub 用户名:${NC}"
    read -r DOCKER_USERNAME
    if [ -z "$DOCKER_USERNAME" ]; then
        echo -e "${RED}❌ 错误: Docker Hub 用户名不能为空${NC}"
        exit 1
    fi
fi

FULL_IMAGE_NAME="${DOCKER_USERNAME}/${IMAGE_NAME}"

echo -e "${BLUE}📦 镜像信息:${NC}"
echo -e "  镜像名称: ${FULL_IMAGE_NAME}"
echo -e "  版本标签: ${VERSION}"
echo -e "  支持架构: ${PLATFORMS}"
echo ""

# 检查是否已登录 Docker Hub
echo -e "${YELLOW}🔐 检查 Docker Hub 登录状态...${NC}"
if ! docker info | grep -q "Username"; then
    echo -e "${YELLOW}⚠️  未检测到 Docker Hub 登录，请先登录:${NC}"
    if ! docker login; then
        echo -e "${RED}❌ Docker Hub 登录失败${NC}"
        exit 1
    fi
fi

# 创建/使用 buildx builder
echo -e "${YELLOW}🔧 配置 Buildx builder...${NC}"
BUILDER_NAME="multiarch-builder"

if ! docker buildx ls | grep -q "$BUILDER_NAME"; then
    echo -e "${BLUE}创建新的 builder: ${BUILDER_NAME}${NC}"
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
else
    echo -e "${GREEN}使用现有的 builder: ${BUILDER_NAME}${NC}"
fi

docker buildx use "$BUILDER_NAME"

# 启动 builder 实例
echo -e "${YELLOW}🏃 启动 builder 实例...${NC}"
docker buildx inspect --bootstrap

# 构建多架构镜像
echo -e "${YELLOW}📦 开始构建多架构镜像...${NC}"
echo -e "${BLUE}这可能需要几分钟时间，请耐心等待...${NC}"

# 构建并推送到 Docker Hub
if docker buildx build \
    --platform "$PLATFORMS" \
    --tag "${FULL_IMAGE_NAME}:${VERSION}" \
    --tag "${FULL_IMAGE_NAME}:latest" \
    --push \
    .; then

    echo ""
    echo -e "${GREEN}✅ 多架构镜像构建并推送成功！${NC}"
    echo ""
    echo -e "${BLUE}📋 镜像信息:${NC}"
    echo -e "  🐳 Docker Hub: https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}"
    echo -e "  📦 镜像地址: ${FULL_IMAGE_NAME}:${VERSION}"
    echo -e "  🏗️  支持架构: ${PLATFORMS}"
    echo ""
    echo -e "${BLUE}🔧 使用方法:${NC}"
    echo -e "  本地运行:"
    echo -e "    docker run -d -p 3001:3001 ${FULL_IMAGE_NAME}:${VERSION}"
    echo ""
    echo -e "  Docker Compose:"
    echo -e "    将 docker-compose.yml 中的 'build: .' 替换为："
    echo -e "    image: ${FULL_IMAGE_NAME}:${VERSION}"
    echo ""
    echo -e "  拉取镜像:"
    echo -e "    docker pull ${FULL_IMAGE_NAME}:${VERSION}"
    echo ""

    # 显示镜像详细信息
    echo -e "${YELLOW}🔍 查看镜像架构信息...${NC}"
    docker buildx imagetools inspect "${FULL_IMAGE_NAME}:${VERSION}"

else
    echo -e "${RED}❌ 镜像构建失败！${NC}"
    exit 1
fi