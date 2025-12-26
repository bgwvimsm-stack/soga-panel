<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';

const vxeTableRef = ref();
const loading = ref(false);
const rechargeRecords = ref([]);

// 筛选条件
const filterStatus = ref('');
const filterUserId = ref('');

// 分页配置
const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

// 表格高度计算
const getTableHeight = computed(() => {
  return (size: string) => {
    switch (size) {
      case 'medium':
        return 600;
      case 'small':
        return 550;
      case 'mini':
        return 500;
      default:
        return 600;
    }
  };
});

// 列配置
const columns = [
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'user_id', title: '用户ID', width: 100, visible: true },
  { field: 'email', title: '用户邮箱', minWidth: 180, visible: true },
  {
    field: 'amount',
    title: '充值金额',
    width: 120,
    visible: true,
    slots: { default: 'amount' }
  },
  {
    field: 'payment_method',
    title: '支付方式',
    width: 100,
    visible: true,
    slots: { default: 'payment_method' }
  },
  { field: 'trade_no', title: '交易号', width: 200, visible: true },
  {
    field: 'status',
    title: '状态',
    width: 100,
    visible: true,
    slots: { default: 'status' }
  },
  { field: 'created_at', title: '创建时间', width: 160, visible: true },
  {
    field: 'paid_at',
    title: '支付时间',
    width: 160,
    visible: true,
    slots: { default: 'paid_at' }
  }
];

// 获取状态类型
const getStatusType = (status: number) => {
  switch (status) {
    case 0: return 'warning';  // 待支付
    case 1: return 'success';  // 已支付
    case 2: return 'info';     // 已取消
    case 3: return 'danger';   // 支付失败
    default: return '';
  }
};

// 加载充值记录
const loadRechargeRecords = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    if (filterStatus.value !== '') {
      params.status = filterStatus.value;
    }

    if (filterUserId.value) {
      params.user_id = filterUserId.value;
    }

    const response: any = await http.get('/admin/recharge-records', { params });

    rechargeRecords.value = response.data.records;
    pagerConfig.total = response.data.pagination.total;
  } catch (error) {
    console.error('加载充值记录失败:', error);
    ElMessage.error('加载充值记录失败');
  } finally {
    loading.value = false;
  }
};

// 分页变化处理
const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadRechargeRecords();
};

// 初始化加载
loadRechargeRecords();
</script>

<template>
  <VxeTableBar
    :vxeTableRef="vxeTableRef"
    :columns="columns"
    title="充值记录"
    @refresh="loadRechargeRecords"
  >
    <template #buttons>
      <el-select
        v-model="filterStatus"
        placeholder="筛选状态"
        clearable
        @change="loadRechargeRecords"
        style="width: 120px; margin-right: 12px;"
      >
        <el-option label="待支付" :value="0" />
        <el-option label="已支付" :value="1" />
        <el-option label="已取消" :value="2" />
        <el-option label="支付失败" :value="3" />
      </el-select>
      <el-input
        v-model="filterUserId"
        placeholder="用户ID"
        clearable
        @change="loadRechargeRecords"
        style="width: 120px;"
      />
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
        :data="rechargeRecords"
        :pager-config="pagerConfig"
        @page-change="handlePageChange"
      >
        <template #amount="{ row }">
          <span class="amount-text">¥{{ row.amount.toFixed(2) }}</span>
        </template>

        <template #payment_method="{ row }">
          <el-tag v-if="row.payment_method === 'alipay'" type="primary">支付宝</el-tag>
          <el-tag v-else-if="row.payment_method === 'wxpay'" type="success">微信</el-tag>
          <el-tag v-else-if="row.payment_method === 'crypto'" type="success">数字货币</el-tag>
          <el-tag v-else-if="row.payment_method === 'gift_card'" type="success">礼品卡</el-tag>
          <el-tag v-else>{{ row.payment_method }}</el-tag>
        </template>

        <template #status="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ row.status_text }}
          </el-tag>
        </template>

        <template #paid_at="{ row }">
          <span>{{ row.paid_at || '-' }}</span>
        </template>
      </vxe-grid>
    </template>
  </VxeTableBar>
</template>

<style scoped lang="scss">
.amount-text {
  font-weight: 600;
  color: #f56c6c;
}
</style>
