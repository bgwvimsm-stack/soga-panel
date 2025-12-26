<template>
  <div class="user-page user-audit-logs">
    <div class="page-header">
      <h2>审计记录</h2>
      <p>查看您的访问记录和触发的审计事件</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="审计记录列表" @refresh="loadLogs">
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
          :data="logs"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #time="{ row }"><span>{{ formatDateTime(row.time) }}</span></template>
          <template #node_name="{ row }"><span>{{ row.node_name || '未知' }}</span></template>
          <template #triggered_rule="{ row }">
            <el-tag size="small" type="info">{{ row.triggered_rule || '未知' }}</el-tag>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getUserAuditLogs } from '@/api/audit';
import type { AuditLog } from '@/api/types';

const vxeTableRef = ref();
const loading = ref(false);
const logs = ref<AuditLog[]>([]);
const pagerConfig = reactive<VxePagerConfig>({
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
  { field: 'time', title: '时间', width: 180, visible: true, slots: { default: 'time' } },
  { field: 'node_name', title: '节点名称', width: 150, visible: true, slots: { default: 'node_name' } },
  { field: 'triggered_rule', title: '触发规则', minWidth: 200, visible: true, slots: { default: 'triggered_rule' } }
];

const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '未知';
  return new Date(dateStr).toLocaleString('zh-CN');
};

const loadLogs = async () => {
  loading.value = true;
  try {
    const response = await getUserAuditLogs({
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    });
    
    if (response.code === 0 && response.data) {
      logs.value = response.data.logs;
      pagerConfig.total = response.data.pagination.total || 0;
    } else {
      throw new Error(response.message || '获取审计记录失败');
    }
  } catch (error) {
    console.error('加载审计记录失败:', error);
    ElMessage.error('加载审计记录失败');
    logs.value = [];
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadLogs();
};

onMounted(() => {
  loadLogs();
});
</script>

<style scoped lang="scss">
.user-audit-logs {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
}
</style>
