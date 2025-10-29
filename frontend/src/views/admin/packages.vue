<template>
  <div class="admin-page admin-packages">
    <div class="page-header">
      <h2>套餐管理</h2>
      <p>管理系统中的所有套餐产品</p>
    </div>

    <!-- 套餐统计概览 -->
    <div class="stats-overview" v-loading="statsLoading">
      <el-row :gutter="20">
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ packageStats?.package_stats?.total || 0 }}</div>
              <div class="stat-label">总套餐数</div>
            </div>
            <div class="stat-icon total">
              <el-icon><Box /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ packageStats?.package_stats?.active || 0 }}</div>
              <div class="stat-label">启用套餐</div>
            </div>
            <div class="stat-icon active">
              <el-icon><CircleCheck /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ packageStats?.sales_stats?.completed_purchases || 0 }}</div>
              <div class="stat-label">成功销售</div>
            </div>
            <div class="stat-icon sales">
              <el-icon><ShoppingCart /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">¥{{ packageStats?.sales_stats?.total_revenue?.toFixed(2) || '0.00' }}</div>
              <div class="stat-label">总收入</div>
            </div>
            <div class="stat-icon revenue">
              <el-icon><Money /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="套餐列表" @refresh="loadPackages">
      <template #buttons>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>新建套餐
        </el-button>
        <el-select v-model="filterStatus" placeholder="筛选状态" clearable @change="loadPackages" style="width: 120px; margin-left: 12px;">
          <el-option label="启用" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
        <el-select v-model="filterLevel" placeholder="筛选等级" clearable @change="loadPackages" style="width: 120px; margin-left: 12px;">
          <el-option v-for="level in 5" :key="level" :label="`等级${level}`" :value="level" />
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
          :data="packages"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #name="{ row }"><span>{{ row.name }}</span></template>
          <template #price="{ row }">
            <span class="price-text">¥{{ row.price.toFixed(2) }}</span>
          </template>
          <template #traffic_quota="{ row }"><span>{{ row.traffic_quota }} GB</span></template>
          <template #validity_days="{ row }"><span>{{ row.validity_days }} 天</span></template>
          <template #speed_limit_text="{ row }"><span>{{ row.speed_limit_text }}</span></template>
          <template #device_limit_text="{ row }"><span>{{ row.device_limit_text }}</span></template>
          <template #level="{ row }">
            <el-tag :type="getLevelType(row.level)" size="small">{{ row.level }}</el-tag>
          </template>
          <template #sort_weight="{ row }"><span>{{ row.sort_weight || 0 }}</span></template>
          <template #sales_count="{ row }"><span>{{ row.sales_count || 0 }}</span></template>
          <template #is_recommended="{ row }">
            <el-tag :type="row.is_recommended ? 'success' : 'info'" size="small">
              {{ row.is_recommended ? '推荐' : '普通' }}
            </el-tag>
          </template>
          <template #status="{ row }">
            <el-switch v-model="row.status" :active-value="1" :inactive-value="0" @change="togglePackageStatus(row)" />
          </template>
          <template #created_at="{ row }"><span>{{ row.created_at }}</span></template>
          <template #actions="{ row }">
            <div class="table-actions">
              <el-button type="primary" size="small" @click="editPackage(row)">编辑</el-button>
              <el-button type="danger" size="small" @click="deletePackage(row)">删除</el-button>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 创建/编辑套餐对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingPackage ? '编辑套餐' : '新建套餐'" width="600px" :close-on-click-modal="false" @close="resetForm">
      <el-form ref="packageFormRef" :model="packageForm" :rules="packageRules" label-width="100px">
        <el-form-item label="套餐名称" prop="name">
          <el-input v-model="packageForm.name" placeholder="请输入套餐名称" maxlength="50" />
        </el-form-item>
        <el-form-item label="价格" prop="price">
          <el-input-number v-model="packageForm.price" :min="0.01" :max="10000" :precision="2" :step="0.01" placeholder="请输入价格" style="width: 100%" />
        </el-form-item>
        <el-form-item label="流量配额" prop="traffic_quota">
          <el-input-number v-model="packageForm.traffic_quota" :min="1" :max="10000" placeholder="请输入流量配额(GB)" style="width: 100%" />
        </el-form-item>
        <el-form-item label="有效期" prop="validity_days">
          <el-input-number v-model="packageForm.validity_days" :min="1" :max="3650" placeholder="请输入有效期(天)" style="width: 100%" />
        </el-form-item>
        <el-form-item label="速度限制" prop="speed_limit">
          <el-input-number v-model="packageForm.speed_limit" :min="0" :max="10000" placeholder="请输入速度限制(Mbps)，0表示无限制" style="width: 100%" />
        </el-form-item>
        <el-form-item label="设备限制" prop="device_limit">
          <el-input-number v-model="packageForm.device_limit" :min="0" :max="100" placeholder="请输入设备数量限制，0表示无限制" style="width: 100%" />
        </el-form-item>
        <el-form-item label="用户等级" prop="level">
          <el-input-number v-model="packageForm.level" :min="1" :max="999" :precision="0" placeholder="请输入用户等级" style="width: 100%" />
        </el-form-item>
        <el-form-item label="排序权重" prop="sort_weight">
          <el-input-number v-model="packageForm.sort_weight" :min="0" :max="9999" :precision="0" placeholder="权重数字越大排序越靠前" style="width: 100%" />
        </el-form-item>
        <el-form-item label="推荐设置">
          <el-switch v-model="packageForm.is_recommended" :active-value="1" :inactive-value="0" active-text="推荐套餐" inactive-text="普通套餐" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="packageForm.status">
            <el-radio :label="1">启用</el-radio>
            <el-radio :label="0">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" @click="savePackage" :loading="saving">{{ editingPackage ? '更新' : '创建' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { Box, CircleCheck, ShoppingCart, Money, Plus } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';

const vxeTableRef = ref();
const loading = ref(false);
const statsLoading = ref(false);
const saving = ref(false);
const showCreateDialog = ref(false);
const editingPackage = ref<any>(null);
const packages = ref([]);
const packageStats = ref<any>({});
const pagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const filterStatus = ref('');
const filterLevel = ref('');

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns = [
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'name', title: '套餐名称', minWidth: 150, visible: true, slots: { default: 'name' } },
  { field: 'price', title: '价格', width: 100, visible: true, slots: { default: 'price' } },
  { field: 'traffic_quota', title: '流量配额', width: 120, visible: true, slots: { default: 'traffic_quota' } },
  { field: 'validity_days', title: '有效期', width: 100, visible: true, slots: { default: 'validity_days' } },
  { field: 'speed_limit_text', title: '速度限制', width: 120, visible: true, slots: { default: 'speed_limit_text' } },
  { field: 'device_limit_text', title: '设备限制', width: 120, visible: true, slots: { default: 'device_limit_text' } },
  { field: 'level', title: '等级', width: 80, visible: true, slots: { default: 'level' } },
  { field: 'sort_weight', title: '权重', width: 90, visible: true, slots: { default: 'sort_weight' } },
  { field: 'sales_count', title: '销量', width: 90, visible: true, slots: { default: 'sales_count' } },
  { field: 'is_recommended', title: '推荐', width: 90, visible: true, slots: { default: 'is_recommended' } },
  { field: 'status', title: '状态', width: 90, visible: true, slots: { default: 'status' } },
  { field: 'created_at', title: '创建时间', width: 160, visible: false, slots: { default: 'created_at' } },
  { field: 'actions', title: '操作', width: 180, fixed: 'right', visible: true, slots: { default: 'actions' } }
];

const packageFormRef = ref<FormInstance>();
const packageForm = reactive({
  name: '',
  price: 0,
  traffic_quota: 0,
  validity_days: 30,
  speed_limit: 0,
  device_limit: 0,
  level: 1,
  sort_weight: 0,
  is_recommended: 0,
  status: 1
});

const packageRules = {
  name: [
    { required: true, message: '请输入套餐名称', trigger: 'blur' },
    { min: 2, max: 50, message: '套餐名称长度在 2 到 50 个字符', trigger: 'blur' }
  ],
  price: [
    { required: true, message: '请输入价格', trigger: 'blur' },
    { type: 'number', min: 0.01, max: 10000, message: '价格必须在0.01-10000元之间', trigger: 'blur' }
  ],
  traffic_quota: [
    { required: true, message: '请输入流量配额', trigger: 'blur' },
    { type: 'number', min: 1, max: 10000, message: '流量配额必须在1-10000GB之间', trigger: 'blur' }
  ],
  validity_days: [
    { required: true, message: '请输入有效期', trigger: 'blur' },
    { type: 'number', min: 1, max: 3650, message: '有效期必须在1-3650天之间', trigger: 'blur' }
  ],
  level: [
    { required: true, message: '请输入用户等级', trigger: 'blur' },
    { type: 'number', min: 1, max: 999, message: '用户等级必须在1-999之间', trigger: 'blur' }
  ],
  sort_weight: [
    { type: 'number', min: 0, max: 9999, message: '权重必须在0-9999之间', trigger: 'blur' }
  ]
};

const getLevelType = (level: number) => {
  const types = ['', 'success', 'primary', 'warning', 'danger', 'info'];
  return types[level] || '';
};

const loadPackageStats = async () => {
  statsLoading.value = true;
  try {
    const response = await http.get('/admin/package-stats');
    if (response.code === 0) {
      packageStats.value = response.data;
    }
  } catch (error) {
    console.error('加载套餐统计失败:', error);
  } finally {
    statsLoading.value = false;
  }
};

const loadPackages = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    if (filterStatus.value !== '') {
      params.status = filterStatus.value;
    }

    if (filterLevel.value !== '') {
      params.level = filterLevel.value;
    }

    const response = await http.get('/admin/packages', { params });

    if (response.code === 0) {
      packages.value = response.data.packages;
      pagerConfig.total = response.data.pagination.total || 0;
    }
  } catch (error) {
    console.error('加载套餐列表失败:', error);
    ElMessage.error('加载套餐列表失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadPackages();
};

const togglePackageStatus = async (pkg: any) => {
  try {
    const response = await http.put(`/admin/packages/${pkg.id}`, { status: pkg.status });

    if (response.code === 0) {
      ElMessage.success('状态更新成功');
      loadPackageStats();
    } else {
      pkg.status = pkg.status === 1 ? 0 : 1;
      ElMessage.error(response.data?.message || '状态更新失败');
    }
  } catch (error: any) {
    pkg.status = pkg.status === 1 ? 0 : 1;
    console.error('更新套餐状态失败:', error);
    ElMessage.error(error.response?.data?.message || '状态更新失败');
  }
};

const editPackage = (pkg: any) => {
  editingPackage.value = pkg;
  Object.assign(packageForm, {
    name: pkg.name,
    price: pkg.price,
    traffic_quota: pkg.traffic_quota,
    validity_days: pkg.validity_days,
    speed_limit: pkg.speed_limit,
    device_limit: pkg.device_limit,
    level: pkg.level,
    sort_weight: pkg.sort_weight || 0,
    is_recommended: pkg.is_recommended ? 1 : 0,
    status: pkg.status
  });
  showCreateDialog.value = true;
};

const deletePackage = async (pkg: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除套餐 "${pkg.name}" 吗？此操作不可撤销。`, '删除确认', { type: 'warning' });

    const response = await http.delete(`/admin/packages/${pkg.id}`);

    if (response.code === 0) {
      ElMessage.success('套餐删除成功');
      loadPackages();
      loadPackageStats();
    } else {
      ElMessage.error(response.data?.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除套餐失败:', error);
      ElMessage.error(error.response?.data?.message || '删除失败');
    }
  }
};

const savePackage = async () => {
  if (!packageFormRef.value) return;

  try {
    await packageFormRef.value.validate();
    saving.value = true;

    let response;
    if (editingPackage.value) {
      response = await http.put(`/admin/packages/${editingPackage.value.id}`, packageForm);
    } else {
      response = await http.post('/admin/packages', packageForm);
    }

    if (response.code === 0) {
      ElMessage.success(editingPackage.value ? '套餐更新成功' : '套餐创建成功');
      showCreateDialog.value = false;
      loadPackages();
      loadPackageStats();
      resetForm();
    } else {
      ElMessage.error(response.data?.message || '操作失败');
    }
  } catch (error: any) {
    console.error('保存套餐失败:', error);
    ElMessage.error(error.response?.data?.message || '操作失败');
  } finally {
    saving.value = false;
  }
};

const cancelEdit = () => {
  showCreateDialog.value = false;
  resetForm();
};

const resetForm = () => {
  editingPackage.value = null;
  Object.assign(packageForm, {
    name: '',
    price: 0,
    traffic_quota: 0,
    validity_days: 30,
    speed_limit: 0,
    device_limit: 0,
    level: 1,
    sort_weight: 0,
    is_recommended: 0,
    status: 1
  });
  packageFormRef.value?.clearValidate();
};

onMounted(() => {
  loadPackages();
  loadPackageStats();
});
</script>

<style scoped lang="scss">
.admin-packages {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }

  .stats-overview {
    margin-bottom: 24px;
    .stat-card {
      transition: transform 0.2s;
      height: 100%;
      &:hover { transform: translateY(-2px); }
      :deep(.el-card__body) {
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    }
    .stat-content {
      flex: 1;
      .stat-number { font-size: 28px; font-weight: 700; color: #303133; line-height: 1; margin-bottom: 8px; }
      .stat-label { font-size: 14px; color: #909399; }
    }
    .stat-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      &.total { background: #e6f7ff; color: #1890ff; }
      &.active { background: #f6ffed; color: #52c41a; }
      &.sales { background: #fff7e6; color: #fa8c16; }
      &.revenue { background: #f9f0ff; color: #722ed1; }
    }
  }

  .table-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .price-text { font-weight: 600; color: #f56c6c; }
}
</style>
