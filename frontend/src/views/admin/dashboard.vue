<template>
  <div class="admin-page admin-dashboard">
    <div class="page-header">
      <h2>管理员仪表板</h2>
      <p>系统概览和关键指标监控</p>
    </div>

    <!-- 系统状态概览 -->
    <div class="stats-overview">
      <el-row :gutter="20">
        <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ systemStats.totalUsers }}</div>
              <div class="stat-label">总用户数</div>
            </div>
            <div class="stat-icon total">
              <el-icon><User /></el-icon>
            </div>
          </el-card>
        </el-col>

        <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ systemStats.totalNodes }}</div>
              <div class="stat-label">节点总数</div>
            </div>
            <div class="stat-icon active">
              <el-icon><Connection /></el-icon>
            </div>
          </el-card>
        </el-col>

        <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ formatBytes(systemStats.totalTraffic) }}</div>
              <div class="stat-label">总流量</div>
            </div>
            <div class="stat-icon sales">
              <el-icon><DataLine /></el-icon>
            </div>
          </el-card>
        </el-col>

        <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ systemStats.activeUsers }}</div>
              <div class="stat-label">活跃用户</div>
            </div>
            <div class="stat-icon revenue">
              <el-icon><User /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>


    <!-- 管理员操作面板 -->
    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="24">
        <el-card class="admin-actions-card">
          <div class="card-header">
            <h3>管理员操作</h3>
            <span class="admin-tip">请谨慎使用以下功能，操作不可逆</span>
          </div>

          <div class="action-buttons">
            <el-button
              type="warning"
              :loading="executingDailyTask"
              @click="handleExecuteDailyTask"
              :disabled="anyOperationRunning"
            >
              <el-icon><Refresh /></el-icon>
              手动执行每日定时任务
            </el-button>

            <el-button
              type="danger"
              :loading="resettingPasswords"
              @click="handleResetAllPasswords"
              :disabled="anyOperationRunning"
            >
              <el-icon><Key /></el-icon>
              重置所有用户UUID和密码
            </el-button>

            <el-button
              type="danger"
              :loading="resettingSubscriptions"
              @click="handleResetAllSubscriptions"
              :disabled="anyOperationRunning"
            >
              <el-icon><Link /></el-icon>
              重置所有用户订阅链接
            </el-button>

            <el-button
              type="danger"
              :loading="resettingInviteCodes"
              @click="handleResetInviteCodes"
              :disabled="anyOperationRunning"
            >
              <el-icon><Link /></el-icon>
              重置所有用户邀请码
            </el-button>

            <el-button
              type="primary"
              :loading="clearingAuditCache"
              @click="handleClearAuditRulesCache"
              :disabled="anyOperationRunning"
            >
              <el-icon><Refresh /></el-icon>
              清除审计规则缓存
            </el-button>

            <el-button
              type="primary"
              :loading="clearingWhitelistCache"
              @click="handleClearWhitelistCache"
              :disabled="anyOperationRunning"
            >
              <el-icon><Refresh /></el-icon>
              清除白名单缓存
            </el-button>

            <el-button
              type="danger"
              :loading="deletingPendingRecords"
              @click="handleDeletePendingRecords"
              :disabled="anyOperationRunning"
            >
              <el-icon><Delete /></el-icon>
              删除待支付记录
            </el-button>
          </div>

          <div class="operation-status" v-if="operationResult">
            <el-alert
              :title="operationResult.title"
              :type="operationResult.type"
              :description="operationResult.description"
              show-icon
              :closable="true"
              @close="operationResult = null"
            />
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 系统版本信息 -->
    <el-row style="margin-top: 20px;">
      <el-col :span="24">
        <el-card class="version-info-card">
          <template #header>
            <div class="card-header">
              <h3>系统信息</h3>
              <el-icon><InfoFilled /></el-icon>
            </div>
          </template>

          <el-row :gutter="20">
            <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
              <div class="version-item">
                <el-icon class="version-icon"><Monitor /></el-icon>
                <div class="version-content">
                  <div class="version-label">前端版本</div>
                  <div class="version-value">{{ appVersion }}</div>
                </div>
              </div>
            </el-col>

            <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
              <div class="version-item">
                <el-icon class="version-icon"><Setting /></el-icon>
                <div class="version-content">
                  <div class="version-label">后端版本</div>
                  <div class="version-value">{{ systemInfo.version || 'N/A' }}</div>
                </div>
              </div>
            </el-col>

            <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
              <div class="version-item">
                <el-icon class="version-icon"><Calendar /></el-icon>
                <div class="version-content">
                  <div class="version-label">前端构建时间</div>
                  <div class="version-value">{{ buildTime }}</div>
                </div>
              </div>
            </el-col>

            <el-col :xs="24" :sm="12" :md="6" :lg="6" :xl="6">
              <div class="version-item">
                <el-icon class="version-icon"><Clock /></el-icon>
                <div class="version-content">
                  <div class="version-label">后端构建时间</div>
                  <div class="version-value">{{ systemInfo.build_time ? formatBuildTime(systemInfo.build_time) : 'N/A' }}</div>
                </div>
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <!-- 最新注册用户 -->
    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="24">
        <el-card class="recent-users-card">
          <div class="card-header">
            <h3>最新注册用户</h3>
            <router-link to="/admin/users">
              <el-button type="primary" plain size="small">
                查看全部
              </el-button>
            </router-link>
          </div>

          <div class="users-list" v-loading="loadingRecentUsers">
            <div
              v-for="user in recentUsers"
              :key="user.id"
              class="user-item"
            >
              <div class="user-info">
                <el-avatar :size="32">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <div class="user-details">
                  <div class="user-name">{{ user.email }}</div>
                  <div class="user-meta">
                    注册时间: {{ formatDateTime(user.created_at) }}
                  </div>
                </div>
              </div>
              <div class="user-status">
                <el-tag :type="getUserStatusType(user.status)" size="small">
                  {{ getUserStatusText(user.status) }}
                </el-tag>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  User,
  Connection,
  DataLine,
  TrendCharts,
  Coin,
  Refresh,
  Warning,
  CircleCheck,
  Document,
  Key,
  Link,
  InfoFilled,
  Monitor,
  Setting,
  Calendar,
  Clock,
  Delete
} from "@element-plus/icons-vue";
import { useUserStore } from "@/store/user";
import {
  getSystemStats,
  getNodes,
  getUsers,
  triggerTrafficReset,
  resetAllUserPasswords,
  resetAllSubscriptionTokens,
  clearAuditRulesCache,
  clearWhitelistCache,
  resetAllInviteCodes
} from "@/api/admin";
import http from "@/api/http";

const userStore = useUserStore();

// 响应式数据
const loadingRecentUsers = ref(false);

// 管理员操作状态
const executingDailyTask = ref(false);
const resettingPasswords = ref(false);
const resettingSubscriptions = ref(false);
const resettingInviteCodes = ref(false);
const clearingAuditCache = ref(false);
const clearingWhitelistCache = ref(false);
const deletingPendingRecords = ref(false);
const operationResult = ref(null);

// 计算属性：是否有操作正在运行
const anyOperationRunning = computed(() => {
  return (
    executingDailyTask.value ||
    resettingPasswords.value ||
    resettingSubscriptions.value ||
    resettingInviteCodes.value ||
    clearingAuditCache.value ||
    clearingWhitelistCache.value ||
    deletingPendingRecords.value
  );
});

// 系统统计数据 - 从API获取
const systemStats = reactive({
  totalUsers: 0,
  newUsersToday: 0,
  totalNodes: 0,
  onlineNodes: 0,
  totalTraffic: 0,
  todayTraffic: 0,
  activeUsers: 0
});

// 版本信息
const appVersion = ref(import.meta.env.VITE_APP_VERSION || '1.0.0');
const systemInfo = ref<any>({});
const buildTime = ref(import.meta.env.VITE_BUILD_TIME || '构建时间未知');


// 最新用户
const recentUsers = ref([]);

// 工具函数
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDateTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-CN');
};

const formatTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  return `${minutes}分钟前`;
};

const getUserStatusType = (status: number) => {
  const statusMap: Record<number, string> = {
    1: 'success',
    0: 'warning',
    [-1]: 'danger'
  };
  return statusMap[status] || 'info';
};

const getUserStatusText = (status: number) => {
  const statusMap: Record<number, string> = {
    1: '正常',
    0: '未激活',
    [-1]: '已禁用'
  };
  return statusMap[status] || '未知';
};

// 格式化构建时间
const formatBuildTime = (buildTimeStr: string) => {
  try {
    // 如果是 ISO 字符串，转换为本地时间格式
    if (buildTimeStr.includes('T') || buildTimeStr.includes('Z')) {
      const date = new Date(buildTimeStr);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    // 如果已经是格式化的字符串，直接返回
    return buildTimeStr;
  } catch (error) {
    return buildTimeStr;
  }
};

// 加载系统统计数据
const loadSystemStats = async () => {
  try {
    const { data } = await getSystemStats();
    // 更新系统统计数据，适配新的API结构
    systemStats.totalUsers = data.users?.total || 0;
    systemStats.activeUsers = data.users?.active || 0;
    systemStats.totalNodes = data.nodes?.total || 0;
    systemStats.onlineNodes = data.nodes?.online || 0;
    systemStats.totalTraffic = data.traffic?.total || 0;
    systemStats.todayTraffic = data.traffic?.today || 0;

    // 获取后端版本信息（从健康检查接口获取更完整的信息）
    try {
      const healthResponse = await fetch('/api/health');
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        if (healthData.code === 0) {
          systemInfo.value = {
            version: healthData.data.version || '1.0.0',
            build_time: healthData.data.build_time || null
          };
        }
      }
    } catch (error) {
      // 如果健康检查失败，使用默认值
      systemInfo.value = { version: '1.0.0' };
    }

    // 计算今日新增用户数
    try {
      const usersResponse = await getUsers({ limit: 100 });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const recentList = usersResponse.data?.users ?? [];
      systemStats.newUsersToday = recentList.filter(user => {
        const createdAt = new Date(user.created_at);
        return createdAt >= today;
      }).length;
    } catch (userError) {
      console.warn('获取今日新增用户失败:', userError);
    }
  } catch (error) {
    console.error('加载系统统计失败:', error);
    ElMessage.error('加载系统统计失败');
  }
};

// 加载最新用户
const loadRecentUsers = async () => {
  loadingRecentUsers.value = true;
  try {
    const { data } = await getUsers({ limit: 10 });
    // 按注册时间降序排序，最新注册的用户显示在最上面
    const userList = data?.users ?? [];
    recentUsers.value = userList
      .map(user => ({
        id: user.id,
        email: user.email,
        status: user.status,
        created_at: new Date(user.created_at).getTime()
      }))
      .sort((a, b) => b.created_at - a.created_at); // 降序排序
  } catch (error) {
    console.error('加载最新用户失败:', error);
  } finally {
    loadingRecentUsers.value = false;
  }
};

// 管理员操作方法
const handleExecuteDailyTask = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要手动执行每日定时任务吗？此操作将执行完整的每日定时任务，包括用户流量重置、符合重置条件的节点流量重置、过期数据清理等。注意：过期用户检查是每分钟执行的独立任务。',
      '确认操作',
      {
        confirmButtonText: '确定执行',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    executingDailyTask.value = true;
    const { data } = await triggerTrafficReset();

    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: data.message || '每日定时任务执行完成，已处理用户流量重置和节点流量重置'
    };
    ElMessage.success(data.message || '每日定时任务执行成功，已完成流量重置和数据清理');

    // 刷新系统统计
    await loadSystemStats();

  } catch (error) {
    if (error !== 'cancel') {
      console.error('执行每日定时任务失败:', error);
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '执行每日定时任务失败，请稍后重试'
      };
      ElMessage.error('执行每日定时任务失败，请稍后重试');
    }
  } finally {
    executingDailyTask.value = false;
  }
};

const handleResetAllPasswords = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将重置所有用户的节点密码，用户需要重新获取订阅链接，是否继续？',
      '危险操作确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'error'
      }
    );

    resettingPasswords.value = true;
    const { data } = await resetAllUserPasswords();

    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: data.message || `已重置 ${data.count} 个用户的节点密码`
    };
    ElMessage.success(data.message || '节点密码重置成功');

  } catch (error) {
    if (error !== 'cancel') {
      console.error('重置节点密码失败:', error);
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '重置节点密码失败，请稍后重试'
      };
      ElMessage.error('重置节点密码失败，请稍后重试');
    }
  } finally {
    resettingPasswords.value = false;
  }
};

const handleResetAllSubscriptions = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将重置所有用户的订阅链接，原有Token将失效，是否继续？',
      '危险操作确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'error'
      }
    );

    resettingSubscriptions.value = true;
    const { data } = await resetAllSubscriptionTokens();

    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: data.message || `已重置 ${data.count ?? 0} 个用户的订阅链接`
    };
    ElMessage.success(data.message || '订阅链接重置成功');

  } catch (error) {
    if (error !== 'cancel') {
      console.error('重置订阅链接失败:', error);
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '重置订阅链接失败，请稍后重试'
      };
      ElMessage.error('重置订阅链接失败，请稍后重试');
    }
  } finally {
    resettingSubscriptions.value = false;
  }
};

const handleResetInviteCodes = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将为所有用户生成新的邀请码并清空已使用次数，是否继续？',
      '危险操作确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'error'
      }
    );

    resettingInviteCodes.value = true;
    const { data } = await resetAllInviteCodes();
    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: data.message || `已重置 ${data.count ?? 0} 个用户的邀请码`
    };
    ElMessage.success(data.message || '邀请码已全部重置');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('重置邀请码失败:', error);
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '重置邀请码失败，请稍后重试'
      };
      ElMessage.error('重置邀请码失败，请稍后重试');
    }
  } finally {
    resettingInviteCodes.value = false;
  }
};

// 清除审计规则缓存
const handleClearAuditRulesCache = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清除审计规则缓存吗？',
      '确认操作',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'info'
      }
    );

    clearingAuditCache.value = true;
    const { data } = await clearAuditRulesCache();

    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: data.message || '审计规则缓存已清除'
    };
    ElMessage.success(data.message || '审计规则缓存已清除');
  } catch (error) {
    if (error !== 'cancel') {
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '清除审计规则缓存失败，请稍后重试'
      };
      ElMessage.error('清除审计规则缓存失败，请稍后重试');
    }
  } finally {
    clearingAuditCache.value = false;
  }
};

// 清除白名单缓存
const handleClearWhitelistCache = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清除白名单缓存吗？',
      '确认操作',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'info'
      }
    );

    clearingWhitelistCache.value = true;
    const { data } = await clearWhitelistCache();

    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: data.message || '白名单缓存已清除'
    };
    ElMessage.success(data.message || '白名单缓存已清除');
  } catch (error) {
    if (error !== 'cancel') {
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '清除白名单缓存失败，请稍后重试'
      };
      ElMessage.error('清除白名单缓存失败，请稍后重试');
    }
  } finally {
    clearingWhitelistCache.value = false;
  }
};

// 删除待支付记录
const handleDeletePendingRecords = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除所有待支付的充值和购买记录吗？此操作不可撤销！',
      '危险操作确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        dangerouslyUseHTMLString: true,
        message: '<strong>警告：</strong>此操作将删除所有状态为"待支付"的充值记录和购买记录，且不可恢复。请确认您了解此操作的后果。'
      }
    );

    deletingPendingRecords.value = true;
    const response = await http.delete('/admin/pending-records');

    operationResult.value = {
      title: '操作成功',
      type: 'success',
      description: response.data?.message || '待支付记录已清理完成'
    };
    ElMessage.success(response.data?.message || '待支付记录已清理完成');
  } catch (error) {
    if (error !== 'cancel') {
      operationResult.value = {
        title: '操作失败',
        type: 'error',
        description: '删除待支付记录失败，请稍后重试'
      };
      ElMessage.error('删除待支付记录失败，请稍后重试');
    }
  } finally {
    deletingPendingRecords.value = false;
  }
};

// 生命周期
onMounted(async () => {
  await Promise.all([
    loadSystemStats(),
    loadRecentUsers()
  ]);
});
</script>

<style scoped lang="scss">
@use '@/styles/admin-mobile.scss';
.admin-dashboard {
  .page-header {
    margin-bottom: 24px;

    h2 {
      margin: 0 0 8px 0;
      color: #303133;
      font-size: 24px;
    }

    p {
      margin: 0;
      color: #909399;
    }
  }
}

.stats-overview {
  margin-bottom: 24px;

  .stat-card {
    transition: transform 0.2s;
    height: 100%;

    &:hover {
      transform: translateY(-2px);
    }

    :deep(.el-card__body) {
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .stat-content {
      flex: 1;

      .stat-number {
        font-size: 28px;
        font-weight: 700;
        color: #303133;
        line-height: 1;
        margin-bottom: 8px;
      }

      .stat-label {
        font-size: 14px;
        color: #909399;
      }
    }

    .stat-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;

      &.total {
        background: #e6f7ff;
        color: #1890ff;
      }

      &.active {
        background: #f6ffed;
        color: #52c41a;
      }

      &.sales {
        background: #fff7e6;
        color: #fa8c16;
      }

      &.revenue {
        background: #f9f0ff;
        color: #722ed1;
      }
    }
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;

  h3 {
    margin: 0;
    color: #303133;
  }
}


.recent-users-card {
  .users-list {
    .user-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #f5f7fa;

      &:last-child {
        border-bottom: none;
      }

      .user-info {
        display: flex;
        align-items: center;
        gap: 12px;

        .user-details {
          .user-name {
            font-weight: 500;
            color: #303133;
            margin-bottom: 4px;
          }

          .user-meta {
            color: #909399;
            font-size: 12px;
          }
        }
      }
    }
  }
}


.admin-actions-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;

    h3 {
      margin: 0;
      color: #303133;
    }

    .admin-tip {
      color: #e6a23c;
      font-size: 12px;
    }
  }

  .action-buttons {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;

    .el-button {
      min-width: 180px;
    }
  }

  .operation-status {
    margin-top: 20px;
  }
}

// 版本信息卡片样式
.version-info-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    h3 {
      margin: 0;
      color: #303133;
      font-size: 16px;
    }

    .el-icon {
      color: #409eff;
      font-size: 18px;
    }
  }

  .version-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: #f8f9fa;
    border-radius: 8px;
    transition: all 0.3s ease;

    &:hover {
      background: #f0f2f5;
      transform: translateY(-1px);
    }

    .version-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #409eff, #67c23a);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 18px;
      flex-shrink: 0;
    }

    .version-content {
      flex: 1;

      .version-label {
        font-size: 12px;
        color: #909399;
        margin-bottom: 4px;
      }

      .version-value {
        font-size: 14px;
        font-weight: 600;
        color: #303133;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      }
    }
  }
}

// 移动端适配
@media (max-width: 768px) {
  .admin-dashboard {
    padding: 0 10px;

    .page-header {
      margin-bottom: 20px;
      text-align: center;

      h2 {
        font-size: 20px;
        margin-bottom: 5px;
      }

      p {
        font-size: 13px;
      }
    }
  }

  .stats-overview {
    margin-bottom: 20px;

    :deep(.el-row) {
      margin: 0 -10px;
    }

    :deep(.el-col) {
      padding: 0 10px;
      margin-bottom: 15px;
    }

    .stat-card {
      :deep(.el-card__body) {
        padding: 15px;
      }

      .stat-content {
        .stat-number {
          font-size: 24px;
          margin-bottom: 3px;
        }

        .stat-label {
          font-size: 12px;
        }
      }

      .stat-icon {
        width: 40px;
        height: 40px;
        font-size: 18px;
      }
    }
  }

  .admin-actions-card {
    margin: 0 10px 20px;

    :deep(.el-card__body) {
      padding: 15px 10px;
    }

    .card-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 15px;
      padding: 0 5px;

      h3 {
        font-size: 16px;
        margin-bottom: 0;
      }

      .admin-tip {
        font-size: 11px;
        text-align: center;
        padding: 8px;
        background: #fff7e6;
        border-radius: 4px;
        border: 1px solid #ffe7ba;
        box-sizing: border-box;
      }
    }

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 15px;
      padding: 0 5px;

      .el-button {
        width: 100%;
        min-width: auto;
        height: 48px;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 12px 16px;
        box-sizing: border-box;

        :deep(.el-icon) {
          margin-right: 8px;
          font-size: 16px;
        }
      }
    }

    .operation-status {
      padding: 0 5px;
    }
  }

  .version-info-card {
    margin: 20px 10px 0;

    :deep(.el-card__body) {
      padding: 15px;
    }

    .card-header {
      margin-bottom: 15px;

      h3 {
        font-size: 16px;
      }
    }

    :deep(.el-row) {
      margin: 0 -5px;
    }

    :deep(.el-col) {
      padding: 0 5px;
      margin-bottom: 10px;
    }

    .version-item {
      padding: 12px;
      gap: 10px;

      .version-icon {
        width: 32px;
        height: 32px;
        font-size: 14px;
      }

      .version-content {
        .version-label {
          font-size: 11px;
        }

        .version-value {
          font-size: 12px;
        }
      }
    }
  }

  .recent-users-card {
    margin: 20px 10px 0;

    :deep(.el-card__body) {
      padding: 15px;
    }

    .card-header {
      margin-bottom: 15px;

      h3 {
        font-size: 16px;
      }

      .el-button {
        padding: 4px 8px;
        font-size: 12px;
      }
    }

    .users-list {
      .user-item {
        padding: 10px 0;

        .user-info {
          gap: 10px;

          .el-avatar {
            width: 28px !important;
            height: 28px !important;
            font-size: 12px;
          }

          .user-details {
            .user-name {
              font-size: 14px;
              margin-bottom: 2px;
            }

            .user-meta {
              font-size: 11px;
            }
          }
        }

        .user-status {
          .el-tag {
            font-size: 11px;
            padding: 2px 6px;
            height: auto;
          }
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .admin-dashboard {
    padding: 0 8px;
  }

  .stats-overview {
    :deep(.el-row) {
      margin: 0 -8px;
    }

    :deep(.el-col) {
      padding: 0 8px;
      margin-bottom: 12px;
    }

    .stat-card {
      :deep(.el-card__body) {
        padding: 12px;
      }

      .stat-content {
        .stat-number {
          font-size: 20px;
        }

        .stat-label {
          font-size: 11px;
        }
      }

      .stat-icon {
        width: 32px;
        height: 32px;
        font-size: 16px;
      }
    }
  }

  .admin-actions-card {
    margin: 0 8px;

    .action-buttons {
      .el-button {
        height: 40px;
        font-size: 13px;

        .el-icon {
          font-size: 14px;
        }
      }
    }
  }

  .version-info-card,
  .recent-users-card {
    margin-left: 8px;
    margin-right: 8px;
  }
}
</style>
