<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, Download } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';
import {
  getGiftCards,
  createGiftCard,
  updateGiftCardStatus,
  deleteGiftCard,
  getGiftCardRedemptions,
  type GiftCard,
  type GiftCardPayload,
  type GiftCardRedemption
} from '@/api/admin';

const vxeTableRef = ref();
const loading = ref(false);
const exporting = ref(false);
const giftCards = ref<GiftCard[]>([]);
const filterStatus = ref('');
const filterType = ref('');
const keyword = ref('');
const selectedCards = ref<GiftCard[]>([]);
const batchProcessing = ref(false);
const selectedCount = computed(() => selectedCards.value.length);
const hasSelection = computed(() => selectedCount.value > 0);

const pagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const cardTypeOptions = [
  { label: '增加账户余额', value: 'balance' },
  { label: '增加会员时长', value: 'duration' },
  { label: '增加套餐流量', value: 'traffic' },
  { label: '重置已用流量', value: 'reset_traffic' },
  { label: '兑换订阅套餐', value: 'package' }
];

const columns = [
  { type: 'checkbox', width: 60, fixed: 'left', visible: true },
  { field: 'id', title: 'ID', width: 80, visible: true, align: 'center' },
  { field: 'code', title: '卡密', minWidth: 200, visible: true, slots: { default: 'code' } },
  { field: 'name', title: '名称', minWidth: 160, visible: true },
  { field: 'card_type', title: '类型', width: 130, visible: true, slots: { default: 'card_type' }, align: 'center' },
  { field: 'value', title: '面值/效果', minWidth: 220, visible: true, slots: { default: 'value' } },
  { field: 'usage', title: '使用情况', width: 160, visible: true, slots: { default: 'usage' }, align: 'center' },
  { field: 'status', title: '状态', width: 110, visible: true, slots: { default: 'status' }, align: 'center' },
  { field: 'start_at', title: '生效时间', width: 180, visible: true, slots: { default: 'start_at' } },
  { field: 'end_at', title: '失效时间', width: 180, visible: true, slots: { default: 'end_at' } },
  { field: 'created_at', title: '创建时间', width: 180, visible: true },
  { field: 'actions', title: '操作', width: 100, fixed: 'right', visible: true, slots: { default: 'actions' }, align: 'center' }
];

const packageOptions = ref<Array<{ id: number; name: string }>>([]);

const creationDialog = reactive({
  visible: false,
  submitting: false,
  form: {
    name: '',
    code: '',
    card_type: 'balance',
    balance_amount: '',
    duration_days: '',
    traffic_value_gb: '',
    reset_traffic_gb: '',
    package_id: null as number | null,
    max_usage: '',
    quantity: 1,
    validity: [] as Array<Date | string>
  }
});

const redemptionDialog = reactive({
  visible: false,
  loading: false,
  card: null as GiftCard | null,
  records: [] as GiftCardRedemption[],
  pager: {
    total: 0,
    currentPage: 1,
    pageSize: 10
  }
});

const statusTagType = (status: number) => {
  if (status === 1) return 'success';
  if (status === 0) return 'info';
  if (status === 2) return 'warning';
  return 'default';
};

const giftCardTypeText = (type: string) => {
  const map: Record<string, string> = {
    balance: '增加账户余额',
    duration: '增加会员时长',
    traffic: '增加套餐流量',
    reset_traffic: '重置已用流量',
    package: '兑换订阅套餐'
  };
  return map[type] || type;
};

const formatCardValue = (card: GiftCard) => {
  switch (card.card_type) {
    case 'balance':
      return card.balance_amount ? `充值 ¥${Number(card.balance_amount).toFixed(2)}` : '-';
    case 'duration':
      return card.duration_days ? `增加 ${card.duration_days} 天` : '-';
    case 'traffic':
      return card.traffic_value_gb ? `增加 ${card.traffic_value_gb} GB` : '-';
    case 'reset_traffic':
      return '重置已用流量';
    case 'package':
      return card.package_name ? `兑换套餐「${card.package_name}」` : '兑换指定套餐';
    default:
      return '-';
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

const usageText = (card: GiftCard) => {
  const used = Number(card.used_count || 0);
  if (card.max_usage === null || card.max_usage === undefined) {
    return `${used} / 不限`;
  }
  return `${used} / ${card.max_usage}`;
};

const canDeleteCard = (card: GiftCard) => {
  return Number(card.used_count || 0) === 0;
};

const loadGiftCards = async () => {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };
    if (filterStatus.value !== '') params.status = filterStatus.value;
    if (filterType.value) params.card_type = filterType.value;
    if (keyword.value.trim()) params.keyword = keyword.value.trim();

    const response = await getGiftCards(params);
    if (response.code === 0) {
      giftCards.value = response.data.records;
      pagerConfig.total = response.data.pagination.total;
    } else {
      throw new Error(response.message || '加载失败');
    }
  } catch (error: any) {
    console.error('加载礼品卡失败:', error);
    ElMessage.error(error?.message || '加载礼品卡失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadGiftCards();
};

const handleSearch = () => {
  pagerConfig.currentPage = 1;
  clearSelection();
  loadGiftCards();
};

const resetFilters = () => {
  filterStatus.value = '';
  filterType.value = '';
  keyword.value = '';
  handleSearch();
};

const handleFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadGiftCards();
};

const resetCreationForm = () => {
  creationDialog.form.name = '';
  creationDialog.form.code = '';
  creationDialog.form.card_type = 'balance';
  creationDialog.form.balance_amount = '';
  creationDialog.form.duration_days = '';
  creationDialog.form.traffic_value_gb = '';
  creationDialog.form.reset_traffic_gb = '0';
  creationDialog.form.package_id = null;
  creationDialog.form.max_usage = '';
  creationDialog.form.quantity = 1;
  creationDialog.form.validity = [];
};

const openCreateDialog = () => {
  resetCreationForm();
  creationDialog.visible = true;
};

const submitCreateGiftCard = async () => {
  const form = creationDialog.form;
  if (!form.name.trim()) {
    ElMessage.warning('请输入礼品卡名称');
    return;
  }

  const payload: GiftCardPayload = {
    name: form.name.trim(),
    card_type: form.card_type,
    code: form.code?.trim() || undefined,
    quantity: form.quantity || 1,
    max_usage: form.max_usage ? Number(form.max_usage) : null
  };

  if (form.validity.length === 2) {
    payload.start_at = new Date(form.validity[0]).toISOString();
    payload.end_at = new Date(form.validity[1]).toISOString();
  }

  if (form.card_type === 'balance') {
    payload.balance_amount = form.balance_amount ? Number(form.balance_amount) : null;
  } else if (form.card_type === 'duration') {
    payload.duration_days = form.duration_days ? Number(form.duration_days) : null;
  } else if (form.card_type === 'traffic') {
    payload.traffic_value_gb = form.traffic_value_gb ? Number(form.traffic_value_gb) : null;
  } else if (form.card_type === 'reset_traffic') {
    payload.reset_traffic_gb = null;
  } else if (form.card_type === 'package') {
    payload.package_id = form.package_id || undefined;
    if (!payload.package_id) {
      ElMessage.warning('请选择需要兑换的套餐');
      return;
    }
  }

  creationDialog.submitting = true;
  try {
    const response = await createGiftCard(payload);
    if (response.code === 0) {
      ElMessage.success('礼品卡生成成功');
      creationDialog.visible = false;
      await loadGiftCards();
    } else {
      throw new Error(response.message || '生成失败');
    }
  } catch (error: any) {
    console.error('生成礼品卡失败:', error);
    ElMessage.error(error?.message || '生成礼品卡失败');
  } finally {
    creationDialog.submitting = false;
  }
};

const confirmDeleteCard = async (card: GiftCard) => {
  if (!canDeleteCard(card)) {
    ElMessage.warning('已有使用记录的礼品卡无法删除');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除礼品卡「${card.name}」吗？`, '删除确认', {
      type: 'warning'
    });
    const response = await deleteGiftCard(card.id);
    if (response.code === 0) {
      ElMessage.success('礼品卡已删除');
      loadGiftCards();
    } else {
      throw new Error(response.message || '删除失败');
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除礼品卡失败:', error);
      ElMessage.error('删除礼品卡失败');
    }
  }
};

const openRedemptionDialog = (card: GiftCard) => {
  redemptionDialog.card = card;
  redemptionDialog.visible = true;
  redemptionDialog.pager.currentPage = 1;
  loadRedemptionRecords();
};

const loadRedemptionRecords = async () => {
  if (!redemptionDialog.card) return;
  redemptionDialog.loading = true;
  try {
    const response = await getGiftCardRedemptions(redemptionDialog.card.id, {
      page: redemptionDialog.pager.currentPage,
      limit: redemptionDialog.pager.pageSize
    });
    if (response.code === 0) {
      redemptionDialog.records = response.data.records;
      redemptionDialog.pager.total = response.data.pagination.total;
    } else {
      throw new Error(response.message || '加载失败');
    }
  } catch (error: any) {
    console.error('加载兑换记录失败:', error);
    ElMessage.error(error?.message || '加载兑换记录失败');
  } finally {
    redemptionDialog.loading = false;
  }
};

const handleRedemptionPageChange = (page: number) => {
  redemptionDialog.pager.currentPage = page;
  loadRedemptionRecords();
};

const loadPackageOptions = async () => {
  try {
    const response = await http.get('/admin/packages', {
      params: { page: 1, limit: 100 }
    });
    if (response.code === 0) {
      packageOptions.value = (response.data.records || response.data.packages || []).map((pkg: any) => ({
        id: pkg.id,
        name: pkg.name
      }));
    }
  } catch (error) {
    console.warn('加载套餐列表失败:', error);
  }
};

onMounted(() => {
  loadGiftCards();
  loadPackageOptions();
});

const refreshSelectionState = () => {
  const records = vxeTableRef.value?.getCheckboxRecords?.() || [];
  selectedCards.value = records;
};

const handleSelectionChange = () => {
  refreshSelectionState();
};

const clearSelection = () => {
  vxeTableRef.value?.clearCheckboxRow?.();
  selectedCards.value = [];
};

const changeCardStatus = async (card: GiftCard, targetStatus: number) => {
  if (card.status === targetStatus) {
    ElMessage.info('礼品卡状态未变化');
    return;
  }
  if (targetStatus === 1 && card.status === 2) {
    ElMessage.warning('已用完的礼品卡无法重新启用');
    return;
  }
  try {
    const response = await updateGiftCardStatus(card.id, targetStatus);
    if (response.code === 0) {
      ElMessage.success(targetStatus === 1 ? '礼品卡已启用' : '礼品卡已禁用');
      loadGiftCards();
    } else {
      throw new Error(response.message || '操作失败');
    }
  } catch (error: any) {
    console.error('更新礼品卡状态失败:', error);
    ElMessage.error(error?.message || '更新礼品卡状态失败');
  }
};

const handleRowCommand = (command: string, card: GiftCard) => {
  switch (command) {
    case 'records':
      openRedemptionDialog(card);
      break;
    case 'enable':
      changeCardStatus(card, 1);
      break;
    case 'disable':
      changeCardStatus(card, 0);
      break;
    case 'delete':
      confirmDeleteCard(card);
      break;
  }
};

const batchUpdateStatus = async (targetStatus: number) => {
  const targets = selectedCards.value.filter(card => {
    if (targetStatus === 1) {
      return card.status !== 1 && card.status !== 2;
    }
    return card.status !== 0;
  });
  if (targets.length === 0) {
    ElMessage.info(targetStatus === 1 ? '没有可启用的礼品卡' : '没有可禁用的礼品卡');
    return;
  }
  batchProcessing.value = true;
  try {
    for (const card of targets) {
      const response = await updateGiftCardStatus(card.id, targetStatus);
      if (response.code !== 0) {
        throw new Error(response.message || '批量操作失败');
      }
    }
    ElMessage.success(targetStatus === 1 ? '批量启用成功' : '批量禁用成功');
    loadGiftCards();
    clearSelection();
  } catch (error: any) {
    console.error('批量更新礼品卡状态失败:', error);
    ElMessage.error(error?.message || '批量操作失败');
  } finally {
    batchProcessing.value = false;
  }
};

const batchDeleteCards = async () => {
  const deletable = selectedCards.value.filter(card => canDeleteCard(card));
  if (deletable.length === 0) {
    ElMessage.warning('所选礼品卡均无法删除');
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除 ${deletable.length} 张礼品卡吗？该操作无法撤销。`, '删除确认', {
      type: 'warning'
    });
    batchProcessing.value = true;
    for (const card of deletable) {
      const response = await deleteGiftCard(card.id);
      if (response.code !== 0) {
        throw new Error(response.message || '删除失败');
      }
    }
    ElMessage.success('批量删除成功');
    loadGiftCards();
    clearSelection();
  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量删除礼品卡失败:', error);
      ElMessage.error((error as Error)?.message || '批量删除失败');
    }
  } finally {
    batchProcessing.value = false;
  }
};

const handleBatchCommand = (command: string) => {
  if (!selectedCards.value.length) {
    ElMessage.warning('请先选择礼品卡');
    return;
  }
  if (command === 'enable') {
    batchUpdateStatus(1);
  } else if (command === 'disable') {
    batchUpdateStatus(0);
  } else if (command === 'delete') {
    batchDeleteCards();
  }
};

const exportGiftCards = async () => {
  exporting.value = true;
  try {
    await ElMessageBox.confirm('确定导出当前列表中的礼品卡吗？', '导出确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info'
    });

    const headers = ['卡密', '名称', '类型', '面值/效果', '失效时间'];
    const rows = giftCards.value.map(card => [
      card.code || '',
      card.name || '',
      giftCardTypeText(card.card_type),
      formatCardValue(card),
      formatDateTime(card.end_at)
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gift_cards_${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    ElMessage.success('导出成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('导出礼品卡失败:', error);
      ElMessage.error('导出失败，请重试');
    }
  } finally {
    exporting.value = false;
  }
};
</script>

<template>
  <VxeTableBar
    :vxeTableRef="vxeTableRef"
    :columns="columns"
    title="礼品卡管理"
    @refresh="loadGiftCards"
  >
    <template #buttons>
      <el-select
        v-model="filterType"
        placeholder="礼品卡类型"
        clearable
        style="width: 150px; margin-right: 12px;"
        @change="handleFilterChange"
      >
        <el-option label="全部类型" value="" />
        <el-option
          v-for="item in cardTypeOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select
        v-model="filterStatus"
        placeholder="状态"
        clearable
        style="width: 130px; margin-right: 12px;"
        @change="handleFilterChange"
      >
        <el-option label="全部状态" value="" />
        <el-option label="已启用" :value="1" />
        <el-option label="已禁用" :value="0" />
        <el-option label="已用完" :value="2" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="关键词（名称/卡密）"
        clearable
        style="width: 220px; margin-right: 12px;"
        @keyup.enter="handleSearch"
      />
      <el-dropdown
        trigger="click"
        :disabled="!hasSelection || batchProcessing"
        @command="handleBatchCommand"
        style="margin-right: 12px;"
      >
        <el-button :disabled="!hasSelection || batchProcessing">
          批量操作
          <span v-if="hasSelection">（{{ selectedCount }}）</span>
          <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="enable">批量启用</el-dropdown-item>
            <el-dropdown-item command="disable">批量禁用</el-dropdown-item>
            <el-dropdown-item command="delete" divided>批量删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button type="primary" @click="handleSearch">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
      <el-button :loading="exporting" @click="exportGiftCards">
        <el-icon><Download /></el-icon>
        导出
      </el-button>
      <el-button type="success" @click="openCreateDialog">新建礼品卡</el-button>
    </template>

    <template v-slot="{ size, dynamicColumns }">
      <vxe-grid
        ref="vxeTableRef"
        v-loading="loading"
        show-overflow
        :size="size"
        :height="600"
        :column-config="{ resizable: true }"
        :row-config="{ isHover: true, keyField: 'id' }"
        :checkbox-config="{ reserve: true }"
        :columns="dynamicColumns"
        :data="giftCards"
        :pager-config="pagerConfig"
        @page-change="handlePageChange"
        @checkbox-change="handleSelectionChange"
        @checkbox-all="handleSelectionChange"
      >
        <template #code="{ row }">
          <span class="code-chip">{{ row.code }}</span>
        </template>
        <template #card_type="{ row }">
          <el-tag type="info" effect="plain">{{ giftCardTypeText(row.card_type) }}</el-tag>
        </template>
        <template #value="{ row }">
          <div class="value-text">{{ formatCardValue(row) }}</div>
        </template>
        <template #usage="{ row }">
          <div class="usage-text">
            {{ usageText(row) }}
          </div>
        </template>
        <template #status="{ row }">
          <el-tag :type="statusTagType(row.status)" effect="plain">
            {{ row.status === 1 ? '已启用' : row.status === 2 ? '已用完' : '已禁用' }}
          </el-tag>
        </template>
        <template #start_at="{ row }">
          {{ formatDateTime(row.start_at) }}
        </template>
        <template #end_at="{ row }">
          <span :class="{ 'text-danger': row.is_expired }">{{ formatDateTime(row.end_at) }}</span>
        </template>
        <template #actions="{ row }">
          <el-dropdown trigger="click" @command="(cmd) => handleRowCommand(cmd, row)">
            <el-button size="small" plain>
              更多
              <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="records">查看兑换记录</el-dropdown-item>
                <el-dropdown-item
                  v-if="row.status !== 2"
                  :command="row.status === 1 ? 'disable' : 'enable'"
                >
                  {{ row.status === 1 ? '禁用礼品卡' : '启用礼品卡' }}
                </el-dropdown-item>
                <el-dropdown-item
                  v-else
                  disabled
                >
                  已用完
                </el-dropdown-item>
                <el-dropdown-item
                  command="delete"
                  :disabled="!canDeleteCard(row)"
                  divided
                >
                  删除礼品卡
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </vxe-grid>
    </template>
  </VxeTableBar>

  <el-dialog
    v-model="creationDialog.visible"
    title="新建礼品卡"
    width="540px"
    :close-on-click-modal="false"
  >
    <el-form label-width="110px" label-position="right">
      <el-form-item label="名称" required>
        <el-input v-model="creationDialog.form.name" placeholder="请输入礼品卡名称" />
      </el-form-item>
      <el-form-item label="自定义卡密">
        <el-input v-model="creationDialog.form.code" placeholder="留空随机生成" />
      </el-form-item>
      <el-form-item label="礼品卡类型" required>
        <el-select v-model="creationDialog.form.card_type" style="width: 100%;">
          <el-option
            v-for="item in cardTypeOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item v-if="creationDialog.form.card_type === 'balance'" label="充值金额" required>
        <el-input v-model="creationDialog.form.balance_amount" placeholder="输入金额">
          <template #suffix>元</template>
        </el-input>
      </el-form-item>

      <el-form-item v-else-if="creationDialog.form.card_type === 'duration'" label="增加天数" required>
        <el-input v-model="creationDialog.form.duration_days" placeholder="输入天数">
          <template #suffix>天</template>
        </el-input>
      </el-form-item>

      <el-form-item v-else-if="creationDialog.form.card_type === 'traffic'" label="增加流量" required>
        <el-input v-model="creationDialog.form.traffic_value_gb" placeholder="输入流量">
          <template #suffix>GB</template>
        </el-input>
      </el-form-item>

      <el-form-item v-else-if="creationDialog.form.card_type === 'reset_traffic'" label="重置已用" required>
        <el-input v-model="creationDialog.form.reset_traffic_gb" disabled>
          <template #suffix>GB</template>
        </el-input>
      </el-form-item>

      <el-form-item v-else-if="creationDialog.form.card_type === 'package'" label="兑换套餐" required>
        <el-select
          v-model="creationDialog.form.package_id"
          filterable
          placeholder="选择可兑换的套餐"
          style="width: 100%;"
        >
          <el-option
            v-for="item in packageOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="有效期">
        <el-date-picker
          v-model="creationDialog.form.validity"
          type="datetimerange"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DD HH:mm:ss"
          style="width: 100%;"
        />
      </el-form-item>

      <el-form-item label="最大使用次数">
        <el-input
          v-model="creationDialog.form.max_usage"
          placeholder="留空表示不限制"
        />
      </el-form-item>

      <el-form-item label="生成数量">
        <el-input-number v-model="creationDialog.form.quantity" :min="1" :max="500" />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="creationDialog.visible = false" :disabled="creationDialog.submitting">取消</el-button>
        <el-button type="primary" :loading="creationDialog.submitting" @click="submitCreateGiftCard">
          提交
        </el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="redemptionDialog.visible"
    :title="`兑换记录 - ${redemptionDialog.card?.code || ''}`"
    width="720px"
    destroy-on-close
  >
    <el-table
      v-loading="redemptionDialog.loading"
      :data="redemptionDialog.records"
      border
      size="small"
    >
      <el-table-column prop="user_email" label="用户" min-width="160">
        <template #default="{ row }">
          <div>{{ row.user_email || '未知用户' }}</div>
          <div class="sub-text" v-if="row.user_name">({{ row.user_name }})</div>
        </template>
      </el-table-column>
      <el-table-column prop="card_type" label="类型" width="120">
        <template #default="{ row }">{{ giftCardTypeText(row.card_type) }}</template>
      </el-table-column>
      <el-table-column label="效果" min-width="180">
        <template #default="{ row }">
          <div v-if="row.card_type === 'balance' && row.change_amount">
            充值 ¥{{ Number(row.change_amount).toFixed(2) }}
          </div>
          <div v-else-if="row.card_type === 'duration' && row.duration_days">
            增加 {{ row.duration_days }} 天
          </div>
          <div v-else-if="row.card_type === 'traffic' && row.traffic_value_gb">
            增加 {{ row.traffic_value_gb }} GB
          </div>
          <div v-else-if="row.card_type === 'reset_traffic' && row.reset_traffic_gb">
            重置为 {{ row.reset_traffic_gb }} GB
          </div>
          <div v-else-if="row.card_type === 'package'">
            套餐兑换成功
          </div>
          <div v-else>-</div>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="备注" min-width="200">
        <template #default="{ row }">
          {{ row.message || '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="兑换时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
      </el-table-column>
    </el-table>
    <div class="redemption-pagination">
      <el-pagination
        layout="prev, pager, next, total"
        :current-page="redemptionDialog.pager.currentPage"
        :page-size="redemptionDialog.pager.pageSize"
        :total="redemptionDialog.pager.total"
        @current-change="handleRedemptionPageChange"
      />
    </div>
  </el-dialog>
</template>

<style scoped lang="scss">
.code-chip {
  font-family: 'Menlo', 'Cascadia Code', monospace;
  padding: 2px 8px;
  background: #f4f6fb;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
}

.value-text {
  font-weight: 500;
  color: #303133;
}

.dropdown-icon {
  margin-left: 4px;
}

.usage-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: #606266;
}

.usage-remaining {
  color: #909399;
  font-size: 12px;
}

.text-danger {
  color: #f56c6c;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.sub-text {
  font-size: 12px;
  color: #909399;
}

.redemption-pagination {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
watch(() => creationDialog.form.card_type, (type) => {
  if (type === 'reset_traffic') {
    creationDialog.form.reset_traffic_gb = '0';
  }
});
