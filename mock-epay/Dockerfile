# 使用官方 Node.js 运行时作为父镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 将 package.json 和 package-lock.json 复制到工作目录
COPY package*.json ./

# 安装项目依赖
RUN npm ci --only=production && npm cache clean --force

# 将项目文件复制到工作目录
COPY . .

# 创建非root用户运行应用
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mockepay -u 1001 -G nodejs

# 更改文件所有权
RUN chown -R mockepay:nodejs /app
USER mockepay

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# 启动应用
CMD ["npm", "start"]