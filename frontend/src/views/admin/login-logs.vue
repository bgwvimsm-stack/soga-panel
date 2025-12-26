<template>
  <div class="admin-page admin-login-logs">
    <div class="page-header">
      <h2>登录日志</h2>
      <p>查看和管理用户登录记录</p>
    </div>

    <!-- VxeTable 表格 -->
    <VxeTableBar
      :vxeTableRef="vxeTableRef"
      :columns="columns"
      title="登录日志"
      @refresh="loadLogs"
    >
      <template #buttons>
        <el-select
          v-model="filterStatus"
          placeholder="登录状态"
          clearable
          @change="loadLogs"
          style="width: 120px; margin-right: 12px;"
        >
          <el-option label="成功" :value="1" />
          <el-option label="失败" :value="0" />
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
          :data="loginLogs"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <!-- 用户名 -->
          <template #username="{ row }">
            <span>{{ row.username || '-' }}</span>
          </template>

          <!-- 登录状态 -->
          <template #login_status="{ row }">
            <el-tag :type="row.login_status === 1 ? 'success' : 'danger'" size="small">
              {{ row.login_status === 1 ? '成功' : '失败' }}
            </el-tag>
          </template>

          <!-- 地理位置 -->
          <template #location="{ row }">
            <div class="location-cell">
              <span>{{ row.location || ipLocationResults[row.login_ip] || '' }}</span>
              <el-button
                type="primary"
                link
                size="small"
                @click="queryIpLocation(row)"
                :loading="Boolean(locationLoading[row.login_ip])"
              >
                查询
              </el-button>
            </div>
          </template>

          <!-- 登录方式 -->
          <template #login_method="{ row }">
            <el-tag
              size="small"
              :type="formatLoginMethod(row.login_method).type"
              effect="light"
            >
              {{ formatLoginMethod(row.login_method).label }}
            </el-tag>
          </template>

          <!-- 设备信息 -->
          <template #user_agent="{ row }">
            <div class="user-agent-info">
              <el-button
                type="primary"
                text
                size="small"
                @click="openClientDetail(row)"
                :disabled="!row.user_agent"
              >
                查看详情
              </el-button>
            </div>
          </template>

          <!-- 登录时间 -->
          <template #login_time="{ row }">
            <span>{{ formatDateTime(row.login_time) }}</span>
          </template>

          <!-- 失败原因 -->
          <template #failure_reason="{ row }">
            <span v-if="row.login_status === 0" class="failure-reason">{{ row.failure_reason || '-' }}</span>
            <span v-else>-</span>
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
import { Search, Download } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';
import { getIPLocation } from '@/utils/ipLocation';

const vxeTableRef = ref();
const loading = ref(false);
const exporting = ref(false);
const loginLogs = ref([]);
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
const filterStatus = ref('');
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
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'username', title: '用户名', minWidth: 160, visible: true, slots: { default: 'username' } },
  { field: 'user_id', title: '用户ID', width: 100, visible: true },
  { field: 'user_email', title: '用户邮箱', minWidth: 200, visible: false },
  { field: 'login_status', title: '状态', width: 100, visible: true, slots: { default: 'login_status' } },
  { field: 'login_ip', title: 'IP地址', width: 150, visible: true },
  { field: 'location', title: '地理位置', width: 200, visible: true, slots: { default: 'location' } },
  { field: 'login_method', title: '登录方式', width: 120, visible: true, slots: { default: 'login_method' } },
  { field: 'user_agent', title: '设备信息', minWidth: 220, visible: true, slots: { default: 'user_agent' } },
  { field: 'login_time', title: '登录时间', width: 180, visible: true, slots: { default: 'login_time' } },
  { field: 'failure_reason', title: '失败原因', minWidth: 150, visible: true, slots: { default: 'failure_reason' } }
];

// 工具函数
const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  } catch {
    return '-';
  }
};

const formatLoginMethod = (method?: string | null) => {
  if (!method) return { label: '未知', type: 'info' as const };
  const normalized = String(method).trim().toLowerCase();
  switch (normalized) {
    case 'password':
      return { label: 'Passwd', type: 'primary' as const };
    case 'google_oauth':
    case 'google':
      return { label: 'Google', type: 'success' as const };
    case 'github_oauth':
    case 'github':
      return { label: 'GitHub', type: 'info' as const };
    default:
      return { label: method, type: 'info' as const };
  }
};

const queryIpLocation = async (row: any) => {
  const ip = row?.login_ip;
  if (!ip) {
    ElMessage.warning('缺少登录IP信息');
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
    loginLogs.value = loginLogs.value.map((item: any) =>
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
  clientDetailDialog.title = `设备信息 - ${row.username || '未知用户'}`;
  clientDetailDialog.content = row.user_agent || '暂无设备信息';
  clientDetailDialog.visible = true;
};

// 加载登录日志
const loadLogs = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    if (filterStatus.value !== '') params.status = filterStatus.value;
    if (filterUserSearch.value) params.user_id = filterUserSearch.value;
    if (filterIpSearch.value) params.ip = filterIpSearch.value;
    if (filterDateRange.value && filterDateRange.value.length === 2) {
      params.start_date = filterDateRange.value[0];
      params.end_date = filterDateRange.value[1];
    }

    const response: any = await http.get('/admin/login-logs', { params });
    const payload: any = response?.data ?? response ?? {};
    const logs = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.logs)
        ? payload.logs
        : Array.isArray(payload.records)
          ? payload.records
          : [];

    loginLogs.value = logs;
    pagerConfig.total = payload.total ?? payload.pagination?.total ?? logs.length;
  } catch (error) {
    console.error('加载登录日志失败:', error);
    ElMessage.error('加载登录日志失败');
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

// 导出日志
const exportLogs = async () => {
  exporting.value = true;
  try {
    await ElMessageBox.confirm('确定要导出登录日志吗？', '确认导出', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info'
    });

    const csvContent = generateCSV(loginLogs.value);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `登录日志_${new Date().toLocaleDateString()}.csv`);
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
  const headers = ['ID', '用户邮箱', '用户ID', '状态', 'IP地址', '登录时间'];
  const rows = logsToExport.map(log => [
    log.id,
    log.user_email,
    log.user_id,
    log.login_status === 1 ? '成功' : '失败',
    log.login_ip,
    formatDateTime(log.login_time)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => `"${field}"`).join(','))
  ].join('\n');

  return '\uFEFF' + csvContent;
};

// 初始化
onMounted(() => {
  loadLogs();
});
</script>

<style scoped lang="scss">
.admin-login-logs {
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

  .failure-reason {
    color: #f56c6c;
    font-size: 12px;
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
