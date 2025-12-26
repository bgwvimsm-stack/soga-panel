<template>
  <div class="admin-page admin-subscription-logs">
    <div class="page-header">
      <h2>订阅记录管理</h2>
      <p>查看和管理所有用户的订阅访问记录</p>
    </div>

    <!-- 统计概览 -->
    <div class="stats-overview" v-loading="statsLoading">
      <el-row :gutter="20">
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ stats.totalLogs || 0 }}</div>
              <div class="stat-label">总访问次数</div>
            </div>
            <div class="stat-icon total">
              <el-icon><Document /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ stats.todayLogs || 0 }}</div>
              <div class="stat-label">今日访问</div>
            </div>
            <div class="stat-icon today">
              <el-icon><Calendar /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ stats.activeUsers || 0 }}</div>
              <div class="stat-label">活跃用户</div>
            </div>
            <div class="stat-icon active">
              <el-icon><User /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ stats.popularType || '-' }}</div>
              <div class="stat-label">热门类型</div>
            </div>
            <div class="stat-icon popular">
              <el-icon><TrendCharts /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- VxeTable 表格 -->
    <VxeTableBar
      :vxeTableRef="vxeTableRef"
      :columns="columns"
      title="订阅记录"
      @refresh="loadLogs"
    >
      <template #buttons>
        <!-- 批量操作 -->
        <el-button
          v-if="selectedLogs.length > 0"
          type="danger"
          size="small"
          @click="clearSelectedLogs"
        >
          <el-icon><Delete /></el-icon>
          清理选中({{ selectedLogs.length }})
        </el-button>

        <!-- 筛选 -->
        <el-select
          v-model="filterType"
          placeholder="订阅类型"
          clearable
          @change="loadLogs"
          style="width: 120px; margin-right: 12px;"
        >
          <el-option label="V2Ray" value="v2ray" />
          <el-option label="Clash" value="clash" />
          <el-option label="Quantumult X" value="quantumultx" />
          <el-option label="Shadowsocks" value="shadowsocks" />
        </el-select>

        <el-input
          v-model="filterUserSearch"
          placeholder="搜索用户名或ID"
          clearable
          @change="loadLogs"
          style="width: 200px; margin-right: 12px;"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-input
          v-model="filterIpSearch"
          placeholder="搜索IP地址"
          clearable
          @change="loadLogs"
          style="width: 150px; margin-right: 12px;"
        />

        <el-date-picker
          v-model="filterDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          @change="loadLogs"
          style="width: 300px; margin-right: 12px;"
        />

        <el-button @click="exportLogs" :loading="exporting">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
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
          :checkbox-config="{ reserve: true }"
          @checkbox-change="handleSelectionChange"
          @checkbox-all="handleSelectionChange"
          @page-change="handlePageChange"
        >
          <!-- 用户名 -->
          <template #username="{ row }">
            <span>{{ row.username || '-' }}</span>
          </template>

          <!-- 订阅类型 -->
          <template #type="{ row }">
            <el-tag :type="getSubscriptionTypeColor(row.type)" size="small">
              {{ getSubscriptionTypeName(row.type) }}
            </el-tag>
          </template>

          <!-- 访问IP -->
          <template #request_ip="{ row }">
            <span>{{ row.request_ip }}</span>
          </template>

          <!-- 地理位置 -->
          <template #location="{ row }">
            <div class="location-cell">
              <span>{{ row.location || ipLocationResults[row.request_ip] || '' }}</span>
              <el-button
                type="primary"
                link
                size="small"
                @click="queryIpLocation(row)"
                :loading="Boolean(locationLoading[row.request_ip])"
              >
                查询
              </el-button>
            </div>
          </template>

          <!-- 客户端 -->
          <template #request_user_agent="{ row }">
            <div class="user-agent-info">
              <el-button
                type="primary"
                text
                size="small"
                @click="openClientDetail(row)"
                :disabled="!row.request_user_agent"
              >
                查看详情
              </el-button>
            </div>
          </template>

          <!-- 访问时间 -->
          <template #request_time="{ row }">
            <span>{{ formatDateTime(row.request_time) }}</span>
          </template>

          <!-- 访问频率 -->
          <template #access_count="{ row }">
            <el-tag :type="getAccessCountType(getUserAccessCount(row.user_id))" size="small">
              {{ getUserAccessCount(row.user_id) }} 次
            </el-tag>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <el-dialog
      v-model="clientDetailDialog.visible"
      :title="clientDetailDialog.title"
      width="600px"
    >
      <el-scrollbar class="client-detail-scroll">
        <pre class="client-detail-text">{{ clientDetailDialog.content }}</pre>
      </el-scrollbar>
      <template #footer>
        <el-button @click="clientDetailDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Document, Calendar, User, TrendCharts, Delete, Search, Download } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';
import { getIPLocation } from '@/utils/ipLocation';

const vxeTableRef = ref();
const loading = ref(false);
const statsLoading = ref(false);
const exporting = ref(false);
const subscriptionLogs = ref([]);
const selectedLogs = ref([]);
const stats = ref({
  totalLogs: 0,
  todayLogs: 0,
  activeUsers: 0,
  popularType: '-'
});
const ipLocationResults = reactive<Record<string, string>>({});
const locationLoading = reactive<Record<string, boolean>>({});
const clientDetailDialog = reactive({
  visible: false,
  title: '',
  content: ''
});

// 分页配置
const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

// 筛选条件
const filterType = ref('');
const filterUserSearch = ref('');
const filterIpSearch = ref('');
const filterDateRange = ref([]);

// 表格高度计算
const getTableHeight = computed(() => {
  return (size: string) => {
    switch (size) {
      case 'medium': return 600;
      case 'small': return 550;
      case 'mini': return 500;
      default: return 600;
    }
  };
});

// 列配置
const columns: VxeTableBarColumns = [
  { type: 'checkbox', width: 60, fixed: 'left', visible: true },
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'username', title: '用户名', minWidth: 160, visible: true, slots: { default: 'username' } },
  { field: 'user_email', title: '用户邮箱', minWidth: 200, visible: false },
  { field: 'user_id', title: '用户ID', width: 110, visible: true },
  { field: 'type', title: '订阅类型', width: 120, visible: true, slots: { default: 'type' } },
  { field: 'request_ip', title: '访问IP', width: 150, visible: true, slots: { default: 'request_ip' } },
  { field: 'location', title: '地理位置', width: 200, visible: true, slots: { default: 'location' } },
  { field: 'request_user_agent', title: '客户端', minWidth: 220, visible: true, slots: { default: 'request_user_agent' } },
  { field: 'request_time', title: '访问时间', width: 180, visible: true, slots: { default: 'request_time' } },
  { field: 'access_count', title: '访问频率', width: 100, visible: true, slots: { default: 'access_count' } }
];

// 工具函数
const getSubscriptionTypeName = (type: string) => {
  const typeMap: Record<string, string> = {
    v2ray: 'V2Ray',
    clash: 'Clash',
    quantumultx: 'Quantumult X',
    shadowsocks: 'Shadowsocks'
  };
  return typeMap[type] || type;
};

const getSubscriptionTypeColor = (type: string) => {
  const colorMap: Record<string, string> = {
    v2ray: 'primary',
    clash: 'success',
    quantumultx: 'warning',
    shadowsocks: 'info'
  };
  return colorMap[type] || '';
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  } catch {
    return '-';
  }
};

const getAccessCountType = (count: number) => {
  if (count > 100) return 'danger';
  if (count > 50) return 'warning';
  return 'success';
};

const getUserAccessCount = (userId: number) => {
  if (!userId) return 0;
  return subscriptionLogs.value.filter((log: any) => log.user_id === userId).length;
};

const getIpAccessCount = (ip: string) => {
  if (!ip) return 0;
  return subscriptionLogs.value.filter((log: any) => log.request_ip === ip).length;
};

const getTypeAccessCount = (type: string) => {
  if (!type) return 0;
  return subscriptionLogs.value.filter((log: any) => log.type === type).length;
};

const queryIpLocation = async (row: any) => {
  const ip = row?.request_ip;
  if (!ip) {
    ElMessage.warning('缺少访问IP信息');
    return;
  }
  if (locationLoading[ip]) {
    return;
  }
  locationLoading[ip] = true;
  try {
    const location = await getIPLocation(ip);
    ipLocationResults[ip] = location;
    row.location = location;
    subscriptionLogs.value = subscriptionLogs.value.map((item: any) =>
      item.id === row.id ? { ...item, location } : item
    );
  } catch (error) {
    console.error('查询地理位置失败:', error);
    ElMessage.error('查询地理位置失败，请稍后重试');
  } finally {
    locationLoading[ip] = false;
  }
};

const openClientDetail = (row: any) => {
  clientDetailDialog.title = `客户端详情 - ${row.username || '未知用户'}`;
  clientDetailDialog.content = row.request_user_agent || '暂无客户端信息';
  clientDetailDialog.visible = true;
};

// 加载统计数据（从日志数据中计算）
const loadStats = async () => {
  statsLoading.value = false;
  // 统计数据将在加载日志后自动计算
};

// 加载订阅日志
const loadLogs = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    if (filterType.value) params.type = filterType.value;
    if (filterUserSearch.value) params.user_id = filterUserSearch.value;
    if (filterIpSearch.value) params.ip_search = filterIpSearch.value;
    if (filterDateRange.value && filterDateRange.value.length === 2) {
      params.start_date = filterDateRange.value[0];
      params.end_date = filterDateRange.value[1];
    }

    const response: any = await http.get('/admin/subscription-logs', { params });
    const payload: any = response?.data ?? response ?? {};
    const logs = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.logs)
        ? payload.logs
        : Array.isArray(payload.records)
          ? payload.records
          : [];

    subscriptionLogs.value = logs;
    const total = payload.total ?? payload.pagination?.total ?? logs.length;
    pagerConfig.total = total;

    // 统计数据
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const typeCount: Record<string, number> = {};
    const userSet = new Set<number>();
    let todayCount = 0;

    logs.forEach((log: any) => {
      if (log?.request_time) {
        const time = new Date(log.request_time);
        if (!Number.isNaN(time.getTime()) && time >= today) {
          todayCount += 1;
        }
      }
      if (log?.type) {
        typeCount[log.type] = (typeCount[log.type] || 0) + 1;
      }
      if (log?.user_id != null) {
        userSet.add(log.user_id);
      }
    });

    const popularType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

    stats.value = {
      totalLogs: total,
      todayLogs: todayCount,
      activeUsers: userSet.size,
      popularType: popularType !== '-' ? getSubscriptionTypeName(popularType) : '-'
    };
  } catch (error) {
    console.error('加载订阅日志失败:', error);
    ElMessage.error('加载订阅日志失败');
  } finally {
    loading.value = false;
  }
};

// 分页变化处理
const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadLogs();
};

// 多选变化处理
const handleSelectionChange = () => {
  const selectRecords = vxeTableRef.value?.getCheckboxRecords();
  selectedLogs.value = selectRecords || [];
};

// 清理选中日志
const clearSelectedLogs = async () => {
  if (selectedLogs.value.length === 0) {
    ElMessage.warning('请先选择要清理的日志');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedLogs.value.length} 条日志吗？此操作不可撤销。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    const ids = selectedLogs.value.map(log => log.id);
    await http.post('/admin/subscription-logs/batch-delete', { ids });
    ElMessage.success('删除成功');
    await loadLogs();
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除日志失败:', error);
      ElMessage.error('删除失败，请重试');
    }
  }
};

// 导出日志
const exportLogs = async () => {
  exporting.value = true;
  try {
    await ElMessageBox.confirm(
      '确定要导出订阅日志吗？',
      '确认导出',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'info'
      }
    );

    const logsToExport = selectedLogs.value.length > 0 ? selectedLogs.value : subscriptionLogs.value;
    const csvContent = generateCSV(logsToExport);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `订阅日志_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    ElMessage.success('导出成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('导出日志失败:', error);
      ElMessage.error('导出失败，请重试');
    }
  } finally {
    exporting.value = false;
  }
};

// 生成CSV内容
const generateCSV = (logsToExport: any[]) => {
  const headers = ['ID', '用户邮箱', '用户ID', '订阅类型', '访问IP', '访问时间'];
  const rows = logsToExport.map(log => [
    log.id,
    log.user_email,
    log.user_id,
    getSubscriptionTypeName(log.type),
    log.request_ip,
    formatDateTime(log.request_time)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => `"${field}"`).join(','))
  ].join('\n');

  return '\uFEFF' + csvContent;
};

// 初始化
onMounted(async () => {
  await loadStats();
  await loadLogs();
});
</script>

<style scoped lang="scss">
.admin-subscription-logs {
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

  .stats-overview {
    margin-bottom: 24px;

    .stat-card {
      :deep(.el-card__body) {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px;
      }

      .stat-content {
        .stat-number {
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
        width: 50px;
        height: 50px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 24px;
        background: #409eff;

        &.today { background: #67c23a; }
        &.active { background: #e6a23c; }
        &.popular { background: #f56c6c; }
      }
    }
  }

  .user-info {
    .user-email {
      font-weight: 500;
      color: #303133;
    }

    .user-id {
      font-size: 12px;
      color: #909399;
      margin-top: 2px;
    }
  }

  .user-agent-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #606266;
  }

  .location-cell {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.client-detail-scroll {
  max-height: 320px;
}

.client-detail-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--el-font-family);
  font-size: 13px;
  line-height: 1.6;
  color: #303133;
  margin: 0;
}
</style>
