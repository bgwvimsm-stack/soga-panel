<template>
  <div class="admin-page admin-coupons">
    <div class="page-header">
      <h2>优惠券管理</h2>
      <p>统一管理优惠券、使用限制与适用套餐</p>
    </div>

    <VxeTableBar :vxeTableRef="tableRef" :columns="tableColumns" title="优惠券列表" @refresh="loadCoupons">
      <template #tools>
        <el-input
          v-model="filters.keyword"
          placeholder="搜索名称或优惠码"
          class="toolbar-search"
          clearable
        >
          <template #append>
            <el-button @click="loadCoupons" :loading="loading">查询</el-button>
          </template>
        </el-input>
        <el-select v-model="filters.status" placeholder="状态" class="toolbar-select" @change="loadCoupons">
          <el-option label="全部" :value="-1" />
          <el-option label="启用" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
      </template>

      <template #buttons>
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>
          新建优惠券
        </el-button>
      </template>

      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid
          ref="tableRef"
          v-loading="loading"
          show-overflow
          :height="getTableHeight(size)"
          :size="size"
          :column-config="{ resizable: true }"
          :row-config="{ isHover: true, keyField: 'id' }"
          :columns="dynamicColumns"
          :data="coupons"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #name="{ row }">
            <span>{{ row.name }}</span>
          </template>
          <template #code="{ row }">
            <span class="coupon-code-tag">{{ row.code }}</span>
          </template>
          <template #discount="{ row }">
            {{ getDiscountText(row) }}
          </template>
          <template #period="{ row }">
            <div>{{ formatDate(row.end_at) }}</div>
          </template>
          <template #usage="{ row }">
            <span v-if="row.max_usage">
              {{ row.total_used || 0 }}/{{ row.max_usage }}
            </span>
            <span v-else>不限</span>
          </template>
          <template #per_user_limit="{ row }">
            <span v-if="row.per_user_limit">{{ row.per_user_limit }}</span>
            <span v-else>不限</span>
          </template>
          <template #packages="{ row }">
            <span v-if="row.package_count && row.package_count > 0">
              {{ row.package_count }} 个
            </span>
            <span v-else>全部</span>
          </template>
          <template #status="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
          <template #actions="{ row }">
            <div class="table-actions">
              <el-button type="primary" size="small" @click="openEditDialog(row)">编辑</el-button>
              <el-button type="danger" size="small" @click="removeCoupon(row)">删除</el-button>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="640px"
      :close-on-click-modal="false"
    >
      <el-form
        :model="form"
        label-width="110px"
        class="coupon-form"
      >
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="请输入优惠券名称" />
        </el-form-item>
        <el-form-item label="优惠码" required>
          <el-input v-model="form.code" placeholder="留空自动生成" maxlength="32">
            <template #append>
              <el-button @click="generateCode">生成</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="优惠类型" required>
          <el-select v-model="form.discount_type">
            <el-option label="按金额优惠" value="amount" />
            <el-option label="按比例优惠" value="percentage" />
          </el-select>
        </el-form-item>
        <el-form-item label="优惠数值" required>
          <el-input-number
            v-model="form.discount_value"
            :min="0.01"
            :max="form.discount_type === 'percentage' ? 100 : 999999"
            :precision="form.discount_type === 'percentage' ? 2 : 2"
            controls-position="right"
          />
          <span class="input-addon">
            {{ form.discount_type === 'percentage' ? '%' : '元' }}
          </span>
        </el-form-item>
        <el-form-item label="有效期" required>
          <el-date-picker
            v-model="form.validRange"
            type="datetimerange"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="YYYY-MM-DD HH:mm:ss"
            range-separator="~"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            :default-time="defaultTimeRange"
          />
        </el-form-item>
        <el-form-item label="最大使用次数">
          <el-input-number
            v-model="form.max_usage"
            :min="1"
            :value-on-clear="null"
            controls-position="right"
            placeholder="为空表示不限"
          />
        </el-form-item>
        <el-form-item label="每用户次数">
          <el-input-number
            v-model="form.per_user_limit"
            :min="1"
            :value-on-clear="null"
            controls-position="right"
            placeholder="为空表示不限"
          />
        </el-form-item>
        <el-form-item label="套餐限制">
          <el-select
            v-model="form.package_ids"
            multiple
            collapse-tags
            placeholder="不选择表示全部套餐"
            @visible-change="handlePackageDropdown"
          >
            <el-option
              v-for="pkg in packageOptions"
              :key="pkg.value"
              :label="`${pkg.label} (¥${pkg.price})`"
              :value="pkg.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="form.status"
            :active-value="1"
            :inactive-value="0"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.description"
            type="textarea"
            rows="3"
            placeholder="可选，输入备注信息"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, computed } from 'vue';
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getCouponDetail,
  type Coupon,
  type CouponPayload
} from '@/api/admin';
import http from '@/api/http';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { Plus } from '@element-plus/icons-vue';

const tableRef = ref();
const loading = ref(false);
const coupons = ref<Coupon[]>([]);
const pagination = reactive({
  page: 1,
  limit: 10,
  total: 0
});
const filters = reactive({
  keyword: '',
  status: -1 as number
});

const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const dialogVisible = ref(false);
const dialogTitle = ref('新建优惠券');
const submitting = ref(false);
const packageOptions = ref<Array<{ label: string; value: number; price: number }>>([]);
const packageLoading = ref(false);

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
type DateRangeValue = [string, string] | null;
const defaultTimeRange: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 23, 59, 59)
];

const form = reactive({
  id: null as number | null,
  name: '',
  code: '',
  discount_type: 'amount',
  discount_value: 10,
  validRange: null as DateRangeValue,
  max_usage: null as number | null,
  per_user_limit: null as number | null,
  package_ids: [] as number[],
  status: 1,
  description: ''
});

const resetForm = () => {
  form.id = null;
  form.name = '';
  form.code = '';
  form.discount_type = 'amount';
  form.discount_value = 10;
  form.validRange = null;
  form.max_usage = null;
  form.per_user_limit = null;
  form.package_ids = [];
  form.status = 1;
  form.description = '';
};

const formatDate = (value: number) => {
  if (!value) return '-';
  const ts = value > 1e12 ? value : value * 1000;
  return new Date(ts).toLocaleString();
};

const getDiscountText = (coupon: Coupon) => {
  if (coupon.discount_type === 'percentage') {
    return `${coupon.discount_value}% 折扣`;
  }
  return `减 ¥${Number(coupon.discount_value).toFixed(2)}`;
};

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const tableColumns: VxeTableBarColumns = [
  { field: 'name', title: '名称', minWidth: 160, slots: { default: 'name' } },
  { field: 'coupon_code', title: '优惠码', width: 160, slots: { default: 'code' } },
  { field: 'discount_type', title: '优惠方式', width: 150, slots: { default: 'discount' } },
  { field: 'period', title: '有效期', minWidth: 160, slots: { default: 'period' } },
  { field: 'usage', title: '总次数', width: 120, slots: { default: 'usage' } },
  { field: 'per_user_limit', title: '每人次数', width: 120, slots: { default: 'per_user_limit' } },
  { field: 'packages', title: '套餐范围', width: 140, slots: { default: 'packages' } },
  { field: 'status', title: '状态', width: 100, slots: { default: 'status' } },
  { field: 'actions', title: '操作', width: 130, fixed: 'right', slots: { default: 'actions' }, columnSelectable: false }
];

const loadCoupons = async () => {
  loading.value = true;
  try {
    const params: Record<string, unknown> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };
    if (filters.status !== -1) {
      params.status = filters.status;
    }
    if (filters.keyword) {
      params.keyword = filters.keyword;
    }
    const response = await getCoupons(params);
    if (response.code === 0) {
      coupons.value = response.data.coupons ?? [];
      const total = response.data.pagination?.total ?? coupons.value.length;
      pagerConfig.total = total;
      pagination.total = total;
      pagination.limit = pagerConfig.pageSize;
      pagination.page = pagerConfig.currentPage;
    }
  } catch (error) {
    ElMessage.error('加载优惠券失败');
  } finally {
    loading.value = false;
  }
};

const handleSizeChange = (size: number) => {
  pagerConfig.pageSize = size;
  pagination.limit = size;
  loadCoupons();
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  pagination.page = currentPage;
  pagination.limit = pageSize;
  loadCoupons();
};

const openCreateDialog = () => {
  resetForm();
  dialogTitle.value = '新建优惠券';
  dialogVisible.value = true;
};

const openEditDialog = async (coupon: Coupon) => {
  try {
    const response = await getCouponDetail(coupon.id);
    if (response.code === 0) {
      const detail = response.data;
      form.id = detail.id;
      form.name = detail.name;
      form.code = detail.code;
      form.discount_type = detail.discount_type;
      form.discount_value = detail.discount_value;
      form.max_usage = detail.max_usage ?? null;
      form.per_user_limit = detail.per_user_limit ?? null;
      form.status = detail.status;
      form.description = detail.description ?? '';
      form.package_ids = detail.package_ids ?? [];
      form.validRange =
        detail.start_at && detail.end_at
          ? [
              dayjs.unix(detail.start_at).format(DATETIME_FORMAT),
              dayjs.unix(detail.end_at).format(DATETIME_FORMAT)
            ]
          : null;
      dialogTitle.value = '编辑优惠券';
      dialogVisible.value = true;
    }
  } catch (error) {
    ElMessage.error('获取优惠券详情失败');
  }
};

const normalizePayload = () => {
  if (!form.name) {
    throw new Error('请输入优惠券名称');
  }
  if (!form.validRange) {
    throw new Error('请选择优惠券有效期');
  }
  const [startRaw, endRaw] = form.validRange;
  if (!startRaw || !endRaw) {
    throw new Error('请选择优惠券有效期');
  }
  const start = dayjs(startRaw, DATETIME_FORMAT);
  const end = dayjs(endRaw, DATETIME_FORMAT);
  if (!start.isValid() || !end.isValid()) {
    throw new Error('请选择正确的开始和结束时间');
  }
  if (!end.isAfter(start)) {
    throw new Error('结束时间必须大于开始时间');
  }
  if (form.discount_value <= 0) {
    throw new Error('优惠值必须大于0');
  }
  const payload: CouponPayload = {
    name: form.name,
    code: form.code || undefined,
    discount_type: form.discount_type as "amount" | "percentage",
    discount_value: Number(form.discount_value),
    start_at: start.unix(),
    end_at: end.unix(),
    max_usage: form.max_usage ?? null,
    per_user_limit: form.per_user_limit ?? null,
    package_ids: form.package_ids.length ? [...form.package_ids] : undefined,
    status: form.status,
    description: form.description || undefined
  };
  if (payload.discount_type === 'percentage' && payload.discount_value > 100) {
    throw new Error('折扣比例不能超过100%');
  }
  return payload;
};

const submitForm = async () => {
  try {
    const payload = normalizePayload();
    submitting.value = true;
    if (form.id) {
      await updateCoupon(form.id, payload);
      ElMessage.success('优惠券更新成功');
    } else {
      await createCoupon(payload);
      ElMessage.success('优惠券创建成功');
    }
    dialogVisible.value = false;
    loadCoupons();
  } catch (error: any) {
    if (error instanceof Error) {
      ElMessage.error(error.message);
    } else {
      ElMessage.error(error?.response?.data?.message || '操作失败');
    }
  } finally {
    submitting.value = false;
  }
};

const removeCoupon = (coupon: Coupon) => {
  ElMessageBox.confirm(`确认删除优惠券「${coupon.name}」吗？`, '提示', {
    type: 'warning'
  })
    .then(async () => {
      await deleteCoupon(coupon.id);
      ElMessage.success('已删除');
      loadCoupons();
    })
    .catch(() => {});
};

const handlePackageDropdown = async (visible: boolean) => {
  if (!visible || packageOptions.value.length || packageLoading.value) {
    return;
  }
  packageLoading.value = true;
  try {
    const response = await http.get('/admin/packages', {
      params: { page: 1, limit: 200, status: 1 }
    });
    if (response.code === 0) {
      packageOptions.value =
        (response.data.packages || []).map((pkg: any) => ({
          label: pkg.name,
          value: pkg.id,
          price: pkg.price
        })) ?? [];
    }
  } catch (error) {
    ElMessage.error('加载套餐列表失败');
  } finally {
    packageLoading.value = false;
  }
};

const generateCode = () => {
  form.code = Math.random().toString(36).slice(2, 10).toUpperCase();
};

onMounted(() => {
  loadCoupons();
});
</script>

<style scoped>
.admin-coupons {
  padding: 16px;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}

.toolbar-search {
  flex: 1;
}

.toolbar-select {
  width: 160px;
}

.coupon-code-tag {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(64, 158, 255, 0.1);
  color: #409eff;
  font-family: 'Monaco', 'Menlo', monospace;
  border: 1px solid rgba(64, 158, 255, 0.4);
  font-size: 12px;
}

.coupon-form .el-form-item {
  align-items: center;
}

.input-addon {
  margin-left: 8px;
  color: #909399;
}
</style>
