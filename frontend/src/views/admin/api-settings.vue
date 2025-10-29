<template>
  <div class="api-settings-page">
    <div class="page-header">
      <h2>API设置</h2>
      <p>管理前后端分离部署的API安全认证</p>
    </div>

    <ApiSecretManager />

    <el-card class="deployment-guide" style="margin-top: 24px;">
      <template #header>
        <span>部署指南</span>
      </template>

      <div class="guide-content">
        <el-alert
          title="推荐配置"
          type="success"
          :closable="false"
          show-icon
          class="recommendation"
        >
          为了提高系统安全性，强烈建议在前后端分离部署时启用API认证机制。
        </el-alert>

        <div class="deployment-scenarios">
          <h3>部署场景</h3>
          
          <el-row :gutter="20">
            <el-col :span="12">
              <el-card shadow="hover" class="scenario-card">
                <template #header>
                  <div class="scenario-header">
                    <el-icon color="#67c23a"><Check /></el-icon>
                    <span>推荐：分离部署</span>
                  </div>
                </template>
                <div class="scenario-content">
                  <p><strong>前端：</strong>Cloudflare Pages</p>
                  <p><strong>后端：</strong>Cloudflare Workers</p>
                  <p><strong>安全性：</strong>启用API密钥认证</p>
                  <div class="benefits">
                    <h4>优势：</h4>
                    <ul>
                      <li>更好的性能和CDN加速</li>
                      <li>独立的版本控制和部署</li>
                      <li>更高的安全性</li>
                      <li>便于团队协作</li>
                    </ul>
                  </div>
                </div>
              </el-card>
            </el-col>

            <el-col :span="12">
              <el-card shadow="hover" class="scenario-card">
                <template #header>
                  <div class="scenario-header">
                    <el-icon color="#e6a23c"><Warning /></el-icon>
                    <span>简单：单一部署</span>
                  </div>
                </template>
                <div class="scenario-content">
                  <p><strong>前后端：</strong>Cloudflare Workers</p>
                  <p><strong>安全性：</strong>依赖Worker内部路由</p>
                  <div class="limitations">
                    <h4>限制：</h4>
                    <ul>
                      <li>前端资源占用Worker空间</li>
                      <li>部署耦合度较高</li>
                      <li>缺少前端CDN优化</li>
                      <li>不需要API密钥（内部调用）</li>
                    </ul>
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>

        <div class="technical-details">
          <el-divider content-position="left">技术详情</el-divider>
          
          <el-descriptions :column="1" border>
            <el-descriptions-item label="认证方式">
              <el-tag type="primary">X-API-Secret Header</el-tag>
              <span style="margin-left: 8px;">自定义请求头传递API密钥</span>
            </el-descriptions-item>
            
            <el-descriptions-item label="密钥格式">
              <el-code>16-64位字母数字组合</el-code>
            </el-descriptions-item>
            
            <el-descriptions-item label="存储位置">
              <div>
                <p><strong>前端：</strong>wrangler.toml [vars] 配置 + localStorage</p>
                <p><strong>后端：</strong>Cloudflare Workers 环境变量</p>
              </div>
            </el-descriptions-item>
            
            <el-descriptions-item label="安全特性">
              <div class="security-features">
                <el-tag size="small">自动请求拦截</el-tag>
                <el-tag size="small" style="margin-left: 4px;">错误处理</el-tag>
                <el-tag size="small" style="margin-left: 4px;">密钥验证</el-tag>
                <el-tag size="small" style="margin-left: 4px;">向后兼容</el-tag>
              </div>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { Check, Warning } from '@element-plus/icons-vue';
import ApiSecretManager from '@/components/ApiSecretManager.vue';

// 设置页面标题
document.title = 'API设置 - 管理员面板';
</script>

<style scoped lang="scss">
.api-settings-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;

  .page-header {
    margin-bottom: 24px;
    text-align: center;

    h2 {
      margin: 0 0 8px 0;
      color: #303133;
    }

    p {
      color: #909399;
      margin: 0;
    }
  }

  .deployment-guide {
    .recommendation {
      margin-bottom: 24px;
    }

    .deployment-scenarios {
      margin-bottom: 32px;

      h3 {
        margin-bottom: 16px;
        color: #303133;
      }

      .scenario-card {
        height: 100%;

        .scenario-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
        }

        .scenario-content {
          p {
            margin: 8px 0;
            
            strong {
              color: #303133;
            }
          }

          .benefits, .limitations {
            margin-top: 16px;

            h4 {
              margin: 0 0 8px 0;
              color: #606266;
              font-size: 14px;
            }

            ul {
              margin: 0;
              padding-left: 16px;

              li {
                margin: 4px 0;
                color: #606266;
                font-size: 13px;
              }
            }
          }

          .benefits h4 {
            color: #67c23a;
          }

          .limitations h4 {
            color: #e6a23c;
          }
        }
      }
    }

    .technical-details {
      .security-features {
        .el-tag {
          margin: 2px;
        }
      }
    }
  }
}

.el-code {
  background: #f5f7fa;
  padding: 4px 8px;
  border-radius: 3px;
  color: #e6a23c;
  font-family: 'Monaco', 'Menlo', monospace;
}
</style>