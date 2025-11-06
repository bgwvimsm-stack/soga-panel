<template>
  <div class="user-page user-subscription-logs">
    <div class="page-header">
      <h2>订阅记录</h2>
      <p>查看您的订阅链接访问记录</p>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="20" class="stats-overview">
      <el-col :xs="24" :sm="12" :md="8">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ totalRecords }}</div>
            <div class="stat-label">总访问次数</div>
          </div>
          <div class="stat-icon"><el-icon><TrendCharts /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ todayRecords }}</div>
            <div class="stat-label">今日访问</div>
          </div>
          <div class="stat-icon"><el-icon><Calendar /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ uniqueIPs }}</div>
            <div class="stat-label">独立IP数</div>
          </div>
          <div class="stat-icon"><el-icon><Monitor /></el-icon></div>
        </el-card>
      </el-col>
    </el-row>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="订阅记录" @refresh="loadSubscriptionLogs">
      <template #buttons>
        <el-select v-model="selectedType" placeholder="订阅类型" clearable @change="loadSubscriptionLogs" style="width: 150px">
          <el-option label="全部" value="" />
          <el-option label="Clash" value="clash" />
          <el-option label="Shadowrocket" value="shadowrocket" />
          <el-option label="Quantumult X" value="quantumultx" />
          <el-option label="Surge" value="surge" />
        </el-select>
      </template>

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
          :data="subscriptionLogs"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #type="{ row }">
            <el-tag :type="getTypeTagColor(row.type)" size="small">{{ getTypeDisplayName(row.type) }}</el-tag>
          </template>
          <template #request_ip="{ row }"><span>{{ row.request_ip }}</span></template>
          <template #request_time="{ row }"><span>{{ formatDateTime(row.request_time) }}</span></template>
          <template #request_user_agent="{ row }">
            <div class="user-agent-info">
              <div class="client-detail">{{ getUserAgentDisplay(row.request_user_agent) }}</div>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { TrendCharts, Calendar, Monitor } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getSubscriptionLogs } from '@/api/user';

const vxeTableRef = ref();
const loading = ref(false);
const subscriptionLogs = ref([]);
const selectedType = ref('');
const totalRecords = ref(0);
const todayRecords = ref(0);
const uniqueIPs = ref(0);

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
  { field: 'type', title: '订阅类型', width: 120, visible: true, slots: { default: 'type' } },
  { field: 'request_ip', title: '访问IP', width: 150, visible: true, slots: { default: 'request_ip' } },
  { field: 'request_time', title: '访问时间', width: 180, visible: true, sortable: true, slots: { default: 'request_time' } },
  { field: 'request_user_agent', title: '客户端信息', minWidth: 200, visible: true, slots: { default: 'request_user_agent' } }
];

const getTypeTagColor = (type: string) => {
  const colorMap: Record<string, string> = {
    clash: 'primary',
    shadowrocket: 'success',
    quantumultx: 'warning',
    surge: 'info'
  };
  return colorMap[type] || '';
};

const getTypeDisplayName = (type: string) => {
  const nameMap: Record<string, string> = {
    clash: 'Clash',
    shadowrocket: 'Shadowrocket',
    quantumultx: 'Quantumult X',
    surge: 'Surge'
  };
  return nameMap[type] || type;
};

const parseDate = (value: string): Date | null => {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const formatDateTime = (dateStr: string): string => {
  const date = parseDate(dateStr);
  return date ? date.toLocaleString('zh-CN') : '-';
};

const parseUserAgent = (ua: string) => {
  if (!ua) return { client: '未知', detail: '' };
  const parts = ua.split('/');
  return {
    client: parts[0] || '未知',
    detail: parts.slice(1).join(' ') || ''
  };
};

const getUserAgentDisplay = (ua: string) => {
  const info = parseUserAgent(ua);
  if (info.client && info.detail) {
    return `${info.client} ${info.detail}`;
  }
  return info.client || info.detail || '未知';
};

const loadSubscriptionLogs = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };
    if (selectedType.value) params.type = selectedType.value;

    const response = await getSubscriptionLogs(params);
    const payload: any = response?.data ?? {};
    const logs = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.logs)
        ? payload.logs
        : [];

    subscriptionLogs.value = logs;

    const total =
      typeof payload.total === 'number'
        ? payload.total
        : typeof payload.pagination?.total === 'number'
          ? payload.pagination.total
          : logs.length;

    pagerConfig.total = total;
    totalRecords.value = total;

    const todayKey = new Date().toDateString();
    todayRecords.value = logs.reduce((count, log) => {
      const logDate = parseDate(log?.request_time);
      return logDate && logDate.toDateString() === todayKey ? count + 1 : count;
    }, 0);

    const ipSet = new Set<string>();
    logs.forEach((log) => {
      if (log?.request_ip) {
        ipSet.add(log.request_ip);
      }
    });
    uniqueIPs.value = ipSet.size;
  } catch (error) {
    console.error('加载订阅记录失败:', error);
    ElMessage.error('加载订阅记录失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadSubscriptionLogs();
};

onMounted(() => {
  loadSubscriptionLogs();
});
</script>

<style scoped lang="scss">
.user-subscription-logs {
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
        font-size: 32px;
        color: #409eff;
        opacity: 0.6;
      }
    }
  }

  .user-agent-info {
    .client-detail { font-size: 12px; color: #909399; margin-top: 2px; }
  }
}
</style>
