<template>
  <el-card class="api-secret-manager">
    <template #header>
      <div class="card-header">
        <span>前后端API密钥设置</span>
        <el-tag :type="authStatus.enabled ? 'success' : 'warning'">
          {{ authStatus.enabled ? '已启用' : '未启用' }}
        </el-tag>
      </div>
    </template>

    <div class="manager-content">
      <!-- 连接模式状态 -->
      <el-alert
        :title="connectionMode.description"
        :type="connectionMode.secure ? 'success' : 'warning'"
        :closable="false"
        show-icon
        class="connection-alert"
      >
        <template v-if="connectionMode.type === 'internal'">
          <p><strong>内部绑定模式：</strong>前端通过Cloudflare服务绑定直接连接到后端Worker</p>
          <p>✅ 无需配置API密钥，通信自动加密保护</p>
        </template>
        <template v-else>
          <p><strong>外部访问模式：</strong>前端通过HTTP URL连接到后端API</p>
          <p v-if="connectionMode.secure">✅ 已配置API密钥，通信受到保护</p>
          <p v-else>⚠️ 未配置API密钥，建议启用API认证保护</p>
        </template>
      </el-alert>

      <el-alert
        v-if="connectionMode.type === 'external'"
        title="外部访问配置"
        type="info"
        :closable="false"
        show-icon
        class="security-alert"
      >
        <p>外部访问需要配置API密钥来保护通信安全。</p>
        <p>请确保前端环境变量 <code>VITE_FRONTEND_API_SECRET</code> 与后端环境变量 <code>FRONTEND_API_SECRET</code> 设置为相同值。</p>
      </el-alert>

      <div class="form-section">
        <el-form :model="form" label-width="120px">
          <el-form-item label="连接模式">
            <div class="status-info">
              <el-tag :type="connectionMode.type === 'internal' ? 'success' : 'primary'" size="large">
                {{ connectionMode.type === 'internal' ? '内部绑定' : '外部访问' }}
              </el-tag>
              <span style="margin-left: 8px; color: #606266;">{{ connectionMode.description }}</span>
            </div>
          </el-form-item>

          <el-form-item v-if="connectionMode.type === 'external'" label="认证状态">
            <div class="status-info">
              <el-text v-if="connectionMode.secure" type="success">
                <el-icon><Check /></el-icon>
                API认证已启用
              </el-text>
              <el-text v-else type="warning">
                <el-icon><Warning /></el-icon>
                API认证未启用（外部访问建议启用）
              </el-text>
            </div>
          </el-form-item>

          <el-form-item v-if="connectionMode.type === 'external'" label="API密钥">
            <el-input
              v-model="form.apiSecret"
              type="password"
              placeholder="输入API密钥（16-64位字母数字）"
              show-password
              clearable
              style="width: 400px;"
            />
            <el-button
              type="primary"
              :icon="Refresh"
              @click="generateSecret"
              style="margin-left: 10px;"
            >
              生成密钥
            </el-button>
          </el-form-item>

          <el-form-item>
            <el-button
              v-if="connectionMode.type === 'external'"
              type="success"
              :icon="Check"
              @click="saveSecret"
              :disabled="!form.apiSecret"
            >
              保存设置
            </el-button>
            <el-button
              v-if="connectionMode.type === 'external' && authStatus.enabled"
              type="danger"
              :icon="Delete"
              @click="clearSecret"
            >
              清除密钥
            </el-button>
            <el-button
              type="info"
              :icon="Connection"
              @click="testConnection"
              :loading="testing"
            >
              测试连接
            </el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="instructions-section">
        <el-divider content-position="left">部署说明</el-divider>
        <el-steps :active="deployStep" finish-status="success" simple>
          <el-step title="生成API密钥" description="点击生成密钥按钮" />
          <el-step title="配置后端" description="设置环境变量 FRONTEND_API_SECRET" />
          <el-step title="配置前端" description="设置环境变量 VITE_FRONTEND_API_SECRET" />
          <el-step title="重新部署" description="部署前后端应用" />
        </el-steps>

        <el-collapse class="deploy-details">
          <el-collapse-item title="详细配置步骤" name="1">
            <div class="config-steps">
              <h4>1. 后端配置（Cloudflare Workers）：</h4>
              <el-code class="config-code">
wrangler secret put FRONTEND_API_SECRET
# 输入生成的API密钥：{{ form.apiSecret || 'your_api_secret_here' }}
              </el-code>

              <h4>2. 前端配置（推荐方式：wrangler.toml）：</h4>
              <el-code class="config-code">
# 编辑 frontend/wrangler.toml 文件的 [vars] 部分
[vars]
NODE_ENV = "production"
VITE_BACKEND_URL = "https://your-worker.workers.dev/api"
VITE_FRONTEND_API_SECRET = "{{ form.apiSecret || 'your_api_secret_here' }}"

# 注释掉内部绑定配置
# [[services]]
# binding = "BACKEND"
# service = "soga-panel"
              </el-code>

              <h4>备选方式：环境变量配置</h4>
              <el-code class="config-code">
# 在 .env 文件中配置（适用于非Cloudflare平台）
VITE_BACKEND_URL=https://your-worker.workers.dev/api
VITE_FRONTEND_API_SECRET={{ form.apiSecret || 'your_api_secret_here' }}
              </el-code>

              <h4>3. 重新部署：</h4>
              <el-code class="config-code">
# 重新构建和部署前端
pnpm build
wrangler pages deploy dist

# 或使用 Git 自动部署（推荐）
git add . && git commit -m "Update API config" && git push
              </el-code>

              <h4>4. 验证配置：</h4>
              <ol>
                <li>确保后端环境变量 FRONTEND_API_SECRET 已设置</li>
                <li>确认前端配置文件已修改并部署</li>
                <li>在此页面点击"测试连接"按钮</li>
                <li>查看浏览器控制台确认连接模式切换</li>
              </ol>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, Warning, Refresh, Delete, Connection } from '@element-plus/icons-vue';
import { apiAuthManager, apiAuthUtils } from '@/utils/api-auth';
import http from '@/api/http';

interface Form {
  apiSecret: string;
}

const form = reactive<Form>({
  apiSecret: ''
});

const testing = ref(false);

// 计算当前认证状态
const authStatus = computed(() => apiAuthUtils.getStatus());

// 计算连接模式
const connectionMode = computed(() => apiAuthManager.getConnectionMode());

// 部署步骤
const deployStep = computed(() => {
  if (!form.apiSecret) return 0;
  if (!authStatus.value.configured) return 1;
  if (!authStatus.value.enabled) return 2;
  return 4;
});

// 生成随机密钥
const generateSecret = () => {
  form.apiSecret = apiAuthUtils.generateApiSecret();
  ElMessage.success('已生成新的API密钥');
};

// 保存密钥
const saveSecret = async () => {
  if (!apiAuthUtils.validateApiSecret(form.apiSecret)) {
    ElMessage.error('API密钥格式不正确，请输入16-64位字母数字');
    return;
  }

  try {
    // 更新API认证管理器
    apiAuthManager.updateApiSecret(form.apiSecret);
    ElMessage.success('API密钥已保存到本地存储');
  } catch (error) {
    console.error('Save API secret error:', error);
    ElMessage.error('保存失败，请重试');
  }
};

// 清除密钥
const clearSecret = async () => {
  try {
    await ElMessageBox.confirm(
      '清除API密钥后，前端将无法访问后端API，确认要清除吗？',
      '确认清除',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    apiAuthManager.updateApiSecret('');
    form.apiSecret = '';
    ElMessage.success('API密钥已清除');
  } catch {
    // 用户取消
  }
};

// 测试连接
const testConnection = async () => {
  testing.value = true;
  
  try {
    // 调用健康检查端点测试连接
    const response = await http.get('/health');
    
    if (response.code === 0) {
      ElMessage.success('连接测试成功，API认证正常工作');
    } else {
      ElMessage.error('连接测试失败：' + response.message);
    }
  } catch (error: any) {
    console.error('Connection test error:', error);
    
    if (error.response?.status === 401) {
      ElMessage.error('API密钥未配置或不匹配');
    } else if (error.response?.status === 403) {
      ElMessage.error('API密钥无效');
    } else {
      ElMessage.error('连接测试失败，请检查网络或后端配置');
    }
  } finally {
    testing.value = false;
  }
};

// 初始化时获取当前密钥
onMounted(() => {
  const currentHeaders = apiAuthManager.getAuthHeaders();
  form.apiSecret = currentHeaders['X-API-Secret'] || '';
});
</script>

<style scoped lang="scss">
.api-secret-manager {
  max-width: 800px;
  margin: 0 auto;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .manager-content {
    .security-alert {
      margin-bottom: 24px;
      
      p {
        margin: 8px 0;
        
        code {
          background: #f5f7fa;
          padding: 2px 6px;
          border-radius: 3px;
          color: #e6a23c;
        }
      }
    }

    .form-section {
      margin-bottom: 32px;

      .status-info {
        display: flex;
        align-items: center;
        
        .el-icon {
          margin-right: 4px;
        }
      }
    }

    .instructions-section {
      .deploy-details {
        margin-top: 20px;
        
        .config-steps {
          h4 {
            margin: 16px 0 8px 0;
            color: #303133;
          }
          
          .config-code {
            display: block;
            background: #f5f7fa;
            padding: 12px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 13px;
            margin-bottom: 16px;
            white-space: pre-wrap;
            border-left: 4px solid #409eff;
          }
          
          ol {
            margin: 12px 0;
            padding-left: 20px;
            
            li {
              margin: 8px 0;
              color: #606266;
            }
          }
        }
      }
    }
  }
}

.el-steps {
  margin: 20px 0;
}
</style>