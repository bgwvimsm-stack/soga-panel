<template>
  <div class="admin-page admin-audit-logs">
    <div class="page-header">
      <h2>审计日志</h2>
      <p>查看系统审计和操作记录</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="审计日志" @refresh="loadLogs">
      <template #buttons>
        <el-input v-model="filterUserSearch" placeholder="搜索用户名或ID" clearable @change="loadLogs" style="width: 200px; margin-right: 12px;">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-date-picker v-model="filterDateRange" type="daterange" range-separator="至" start-placeholder="开始时间"
          end-placeholder="结束时间" @change="loadLogs" style="width: 300px; margin-right: 12px;" />
        <el-button @click="exportLogs" :loading="exporting"><el-icon><Download /></el-icon>导出</el-button>
      </template>

      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid ref="vxeTableRef" v-loading="loading" show-overflow :height="getTableHeight(size)" :size="size"
          :column-config="{ resizable: true }" :row-config="{ isHover: true, keyField: 'id' }" :columns="dynamicColumns" :data="auditLogs"
          :pager-config="pagerConfig" @page-change="handlePageChange">
          <template #username="{ row }">
            <span>{{ row.username || '-' }}</span>
          </template>
          <template #node_name="{ row }"><span>{{ row.node_name || '-' }}</span></template>
          <template #rule_name="{ row }"><span>{{ row.rule_name || '-' }}</span></template>
          <template #rule_content="{ row }">
            <div class="details-text" :title="row.rule_content">
              {{ truncateText(row.rule_content, 80) }}
            </div>
          </template>
          <template #ip_address="{ row }"><span>{{ row.ip_address || '-' }}</span></template>
          <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Download } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';

const vxeTableRef = ref();
const loading = ref(false);
const exporting = ref(false);
const auditLogs = ref([]);
const pagerConfig = reactive<VxePagerConfig>({ total: 0, currentPage: 1, pageSize: 20, pageSizes: [10, 20, 50, 100], layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump'] });
const filterUserSearch = ref('');
const filterDateRange = ref([]);

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns: VxeTableBarColumns = [
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'username', title: '用户名', minWidth: 160, visible: true, slots: { default: 'username' } },
  { field: 'user_id', title: '用户ID', width: 110, visible: true },
  { field: 'user_email', title: '用户邮箱', minWidth: 220, visible: false },
  { field: 'node_name', title: '触发节点', width: 160, visible: true, slots: { default: 'node_name' } },
  { field: 'rule_name', title: '规则名称', minWidth: 180, visible: true, slots: { default: 'rule_name' } },
  { field: 'rule_content', title: '规则内容', minWidth: 220, visible: true, slots: { default: 'rule_content' } },
  { field: 'ip_address', title: 'IP地址', width: 150, visible: true, slots: { default: 'ip_address' } },
  { field: 'created_at', title: '时间', width: 180, visible: true, slots: { default: 'created_at' } }
];

const truncateText = (text: string, maxLength: number) => {
  if (!text) return '-';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  try { return new Date(dateStr).toLocaleString('zh-CN'); } catch { return '-'; }
};

const loadLogs = async () => {
  loading.value = true;
  try {
    const params: any = { page: pagerConfig.currentPage, limit: pagerConfig.pageSize };
    if (filterUserSearch.value) params.user_id = filterUserSearch.value;
    if (filterDateRange.value && filterDateRange.value.length === 2) {
      params.start_date = filterDateRange.value[0];
      params.end_date = filterDateRange.value[1];
    }
    const response: any = await http.get('/admin/audit-logs', { params });
    const payload: any = response?.data ?? response ?? {};
    const logs = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.logs)
        ? payload.logs
        : Array.isArray(payload.records)
          ? payload.records
          : [];

    auditLogs.value = logs;
    pagerConfig.total = payload.total ?? payload.pagination?.total ?? logs.length;
  } catch (error) {
    console.error('加载审计日志失败:', error);
    ElMessage.error('加载审计日志失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadLogs();
};

const exportLogs = async () => {
  exporting.value = true;
  try {
    await ElMessageBox.confirm('确定要导出审计日志吗？', '确认导出', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' });
    const csvContent = generateCSV(auditLogs.value);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `审计日志_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    ElMessage.success('导出成功');
  } catch (error) {
    if (error !== 'cancel') ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
};

const generateCSV = (logs: any[]) => {
  const headers = ['ID', '用户邮箱', '节点名称', '规则名称', '规则内容', 'IP地址', '时间'];
  const rows = logs.map(log => [
    log.id,
    log.user_email,
    log.node_name,
    log.rule_name,
    log.rule_content,
    log.ip_address,
    formatDateTime(log.created_at)
  ]);
  return '\uFEFF' + [headers.join(','), ...rows.map(row => row.map(f => `"${f}"`).join(','))].join('\n');
};

onMounted(() => loadLogs());
</script>

<style scoped lang="scss">
.admin-audit-logs {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .user-info {
    .user-email { font-weight: 500; color: #303133; }
    .user-id { font-size: 12px; color: #909399; margin-top: 2px; }
  }
  .details-text { font-size: 12px; color: #606266; }
}
</style>
