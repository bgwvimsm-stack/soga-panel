<template>
  <div class="admin-page admin-node-status">
    <div class="page-header">
      <h2>节点状态</h2>
      <p>查看每个节点的服务器资源与上报状态</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="节点状态" @refresh="loadNodes">
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
          :data="nodes"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #name="{ row }">
            <div class="node-name">
              <span>{{ row.name || '-' }}</span>
            </div>
          </template>
          <template #cpu="{ row }">
            <span>{{ formatPercent(row.cpu_usage) }}</span>
          </template>
          <template #memory="{ row }">
            <span>{{ formatUsage(row.memory_used, row.memory_total) }}</span>
          </template>
          <template #swap="{ row }">
            <span>{{ formatUsage(row.swap_used, row.swap_total) }}</span>
          </template>
          <template #disk="{ row }">
            <span>{{ formatUsage(row.disk_used, row.disk_total) }}</span>
          </template>
          <template #uptime="{ row }">
            <span>{{ formatUptime(row.uptime) }}</span>
          </template>
          <template #last_reported="{ row }">
            <span>{{ formatDateTime(row.last_reported) }}</span>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getNodeStatusList, type NodeStatus, type NodeStatusResponse } from '@/api/admin';

const vxeTableRef = ref();
const loading = ref(false);
const nodes = ref<NodeStatus[]>([]);

const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium':
      return 640;
    case 'small':
      return 600;
    case 'mini':
      return 560;
    default:
      return 640;
  }
});

const columns: VxeTableBarColumns = [
  { field: 'name', title: '节点名称', minWidth: 180, visible: true, slots: { default: 'name' } },
  { field: 'cpu_usage', title: 'CPU', width: 90, visible: true, align: 'center', slots: { default: 'cpu' } },
  { field: 'memory', title: '内存', width: 220, visible: true, slots: { default: 'memory' } },
  { field: 'swap', title: 'Swap', minWidth: 220, visible: true, slots: { default: 'swap' } },
  { field: 'disk', title: '磁盘', width: 200, visible: true, slots: { default: 'disk' } },
  { field: 'uptime', title: '运行时间', width: 140, visible: true, align: 'center', slots: { default: 'uptime' } },
  { field: 'last_reported', title: '最后上报', width: 180, visible: true, align: 'center', slots: { default: 'last_reported' } }
];

const formatPercent = (value?: number) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '-';
  return `${num.toFixed(1)}%`;
};

const formatBytes = (bytes?: number) => {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return `${(num / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

const formatUsage = (used?: number, total?: number) => {
  const totalNum = Number(total);
  const usedNum = Number(used);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return '-';
  const percent = Math.min(100, Math.max(0, (usedNum / totalNum) * 100));
  return `${formatBytes(usedNum)} / ${formatBytes(totalNum)} (${percent.toFixed(1)}%)`;
};

const formatUptime = (seconds?: number) => {
  const totalSeconds = Math.floor(Number(seconds));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '-';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
};

const loadNodes = async () => {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    params.online = 1;

    const response = await getNodeStatusList(params);
    const payload = response.data as NodeStatusResponse | null;

    nodes.value = (payload?.nodes || []).filter((node) => node.is_online);
    pagerConfig.total = payload?.pagination?.total || nodes.value.length;
  } catch (error) {
    console.error('加载节点状态失败:', error);
    ElMessage.error('加载节点状态失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadNodes();
};

onMounted(() => {
  loadNodes();
});
</script>

<style scoped lang="scss">
.admin-node-status {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }

  .node-name {
    display: flex;
    align-items: center;
  }
}
</style>
