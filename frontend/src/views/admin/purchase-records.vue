<template>
  <div class="admin-page admin-purchase-records">
    <div class="page-header">
      <h2>购买记录</h2>
      <p>查看和管理所有用户的套餐购买记录</p>
    </div>

    <!-- VxeTable 表格 -->
    <VxeTableBar
      :vxeTableRef="vxeTableRef"
      :columns="columns"
      title="购买记录"
      @refresh="loadPurchaseRecords"
    >
      <template #buttons>
        <el-select
          v-model="filterStatus"
          placeholder="筛选状态"
          clearable
          @change="loadPurchaseRecords"
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
          @change="loadPurchaseRecords"
          style="width: 120px; margin-right: 12px;"
        />
        <el-input
          v-model="filterPackageId"
          placeholder="套餐ID"
          clearable
          @change="loadPurchaseRecords"
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
          :data="purchaseRecords"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <!-- 购买金额 -->
          <template #price="{ row }">
            <span
              class="amount-chip"
              :class="{ mixed: isMixedPaymentRow(row) }"
            >
              <span v-if="isMixedPaymentRow(row)">
                {{ getMixedPaymentDisplay(row) }}
              </span>
              <span v-else>
                ¥{{ formatAmountValue(getFinalPriceValue(row)) }}
              </span>
            </span>
          </template>

          <template #discount_amount="{ row }">
            <span v-if="getDiscountAmountValue(row) > 0" class="discount-text">
              ¥{{ formatAmountValue(getDiscountAmountValue(row)) }}
            </span>
            <span v-else>-</span>
          </template>

          <template #coupon_code="{ row }">
            <span v-if="row.coupon_code" class="coupon-tag">{{ row.coupon_code }}</span>
            <span v-else>-</span>
          </template>

          <!-- 流量配额 -->
          <template #traffic_quota="{ row }">
            <span>{{ row.traffic_quota }} GB</span>
          </template>

          <!-- 有效期 -->
          <template #validity_days="{ row }">
            <span>{{ row.validity_days }} 天</span>
          </template>

          <!-- 支付方式 -->
          <template #purchase_type="{ row }">
            <span class="payment-chip" :class="getPaymentChipClass(row.purchase_type)">
              {{ getPurchaseTypeText(row) }}
            </span>
          </template>

          <!-- 状态 -->
          <template #status_text="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ row.status_text }}
            </el-tag>
          </template>

          <!-- 创建时间 -->
          <template #created_at="{ row }">
            <span>{{ formatDateTime(row.created_at) }}</span>
          </template>

          <!-- 支付时间 -->
          <template #paid_at="{ row }">
            <span>{{ formatDateTime(row.paid_at) }}</span>
          </template>

          <!-- 到期时间 -->
          <template #expires_at="{ row }">
            <span>{{ row.expires_at || '-' }}</span>
          </template>

          <template #actions="{ row }">
            <el-button
              v-if="row.status === 0"
              size="small"
              type="success"
              :loading="markingTradeNo === row.trade_no"
              @click="markPurchasePaid(row)"
            >
              标记已支付
            </el-button>
            <span v-else>-</span>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';

const vxeTableRef = ref();
const loading = ref(false);
const purchaseRecords = ref([]);
const markingTradeNo = ref('');

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
const filterUserId = ref('');
const filterPackageId = ref('');

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
  { field: 'user_id', title: '用户ID', width: 100, visible: true },
  { field: 'email', title: '用户邮箱', minWidth: 180, visible: false },
  { field: 'package_id', title: '套餐ID', width: 100, visible: true },
  { field: 'package_name', title: '套餐名称', minWidth: 150, visible: true },
  { field: 'price', title: '购买金额', width: 180, visible: true, slots: { default: 'price' } },
  { field: 'discount_amount', title: '优惠金额', width: 120, visible: true, slots: { default: 'discount_amount' } },
  { field: 'coupon_code', title: '优惠码', width: 160, visible: true, slots: { default: 'coupon_code' } },
  { field: 'traffic_quota', title: '流量配额', width: 100, visible: true, slots: { default: 'traffic_quota' } },
  { field: 'validity_days', title: '有效期', width: 100, visible: true, slots: { default: 'validity_days' } },
  { field: 'purchase_type', title: '支付方式', width: 120, visible: true, slots: { default: 'purchase_type' } },
  { field: 'trade_no', title: '交易号', width: 200, visible: true },
  { field: 'status_text', title: '状态', width: 100, visible: true, slots: { default: 'status_text' } },
  { field: 'created_at', title: '创建时间', width: 170, visible: true, slots: { default: 'created_at' } },
  { field: 'paid_at', title: '支付时间', width: 170, visible: true, slots: { default: 'paid_at' } },
  { field: 'expires_at', title: '到期时间', width: 160, visible: true, slots: { default: 'expires_at' } },
  { field: 'actions', title: '操作', width: 140, visible: true, slots: { default: 'actions' } }
];

// 获取状态类型
const getStatusType = (status: number) => {
  switch (status) {
    case 0: return 'warning'; // 待支付
    case 1: return 'success'; // 已支付
    case 2: return 'info';    // 已取消
    case 3: return 'danger';  // 支付失败
    default: return '';
  }
};

const getPurchaseTypeText = (row: any) => {
  const type = String(row?.purchase_type || '');
  if (isMixedPaymentRow(row)) {
    return '混合支付';
  }
  if (!type) return '-';
  if (type === 'balance') return '余额支付';
  if (type === 'direct') return '在线支付';
  if (type === 'alipay') return '支付宝';
  if (type === 'wechat' || type === 'wxpay') return '微信';
  if (type === 'qqpay') return 'QQ支付';
  return getMixedPaymentMethodLabel(type) || type;
};

const getDiscountAmountValue = (row: any) => {
  const raw = Number(row?.discount_amount ?? 0);
  return Number.isFinite(raw) ? raw : 0;
};

const getOriginalPriceValue = (row: any) => {
  if (row?.package_price != null && Number.isFinite(Number(row.package_price))) {
    return Number(row.package_price);
  }
  if (row?.final_price != null && Number.isFinite(Number(row.final_price))) {
    const discount = getDiscountAmountValue(row);
    return Number(row.final_price) + discount;
  }
  const base = Number(row?.price || 0);
  const discount = getDiscountAmountValue(row);
  return discount > 0 ? base + discount : base;
};

const getFinalPriceValue = (row: any) => {
  if (row?.final_price != null && Number.isFinite(Number(row.final_price))) {
    return Number(row.final_price);
  }
  const original = getOriginalPriceValue(row);
  const discount = getDiscountAmountValue(row);
  if (discount > 0) {
    return Math.max(original - discount, 0);
  }
  if (row?.price != null && Number.isFinite(Number(row.price))) {
    return Number(row.price);
  }
  return original;
};

const isMixedPaymentRow = (row: any) => {
  if (!row) return false;
  const type = String(row.purchase_type || '').toLowerCase();
  const totalPrice = getFinalPriceValue(row);
  const paidOnline = Number(row.price || 0);
  const diff = Number((totalPrice - paidOnline).toFixed(2));
  return type === 'smart_topup' || type.startsWith('balance_') || diff > 0;
};

const formatAmountValue = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

const getMixedPaymentMethodLabel = (type: string) => {
  const normalized = String(type || '').toLowerCase();
  if (normalized.endsWith('alipay')) return '支付宝';
  if (normalized.endsWith('wxpay') || normalized.endsWith('wechat')) return '微信';
  if (normalized.endsWith('qqpay')) return 'QQ支付';
  return '在线支付';
};

const getMixedPaymentDisplay = (row: any) => {
  if (!row) return '';
  const paymentType = row?.purchase_type ? String(row.purchase_type) : '';
  const totalPrice = getFinalPriceValue(row);
  const paidOnline = Number(row?.price || 0);
  const balancePart = Math.max(Number((totalPrice - paidOnline).toFixed(2)), 0);
  const methodLabel = getMixedPaymentMethodLabel(paymentType);
  return `余额 ${formatAmountValue(balancePart)} + ${methodLabel} ${formatAmountValue(paidOnline)}`;
};

const getPaymentChipClass = (type: string) => {
  const normalized = String(type || '').toLowerCase();
  if (!normalized || normalized === 'balance') return 'chip-balance';
  if (normalized === 'alipay' || normalized.endsWith('alipay')) return 'chip-alipay';
  if (normalized === 'wechat' || normalized === 'wxpay' || normalized.endsWith('wxpay')) return 'chip-wechat';
  if (normalized === 'qqpay' || normalized.endsWith('qqpay')) return 'chip-qq';
  if (normalized === 'smart_topup' || normalized.startsWith('balance_')) return 'chip-mixed';
  if (normalized === 'direct') return 'chip-online';
  return 'chip-default';
};

const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString('zh-CN');
  } catch (error) {
    return dateStr;
  }
};

// 加载购买记录
const loadPurchaseRecords = async () => {
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
    if (filterPackageId.value) {
      params.package_id = filterPackageId.value;
    }

    const response: any = await http.get('/admin/purchase-records', { params });
    purchaseRecords.value = response.data.records || [];
    pagerConfig.total = response.data.pagination?.total || 0;
  } catch (error) {
    console.error('加载购买记录失败:', error);
    ElMessage.error('加载购买记录失败');
  } finally {
    loading.value = false;
  }
};

// 分页变化处理
const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadPurchaseRecords();
};

const markPurchasePaid = async (row: any) => {
  if (!row?.trade_no || row.status !== 0) return;
  try {
    await ElMessageBox.confirm(
      `确认将交易号 ${row.trade_no} 标记为已支付并激活套餐吗？`,
      '确认操作',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    );
  } catch (error) {
    return;
  }

  markingTradeNo.value = row.trade_no;
  try {
    const response: any = await http.post(`/admin/purchase-records/${encodeURIComponent(row.trade_no)}/mark-paid`);
    ElMessage.success(response.message || '已标记为已支付');
    loadPurchaseRecords();
  } catch (error) {
    console.error('标记购买记录失败:', error);
    ElMessage.error('标记购买记录失败');
  } finally {
    markingTradeNo.value = '';
  }
};

// 初始化
onMounted(() => {
  loadPurchaseRecords();
});
</script>

<style scoped lang="scss">
.admin-purchase-records {
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

.amount-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-weight: 600;
    font-size: 14px;
    color: #303133;
    white-space: nowrap;
  }

  .discount-text {
    color: #67c23a;
    font-weight: 600;
  }

  .coupon-tag {
    display: inline-flex;
    padding: 2px 10px;
    border-radius: 12px;
    background: rgba(103, 194, 58, 0.1);
    color: #67c23a;
    border: 1px solid rgba(103, 194, 58, 0.4);
    font-size: 12px;
    font-family: 'Monaco', 'Menlo', monospace;
  }

  .payment-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    border: 1px solid transparent;
  }

  .payment-chip.chip-balance {
    color: #67c23a;
    border-color: rgba(103, 194, 58, 0.4);
    background: rgba(103, 194, 58, 0.08);
  }

  .payment-chip.chip-alipay {
    color: #409eff;
    border-color: rgba(64, 158, 255, 0.45);
    background: rgba(64, 158, 255, 0.08);
  }

  .payment-chip.chip-wechat {
    color: #11c26d;
    border-color: rgba(17, 194, 109, 0.45);
    background: rgba(17, 194, 109, 0.08);
  }

  .payment-chip.chip-qq {
    color: #8a5cff;
    border-color: rgba(138, 92, 255, 0.45);
    background: rgba(138, 92, 255, 0.08);
  }

  .payment-chip.chip-mixed {
    color: #f56c6c;
    border-color: rgba(245, 108, 108, 0.45);
    background: rgba(245, 108, 108, 0.08);
  }

  .payment-chip.chip-online {
    color: #909399;
    border-color: rgba(144, 147, 153, 0.4);
    background: rgba(144, 147, 153, 0.08);
  }

  .payment-chip.chip-default {
    color: #606266;
    border-color: rgba(96, 98, 102, 0.35);
    background: rgba(96, 98, 102, 0.08);
  }
}
</style>
