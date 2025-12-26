<template>
  <div class="rebate-withdrawals-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>返利提现审核</span>
          <div class="filters">
            <el-select
              v-model="filters.status"
              clearable
              placeholder="筛选状态"
              style="width: 150px"
              size="small"
              @change="fetchData"
            >
              <el-option label="审核中" value="pending" />
              <el-option label="待打款" value="approved" />
              <el-option label="已打款" value="paid" />
              <el-option label="已驳回" value="rejected" />
            </el-select>
            <el-button type="primary" size="small" @click="fetchData">
              刷新
            </el-button>
          </div>
        </div>
      </template>
      <vxe-grid
        v-loading="loading"
        :data="records"
        show-overflow
        :columns="columns"
        :row-config="{ isHover: true, keyField: 'id' }"
        :column-config="{ resizable: true }"
        size="small"
        :height="520"
        >
        <template #user="{ row }">
          <span>{{ row.email || "-" }}</span>
        </template>
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
          <el-tag :type="statusTag(row.status)" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
        <template #created_at="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
        <template #processed_at="{ row }">
          {{ formatDateTime(row.processedAt) }}
        </template>
        <template #address="{ row }">
          <template v-if="getPayloadAddress(row.accountPayload)">
            <span class="address-text">{{ formatAddressPreview(getPayloadAddress(row.accountPayload)!) }}</span>
            <el-button type="primary" text size="small" @click="showAddressDetail(row)">查看</el-button>
          </template>
          <span v-else>-</span>
        </template>
        <template #user_note="{ row }">
          {{ getPayloadNote(row.accountPayload) || "-" }}
        </template>
        <template #review_note="{ row }">
          {{ row.reviewNote || "-" }}
        </template>
        <template #actions="{ row }">
          <el-dropdown
            trigger="click"
            @command="(cmd: WithdrawalAction) => handleAction(row, cmd)"
          >
            <span class="dropdown-trigger">
              更多<el-icon class="dropdown-icon"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  command="approved"
                  :disabled="row.status !== 'pending'"
                >
                  通过
                </el-dropdown-item>
                <el-dropdown-item
                  command="rejected"
                  :disabled="row.status !== 'pending'"
                >
                  拒绝
                </el-dropdown-item>
                <el-dropdown-item
                  command="paid"
                  :disabled="row.status === 'rejected' || row.status === 'paid'"
                >
                  标记已打款
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </vxe-grid>
    </el-card>

    <el-dialog
      v-model="addressDialog.visible"
      title="USDT 提现信息"
      width="420px"
      :close-on-click-modal="false"
    >
      <div class="address-dialog">
        <p><strong>USDT 地址：</strong>{{ addressDialog.address || '-' }}</p>
        <p><strong>实付金额：</strong>¥{{ addressDialog.netAmount.toFixed(2) }}</p>
        <div v-if="addressDialog.qr" class="qr-wrapper">
          <img :src="addressDialog.qr" alt="USDT 地址二维码" />
          <p class="qr-hint">扫描或复制上方地址进行打款</p>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown } from "@element-plus/icons-vue";
import QRCode from "qrcode";
import {
  getRebateWithdrawals,
  reviewRebateWithdrawal
} from "@/api/admin";

type WithdrawalAction = "approved" | "rejected" | "paid";

interface WithdrawalRecord {
  id: number;
  userId: number;
  email: string;
  username: string;
  amount: number;
  method: string;
  status: string;
  feeRate?: number;
  feeAmount?: number;
  reviewNote?: string;
  accountPayload?: Record<string, unknown> | null;
  createdAt: string;
  processedAt?: string;
}

const addressDialog = reactive({
  visible: false,
  address: "",
  netAmount: 0,
  qr: ""
});

const loading = ref(false);
const records = ref<WithdrawalRecord[]>([]);
const filters = reactive<{ status: string | null }>({
  status: null
});

const columns: VxeGridColumns = [
  { field: "id", title: "ID", width: 60, align: "center" },
  { field: "user", title: "用户邮箱", width: 200, align: "center", slots: { default: "user" } },
  { field: "amount", title: "金额", width: 120, align: "center", slots: { default: "amount" } },
  { field: "method", title: "方式", width: 120, align: "center", slots: { default: "method" } },
  { field: "fee", title: "手续费", width: 100, align: "center", slots: { default: "fee" } },
  { field: "net", title: "实付", width: 100, align: "center", slots: { default: "net" } },
  { field: "status", title: "状态", width: 100, align: "center", slots: { default: "status" } },
  { field: "created_at", title: "申请时间", width: 160, align: "center", slots: { default: "created_at" } },
  { field: "processed_at", title: "处理时间", width: 160, align: "center", slots: { default: "processed_at" } },
  { field: "address", title: "USDT 地址", minWidth: 220, align: "center", slots: { default: "address" } },
  { field: "user_note", title: "备注", minWidth: 180, align: "center", slots: { default: "user_note" } },
  { field: "review_note", title: "审核备注", minWidth: 180, align: "center", slots: { default: "review_note" } },
  { field: "actions", title: "操作", width: 80, align: "center", fixed: "right", slots: { default: "actions" } }
];

const statusLabel = (status: string) => {
  if (status === "paid") return "已打款";
  if (status === "approved") return "待打款";
  if (status === "rejected") return "已驳回";
  return "审核中";
};

const statusTag = (status: string) => {
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

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
};

const getNetAmount = (row: WithdrawalRecord) => {
  return row.amount - (row.feeAmount || 0);
};

const getPayloadAddress = (payload?: Record<string, unknown> | null) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return (payload as Record<string, string>).account || "";
};

const getPayloadNote = (payload?: Record<string, unknown> | null) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return (payload as Record<string, string>).note || "";
};

const formatAddressPreview = (address: string) => {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const showAddressDetail = async (row: WithdrawalRecord) => {
  const address = getPayloadAddress(row.accountPayload);
  if (!address) return;
  addressDialog.address = address;
  addressDialog.netAmount = getNetAmount(row);
  addressDialog.visible = true;
  addressDialog.qr = "";
  try {
    addressDialog.qr = await QRCode.toDataURL(address, { width: 220, margin: 1 });
  } catch (error) {
    console.error("生成二维码失败", error);
  }
};

const fetchData = async () => {
  try {
    loading.value = true;
    const { data } = await getRebateWithdrawals({
      status: filters.status || undefined
    });
    const list = Array.isArray(data?.records) ? data.records : [];
    records.value = list.map((row: any) => ({
      ...row,
      accountPayload: row.accountPayload ?? null
    }));
  } catch (error: any) {
    console.error(error);
    ElMessage.error(error?.message || "获取提现申请失败");
  } finally {
    loading.value = false;
  }
};

const handleAction = async (row: WithdrawalRecord, action: WithdrawalAction) => {
  if (action === "approved" && row.status !== "pending") return;
  if (action === "rejected" && row.status !== "pending") return;
  if (action === "paid" && (row.status === "rejected" || row.status === "paid")) return;
  try {
    const promptResult = await ElMessageBox.prompt(
      action === "rejected" ? "请输入驳回原因" : "可输入备注",
      action === "rejected" ? "驳回提现" : "更新提现状态",
      {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputPlaceholder: "选填",
        inputType: "textarea"
      }
    ).catch(() => null);
    if (promptResult === null) {
      return;
    }
    const note = promptResult.value;
    loading.value = true;
    await reviewRebateWithdrawal({
      id: row.id,
      status: action,
      note: note ? String(note) : undefined
    });
    ElMessage.success("状态已更新");
    fetchData();
  } catch (error: any) {
    if (error !== "cancel") {
      console.error(error);
      ElMessage.error(error?.message || "更新失败");
    }
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchData();
});
</script>

<style scoped lang="scss">
.rebate-withdrawals-page {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .amount-text {
    font-weight: 600;
  }

  .fee-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }

  .dropdown-trigger {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    color: var(--el-color-primary);

    .dropdown-icon {
      margin-left: 4px;
    }
  }

  .address-text {
    font-family: monospace;
    margin-right: 6px;
  }

  .address-dialog {
    p {
      margin: 6px 0;
    }

    .qr-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 12px;

      img {
        width: 220px;
        height: 220px;
      }

      .qr-hint {
        font-size: 12px;
        color: #6b7280;
        margin-top: 6px;
      }
    }
  }
}
</style>
