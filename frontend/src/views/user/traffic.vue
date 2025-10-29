<template>
  <div class="user-page user-traffic">
    <div class="page-header">
      <h2>流量统计</h2>
      <p>查看您的流量使用情况和历史趋势</p>
    </div>

    <!-- 流量统计卡片 -->
    <el-row :gutter="20" class="stats-overview">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ formatTraffic(totalUsed) }}</div>
            <div class="stat-label">总使用量</div>
          </div>
          <div class="stat-icon total"><el-icon><TrendCharts /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ formatTraffic(todayUsed) }}</div>
            <div class="stat-label">今日使用</div>
          </div>
          <div class="stat-icon today"><el-icon><Calendar /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ formatTraffic(monthUsed) }}</div>
            <div class="stat-label">本月使用</div>
          </div>
          <div class="stat-icon month"><el-icon><DataAnalysis /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ formatTraffic(remaining) }}</div>
            <div class="stat-label">剩余流量</div>
          </div>
          <div class="stat-icon remaining" :class="{ warning: isTrafficLow }"><el-icon><Refresh /></el-icon></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 流量使用进度 -->
    <el-card class="progress-card">
      <div class="progress-header">
        <h3>流量使用进度</h3>
        <el-tag :type="getUsageTagType(usagePercentage)">
          {{ usagePercentage }}% 已使用
        </el-tag>
      </div>
      <div class="progress-content">
        <el-progress
          :percentage="usagePercentage"
          :stroke-width="20"
          :color="getProgressColors()"
        >
          <template #default="{ percentage }">
            <span class="progress-text">{{ percentage }}%</span>
          </template>
        </el-progress>
        <div class="progress-info">
          <span>{{ formatTraffic(totalUsed) }} / {{ formatTraffic(totalEnable) }}</span>
        </div>
      </div>
    </el-card>

    <!-- 流量趋势图 -->
    <el-card class="chart-card">
      <div class="chart-header">
        <h3>流量趋势</h3>
        <div class="chart-controls">
          <el-radio-group v-model="selectedPeriod" @change="loadTrafficTrends">
            <el-radio-button value="today">今天</el-radio-button>
            <el-radio-button value="3days">最近3天</el-radio-button>
            <el-radio-button value="7days">最近7天</el-radio-button>
          </el-radio-group>
          <el-button @click="loadTrafficTrends" :loading="chartsLoading">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>

      <div class="chart-content">
        <TrafficChart
          :data="trafficTrends"
          :loading="chartsLoading"
          :title="getChartTitle()"
          height="400px"
        />
      </div>
    </el-card>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="流量记录" @refresh="loadTrafficLogs">
      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid
          ref="vxeTableRef"
          v-loading="loading"
          show-overflow
          :height="getTableHeight(size)"
          :size="size"
          :column-config="{ resizable: true }"
          :row-config="{ isHover: true, keyField: 'id' }"
          :columns="dynamicColumns"
          :data="trafficLogs"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #log_time="{ row }">
            <span>{{ row.log_time || formatDate(row.created_at) }}</span>
          </template>
          <template #created_at="{ row }">
            <span>{{ formatTime(row.created_at) }}</span>
          </template>
          <template #upload_traffic="{ row }">
            <span>{{ formatTraffic(row.upload_traffic) }}</span>
          </template>
          <template #download_traffic="{ row }">
            <span>{{ formatTraffic(row.download_traffic) }}</span>
          </template>
          <template #total_traffic="{ row }">
            <span class="total-traffic">{{ formatTraffic(row.total_traffic) }}</span>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { TrendCharts, Calendar, DataAnalysis, Refresh } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getUserTrafficRecords, getTrafficTrends } from '@/api/user';
import { useUserStore } from '@/store/user';
import TrafficChart from '@/components/TrafficChart.vue';

const userStore = useUserStore();
const vxeTableRef = ref();
const loading = ref(false);
const chartsLoading = ref(false);
const trafficLogs = ref([]);
const trafficTrends = ref([]);
const selectedPeriod = ref('today');
const totalUsed = ref(0);
const todayUsed = ref(0);
const monthUsed = ref(0);
const remaining = ref(0);
const totalEnable = ref(0);

const pagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns = [
  { field: 'log_time', title: '日期', width: 120, visible: true, slots: { default: 'log_time' } },
  { field: 'created_at', title: '时间', width: 100, visible: true, slots: { default: 'created_at' } },
  { field: 'upload_traffic', title: '上传流量', width: 120, visible: true, slots: { default: 'upload_traffic' } },
  { field: 'download_traffic', title: '下载流量', width: 120, visible: true, slots: { default: 'download_traffic' } },
  { field: 'total_traffic', title: '总流量', width: 120, visible: true, slots: { default: 'total_traffic' } },
  { field: 'node_name', title: '节点名称', width: 150, visible: true }
];

const formatTraffic = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('zh-CN');
};

const formatTime = (dateStr: string): string => {
  if (!dateStr) return '--:--:--';
  try {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch (error) {
    return '--:--:--';
  }
};

// 计算属性
const usagePercentage = computed(() => {
  const used = totalUsed.value || 0;
  const total = totalEnable.value || 1;
  return Math.min(Math.round((used / total) * 100), 100);
});

const isTrafficLow = computed(() => {
  return usagePercentage.value > 80;
});

// 获取使用率标签类型
const getUsageTagType = (percentage: number) => {
  if (percentage < 50) return 'success';
  if (percentage < 80) return 'warning';
  return 'danger';
};

// 获取进度条颜色
const getProgressColors = () => {
  return [
    { color: '#67c23a', percentage: 50 },
    { color: '#e6a23c', percentage: 80 },
    { color: '#f56c6c', percentage: 100 }
  ];
};

// 获取图表标题
const getChartTitle = () => {
  const titleMap: Record<string, string> = {
    today: '今天流量使用情况',
    '3days': '最近3天流量趋势',
    '7days': '最近7天流量趋势'
  };
  return titleMap[selectedPeriod.value] || '流量趋势';
};

const loadTrafficLogs = async () => {
  loading.value = true;
  try {
    const response = await getUserTrafficRecords({
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    });

    if (response.code === 0 && response.data) {
      trafficLogs.value = response.data.data || [];
      pagerConfig.total = response.data.total || 0;

      // 更新流量统计数据
      updateTrafficStats();
    }
  } catch (error) {
    console.error('加载流量记录失败:', error);
    ElMessage.error('加载流量记录失败');
  } finally {
    loading.value = false;
  }
};

// 更新流量统计数据
const updateTrafficStats = () => {
  const user = userStore.user;
  if (!user) return;

  totalUsed.value = Number(user.upload_traffic || 0) + Number(user.download_traffic || 0);
  totalEnable.value = Number(user.transfer_enable || 0);
  remaining.value = Math.max(0, totalEnable.value - totalUsed.value);
  monthUsed.value = totalUsed.value; // 本月使用等于总使用

  // 今日使用需要从API获取
  loadTodayTraffic();
};

// 加载今日流量
const loadTodayTraffic = async () => {
  try {
    const { data } = await getTrafficTrends('today');
    if (Array.isArray(data) && data.length > 0) {
      const todayData = data[0];
      todayUsed.value = Number(todayData.upload_traffic || 0) + Number(todayData.download_traffic || 0);
    } else {
      // 如果API没有数据，使用用户数据
      const user = userStore.user;
      todayUsed.value = Number(user.upload_today || 0) + Number(user.download_today || 0);
    }
  } catch (error) {
    console.warn('获取今日流量失败，使用默认值:', error);
    const user = userStore.user;
    todayUsed.value = Number(user.upload_today || 0) + Number(user.download_today || 0);
  }
};

// 加载流量趋势
const loadTrafficTrends = async () => {
  chartsLoading.value = true;
  try {
    const { data } = await getTrafficTrends(selectedPeriod.value);
    if (Array.isArray(data)) {
      trafficTrends.value = data;
    } else {
      trafficTrends.value = [];
    }
  } catch (error) {
    console.error('加载流量趋势失败:', error);
    trafficTrends.value = [];
  } finally {
    chartsLoading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadTrafficLogs();
};

onMounted(() => {
  updateTrafficStats();
  loadTrafficTrends();
  loadTrafficLogs();
});
</script>

<style scoped lang="scss">
.user-traffic {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }

  .stats-overview {
    margin-bottom: 24px;
    .stat-card {
      :deep(.el-card__body) {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
      }
      .stat-content {
        .stat-number { font-size: 28px; font-weight: 700; color: #303133; margin-bottom: 8px; }
        .stat-label { font-size: 14px; color: #909399; }
      }
      .stat-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        color: #909399;
        opacity: 0.7;

        &.total { color: #409eff; opacity: 0.85; }
        &.today { color: #67c23a; opacity: 0.85; }
        &.month { color: #e6a23c; opacity: 0.85; }
        &.remaining {
          color: #909399;
          &.warning { color: #f56c6c; opacity: 0.9; }
        }
      }
    }
  }

  .progress-card {
    margin-bottom: 24px;

    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;

      h3 {
        margin: 0;
        color: #303133;
        font-size: 18px;
      }
    }

    .progress-content {
      .progress-text {
        font-size: 14px;
        font-weight: bold;
      }

      .progress-info {
        text-align: center;
        margin-top: 12px;
        color: #606266;
        font-size: 14px;
      }
    }
  }

  .chart-card {
    margin-bottom: 24px;

    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;

      h3 {
        margin: 0;
        color: #303133;
        font-size: 18px;
      }

      .chart-controls {
        display: flex;
        gap: 12px;
        align-items: center;
      }
    }

    .chart-content {
      padding: 0;
    }
  }

  .total-traffic { font-weight: 600; color: #409eff; }
}

// 移动端响应式优化
@media (max-width: 768px) {
  .user-traffic {
    .page-header {
      text-align: center;
      margin-bottom: 16px;

      h2 { font-size: 20px; }
      p { font-size: 13px; }
    }

    .stats-overview {
      margin-bottom: 16px;

      .stat-card {
        margin-bottom: 12px;

        :deep(.el-card__body) {
          padding: 16px;
        }

        .stat-content {
          .stat-number { font-size: 22px; }
          .stat-label { font-size: 13px; }
        }

        .stat-icon {
          font-size: 26px;
          opacity: 0.8;
        }
      }
    }

    .progress-card {
      margin-bottom: 16px;

      :deep(.el-card__body) {
        padding: 16px;
      }

      .progress-header {
        flex-direction: column;
        align-items: flex-start;
        margin-bottom: 16px;

        h3 {
          font-size: 16px;
          margin-bottom: 8px;
        }
      }

      .progress-content {
        :deep(.el-progress-bar__outer) {
          height: 16px !important;
        }

        .progress-info {
          font-size: 13px;
          margin-top: 10px;
        }
      }
    }

    .chart-card {
      margin-bottom: 16px;

      :deep(.el-card__body) {
        padding: 16px;
      }

      .chart-header {
        flex-direction: column;
        align-items: flex-start;
        margin-bottom: 16px;

        h3 {
          font-size: 16px;
          margin-bottom: 12px;
        }

        .chart-controls {
          width: 100%;
          justify-content: space-between;
          gap: 8px;

          .el-radio-group {
            flex: 1;

            :deep(.el-radio-button__inner) {
              font-size: 12px;
              padding: 8px 12px;
            }
          }

          .el-button {
            font-size: 12px;
            padding: 8px 12px;
          }
        }
      }
    }
  }
}
</style>
