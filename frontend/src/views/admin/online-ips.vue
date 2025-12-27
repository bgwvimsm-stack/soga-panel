<template>
  <div class="admin-page admin-online-ips">
    <div class="page-header">
      <h2>在线IP管理</h2>
      <p>监控和管理当前在线的IP地址</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="在线IP" @refresh="loadOnlineIps">
      <template #buttons>
        <el-input v-model="filterUserSearch" placeholder="搜索用户名或ID" clearable @change="loadOnlineIps" style="width: 200px; margin-right: 12px;">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-input v-model="filterIpSearch" placeholder="搜索IP地址" clearable @change="loadOnlineIps" style="width: 150px; margin-right: 12px;" />
        <el-input v-model="filterNodeSearch" placeholder="搜索节点" clearable @change="loadOnlineIps" style="width: 150px;" />
      </template>

      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid ref="vxeTableRef" v-loading="loading" show-overflow :height="getTableHeight(size)" :size="size"
          :column-config="{ resizable: true }" :row-config="{ isHover: true, keyField: 'id' }" :columns="dynamicColumns" :data="onlineIps"
          :pager-config="pagerConfig" @page-change="handlePageChange">
          <template #username="{ row }"><span>{{ row.username || '-' }}</span></template>
          <template #location="{ row }">
            <div class="location-cell">
              <span>{{ row.location || ipLocationResults[row.ip_address] || '' }}</span>
              <el-button
                type="primary"
                link
                size="small"
                @click="queryIpLocation(row)"
                :loading="Boolean(locationLoading[row.ip_address])"
              >
                查询
              </el-button>
            </div>
          </template>
          <template #node_name="{ row }"><el-tag size="small">{{ row.node_name }}</el-tag></template>
          <template #connect_time="{ row }"><span>{{ formatDateTime(row.connect_time) }}</span></template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';
import { getIPLocation } from '@/utils/ipLocation';

const vxeTableRef = ref();
const loading = ref(false);
const onlineIps = ref([]);
const ipLocationResults = reactive<Record<string, string>>({});
const locationLoading = reactive<Record<string, boolean>>({});
const pagerConfig = reactive<VxePagerConfig>({ total: 0, currentPage: 1, pageSize: 20, pageSizes: [10, 20, 50, 100], layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump'] });
const filterUserSearch = ref('');
const filterIpSearch = ref('');
const filterNodeSearch = ref('');

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns: VxeTableBarColumns = [
  { field: 'username', title: '用户名', minWidth: 160, visible: true, slots: { default: 'username' } },
  { field: 'user_id', title: '用户ID', width: 100, visible: true },
  { field: 'user_email', title: '用户邮箱', minWidth: 200, visible: false },
  { field: 'ip_address', title: 'IP地址', width: 150, visible: true },
  { field: 'location', title: '地理位置', width: 200, visible: true, slots: { default: 'location' } },
  { field: 'node_name', title: '连接节点', width: 150, visible: true, slots: { default: 'node_name' } },
  { field: 'connect_time', title: '连接时间', width: 180, visible: true, slots: { default: 'connect_time' } }
];

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  try { return new Date(dateStr).toLocaleString('zh-CN'); } catch { return '-'; }
};

const queryIpLocation = async (row: any) => {
  const ip = row?.ip_address;
  if (!ip) {
    ElMessage.warning('缺少IP地址信息');
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
    onlineIps.value = onlineIps.value.map((item: any) =>
      item.id === row.id ? { ...item, location } : item
    );
  } catch (error) {
    console.error('查询IP地理位置失败:', error);
    ElMessage.error('查询地理位置失败，请稍后重试');
  } finally {
    locationLoading[ip] = false;
  }
};

const loadOnlineIps = async () => {
  loading.value = true;
  try {
    const params: any = { page: pagerConfig.currentPage, limit: pagerConfig.pageSize };
    if (filterUserSearch.value) params.user_search = filterUserSearch.value;
    if (filterIpSearch.value) params.ip = filterIpSearch.value;
    if (filterNodeSearch.value) params.node_search = filterNodeSearch.value;
    const response: any = await http.get('/admin/online-ips', { params });
    const payload: any = response?.data ?? response ?? {};
    const ips = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.ips)
        ? payload.ips
        : Array.isArray(payload.records)
          ? payload.records
          : [];
    onlineIps.value = ips;
    pagerConfig.total = payload.total ?? payload.pagination?.total ?? ips.length;
  } catch (error) {
    console.error('加载在线IP失败:', error);
    ElMessage.error('加载在线IP失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadOnlineIps();
};

onMounted(() => loadOnlineIps());
</script>

<style scoped lang="scss">
.admin-online-ips {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .user-info {
    .user-email { font-weight: 500; color: #303133; }
    .user-id { font-size: 12px; color: #909399; margin-top: 2px; }
  }
  .location-cell {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
</style>
