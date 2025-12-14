<template>
    <div class="store">

      <!-- 套餐列表 -->
      <div class="packages-section" v-loading="loading">
        <div class="packages-grid">
          <div
            v-for="pkg in packages"
            :key="pkg.id"
            class="package-card"
            :class="{ 'popular': pkg.is_recommended }"
          >
            <el-card>
              <!-- 推荐标签 -->
              <div v-if="pkg.is_recommended" class="popular-badge">
                <el-icon><Star /></el-icon>
                推荐
              </div>

              <!-- 套餐头部 -->
              <div class="package-header">
                <h3 class="package-name">{{ pkg.name }}</h3>
                <div class="package-level">
                  <el-tag :type="getLevelType(pkg.level)" size="small">
                    等级 {{ pkg.level }}
                  </el-tag>
                </div>
              </div>

              <!-- 价格 -->
              <div class="package-price">
                <span class="price-symbol">¥</span>
                <span class="price-amount">{{ Math.floor(pkg.price) }}</span>
                <span class="price-decimal">.{{ ((pkg.price % 1) * 100).toFixed(0).padStart(2, '0') }}</span>
              </div>

              <!-- 套餐特性 -->
              <div class="package-features">
                <div class="feature-item">
                  <el-icon><Connection /></el-icon>
                  <span>{{ pkg.traffic_quota_gb }} GB 流量</span>
                </div>
                <div class="feature-item">
                  <el-icon><Clock /></el-icon>
                  <span>{{ pkg.validity_days }} 天有效期</span>
                </div>
                <div class="feature-item">
                  <el-icon><Lightning /></el-icon>
                  <span>{{ pkg.speed_limit_text }}</span>
                </div>
                <div class="feature-item">
                  <el-icon><Monitor /></el-icon>
                  <span>{{ pkg.device_limit_text }}</span>
                </div>
              </div>

              <!-- 购买按钮 -->
              <div class="package-actions">
                <el-button
                  type="primary"
                  size="large"
                  block
                  @click="showPurchaseDialog(pkg)"
                  :loading="purchaseLoading === pkg.id"
                >
                  立即购买
                </el-button>
              </div>
            </el-card>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && packages.length === 0" class="empty-state">
          <el-empty description="暂无可用套餐" />
        </div>

        <!-- 分页 -->
        <div v-if="pagination.total > 0" class="pagination-wrapper">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[12, 24, 48]"
            :total="pagination.total"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="loadPackages"
            @current-change="loadPackages"
          />
        </div>
      </div>

      <!-- 购买对话框 -->
      <el-dialog
        v-model="showPurchaseDialogVisible"
        title="购买套餐"
        width="500px"
        :close-on-click-modal="false"
      >
        <div v-if="selectedPackage" class="purchase-content">
          <!-- 套餐信息 -->
          <div class="purchase-package-info">
            <h3>{{ selectedPackage.name }}</h3>
            <div class="package-details">
              <div class="detail-row">
                <span>套餐价格:</span>
                <span class="price-text">¥{{ selectedPackage.price.toFixed(2) }}</span>
              </div>
              <div class="detail-row">
                <span>流量配额:</span>
                <span>{{ selectedPackage.traffic_quota_gb }} GB</span>
              </div>
              <div class="detail-row">
                <span>有效期:</span>
                <span>{{ selectedPackage.validity_days }} 天</span>
              </div>
              <div class="detail-row">
                <span>速度限制:</span>
                <span>{{ selectedPackage.speed_limit_text }}</span>
              </div>
              <div class="detail-row">
                <span>设备限制:</span>
                <span>{{ selectedPackage.device_limit_text }}</span>
              </div>
              <div class="detail-row" v-if="discountAmountDisplay > 0">
                <span>优惠金额:</span>
                <span class="price-text">-¥{{ discountAmountDisplay.toFixed(2) }}</span>
              </div>
              <div class="detail-row final-price-row">
                <span>应付金额:</span>
                <span class="price-text">¥{{ finalPriceDisplay.toFixed(2) }}</span>
              </div>
            </div>
          </div>

          <div class="coupon-section">
            <div class="coupon-input-row">
              <span class="coupon-label">优惠码</span>
              <el-input
                v-model="couponCode"
                class="coupon-input"
                placeholder="请输入优惠码"
                clearable
                @clear="clearCoupon"
              >
                <template #append>
                  <el-button :loading="couponVerifying" @click="applyCoupon">
                    {{ couponInfo ? '重新验证' : '校验' }}
                  </el-button>
                </template>
              </el-input>
              <el-button
                v-if="couponInfo"
                link
                type="primary"
                @click="clearCoupon"
              >
                移除
              </el-button>
            </div>
            <p v-if="couponError" class="coupon-error">{{ couponError }}</p>
          </div>

          <!-- 当前余额 - 仅在余额大于等于0.01时显示 -->
          <div class="balance-info" v-if="selectedPackage">
            <el-alert
              :title="`当前余额: ¥${userBalance.toFixed(2)}`"
              :type="userBalance >= finalPriceDisplay ? 'success' : 'warning'"
              :closable="false"
              show-icon
            >
              <template #default>
                <div class="balance-message">
                  <div class="balance-tip">
                    <template v-if="finalPriceDisplay <= 0">
                      优惠后无需支付，系统将直接发放套餐
                    </template>
                    <template v-else-if="userBalance >= finalPriceDisplay">
                      <span v-if="discountAmountDisplay > 0">
                        优惠 ¥{{ discountAmountDisplay.toFixed(2) }}，应付 ¥{{ finalPriceDisplay.toFixed(2) }}，余额充足，可以直接购买
                      </span>
                      <span v-else>
                        余额充足，可以直接购买
                      </span>
                    </template>
                    <template v-else>
                      <span v-if="discountAmountDisplay > 0">
                        优惠 ¥{{ discountAmountDisplay.toFixed(2) }}，应付 ¥{{ finalPriceDisplay.toFixed(2) }}，余额不足，还需支付 ¥{{ (finalPriceDisplay - userBalance).toFixed(2) }}
                      </span>
                      <span v-else>
                        余额不足，还需支付 ¥{{ (finalPriceDisplay - userBalance).toFixed(2) }}
                      </span>
                    </template>
                  </div>
                </div>
              </template>
            </el-alert>
          </div>

          <!-- 支付方式选择 -->
          <div class="payment-method">
            <h4>支付方式</h4>
            <el-radio-group v-model="purchaseForm.purchase_type">
              <!-- 当余额足够时显示余额支付 -->
              <el-radio
                v-if="finalPriceDisplay <= 0 || userBalance >= selectedPackage.price"
                value="balance"
              >
                <div class="payment-option">
                  <el-icon><Wallet /></el-icon>
                  <span>余额支付</span>
                </div>
              </el-radio>
              <el-radio
                v-for="method in paymentMethods"
                :key="method.value"
                v-if="finalPriceDisplay > 0"
                :value="method.value"
              >
                <div class="payment-option">
                  <component :is="getPaymentIcon(method.value)" class="payment-icon" v-if="getPaymentIcon(method.value)" />
                  <span>{{ method.label }}</span>
                </div>
              </el-radio>
            </el-radio-group>
          </div>
        </div>

        <template #footer>
          <div class="dialog-footer">
            <el-button @click="showPurchaseDialogVisible = false">取消</el-button>
            <el-button
              type="primary"
              @click="confirmPurchase"
              :loading="purchaseSubmitting"
            >
              确认购买
            </el-button>
          </div>
        </template>
      </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Star,
  Connection,
  Clock,
  Lightning,
  Monitor,
  Wallet,
  CreditCard
} from '@element-plus/icons-vue';
import Alipay from '@/components/PaymentIcons/Alipay.vue';
import Wechat from '@/components/PaymentIcons/Wechat.vue';
import Crypto from '@/components/PaymentIcons/Crypto.vue';
import http from '@/api/http';

// 响应式数据
const loading = ref(false);
const packages = ref([]);
const currentPage = ref(1);
const pageSize = ref(12);
const pagination = reactive({
  total: 0,
  totalPages: 0
});

// 筛选和排序
const sortBy = ref('price');
const sortOrder = ref('asc');

// 购买相关
const showPurchaseDialogVisible = ref(false);
const selectedPackage = ref(null);
const purchaseLoading = ref(0);
const purchaseSubmitting = ref(false);
const userBalance = ref(0);

const purchaseForm = reactive({
  package_id: 0,
  purchase_type: 'balance'
});
const paymentMethods = ref<{ value: string; label: string }[]>([
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信支付' }
]);

const couponCode = ref('');
const couponInfo = ref<any>(null);
const couponError = ref('');
const couponVerifying = ref(false);

const resetCouponState = () => {
  couponCode.value = '';
  couponInfo.value = null;
  couponError.value = '';
};

const finalPrice = computed(() => {
  if (!selectedPackage.value) return 0;
  if (couponInfo.value?.final_price !== undefined) {
    return Number(couponInfo.value.final_price);
  }
  return Number(selectedPackage.value.price);
});

const discountAmountValue = computed(() => {
  if (!couponInfo.value) return 0;
  return Number(couponInfo.value.discount_amount || 0);
});

const finalPriceDisplay = computed(() => Number(finalPrice.value || 0));
const discountAmountDisplay = computed(() => Number(discountAmountValue.value || 0));

// 获取等级类型
const getLevelType = (level: number) => {
  const types = ['', 'success', 'primary', 'warning', 'danger', 'info'];
  return types[level] || '';
};

const syncPurchaseType = () => {
  if (!selectedPackage.value) {
    purchaseForm.purchase_type = 'balance';
    return;
  }
  if (finalPriceDisplay.value <= 0) {
    purchaseForm.purchase_type = 'balance';
    return;
  }
  if (userBalance.value >= finalPriceDisplay.value) {
    purchaseForm.purchase_type = 'balance';
  } else if (!paymentMethods.value.find((m) => m.value === purchaseForm.purchase_type)) {
    purchaseForm.purchase_type = getPrimaryOnlineMethod();
  }
};

const getPrimaryOnlineMethod = () =>
  paymentMethods.value[0]?.value || 'alipay';

const getPaymentIcon = (method: string) => {
  const key = method.toLowerCase();
  if (key === 'alipay') return Alipay;
  if (key === 'wechat' || key === 'wxpay') return Wechat;
  if (key === 'crypto' || key === 'usdt') return Crypto;
  return null;
};

// 加载用户余额
const loadUserBalance = async () => {
  try {
    const response = await http.get('/wallet/money');
    if (response.code === 0) {
      // 确保余额是数字类型
      userBalance.value = Number(response.data.money) || 0;
      if (showPurchaseDialogVisible.value) {
        syncPurchaseType();
      }
    }
  } catch (error) {
    console.error('加载用户余额失败:', error);
  }
};

const loadPaymentMethods = async () => {
  try {
    const response = await http.get('/payment/config');
    if (response.code === 0 && Array.isArray(response.data?.payment_methods)) {
      const methods = response.data.payment_methods as Array<{ value: string; label: string }>;
      if (methods.length > 0) {
        paymentMethods.value = methods.map((item) => ({
          value: item.value,
          label: item.label || item.value
        }));
      }
    }
  } catch (error) {
    console.error('获取支付方式失败:', error);
  } finally {
    if (!paymentMethods.value.find((m) => m.value === purchaseForm.purchase_type)) {
      purchaseForm.purchase_type = getPrimaryOnlineMethod();
    }
  }
};

// 加载套餐列表
const loadPackages = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: currentPage.value,
      limit: pageSize.value,
      sort: sortBy.value,
      order: sortOrder.value
    };


    const response = await http.get('/packages', { params });

    if (response.code === 0) {
      packages.value = response.data.packages;
      Object.assign(pagination, response.data.pagination);
    }
  } catch (error) {
    console.error('加载套餐列表失败:', error);
    ElMessage.error('加载套餐列表失败');
  } finally {
    loading.value = false;
  }
};

// 显示购买对话框
const showPurchaseDialog = async (pkg: any) => {
  selectedPackage.value = pkg;
  purchaseForm.package_id = pkg.id;
  resetCouponState();

  // 先加载最新余额
  await loadUserBalance();

  // 根据最新余额设置支付方式(余额需>=0.01才认为有余额)
  purchaseForm.purchase_type = (userBalance.value >= 0.01 && userBalance.value >= pkg.price)
    ? 'balance'
    : getPrimaryOnlineMethod();
  syncPurchaseType();

  showPurchaseDialogVisible.value = true;
};

const applyCoupon = async () => {
  if (!purchaseForm.package_id) {
    couponError.value = '请先选择套餐';
    return;
  }
  if (!couponCode.value.trim()) {
    couponError.value = '请输入优惠码';
    return;
  }
  couponVerifying.value = true;
  try {
    const response = await http.post('/packages/coupon/preview', {
      package_id: purchaseForm.package_id,
      coupon_code: couponCode.value.trim()
    });
    if (response.code === 0) {
      couponInfo.value = response.data;
      couponError.value = '';
      ElMessage.success('优惠码已应用');
      syncPurchaseType();
    } else {
      couponInfo.value = null;
      couponError.value = response.message || '优惠码无效';
    }
  } catch (error: any) {
    couponInfo.value = null;
    couponError.value = error.response?.data?.message || '优惠码校验失败';
  } finally {
    couponVerifying.value = false;
  }
};

const clearCoupon = () => {
  resetCouponState();
  syncPurchaseType();
};

// 确认购买
const confirmPurchase = async () => {
  if (!selectedPackage.value) return;

  try {
    await ElMessageBox.confirm(
      `确认购买套餐 "${selectedPackage.value.name}" 吗？`,
      '购买确认',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    purchaseSubmitting.value = true;

    const requestData: any = {
      package_id: purchaseForm.package_id
    };

    if (couponCode.value.trim()) {
      requestData.coupon_code = couponCode.value.trim();
    }

    // 根据 purchase_type 判断支付类型
    if (purchaseForm.purchase_type === 'balance') {
      // 余额支付
      requestData.purchase_type = 'balance';
    } else {
      // 在线支付（alipay 或 wechat）
      requestData.purchase_type = 'direct';
      requestData.payment_method = purchaseForm.purchase_type; // alipay 或 wechat
    }

    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin.replace(/\/$/, '')
        : '';
    if (origin) {
      requestData.return_url = `${origin}/user/store`;
    }

    const response = await http.post('/packages/purchase', requestData);

    if (response.code === 0) {
      const data = response.data;

      if (data.status === 1) {
        // 余额支付，直接成功
        ElMessage.success('套餐购买成功！');
        showPurchaseDialogVisible.value = false;
        resetCouponState();

        // 刷新余额
        loadUserBalance();
      } else if (data.status === 0) {
        // 需要在线支付
        const isMixed = data.purchase_type && (
          data.purchase_type === 'smart_topup' || String(data.purchase_type).startsWith('balance_')
        );
        if (isMixed) {
          // 智能补差额支付
          ElMessage.success(`需要补差额 ¥${data.payment_amount.toFixed(2)}，正在跳转到支付页面...`);
        } else {
          // 直接支付
          ElMessage.success('订单创建成功，正在跳转到支付页面...');
        }
        showPurchaseDialogVisible.value = false;
        resetCouponState();

        // 跳转到支付页面
        window.open(data.payment_url, '_blank');
      }
    } else {
      ElMessage.error(response.data?.message || '购买失败');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('购买套餐失败:', error);
      ElMessage.error(error.response?.data?.message || '购买失败');
    }
  } finally {
    purchaseSubmitting.value = false;
  }
};

// 初始化
onMounted(() => {
  loadPackages();
  loadUserBalance();
  loadPaymentMethods();
});
</script>

<style scoped>
.store {
  padding: 24px;
}

@media (max-width: 768px) {
  .store {
    padding: 16px;
  }
}

.page-header {
  margin-bottom: 24px;
  text-align: center;
}

.page-header h1 {
  font-size: 32px;
  color: #303133;
  margin: 0 0 8px 0;
}

.page-header p {
  color: #909399;
  margin: 0;
  font-size: 16px;
}

.filter-section {
  margin-bottom: 24px;
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 24px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-weight: 500;
  color: #606266;
}

.packages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.package-card {
  position: relative;
  transition: transform 0.2s, box-shadow 0.2s;
}

.package-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.package-card.popular {
  border: 2px solid #409EFF;
}

.popular-badge {
  position: absolute;
  top: -1px;
  right: 16px;
  background: linear-gradient(135deg, #409EFF, #67C23A);
  color: white;
  padding: 6px 12px;
  border-radius: 0 0 12px 12px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 1;
}

.package-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.package-name {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.package-price {
  text-align: center;
  margin-bottom: 24px;
}

.price-symbol {
  font-size: 20px;
  color: #f56c6c;
  vertical-align: top;
}

.price-amount {
  font-size: 48px;
  font-weight: 700;
  color: #f56c6c;
  line-height: 1;
}

.price-decimal {
  font-size: 20px;
  color: #f56c6c;
  vertical-align: top;
}

.package-features {
  margin-bottom: 24px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  color: #606266;
  font-size: 14px;
}

.feature-item .el-icon {
  color: #409EFF;
  font-size: 16px;
}

.package-actions {
  margin-top: auto;
  display: flex;
  justify-content: center;
}

.empty-state {
  text-align: center;
  padding: 60px 0;
}

.pagination-wrapper {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

/* 购买对话框样式 */
.purchase-content {
  max-height: 500px;
  overflow-y: auto;
}

.purchase-package-info {
  margin-bottom: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.final-price-row .price-text {
  color: #67c23a;
}

.purchase-package-info h3 {
  margin: 0 0 12px 0;
  color: #303133;
}

.package-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: #606266;
}

.price-text {
  font-weight: 600;
  color: #f56c6c;
}

.coupon-section {
  margin-bottom: 20px;
}

.coupon-input-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.coupon-label {
  color: #606266;
  font-weight: 500;
  min-width: 56px;
}

.coupon-input {
  max-width: 220px;
}

.coupon-error {
  color: #f56c6c;
  font-size: 13px;
  margin-top: 8px;
  margin-left: 56px;
}

.balance-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.balance-text {
  font-weight: 600;
  color: #303133;
}

.balance-tip {
  color: #606266;
  font-size: 13px;
}

.balance-info {
  margin-bottom: 20px;
}

.payment-method {
  margin-bottom: 20px;
  text-align: left;
  width: 60%;
  margin-left: 20%;
  margin-right: 20%;
}
.payment-method h4 {
  margin: 0 0 12px 0;
  color: #303133;
  text-align: left;
}
.payment-method .el-radio-group {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  text-align: left;
}
.payment-method .el-radio {
  margin: 0 !important;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  text-align: left;
  width: auto;
}
.payment-method .el-radio .el-radio__input {
  margin-right: 8px;
}
.payment-method .el-radio .el-radio__label {
  padding-left: 0 !important;
  display: flex;
  align-items: center;
  text-align: left;
}

.payment-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.payment-icon {
  font-size: 20px;
  width: 20px;
  height: 20px;
}

.insufficient-text {
  color: #f56c6c;
  font-size: 12px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

:deep(.el-card__body) {
  padding: 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.el-radio-group) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

:deep(.el-radio) {
  margin-right: 0;
}

@media (max-width: 768px) {
  .packages-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .filter-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .filter-item {
    justify-content: space-between;
  }

  .package-card {
    margin: 0;
  }

  .package-card :deep(.el-card__body) {
    padding: 16px;
  }

  .package-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
  }

  .package-name {
    font-size: 18px;
  }

  .package-price {
    margin-bottom: 16px;
  }

  .price-amount {
    font-size: 36px;
  }

  .price-symbol,
  .price-decimal {
    font-size: 16px;
  }

  .package-features {
    margin-bottom: 16px;
  }

  .feature-item {
    padding: 6px 0;
    font-size: 13px;
  }

  .pagination-wrapper {
    margin-top: 16px;
  }

  :deep(.el-pagination) {
    .el-pagination__sizes {
      display: none;
    }
    .el-pagination__jump {
      display: none;
    }
  }
}

@media (max-width: 480px) {
  .store {
    padding: 12px;
  }

  .packages-grid {
    gap: 12px;
  }

  .package-card :deep(.el-card__body) {
    padding: 12px;
  }

  .package-name {
    font-size: 16px;
  }

  .price-amount {
    font-size: 32px;
  }

  .price-symbol,
  .price-decimal {
    font-size: 14px;
  }

  .feature-item {
    font-size: 12px;
  }

  .package-actions :deep(.el-button) {
    font-size: 14px;
    height: 40px;
  }

  .purchase-content {
    max-height: 400px;
  }

  .purchase-package-info {
    padding: 12px;
  }

  .payment-method {
    width: 80%;
    margin-left: 10%;
    margin-right: 10%;
  }

  :deep(.el-dialog) {
    width: 90% !important;
    margin: 5vh auto;
  }

  :deep(.el-dialog__body) {
    padding: 16px;
  }

  :deep(.el-dialog__footer) {
    padding: 12px 16px;
  }

  .dialog-footer :deep(.el-button) {
    font-size: 14px;
    height: 36px;
  }
}
</style>
