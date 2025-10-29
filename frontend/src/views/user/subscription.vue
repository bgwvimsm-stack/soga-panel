<template>
  <div class="subscription-page">
    <div class="page-header">
      <h2>订阅管理</h2>
      <p>管理和获取您的代理订阅链接</p>
    </div>
    
    <!-- 用户状态警告 -->
    <el-alert
      v-if="userStore.isDisabledUser()"
      title="账号已被禁用"
      type="warning"
      :closable="false"
      show-icon
      class="status-alert"
    >
      <template #default>
        您的账号已被禁用，无法获取和使用订阅链接。如有疑问请联系管理员。
      </template>
    </el-alert>
    
    <!-- 订阅状态概览 -->
    <div class="subscription-overview">
      <el-row :gutter="20" class="mobile-responsive-row">
        <el-col :xs="24" :sm="12" :md="8" :lg="8" :xl="8">
          <el-card class="overview-card">
            <div class="stat-item">
              <div class="stat-content">
                <div class="stat-value">{{ formatClassExpireTime() }}</div>
                <div class="stat-label">等级过期时间</div>
              </div>
              <div class="stat-icon active">
                <el-icon><Clock /></el-icon>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="8" :lg="8" :xl="8">
          <el-card class="overview-card">
            <div class="stat-item">
              <div class="stat-content">
                <div class="stat-value">{{ formatDate(lastUpdateTime) }}</div>
                <div class="stat-label">最后更新</div>
              </div>
              <div class="stat-icon update">
                <el-icon><Clock /></el-icon>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="8" :lg="8" :xl="8">
          <el-card class="overview-card">
            <div class="stat-item">
              <div class="stat-content">
                <div class="stat-value">{{ userStore.user?.class || 0 }}</div>
                <div class="stat-label">用户等级</div>
              </div>
              <div class="stat-icon level">
                <el-icon><Star /></el-icon>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>
    
    <!-- 订阅链接管理 -->
    <el-card class="subscription-card">
      <div class="card-header">
        <h3>订阅链接</h3>
        <div class="header-actions">
          <el-button @click="refreshToken" :loading="tokenRefreshing">
            <el-icon><Refresh /></el-icon>
            重置订阅信息
          </el-button>
        </div>
      </div>
      
      <div class="subscription-content">
        <el-alert
          title="订阅说明"
          type="info"
          :closable="false"
          show-icon
        >
          <template #default>
            <p>请将以下订阅链接复制到您的代理客户端中使用。订阅链接会根据您的权限自动更新可用节点。</p>
</template>
        </el-alert>
        
        <div class="subscription-list">
          <div 
            v-for="sub in subscriptionTypes" 
            :key="sub.type"
            class="subscription-item"
          >
            <div class="sub-info">
              <div class="sub-title">
                <el-icon>
                  <component :is="sub.icon" />
                </el-icon>
                <span>{{ sub.name }}</span>
                <el-tag size="small" :type="sub.recommended ? 'success' : 'info'">
                  {{ sub.recommended ? '推荐' : '通用' }}
                </el-tag>
              </div>
              <div class="sub-description">{{ sub.description }}</div>
            </div>
            
            <div class="sub-actions">
              <div class="sub-url">
                <el-input
                  :value="getSubscriptionUrl(sub.type)"
                  readonly
                  class="url-input"
                >
                  <template #append>
                    <el-button @click="copyLink(sub.type, sub.name)">
                      <el-icon><CopyDocument /></el-icon>
                    </el-button>
</template>
                </el-input>
              </div>
              
              <div class="sub-import">
                <el-button @click="oneClickImport(sub.type, sub.name)">
                  <el-icon><Link /></el-icon>
                  一键导入
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-card>
    
    <!-- 使用指南 -->
    <el-card class="guide-card">
      <div class="guide-header">
        <h3>使用指南</h3>
      </div>
      
      <el-collapse v-model="activeGuides">
        <el-collapse-item name="clash" title="Clash 客户端">
          <div class="guide-content">
            <ol>
              <li>下载并安装 Clash 客户端</li>
              <li>点击上方 Clash 订阅的"一键导入"按钮</li>
              <li>系统将自动启动 Clash 客户端并导入订阅配置</li>
              <li>更新配置，选择合适的节点开始使用</li>
            </ol>
            <p><strong>推荐客户端：</strong>Clash for Windows、ClashX (macOS)、Clash for Android</p>
          </div>
        </el-collapse-item>
        
        <el-collapse-item name="shadowrocket" title="Shadowrocket 客户端">
          <div class="guide-content">
            <ol>
              <li>下载并安装 Shadowrocket 客户端</li>
              <li>点击上方 Shadowrocket 订阅的"一键导入"按钮</li>
              <li>系统将自动启动 Shadowrocket 并添加订阅</li>
              <li>更新订阅，选择合适的节点连接</li>
            </ol>
            <p><strong>注意：</strong>仅适用于 iOS 平台的 Shadowrocket 客户端</p>
          </div>
        </el-collapse-item>
        
        <el-collapse-item name="quantumult" title="Quantumult X 客户端">
          <div class="guide-content">
            <ol>
              <li>打开 Quantumult X 应用</li>
              <li>点击上方 Quantumult X 订阅的"一键导入"按钮</li>
              <li>系统将自动启动 Quantumult X 并添加订阅资源</li>
              <li>更新订阅，配置分流规则</li>
            </ol>
            <p><strong>注意：</strong>仅适用于 iOS 平台的 Quantumult X</p>
          </div>
        </el-collapse-item>
        
        <el-collapse-item name="surge" title="Surge 客户端">
          <div class="guide-content">
            <ol>
              <li>下载并安装 Surge 客户端</li>
              <li>点击上方 Surge 订阅的"一键导入"按钮</li>
              <li>系统将自动启动 Surge 并安装订阅配置</li>
              <li>启用配置，选择合适的节点开始使用</li>
            </ol>
            <p><strong>注意：</strong>适用于 macOS 和 iOS 平台的 Surge 客户端</p>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, markRaw } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Link,
  Clock,
  Star,
  Refresh,
  CopyDocument,
  Monitor,
  Cellphone,
  Platform,
} from "@element-plus/icons-vue";
import { resetSubscriptionToken } from "@/api/user";
import { getUserProfile } from "@/api/auth";
import { useUserStore } from "@/store/user";

const userStore = useUserStore();

// 响应式数据
const tokenRefreshing = ref(false);
const activeGuides = ref(['clash']);
const lastUpdateTime = ref(new Date());

// 订阅类型配置 - 使用 markRaw 标记图标组件避免不必要的响应式转换
const subscriptionTypes = [
  {
    type: 'clash',
    name: 'Clash',
    description: '适用于 Clash 系列客户端，配置简单易用',
    icon: markRaw(Platform),
    recommended: true
  },
  {
    type: 'shadowrocket',
    name: 'Shadowrocket',
    description: '适用于 iOS 平台的 Shadowrocket 客户端',
    icon: markRaw(Cellphone),
    recommended: false
  },
  {
    type: 'quantumult',
    name: 'Quantumult X',
    description: '适用于 iOS 平台的 Quantumult X 客户端',
    icon: markRaw(Cellphone),
    recommended: false
  },
  {
    type: 'surge',
    name: 'Surge',
    description: '适用于 macOS/iOS 平台的 Surge 客户端',
    icon: markRaw(Monitor),
    recommended: false
  }
];

// 计算属性
const formatClassExpireTime = () => {
  const classExpireTime = userStore.user?.class_expire_time;
  if (!classExpireTime) return '永久';
  
  let date: Date;
  if (typeof classExpireTime === 'number') {
    date = new Date(classExpireTime * 1000);
  } else {
    date = new Date(classExpireTime);
  }
  
  if (isNaN(date.getTime())) return '永久';
  
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const baseUrl = computed(() => {
  // 优先使用配置的订阅链接，为空则使用当前域名
  const subscriptionUrl = userStore.user?.subscription_url;
  if (subscriptionUrl && subscriptionUrl.trim() !== '') {
    return subscriptionUrl.replace(/\/$/, ''); // 移除末尾的斜杠
  }
  return window.location.origin;
});

// 方法
const getSubscriptionUrl = (type: string) => {
  const token = userStore.user?.token;
  if (!token) {
    return `${baseUrl.value}/api/subscription/${type}?token=请先获取Token`;
  }
  return `${baseUrl.value}/api/subscription/${type}?token=${token}`;
};

const formatDate = (date: Date) => {
  return date.toLocaleString('zh-CN');
};

const copyLink = async (type: string, name: string) => {
  // 检查用户是否被禁用
  if (userStore.isDisabledUser()) {
    ElMessage.error('您的账号已被禁用，无法获取订阅链接');
    return;
  }
  
  const url = getSubscriptionUrl(type);
  try {
    await navigator.clipboard.writeText(url);
    ElMessage.success(`${name} 订阅链接已复制到剪贴板`);
  } catch (error) {
    console.error('复制失败:', error);
    ElMessage.error('复制失败，请手动复制');
  }
};


const oneClickImport = async (type: string, name: string) => {
  // 检查用户是否被禁用
  if (userStore.isDisabledUser()) {
    ElMessage.error('您的账号已被禁用，无法获取订阅链接');
    return;
  }
  
  const subscriptionUrl = getSubscriptionUrl(type);
  let schemeUrl = '';
  
  switch (type) {
    case 'clash':
      schemeUrl = `clash://install-config?url=${encodeURIComponent(subscriptionUrl)}`;
      break;
    case 'shadowrocket':
      schemeUrl = `shadowrocket://add/sub://${encodeURIComponent(subscriptionUrl)}`;
      break;
    case 'quantumult':
      schemeUrl = `quantumult-x://add-resource?remote-resource=${subscriptionUrl}`;
      break;
    case 'surge':
      schemeUrl = `surge://install-subscription?url=${subscriptionUrl}`;
      break;
    default:
      ElMessage.error('不支持的订阅类型');
      return;
  }
  
  try {
    window.location.href = schemeUrl;
    ElMessage.success(`正在启动 ${name} 客户端...`);
  } catch (error) {
    console.error('启动客户端失败:', error);
    ElMessage.error('启动客户端失败，请确保已安装对应客户端');
  }
};


const refreshToken = async () => {
  try {
    await ElMessageBox.confirm(
      '重置订阅信息后，所有现有的订阅链接将失效，您需要重新获取新的订阅链接并在客户端中更新。确定要继续吗？',
      '确认重置订阅信息',
      {
        confirmButtonText: '确定重置',
        cancelButtonText: '取消',
        type: 'warning',
        distinguishCancelAndClose: true
      }
    );

    // 用户确认后才执行重置
    tokenRefreshing.value = true;
    try {
      const { data } = await resetSubscriptionToken();
      // 更新用户store中的token
      userStore.updateUser({
        token: data.token
      });
      lastUpdateTime.value = new Date();
      ElMessage.success('订阅令牌已重置');
    } catch (error) {
      console.error('重置订阅信息失败:', error);
      ElMessage.error('重置订阅信息失败');
    } finally {
      tokenRefreshing.value = false;
    }
  } catch (error) {
    // 用户取消操作
    if (error === 'cancel' || error === 'close') {
      ElMessage.info('已取消重置操作');
    }
  }
};


// 获取最新用户数据
const loadUserProfile = async () => {
  try {
    const { data } = await getUserProfile();
    userStore.setUser(data);
  } catch (error) {
    console.error('获取用户信息失败:', error);
  }
};

onMounted(async () => {
  // 初始化时获取最新用户数据以确保token正确
  await loadUserProfile();
});
</script>

<style scoped lang="scss">
.subscription-page {
  min-height: 100%;
  height: auto;

  .page-header {
    margin-bottom: 20px;

    h2 {
      margin: 0 0 8px 0;
      color: #303133;
    }

    p {
      margin: 0;
      color: #909399;
    }
  }
}

.subscription-overview {
  margin-bottom: 20px;
  
  .overview-card {
    :deep(.el-card__body) {
      padding: 20px;
    }
    
    .stat-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      
      .stat-content {
        .stat-value {
          font-size: 28px;
          font-weight: bold;
          color: #303133;
          margin-bottom: 5px;
        }
        
        .stat-label {
          color: #909399;
          font-size: 14px;
        }
      }
      
      .stat-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        color: #909399;
        opacity: 0.7;
        
        &.active { color: #67c23a; opacity: 0.85; }
        &.update { color: #409eff; opacity: 0.85; }
        &.level { color: #e6a23c; opacity: 0.85; }
      }
    }
  }
}

.subscription-card {
  margin-bottom: 20px;
  
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    
    h3 {
      margin: 0;
      color: #303133;
    }
    
    .header-actions {
      display: flex;
      gap: 10px;
    }
  }
  
  .subscription-content {
    .el-alert {
      margin-bottom: 20px;
      
      :deep(.el-alert__content) {
        p {
          margin: 0;
          line-height: 1.5;
        }
      }
    }
    
    .subscription-list {
      .subscription-item {
        padding: 20px;
        border: 1px solid #e4e7ed;
        border-radius: 8px;
        margin-bottom: 16px;
        
        &:last-child {
          margin-bottom: 0;
        }
        
        .sub-info {
          margin-bottom: 16px;
          
          .sub-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            
            .el-icon {
              color: #409eff;
            }
            
            span {
              font-size: 16px;
              font-weight: 600;
              color: #303133;
            }
          }
          
          .sub-description {
            color: #606266;
            font-size: 14px;
          }
        }
        
        .sub-actions {
          display: flex;
          gap: 12px;
          align-items: center;

          .sub-url {
            flex: 1;

            .url-input {
              :deep(.el-input__inner) {
                font-size: 12px;
                font-family: monospace;
              }
            }
          }

          .sub-import {
            flex-shrink: 0;
          }
        }
      }
    }
  }
}

.guide-card {
  .guide-header {
    margin-bottom: 20px;
    
    h3 {
      margin: 0;
      color: #303133;
    }
  }
  
  .guide-content {
    ol {
      padding-left: 20px;
      
      li {
        margin-bottom: 8px;
        line-height: 1.6;
      }
    }
    
    p {
      margin: 12px 0 0 0;
      padding: 10px;
      background: #f5f7fa;
      border-radius: 4px;
      font-size: 14px;
      
      strong {
        color: #409eff;
      }
    }
  }
}

.qr-content {
  text-align: center;
  
  .qr-code {
    margin-bottom: 20px;
    
    .qr-loading {
      width: 200px;
      height: 200px;
      margin: 0 auto;
      border: 2px dashed #dcdfe6;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #409eff;
      
      .el-icon {
        font-size: 24px;
        margin-bottom: 10px;
      }
      
      p {
        margin: 0;
        font-size: 14px;
      }
    }
    
    .qr-image {
      display: flex;
      justify-content: center;
      
      img {
        width: 200px;
        height: 200px;
        border-radius: 8px;
        border: 1px solid #e4e7ed;
      }
    }
    
    .qr-placeholder {
      width: 200px;
      height: 200px;
      margin: 0 auto;
      border: 2px dashed #dcdfe6;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: #909399;
      
      p {
        margin: 10px 0 0 0;
        font-size: 16px;
      }
      
      small {
        margin-top: 10px;
        font-size: 12px;
        word-break: break-all;
        padding: 0 10px;
      }
    }
  }
  
  .qr-tips {
    p {
      margin: 0;
      color: #606266;
      font-size: 14px;
    }
  }
  
  .status-alert {
    margin-bottom: 20px;
  }
}

// 移动端响应式优化
@media (max-width: 768px) {
  .subscription-page {
    .page-header {
      margin-bottom: 15px;
      text-align: center;
      
      h2 {
        font-size: 18px;
      }
      
      p {
        font-size: 13px;
      }
    }
    
    .status-alert {
      margin-bottom: 15px;
      
      :deep(.el-alert__content) {
        font-size: 13px;
      }
    }
  }
  
  .subscription-overview {
    margin-bottom: 15px;
    
    .mobile-responsive-row {
      margin-left: -8px !important;
      margin-right: -8px !important;
      
      .el-col {
        padding-left: 8px !important;
        padding-right: 8px !important;
        margin-bottom: 10px;
      }
    }
    
    .overview-card {
      :deep(.el-card__body) {
        padding: 12px !important;
      }
      
      .stat-item {
        flex-direction: column;
        align-items: flex-start;
        position: relative;
        
        .stat-content {
          width: calc(100% - 40px);
          padding-right: 8px;

          .stat-value {
            font-size: 20px;
            margin-bottom: 3px;
            word-break: break-all;
            line-height: 1.2;
          }

          .stat-label {
            font-size: 12px;
            line-height: 1.3;
          }
        }
        
        .stat-icon {
          position: absolute;
          top: 4px;
          right: 4px;
          font-size: 24px;
          opacity: 0.85;
          z-index: 1;
        }
      }
    }
  }
  
  .subscription-card {
    margin-bottom: 15px;

    :deep(.el-card__body) {
      padding: 15px !important;
    }

    .card-header {
      flex-direction: column;
      align-items: flex-start;
      margin-bottom: 15px;

      h3 {
        font-size: 16px;
        margin-bottom: 10px;
      }

      .header-actions {
        width: 100%;
        gap: 8px;

        .el-button {
          flex: 1;
          font-size: 12px !important;
          padding: 8px 12px !important;
        }
      }
    }

    .subscription-content {
      .el-alert {
        margin-bottom: 15px;

        :deep(.el-alert__content) {
          font-size: 13px;

          p {
            font-size: 13px;
          }
        }
      }

      .subscription-list {
        // 确保在移动端显示所有订阅项
        display: block !important;

        .subscription-item {
          padding: 15px !important;
          margin-bottom: 12px;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          height: auto !important;
          overflow: visible !important;

          .sub-info {
            margin-bottom: 12px;

            .sub-title {
              gap: 6px;
              margin-bottom: 6px;
              flex-wrap: wrap;

              .el-icon {
                font-size: 16px;
              }

              span {
                font-size: 14px !important;
              }

              .el-tag {
                font-size: 10px;
              }
            }

            .sub-description {
              font-size: 12px;
              line-height: 1.4;
            }
          }

          .sub-actions {
            flex-direction: column;
            gap: 8px;
            align-items: stretch;

            .sub-url {
              flex: none;
              width: 100%;

              .url-input {
                width: 100%;

                :deep(.el-input__inner) {
                  font-size: 11px !important;
                  padding: 8px !important;
                  word-break: break-all;
                }

                :deep(.el-input-group__append) {
                  .el-button {
                    padding: 8px 12px !important;
                    font-size: 12px !important;
                  }
                }
              }
            }

            .sub-import {
              flex-shrink: 0;
              width: 100%;

              .el-button {
                width: 100%;
                padding: 10px 16px !important;
                font-size: 13px !important;
              }
            }
          }
        }
      }

      .qr-code-section {
        .qr-code-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;

          canvas {
            max-width: 200px !important;
            height: auto !important;
          }

          .qr-actions {
            width: 100%;
            gap: 8px;

            .el-button {
              flex: 1;
              font-size: 12px !important;
              padding: 8px 12px !important;
            }
          }
        }

        .qr-tips {
          p {
            font-size: 12px;
          }
        }
      }
    }
  }

  // 修复使用指南在移动端的显示
  .guide-card {
    :deep(.el-card__body) {
      padding: 15px !important;
    }

    .guide-header {
      margin-bottom: 15px;

      h3 {
        font-size: 16px;
      }
    }

    :deep(.el-collapse) {
      border: none;

      .el-collapse-item {
        margin-bottom: 8px;

        .el-collapse-item__header {
          font-size: 14px;
          padding: 10px 12px;
          background: #f5f7fa;
          border-radius: 4px;
        }

        .el-collapse-item__wrap {
          border: none;
        }

        .el-collapse-item__content {
          padding: 10px 12px;
          font-size: 13px;
        }
      }
    }

    .guide-content {
      ol {
        padding-left: 18px;
        margin: 8px 0;

        li {
          margin-bottom: 6px;
          font-size: 13px;
          line-height: 1.5;
        }
      }

      p {
        margin: 10px 0 0 0;
        padding: 8px;
        font-size: 12px;

        strong {
          font-size: 12px;
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .subscription-page {
    .page-header {
      margin-bottom: 12px;
      
      h2 {
        font-size: 16px;
      }
      
      p {
        font-size: 12px;
      }
    }
  }
  
  .subscription-overview {
    .mobile-responsive-row {
      margin-left: -6px !important;
      margin-right: -6px !important;
      
      .el-col {
        padding-left: 6px !important;
        padding-right: 6px !important;
        margin-bottom: 8px;
      }
    }
    
    .overview-card {
      :deep(.el-card__body) {
        padding: 10px !important;
      }
      
      .stat-item {
        .stat-content {
          width: calc(100% - 36px);

          .stat-value {
            font-size: 18px;
          }

          .stat-label {
            font-size: 11px;
          }
        }
        
        .stat-icon {
          top: 3px;
          right: 3px;
          font-size: 20px;
          opacity: 0.85;
        }
      }
    }
  }
  
  .subscription-card {
    :deep(.el-card__body) {
      padding: 12px !important;
    }
    
    .card-header {
      .header-actions {
        gap: 6px;
        
        .el-button {
          font-size: 11px !important;
          padding: 6px 8px !important;
        }
      }
    }
    
    .subscription-content {
      .subscription-links {
        .subscription-item {
          .subscription-body {
            .link-container {
              .subscription-link {
                font-size: 11px !important;
                padding: 6px !important;
              }
              
              .link-actions {
                .el-button {
                  font-size: 10px !important;
                  padding: 4px 6px !important;
                }
              }
            }
          }
        }
      }
    }
  }
}
</style>
