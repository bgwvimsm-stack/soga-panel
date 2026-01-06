<template>
  <div class="invite-page">
    <el-alert
      v-if="showRebateBlocked"
      type="warning"
      show-icon
      class="rebate-alert"
      title="当前账号非会员或已过期，邀请好友充值/购买不会产生返利。"
    />
    <el-row :gutter="16" class="stats-row">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <div class="stats-card">
            <div class="stats-title">邀请码</div>
            <div class="invite-code">
              <span>{{ displayInviteCode }}</span>
              <el-button
                size="small"
                type="primary"
                text
                :disabled="!overview?.inviteCode"
                @click="copyInviteLink"
              >
                复制链接
              </el-button>
            </div>
            <p class="invite-link" v-if="inviteLink">
              {{ inviteLink }}
            </p>
            <p class="invite-stat">
              使用次数：{{ inviteUsageText }}
            </p>
            <p class="invite-hint">
              分享上方链接邀请好友注册。{{ inviteModeText }}
            </p>
            <p v-if="showRebateBlocked" class="invite-hint invite-warning">
              返利资格已暂停，续费后将恢复。
            </p>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <div class="balance-card">
            <div class="balance-title">可用返利 (元)</div>
            <div class="balance-value">{{ overview?.rebateAvailable?.toFixed(2) || "0.00" }}</div>
            <div class="balance-footer">
              累计返利：{{ overview?.rebateTotal?.toFixed(2) || "0.00" }} 元
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="action-row">
      <el-col :xs="24" :md="12">
        <el-card shadow="never" class="action-card">
          <template #header>返利划转到余额</template>
          <el-form label-position="top">
            <el-form-item label="划转金额（元）">
              <el-input
                v-model="transferForm.amount"
                placeholder="请输入划转金额"
                type="number"
                min="0"
              />
            </el-form-item>
            <el-button
              type="primary"
              :loading="transferLoading"
              @click="handleTransfer"
              :disabled="!transferForm.amount"
            >
              划转
            </el-button>
          </el-form>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never" class="action-card">
          <template #header>申请提现</template>
          <el-form label-position="top" class="withdraw-form">
            <el-form-item label="提现金额（元）">
              <el-input
                v-model="withdrawForm.amount"
                placeholder="请输入提现金额"
                type="number"
                min="0"
              />
            </el-form-item>
            <div class="withdraw-tip">
              最低提现金额：¥{{ withdrawMinAmountText }}，手续费：{{ withdrawFeeRateText }}。
              <template v-if="estimatedFee > 0">
                预估手续费 ¥{{ estimatedFee.toFixed(2) }}，预计到账 ¥{{ estimatedNetAmount.toFixed(2) }}。
              </template>
            </div>
            <el-form-item label="提现方式">
              <el-input :model-value="withdrawMethodDisplay" disabled />
            </el-form-item>
            <el-form-item label="收款账号">
              <el-input
                v-model="withdrawForm.accountNumber"
                placeholder="请输入 USDT-TRC20 提现地址"
              />
            </el-form-item>
            <el-form-item label="备注信息">
              <el-input
                v-model="withdrawForm.extraNote"
                placeholder="可填写额外备注"
                type="textarea"
                :rows="2"
              />
            </el-form-item>
            <el-button
              type="primary"
              :loading="withdrawLoading"
              @click="handleWithdraw"
              :disabled="!withdrawForm.amount"
            >
              提交申请
            </el-button>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="data-grid-card" v-loading="overviewLoading">
      <template #header>
        <div class="card-header">
          <span>邀请好友（{{ overview?.stats?.totalInvited || 0 }}）</span>
        </div>
      </template>
      <vxe-grid
        show-overflow
        :data="overview?.referrals || []"
        :columns="referralColumns"
        :row-config="{ isHover: true, keyField: 'inviteeId' }"
        :column-config="{ resizable: true }"
        size="small"
        :height="360"
      >
        <template #username="{ row }">
          <span>{{ row.username || "-" }}</span>
        </template>
        <template #email="{ row }">
          <span>{{ row.email || "-" }}</span>
        </template>
        <template #status="{ row }">
          <el-tag :type="referralStatusTag(row.status)" size="small">
            {{ referralStatusText(row.status) }}
          </el-tag>
        </template>
        <template #registered_at="{ row }">
          {{ formatDateTime(row.registeredAt) }}
        </template>
        <template #paid_at="{ row }">
          {{ formatDateTime(row.firstPaidAt) }}
        </template>
        <template #rebate="{ row }">
          <span class="amount-text">¥{{ (row.totalRebate || 0).toFixed(2) }}</span>
        </template>
      </vxe-grid>
    </el-card>

    <el-card shadow="never" class="data-grid-card" v-loading="ledgerLoading">
      <template #header>
        <span>返利流水</span>
      </template>
      <vxe-grid
        show-overflow
        :data="ledgerRecords"
        :columns="ledgerColumns"
        :row-config="{ isHover: true, keyField: 'id' }"
        :column-config="{ resizable: true }"
        size="small"
        :height="320"
      >
        <template #event_type="{ row }">
          {{ getLedgerTypeText(row.eventType) }}
        </template>
        <template #source_type="{ row }">
          {{ getLedgerSourceText(row.sourceType) }}
        </template>
        <template #invitee="{ row }">
          {{ row.inviteeEmail || "-" }}
        </template>
        <template #amount="{ row }">
          <span :class="row.amount >= 0 ? 'amount-plus' : 'amount-minus'">
            {{ row.amount >= 0 ? "+" : "" }}{{ row.amount.toFixed(2) }}
          </span>
        </template>
        <template #created_at="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </vxe-grid>
    </el-card>

    <el-card shadow="never" class="data-grid-card" v-loading="withdrawLoadingTable">
      <template #header>
        <span>提现记录</span>
      </template>
      <vxe-grid
        show-overflow
        :data="withdrawRecords"
        :columns="withdrawColumns"
        :row-config="{ isHover: true, keyField: 'id' }"
        :column-config="{ resizable: true }"
        size="small"
        :height="320"
      >
        <template #amount="{ row }">
          <span class="amount-text">¥{{ row.amount.toFixed(2) }}</span>
        </template>
        <template #method="{ row }">
          {{ withdrawMethodLabel(row.method) }}
        </template>
        <template #fee="{ row }">
          ¥{{ (row.feeAmount || 0).toFixed(2) }}
        </template>
        <template #net="{ row }">
          ¥{{ getNetAmount(row).toFixed(2) }}
        </template>
        <template #status="{ row }">
          <el-tag :type="withdrawStatusTag(row.status)" size="small">
            {{ withdrawStatusLabel(row.status) }}
          </el-tag>
        </template>
        <template #created_at="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
        <template #processed_at="{ row }">
          {{ formatDateTime(row.processedAt) }}
        </template>
        <template #address="{ row }">
          {{ getWithdrawAddress(row) || "-" }}
        </template>
        <template #user_note="{ row }">
          {{ getWithdrawUserNote(row) || "-" }}
        </template>
        <template #review_note="{ row }">
          {{ row.reviewNote || "-" }}
        </template>
      </vxe-grid>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  getReferralOverview,
  getRebateLedger,
  transferRebate,
  createRebateWithdrawal,
  getUserRebateWithdrawals
} from "@/api/user";

const overview = ref<any | null>(null);
const overviewLoading = ref(false);
const ledgerRecords = ref<any[]>([]);
const ledgerLoading = ref(false);
const withdrawRecords = ref<any[]>([]);
const withdrawLoadingTable = ref(false);

const transferForm = reactive({
  amount: ""
});
const transferLoading = ref(false);

const withdrawForm = reactive({
  amount: "",
  method: "usdt",
  accountNumber: "",
  extraNote: ""
});
const withdrawLoading = ref(false);

const referralColumns: VxeGridColumns = [
  { field: "username", title: "用户名", width: 160, align: "center", slots: { default: "username" } },
  { field: "email", title: "邮箱", width: 220, align: "center", slots: { default: "email" } },
  { field: "status", title: "状态", width: 120, align: "center", slots: { default: "status" } },
  { field: "registered_at", title: "注册时间", width: 180, align: "center", slots: { default: "registered_at" } },
  { field: "paid_at", title: "首次付费时间", width: 180, align: "center", slots: { default: "paid_at" } },
  { field: "rebate", title: "累计返利", width: 140, align: "center", slots: { default: "rebate" } }
];

const ledgerColumns: VxeGridColumns = [
  { field: "eventType", title: "类型", width: 140, align: "center", slots: { default: "event_type" } },
  { field: "sourceType", title: "来源", width: 140, align: "center", slots: { default: "source_type" } },
  { field: "inviteeEmail", title: "关联用户", width: 200, align: "center", slots: { default: "invitee" } },
  { field: "tradeNo", title: "关联订单", width: 200, align: "center" },
  { field: "amount", title: "金额", width: 120, align: "center", slots: { default: "amount" } },
  { field: "created_at", title: "时间", width: 180, align: "center", slots: { default: "created_at" } }
];

const withdrawColumns: VxeGridColumns = [
  { field: "amount", title: "金额", width: 120, align: "center", slots: { default: "amount" } },
  { field: "method", title: "方式", width: 120, align: "center", slots: { default: "method" } },
  { field: "fee", title: "手续费", width: 120, align: "center", slots: { default: "fee" } },
  { field: "net", title: "实付", width: 120, align: "center", slots: { default: "net" } },
  { field: "status", title: "状态", width: 120, align: "center", slots: { default: "status" } },
  { field: "created_at", title: "申请时间", width: 180, align: "center", slots: { default: "created_at" } },
  { field: "processed_at", title: "处理时间", width: 180, align: "center", slots: { default: "processed_at" } },
  { field: "address", title: "USDT 地址", minWidth: 220, align: "center", slots: { default: "address" } },
  { field: "user_note", title: "备注", minWidth: 180, align: "center", slots: { default: "user_note" } },
  { field: "review_note", title: "审核备注", minWidth: 180, align: "center", slots: { default: "review_note" } }
];

const inviteLink = computed(() => {
  if (!overview.value?.inviteCode) {
    return "";
  }
  const base = overview.value?.inviteBaseUrl || window.location.origin;
  const normalized = base.replace(/\/$/, "");
  return `${normalized}/auth/register?invite=${overview.value.inviteCode}`;
});

const displayInviteCode = computed(() => {
  if (!overview.value?.inviteCode) return "未生成";
  return overview.value.inviteCode.toUpperCase();
});

const inviteUsageText = computed(() => {
  const used = overview.value?.inviteUsed || 0;
  const limit = overview.value?.inviteLimit || 0;
  if (!limit) return `${used} / ∞`;
  return `${used} / ${limit}`;
});

const inviteModeText = computed(() => {
  const mode = overview.value?.rebateSettings?.mode;
  if (mode === "first_order") {
    return "仅好友首次付费返利。";
  }
  return "好友每次充值或购买都会返利。";
});

const showRebateBlocked = computed(() => overview.value?.rebateEligible === false);

const withdrawMinAmount = computed(() => {
  const value = Number(overview.value?.withdrawSettings?.minAmount ?? 200);
  if (!Number.isFinite(value) || value <= 0) return 200;
  return Number(value.toFixed(2));
});

const withdrawMinAmountText = computed(() => withdrawMinAmount.value.toFixed(2));

const withdrawFeeRate = computed(() => {
  const value = Number(overview.value?.withdrawSettings?.feeRate ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 1);
});

const withdrawFeeRateText = computed(() => `${(withdrawFeeRate.value * 100).toFixed(2)}%`);

const withdrawMethodDisplay = computed(() => "USDT (TRC20)");

const estimatedFee = computed(() => {
  const amount = Number(withdrawForm.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Number((amount * withdrawFeeRate.value).toFixed(2));
});

const estimatedNetAmount = computed(() => {
  const amount = Number(withdrawForm.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Number((amount - estimatedFee.value).toFixed(2));
});

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
};

const ledgerTypeTextMap: Record<string, string> = {
  purchase_rebate: "套餐返利",
  recharge_rebate: "充值返利",
  withdraw: "提现扣减",
  withdraw_revert: "提现退回",
  transfer: "返利划转",
  withdraw_cancel: "提现撤回",
};

const ledgerSourceTextMap: Record<string, string> = {
  purchase: "购买套餐",
  recharge: "余额充值",
  withdraw: "提现",
  transfer: "划转",
  manual: "手动提现",
  balance: "余额账户",
};

const getLedgerTypeText = (value?: string) => {
  if (!value) return "-";
  return ledgerTypeTextMap[value] || value;
};

const getLedgerSourceText = (value?: string) => {
  if (!value) return "-";
  return ledgerSourceTextMap[value] || value;
};

const fetchOverview = async () => {
  try {
    overviewLoading.value = true;
    const { data } = await getReferralOverview();
    overview.value = data;
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || "获取邀请数据失败");
  } finally {
    overviewLoading.value = false;
  }
};

const fetchLedger = async () => {
  try {
    ledgerLoading.value = true;
    const { data } = await getRebateLedger({ limit: 10 });
    ledgerRecords.value = data?.records || [];
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || "获取返利流水失败");
  } finally {
    ledgerLoading.value = false;
  }
};

const fetchWithdrawals = async () => {
  try {
    withdrawLoadingTable.value = true;
    const { data } = await getUserRebateWithdrawals({ limit: 10 });
    withdrawRecords.value = data?.records || [];
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || "获取提现记录失败");
  } finally {
    withdrawLoadingTable.value = false;
  }
};

const handleTransfer = async () => {
  const amount = Number(transferForm.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    ElMessage.warning("请输入正确的划转金额");
    return;
  }
  const available = Number(overview.value?.rebateAvailable ?? 0);
  if (amount > available) {
    ElMessage.warning("可用返利不足");
    return;
  }
  try {
    transferLoading.value = true;
    await transferRebate({ amount });
    ElMessage.success("划转成功");
    transferForm.amount = "";
    await fetchOverview();
    await fetchLedger();
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || "划转失败");
  } finally {
    transferLoading.value = false;
  }
};

const handleWithdraw = async () => {
  const amount = Number(withdrawForm.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    ElMessage.warning("请输入正确的提现金额");
    return;
  }
  const available = Number(overview.value?.rebateAvailable ?? 0);
  const minAmount = withdrawMinAmount.value;
  if (available < minAmount) {
    ElMessage.warning(`返利余额未满 ¥${withdrawMinAmountText.value}，暂无法提现`);
    return;
  }
  if (amount < minAmount) {
    ElMessage.warning(`单次提现金额需至少 ¥${withdrawMinAmountText.value}`);
    return;
  }
  if (amount > available) {
    ElMessage.warning("可用返利不足");
    return;
  }
  if (!withdrawForm.accountNumber.trim()) {
    ElMessage.warning("请填写 USDT 提现地址");
    return;
  }
  try {
    withdrawLoading.value = true;
    const payload: Record<string, unknown> = {
      amount,
      method: withdrawForm.method
    };
    const accountPayload: Record<string, string> = {
      account: withdrawForm.accountNumber.trim()
    };
    if (withdrawForm.extraNote.trim()) {
      accountPayload.note = withdrawForm.extraNote.trim();
    }
    payload.accountPayload = accountPayload;
    await createRebateWithdrawal(payload as any);
    ElMessage.success("提现申请已提交");
    withdrawForm.amount = "";
    withdrawForm.accountNumber = "";
    withdrawForm.extraNote = "";
    await fetchOverview();
    await fetchWithdrawals();
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || "提交失败");
  } finally {
    withdrawLoading.value = false;
  }
};

const copyInviteLink = async () => {
  if (!inviteLink.value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteLink.value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = inviteLink.value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    ElMessage.success("邀请链接已复制");
  } catch (error) {
    console.error(error);
    ElMessage.error("复制链接失败，请手动复制");
  }
};

const withdrawStatusLabel = (status: string) => {
  if (status === "paid") return "已打款";
  if (status === "approved") return "待打款";
  if (status === "rejected") return "已驳回";
  return "审核中";
};

const withdrawStatusTag = (status: string) => {
  if (status === "paid") return "success";
  if (status === "approved") return "warning";
  if (status === "rejected") return "danger";
  return "info";
};

const withdrawMethodLabel = (method?: string) => {
  if (!method) return "-";
  if (method.toLowerCase() === "usdt") {
    return "USDT (TRC20)";
  }
  return method;
};

const getNetAmount = (row: any) => {
  const fee = Number(row.feeAmount || 0);
  return Number(row.amount || 0) - fee;
};

const getWithdrawAddress = (row: any) => {
  const payload = row.accountPayload;
  if (!payload || typeof payload !== "object") return "";
  return payload.account || "";
};

const getWithdrawUserNote = (row: any) => {
  const payload = row.accountPayload;
  if (!payload || typeof payload !== "object") return "";
  return payload.note || "";
};

const referralStatusText = (status?: string) => {
  if (status === "active") return "已付费";
  if (status === "blocked") return "已禁用";
  return "待激活";
};

const referralStatusTag = (status?: string) => {
  if (status === "active") return "success";
  if (status === "blocked") return "danger";
  return "info";
};

onMounted(() => {
  fetchOverview();
  fetchLedger();
  fetchWithdrawals();
});
</script>

<style scoped lang="scss">
.invite-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rebate-alert {
  margin-bottom: 4px;
}

.stats-row,
.action-row {
  margin-bottom: 0;
}

.withdraw-form {
  .withdraw-tip {
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 12px;
  }
}

.stats-card {
  .stats-title {
    font-size: 14px;
    color: #6b7280;
  }

  .invite-code {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 24px;
    font-weight: 600;
    margin: 10px 0;
    text-transform: uppercase;
  }

  .invite-link {
    font-size: 13px;
    color: #4b5563;
    word-break: break-all;
  }

  .invite-stat {
    font-size: 13px;
    color: #6b7280;
    margin-top: 6px;
  }

  .invite-hint {
    font-size: 12px;
    color: #9ca3af;
    margin-top: 6px;
  }

  .invite-warning {
    color: #b45309;
  }
}

.balance-card {
  .balance-title {
    font-size: 14px;
    color: #6b7280;
  }

  .balance-value {
    font-size: 32px;
    font-weight: 600;
    margin: 6px 0;
  }

  .balance-footer {
    font-size: 13px;
    color: #9ca3af;
  }
}

.action-card {
  height: 100%;
}

.data-grid-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}

.amount-text {
  font-weight: 600;
}

.amount-plus {
  color: #16a34a;
  font-weight: 600;
}

.amount-minus {
  color: #dc2626;
  font-weight: 600;
}
</style>
