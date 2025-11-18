<template>
  <div class="dashboard">
    <!-- 欢迎区域 -->
    <div class="welcome-section">
      <h1>仪表盘</h1>
    </div>

    <!-- 用户状态警告 -->
    <el-alert
      v-if="userStore.isDisabledUser()"
      title="账号已被禁用"
      type="warning"
      :closable="false"
      show-icon
      class="status-alert"
      style="margin-bottom: 20px;"
    >
      <template #default>
        您的账号已被禁用，只能访问仪表盘、公告详情和个人资料页面。如有疑问请联系管理员。
      </template>
    </el-alert>

    <!-- 主要内容区域 -->
    <div class="main-content" v-loading="loading">
      <div class="dashboard-layout">
        <!-- 左侧公告区域 -->
        <div class="left-panel">
          <div class="pinned-announcements-section" v-if="pinnedAnnouncements.length > 0">
            <h2>公告</h2>
            <div class="announcement-list">
              <div
                v-for="announcement in pinnedAnnouncements"
                :key="announcement.id"
                class="announcement-card"
                :class="`announcement-type-${announcement.type}`"
              >
                <div class="announcement-header">
                  <div class="announcement-icon">
                    <el-icon v-if="announcement.type === 'info'"><InfoFilled /></el-icon>
                    <el-icon v-else-if="announcement.type === 'warning'"><WarningFilled /></el-icon>
                    <el-icon v-else-if="announcement.type === 'success'"><SuccessFilled /></el-icon>
                    <el-icon v-else-if="announcement.type === 'danger'"><CircleCloseFilled /></el-icon>
                    <el-icon v-else><Bell /></el-icon>
                  </div>
                  <div class="announcement-content">
                    <h3 class="announcement-title">{{ announcement.title }}</h3>
                    <div class="announcement-text" v-if="announcement.content_html" v-html="announcement.content_html"></div>
                    <div class="announcement-text" v-else>{{ announcement.content }}</div>
                  </div>
                  <div class="announcement-time">
                    {{ formatAnnouncementTime(announcement.created_at) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧内容区域 -->
        <div class="right-panel">
          <!-- 用户中心 -->
          <div class="subscription-section">
            <h2>用户中心</h2>

            <div class="subscription-card">
              <div class="subscription-info">
                <!-- 第一行: 用户等级、在线设备、速度限制 -->
                <div class="device-speed-info">
                  <span class="info-item">等级 {{ userStore.user?.class || 0 }}</span>
                  <span class="info-item">在线设备 {{ onlineDeviceCount }}/{{ user?.device_limit || '∞' }}</span>
                  <span class="info-item">速度限制 {{ formatSpeedLimit(user?.speed_limit) }}</span>
                </div>

                <!-- 第二行: 会员到期信息 -->
                <p class="member-info">
                  会员于 {{ formatClassExpireTime(user?.class_expire_time) }} 到期，距离到期还有 {{ getDaysUntilClassExpiry(user?.class_expire_time) }} 天。<span v-if="getTrafficResetInfo()">{{ getTrafficResetInfo() }}</span>
                </p>

                <!-- 第三行: 流量信息 -->
                <div class="traffic-info">
                  <span class="today-usage">今日已用 {{ formatBytes(todayUsage) }}</span>
                  <span class="total-usage">已用 {{ formatBytes(usedTraffic) }} / 总计 {{ formatBytes(user?.transfer_enable || 0) }}</span>
                </div>

                <!-- 流量进度条 -->
                <div class="traffic-progress">
                  <el-progress
                    :percentage="getTrafficPercent()"
                    :show-text="false"
                    :stroke-width="8"
                    :color="getProgressColor(getTrafficPercent())"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 捷径 -->
          <div class="shortcuts-section">
            <h2>捷径</h2>

            <div class="shortcuts-grid">
              <div class="shortcut-card" @click="goToNodes">
                <div class="shortcut-icon">
                  <el-icon><Connection /></el-icon>
                </div>
                <div class="shortcut-content">
                  <h3>节点列表</h3>
                  <p>查看可用节点和连接状态</p>
                </div>
              </div>

              <div class="shortcut-card" @click="goToSubscription">
                <div class="shortcut-icon">
                  <el-icon><Link /></el-icon>
                </div>
                <div class="shortcut-content">
                  <h3>一键订阅</h3>
                  <p>快速复制点击对应客户端进行使用</p>
                </div>
              </div>

              <div class="shortcut-card" @click="goToTraffic">
                <div class="shortcut-icon">
                  <el-icon><TrendCharts /></el-icon>
                </div>
                <div class="shortcut-content">
                  <h3>流量统计</h3>
                  <p>查看您的流量使用统计情况</p>
                </div>
              </div>

              <div class="shortcut-card" @click="goToAnnouncements">
                <div class="shortcut-icon">
                  <el-icon><Bell /></el-icon>
                </div>
                <div class="shortcut-content">
                  <h3>公告详情</h3>
                  <p>查看最新的系统公告和通知</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { formatBytes } from '@/utils/format';
import { useUserStore } from "@/store/user";
import {
  Document, Connection, Link, Clock, Setting, TrendCharts,
  InfoFilled, WarningFilled, SuccessFilled, CircleCloseFilled, Bell
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { getUserProfile } from "@/api/auth";
import { getUser } from "@/utils/auth-soga";
import { getAnnouncements, type Announcement } from "@/api/announcement";
import http from "@/api/http";
import type { User as UserType } from "@/api/types";
import { getTrafficTrends } from "@/api/user";

const router = useRouter();
const userStore = useUserStore();
const user = ref<UserType | null>(getUser());
const loading = ref(false);
const pinnedAnnouncements = ref<Announcement[]>([]);
const onlineDeviceCount = ref(0);

// 计算已使用流量
const usedTraffic = computed(() => {
  const total = Number(user.value?.transfer_total || 0);
  if (Number.isFinite(total) && total > 0) {
    return total;
  }
  const upload = user.value?.upload_traffic || 0;
  const download = user.value?.download_traffic || 0;
  return upload + download;
});

// 计算今日已用流量
const todayUsage = ref(0);

const updateLocalTodayUsage = () => {
  todayUsage.value = (user.value?.upload_today || 0) + (user.value?.download_today || 0);
};

const updateTodayUsage = async () => {
  updateLocalTodayUsage();
  try {
    const { data } = await getTrafficTrends('today');
    if (Array.isArray(data) && data.length > 0) {
      const todayData = data[0];
      const total = Number(todayData.total_traffic || 0);
      if (total > 0) {
        todayUsage.value = total;
      } else {
        todayUsage.value = Number(todayData.upload_traffic || 0) + Number(todayData.download_traffic || 0);
      }
    }
  } catch (error) {
    console.error('获取今日流量失败:', error);
  }
};

// formatBytes函数已从@/utils/format导入

// 格式化设备限制
const formatDeviceLimit = (limit?: number): string => {
  if (!limit || limit === 0) return '无限制';
  return `${limit}/10`;
};

// 格式化速度限制
const formatSpeedLimit = (limit?: number): string => {
  if (!limit || limit === 0) return '无限制';
  return `${limit} Mbps`;
};

// 格式化等级过期时间
const formatClassExpireTime = (dateStr?: string | number): string => {
  if (!dateStr) return '永久';

  let date: Date;
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000);
  } else {
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) {
    return '永久';
  }

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

// 计算距离等级过期天数
const getDaysUntilClassExpiry = (dateStr?: string | number): number => {
  if (!dateStr) return 999;

  let date: Date;
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000);
  } else {
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) return 999;

  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(diffDays, 0);
};

// 计算流量使用百分比
const getTrafficPercent = (): number => {
  if (!user.value?.transfer_enable || user.value.transfer_enable === 0) return 0;
  const used = usedTraffic.value;
  return Math.min(Math.round((used / user.value.transfer_enable) * 100), 100);
};

// 根据使用百分比获取进度条颜色
const getProgressColor = (percentage: number): string => {
  if (percentage >= 90) return '#f56c6c'; // 红色 - 危险
  if (percentage >= 70) return '#e6a23c'; // 黄色 - 警告
  return '#67c23a'; // 绿色 - 正常
};

// 格式化到期日期
const formatExpireDate = (dateStr?: string | number): string => {
  if (!dateStr) return '永不过期';

  let date: Date;
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000);
  } else {
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) {
    return '永不过期';
  }

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

// 计算距离到期天数
const getDaysUntilExpiry = (dateStr?: string | number): number => {
  if (!dateStr) return 999;

  let date: Date;
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000);
  } else {
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) return 999;

  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(diffDays, 0);
};

// 获取流量重置信息
const getTrafficResetInfo = (): string => {
  // 如果 traffic_reset_day 为 0，表示不执行流量重置，返回空字符串不显示
  if (!user.value?.traffic_reset_day || user.value.traffic_reset_day === 0) {
    return '';
  }

  const resetDay = user.value.traffic_reset_day;

  // 设置为1-31时，显示为"已用流量将在每月X日重置"
  return `已用流量将在每月 ${resetDay} 日重置`;
};

// 导航方法
const goToSubscription = () => router.push('/user/subscription');
const goToNodes = () => router.push('/user/nodes');
const goToTraffic = () => router.push('/user/traffic');
const goToAnnouncements = () => router.push('/user/announcements');

// 格式化公告时间
const formatAnnouncementTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

  if (diffInHours < 1) {
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    return diffInMinutes < 1 ? '刚刚' : `${diffInMinutes}分钟前`;
  }

  if (diffInHours < 24) {
    return `${diffInHours}小时前`;
  }

  if (diffInHours < 168) { // 7天
    return `${Math.floor(diffInHours / 24)}天前`;
  }

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

// 加载置顶公告
const loadPinnedAnnouncements = async () => {
  try {
    const { data } = await getAnnouncements({ limit: 10, offset: 0 });
    pinnedAnnouncements.value = data.filter((announcement: Announcement) => announcement.is_pinned);
  } catch (error) {
    console.error('加载置顶公告失败:', error);
  }
};

// 加载在线设备数量
const loadOnlineDeviceCount = async () => {
  try {
    const response = await http.get('/user/online-devices');
    if (response.data && response.data.count !== undefined) {
      onlineDeviceCount.value = response.data.count;
    }
  } catch (error) {
    console.error('加载在线设备数量失败:', error);
    onlineDeviceCount.value = 0;
  }
};

// 加载数据
const loadData = async () => {
  loading.value = true;

  try {
    await Promise.all([
      getUserProfile().then(({ data }) => {
        user.value = data;
        // 同时更新 userStore 以确保其他组件能获取到最新的用户信息
        userStore.updateUser(data);
      }),
      loadPinnedAnnouncements(),
      loadOnlineDeviceCount()
    ]);
    await updateTodayUsage();
  } catch (error) {
    console.error('加载数据失败:', error);
    ElMessage.error('加载数据失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadData();
});
</script>

<style scoped lang="scss">
.dashboard {
  margin: -20px;
  margin-bottom: 0;
}

.welcome-section {
  position: relative;
  background: linear-gradient(120deg, #dbeafe 0%, #e0f2fe 45%, #fce7f3 100%);
  color: #0f172a;
  padding: 36px 48px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.05);
  overflow: hidden;

  &::before,
  &::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    filter: blur(0px);
    opacity: 0.35;
  }

  &::before {
    width: 220px;
    height: 220px;
    right: -60px;
    top: -100px;
    background: radial-gradient(circle, rgba(147, 197, 253, 0.8) 0%, rgba(147, 197, 253, 0) 70%);
  }

  &::after {
    width: 180px;
    height: 180px;
    left: -50px;
    bottom: -90px;
    background: radial-gradient(circle, rgba(248, 181, 218, 0.8) 0%, rgba(248, 181, 218, 0) 70%);
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }
}

.main-content {
  padding: 30px;
  max-width: 1400px;
  margin: 0 auto;
}

.dashboard-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  align-items: start;
}

.left-panel {
  .pinned-announcements-section {
    margin-bottom: 0;

    h2 {
      font-size: 18px;
      font-weight: 500;
      color: #1f2937;
      margin: 0 0 20px 0;
    }
  }
}

.right-panel {
  .subscription-section,
  .shortcuts-section {
    margin-bottom: 40px;

    h2 {
      font-size: 18px;
      font-weight: 500;
      color: #1f2937;
      margin: 0 0 20px 0;
    }
  }

  .shortcuts-section {
    margin-bottom: 0;
  }
}

.subscription-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;

  .subscription-header {
    margin-bottom: 16px;

    h3 {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin: 0;
    }
  }

  .subscription-info {
    .device-speed-info {
      display: flex;
      gap: 24px;
      margin-bottom: 12px;

      .info-item {
        color: #6b7280;
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
      }
    }

    .member-info {
      color: #6b7280;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 12px 0;
    }

    .traffic-info {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 12px;

      .today-usage {
        color: #1f2937;
        font-size: 14px;
        font-weight: 500;
      }

      .total-usage {
        color: #1f2937;
        font-size: 14px;
        font-weight: 500;
      }
    }

    .traffic-progress {
      margin-top: 8px;

      :deep(.el-progress-bar__outer) {
        background-color: #f0f2f5;
        border-radius: 4px;
      }

      :deep(.el-progress-bar__inner) {
        border-radius: 4px;
        transition: all 0.3s ease;
      }
    }
  }
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

.shortcut-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateY(-2px);
  }

  .shortcut-icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background: #f3f4f6;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    .el-icon {
      font-size: 24px;
      color: #6b7280;
    }
  }

  .shortcut-content {
    flex: 1;
    min-width: 0;

    h3 {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 4px 0;
    }

    p {
      font-size: 14px;
      color: #6b7280;
      margin: 0;
      line-height: 1.4;
    }
  }
}

.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.announcement-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
  border-left: 4px solid transparent;
  transition: all 0.2s ease;

  &.announcement-type-info {
    border-left-color: #409eff;
  }

  &.announcement-type-warning {
    border-left-color: #e6a23c;
  }

  &.announcement-type-success {
    border-left-color: #67c23a;
  }

  &.announcement-type-danger {
    border-left-color: #f56c6c;
  }

  .announcement-header {
    display: flex;
    align-items: flex-start;
    gap: 16px;

    .announcement-icon {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
      background: #f3f4f6;

      .el-icon {
        color: #6b7280;
      }
    }

    .announcement-content {
      flex: 1;
      min-width: 0;

      .announcement-title {
        font-size: 16px;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 8px 0;
        line-height: 1.4;
      }

      .announcement-text {
        color: #6b7280;
        font-size: 14px;
        line-height: 1.5;
        margin: 0;

        :deep(p) {
          margin: 0 0 8px 0;

          &:last-child {
            margin-bottom: 0;
          }
        }

        :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
          color: #1f2937;
          margin: 12px 0 8px 0;
          font-size: 15px;

          &:first-child {
            margin-top: 0;
          }
        }

        :deep(ul), :deep(ol) {
          margin: 8px 0;
          padding-left: 20px;
        }

        :deep(code) {
          background-color: #f1f2f3;
          padding: 2px 4px;
          border-radius: 3px;
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 13px;
          color: #e74c3c;
        }
      }
    }

    .announcement-time {
      font-size: 12px;
      color: #9ca3af;
      white-space: nowrap;
      margin-top: 4px;
    }
  }
}

// 响应式设计
@media (max-width: 1024px) {
  .dashboard-layout {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .left-panel {
    .pinned-announcements-section {
      margin-bottom: 40px;
    }
  }
}

@media (max-width: 768px) {
  .welcome-section {
    padding: 20px;
  }

  .main-content {
    padding: 20px;
  }

  .dashboard-layout {
    gap: 20px;
  }

  .shortcuts-grid {
    grid-template-columns: 1fr;
  }

  .shortcut-card {
    padding: 16px;

    .shortcut-icon {
      width: 40px;
      height: 40px;

      .el-icon {
        font-size: 20px;
      }
    }

    .shortcut-content {
      h3 {
        font-size: 15px;
      }

      p {
        font-size: 13px;
      }
    }
  }

  .announcement-card {
    .announcement-header {
      gap: 12px;

      .announcement-icon {
        width: 40px;
        height: 40px;
        font-size: 20px;
      }

      .announcement-content {
        .announcement-title {
          font-size: 15px;
        }

        .announcement-text {
          font-size: 13px;
        }
      }
    }
  }
}
</style>
