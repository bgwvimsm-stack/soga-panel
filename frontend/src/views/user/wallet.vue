<template>
  <div class="user-page user-wallet">
    <div class="page-header">
      <h2>我的钱包</h2>
      <p>管理您的账户余额、充值记录和消费明细</p>
    </div>

    <!-- 钱包概览卡片 -->
    <div class="wallet-overview">
      <el-row :gutter="16">
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="balance-card stat-card-main">
            <div class="stat-item">
              <div class="stat-icon balance">
                <el-icon><Wallet /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-label">当前余额</div>
                <div class="stat-value balance-value">¥{{ balanceInfo.current_balance?.toFixed(2) || '0.00' }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card stat-card-main">
            <div class="stat-item">
              <div class="stat-icon recharged">
                <el-icon><CreditCard /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-label">累计充值</div>
                <div class="stat-value">¥{{ balanceInfo.total_recharged?.toFixed(2) || '0.00' }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card stat-card-main">
            <div class="stat-item">
              <div class="stat-icon spent">
                <el-icon><ShoppingCart /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-label">累计消费</div>
                <div class="stat-value">¥{{ balanceInfo.total_spent?.toFixed(2) || '0.00' }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card stat-card-main">
            <div class="stat-item">
              <div class="stat-icon pending">
                <el-icon><Clock /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-label">待到账</div>
                <div class="stat-value">¥{{ balanceInfo.pending_recharge?.toFixed(2) || '0.00' }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 快速操作 -->
    <el-card class="quick-actions">
      <template #header>
        <div class="card-header">
          <span>快速操作</span>
        </div>
      </template>
      <div class="action-buttons">
        <el-button type="primary" size="large" @click="showRechargeDialog = true">
          <el-icon><Plus /></el-icon>
          余额充值
        </el-button>
        <el-button size="large" @click="$router.push('/user/store')">
          <el-icon><Shop /></el-icon>
          购买套餐
        </el-button>
      </div>
    </el-card>

    <!-- 交易记录 - 使用标签页切换 -->
    <el-card class="transaction-records">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="充值记录" name="recharge">
          <vxe-grid
            ref="rechargeTableRef"
            v-loading="rechargeLoading"
            show-overflow
            :height="500"
            size="small"
            :column-config="{ resizable: true }"
            :row-config="{ isHover: true, keyField: 'id' }"
            :columns="rechargeColumns"
            :data="rechargeRecords"
            :pager-config="rechargePagerConfig"
            @page-change="handleRechargePageChange"
          >
            <template #trade_no="{ row }"><span class="trade-no">{{ row.trade_no }}</span></template>
            <template #amount="{ row }">
              <span class="amount-text">¥{{ (row.amount || 0).toFixed(2) }}</span>
            </template>
            <template #payment_method="{ row }">
              <el-tag :type="row.payment_method === 'wechat' ? 'success' : 'primary'" size="small">
                {{ getPaymentMethodText(row.payment_method) }}
              </el-tag>
            </template>
            <template #status="{ row }">
              <el-tag :type="getStatusType(row.status)" size="small">{{ getStatusText(row.status) }}</el-tag>
            </template>
            <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
            <template #paid_at="{ row }"><span>{{ formatDateTime(row.paid_at) }}</span></template>
          </vxe-grid>
        </el-tab-pane>

        <el-tab-pane label="购买记录" name="purchase">
          <vxe-grid
            ref="purchaseTableRef"
            v-loading="purchaseLoading"
            show-overflow
            :height="500"
            size="small"
            :column-config="{ resizable: true }"
            :row-config="{ isHover: true, keyField: 'id' }"
            :columns="purchaseColumns"
            :data="purchaseRecords"
            :pager-config="purchasePagerConfig"
            @page-change="handlePurchasePageChange"
          >
            <template #package_name="{ row }"><span>{{ row.package_name || '-' }}</span></template>
            <template #price="{ row }">
              <div
                class="amount-chip"
                :class="{ mixed: isMixedPayment(row.purchase_type) }"
              >
                <span v-if="isMixedPayment(row.purchase_type)">
                  {{ getMixedPaymentDisplay(row) }}
                </span>
                <span v-else>
                  ¥{{ formatAmountValue(getFinalPriceValue(row)) }}
                </span>
              </div>
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
            <template #traffic_quota_gb="{ row }">
              <span>{{ row.traffic_quota_gb || 0 }} GB</span>
            </template>
            <template #purchase_type="{ row }">
              <span class="payment-chip" :class="getPaymentChipClass(row.purchase_type)">
                {{ getPurchaseTypeText(row.purchase_type) }}
              </span>
            </template>
            <template #status="{ row }">
              <el-tag :type="getPurchaseStatusType(row.status)" size="small">{{ getPurchaseStatusText(row.status) }}</el-tag>
            </template>
            <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
            <template #paid_at="{ row }"><span>{{ formatDateTime(row.paid_at) }}</span></template>
          </vxe-grid>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 余额充值对话框 -->
    <el-dialog v-model="showRechargeDialog" title="余额充值" width="500px">
      <el-form :model="rechargeForm" label-width="100px">
        <el-form-item label="充值金额" required>
          <el-input v-model="rechargeForm.amount" placeholder="请输入充值金额">
            <template #suffix>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="支付方式" required>
          <el-radio-group v-model="rechargeForm.payment_method">
            <el-radio value="alipay">
              <Alipay class="payment-icon" />
              支付宝
            </el-radio>
            <el-radio value="wechat">
              <Wechat class="payment-icon" />
              微信支付
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showRechargeDialog = false">取消</el-button>
          <el-button type="primary" @click="submitRecharge" :loading="submitting">确认充值</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Wallet, CreditCard, ShoppingCart, Clock, Plus, Shop, ChatDotRound } from '@element-plus/icons-vue';
import Alipay from '@/components/PaymentIcons/Alipay.vue';
import Wechat from '@/components/PaymentIcons/Wechat.vue';
import http from '@/api/http';

const rechargeTableRef = ref();
const purchaseTableRef = ref();
const rechargeLoading = ref(false);
const purchaseLoading = ref(false);
const submitting = ref(false);
const showRechargeDialog = ref(false);
const activeTab = ref('recharge');
const rechargeRecords = ref([]);
const purchaseRecords = ref([]);

const balanceInfo = reactive({
  current_balance: 0,
  total_recharged: 0,
  total_spent: 0,
  pending_recharge: 0
});

const rechargeForm = reactive({
  amount: '',
  payment_method: 'alipay'
});

const rechargePagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const purchasePagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const rechargeColumns = [
  { field: 'trade_no', title: '交易号', width: 200, visible: true, slots: { default: 'trade_no' }, align: 'center' },
  { field: 'amount', title: '充值金额', width: 120, visible: true, slots: { default: 'amount' }, align: 'center' },
  { field: 'payment_method', title: '支付方式', width: 120, visible: true, slots: { default: 'payment_method' }, align: 'center' },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' }, align: 'center' },
  { field: 'created_at', title: '创建时间', width: 180, visible: true, slots: { default: 'created_at' }, align: 'center' },
  { field: 'paid_at', title: '支付时间', width: 180, visible: true, slots: { default: 'paid_at' }, align: 'center' }
];

const purchaseColumns = [
  { field: 'package_name', title: '套餐名称', width: 180, visible: true, slots: { default: 'package_name' }, align: 'center' },
  { field: 'price', title: '购买金额', width: 180, visible: true, slots: { default: 'price' }, align: 'center' },
  { field: 'discount_amount', title: '优惠金额', width: 140, visible: true, slots: { default: 'discount_amount' }, align: 'center' },
  { field: 'coupon_code', title: '优惠码', width: 160, visible: true, slots: { default: 'coupon_code' }, align: 'center' },
  { field: 'traffic_quota_gb', title: '流量配额', width: 120, visible: true, slots: { default: 'traffic_quota_gb' }, align: 'center' },
  { field: 'purchase_type', title: '支付方式', width: 120, visible: true, slots: { default: 'purchase_type' }, align: 'center' },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' }, align: 'center' },
  { field: 'created_at', title: '创建时间', width: 180, visible: true, slots: { default: 'created_at' }, align: 'center' },
  { field: 'paid_at', title: '购买时间', width: 180, visible: true, slots: { default: 'paid_at' }, align: 'center' }
];

const getPaymentMethodText = (method: string) => {
  const methodMap: Record<string, string> = {
    'alipay': '支付宝',
    'wechat': '微信',
    'wxpay': '微信',
    'balance': '余额支付'
  };
  return methodMap[method] || method || '-';
};

const getStatusType = (status: number) => {
  const typeMap: Record<number, string> = { 0: 'warning', 1: 'success', 2: 'info' };
  return typeMap[status] || 'info';
};

const getStatusText = (status: number) => {
  const textMap: Record<number, string> = { 0: '待支付', 1: '已支付', 2: '已取消' };
  return textMap[status] || '未知';
};

const getPurchaseStatusType = (status: number) => {
  const typeMap: Record<number, string> = { 0: 'warning', 1: 'success', 2: 'info' };
  return typeMap[status] || 'info';
};

const getPurchaseStatusText = (status: number) => {
  const textMap: Record<number, string> = { 0: '待支付', 1: '已支付', 2: '已取消' };
  return textMap[status] || '未知';
};

const getPurchaseTypeText = (type: string) => {
  if (!type) return '-';
  const normalized = String(type);
  if (normalized === 'balance') return '余额支付';
  if (normalized === 'smart_topup') return '混合支付';
  if (normalized === 'direct') return '在线支付';
  if (normalized === 'alipay') return '支付宝';
  if (normalized === 'wechat' || normalized === 'wxpay') return '微信';
  if (normalized === 'qqpay') return 'QQ支付';
  if (normalized.startsWith('balance_')) return '混合支付';
  return normalized;
};

const isMixedPayment = (type: string) => {
  if (!type) return false;
  const normalized = String(type);
  return normalized === 'smart_topup' || normalized.startsWith('balance_');
};

const formatAmountValue = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
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
  const priceValue = Number(row?.price || 0);
  const discount = getDiscountAmountValue(row);
  return discount > 0 ? priceValue + discount : priceValue;
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

const getMixedPaymentMethodLabel = (type: string) => {
  if (!type) return '在线支付';
  const normalized = String(type);
  if (normalized.endsWith('alipay')) return '支付宝';
  if (normalized.endsWith('wxpay') || normalized.endsWith('wechat')) return '微信';
  if (normalized.endsWith('qqpay')) return 'QQ支付';
  return '在线支付';
};

const getMixedPaymentDisplay = (row: any) => {
  const paymentType = row?.purchase_type ? String(row.purchase_type) : '';
  const finalPrice = getFinalPriceValue(row);
  const paidOnline = Number(row?.price || 0);
  const balancePart = Math.max(finalPrice - paidOnline, 0);
  const methodLabel = getMixedPaymentMethodLabel(paymentType);
  const parts: string[] = [];
  if (balancePart > 0.001) {
    parts.push(`余额 ${formatAmountValue(balancePart)}`);
  }
  parts.push(`${methodLabel} ${formatAmountValue(paidOnline)}`);
  return parts.join(' + ');
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
  return new Date(dateStr).toLocaleString('zh-CN');
};

const handleTabChange = (tabName: string) => {
  if (tabName === 'purchase' && purchaseRecords.value.length === 0) {
    loadPurchaseRecords();
  }
};

const loadBalanceInfo = async () => {
  try {
    const response = await http.get('/wallet/stats');
    if (response.code === 0) {
      Object.assign(balanceInfo, response.data);
    }
  } catch (error) {
    console.error('加载钱包信息失败:', error);
  }
};

const loadRechargeRecords = async () => {
  rechargeLoading.value = true;
  try {
    const params: any = {
      page: rechargePagerConfig.currentPage,
      limit: rechargePagerConfig.pageSize
    };

    const response = await http.get('/wallet/recharge-records', { params });
    if (response.code === 0) {
      rechargeRecords.value = response.data.records || [];
      rechargePagerConfig.total = response.data.pagination?.total || 0;
    }
  } catch (error) {
    console.error('加载充值记录失败:', error);
    ElMessage.error('加载充值记录失败');
  } finally {
    rechargeLoading.value = false;
  }
};

const loadPurchaseRecords = async () => {
  purchaseLoading.value = true;
  try {
    const params: any = {
      page: purchasePagerConfig.currentPage,
      limit: purchasePagerConfig.pageSize
    };

    const response = await http.get('/packages/purchase-records', { params });
    if (response.code === 0) {
      purchaseRecords.value = response.data.records || [];
      purchasePagerConfig.total = response.data.pagination?.total || 0;
    }
  } catch (error) {
    console.error('加载购买记录失败:', error);
    ElMessage.error('加载购买记录失败');
  } finally {
    purchaseLoading.value = false;
  }
};

const handleRechargePageChange = ({ currentPage, pageSize }) => {
  rechargePagerConfig.currentPage = currentPage;
  rechargePagerConfig.pageSize = pageSize;
  loadRechargeRecords();
};

const handlePurchasePageChange = ({ currentPage, pageSize }) => {
  purchasePagerConfig.currentPage = currentPage;
  purchasePagerConfig.pageSize = pageSize;
  loadPurchaseRecords();
};

const submitRecharge = async () => {
  if (!rechargeForm.amount || parseFloat(rechargeForm.amount) <= 0) {
    ElMessage.warning('请输入有效的充值金额');
    return;
  }

  submitting.value = true;
  try {
    const response = await http.post('/wallet/recharge', {
      amount: parseFloat(rechargeForm.amount),
      payment_method: rechargeForm.payment_method
    });

    if (response.code === 0 && response.data) {
      ElMessage.success('充值订单创建成功，正在跳转到支付页面...');
      showRechargeDialog.value = false;
      rechargeForm.amount = '';

      // 处理支付表单（优先使用payment_form）
      if (response.data.payment_form) {
        // 创建新窗口并写入HTML表单
        const paymentWindow = window.open('', '_blank');
        if (paymentWindow) {
          paymentWindow.document.write(response.data.payment_form);
          paymentWindow.document.close();
        } else {
          ElMessage.error('请允许弹出窗口以完成支付');
        }
      } else if (response.data.payment_url || response.data.pay_url) {
        // 备用方案：直接跳转URL
        const payUrl = response.data.payment_url || response.data.pay_url;
        window.open(payUrl, '_blank');
      } else {
        ElMessage.error('支付链接获取失败');
      }

      // 刷新充值记录和余额信息
      await Promise.all([loadRechargeRecords(), loadBalanceInfo()]);
    } else {
      ElMessage.error(response.message || '创建充值订单失败');
    }
  } catch (error: any) {
    console.error('创建充值订单失败:', error);
    ElMessage.error(error.message || '创建充值订单失败');
  } finally {
    submitting.value = false;
  }
};

onMounted(() => {
  loadBalanceInfo();
  loadRechargeRecords();
});
</script>

<style scoped lang="scss">
.user-wallet {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; font-weight: 600; }
    p { margin: 0; color: #909399; font-size: 14px; }
  }

  .wallet-overview {
    margin-bottom: 24px;
    .stat-card-main {
      transition: transform 0.2s, box-shadow 0.2s;
      &:hover {
        transform: translateY(-4px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      :deep(.el-card__body) {
        padding: 20px;
      }
    }
    .stat-item {
      display: flex;
      align-items: center;
      .stat-icon {
        width: 56px;
        height: 56px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        margin-right: 16px;
        &.balance { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
        &.recharged { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #fff; }
        &.spent { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: #fff; }
        &.pending { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: #fff; }
      }
      .stat-content {
        flex: 1;
        .stat-label {
          font-size: 14px;
          color: #909399;
          margin-bottom: 8px;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #303133;
          &.balance-value {
            font-size: 28px;
            color: #667eea;
          }
        }
      }
    }
  }

  .quick-actions {
    margin-bottom: 24px;
    .card-header {
      font-weight: 600;
      color: #303133;
    }
    .action-buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      .el-button {
        flex: 1 1 0;
        min-width: 140px;
      }
    }
  }

  .transaction-records {
    :deep(.el-tabs__header) {
      margin-bottom: 20px;
    }
    :deep(.el-tabs__item) {
      font-size: 15px;
      font-weight: 500;
    }
  }

  .trade-no {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 12px;
    color: #606266;
    background: #f5f7fa;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .amount-text {
    font-weight: 600;
    color: #f56c6c;
    font-size: 15px;
  }

  .amount-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-weight: 600;
    font-size: 14px;
    color: #303133;
    white-space: normal;
    text-align: center;
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

  .status-text {
    color: #909399;
    font-size: 13px;
  }

  :deep(.el-dialog) {
    border-radius: 12px;
    .el-dialog__header {
      padding: 20px 24px;
      border-bottom: 1px solid #f0f0f0;
    }
    .el-dialog__body {
      padding: 24px;
    }
    .el-form-item__label {
      font-weight: 500;
    }
    .el-input__suffix {
      color: #909399;
    }
    .el-radio {
      margin-right: 24px;
      .el-icon {
        margin-right: 4px;
      }
      .payment-icon {
        width: 1.2em;
        height: 1.2em;
        margin-right: 4px;
        vertical-align: middle;
      }
    }
    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
  }
}

@media (max-width: 768px) {
  .user-wallet {
    .wallet-overview {
      .el-col {
        margin-bottom: 12px;
      }
    }
    .quick-actions {
      :deep(.el-card__body) {
        padding: 20px 0;
      }
      .action-buttons {
        flex-direction: column;
        gap: 12px;
        padding: 0 20px;
        :deep(.el-button) {
          width: 100% !important;
          flex: none !important;
          display: block !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
      }
    }
  }
}
</style>
