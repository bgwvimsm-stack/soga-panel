<template>
  <div class="admin-tickets-page">
    <div class="page-header">
      <div>
        <h1>工单管理</h1>
        <p class="subtitle">集中查看所有用户工单，并由管理员以 Markdown 形式回复。</p>
      </div>
      <div class="page-actions">
        <el-select
          v-model="filters.status"
          class="status-filter"
          placeholder="全部状态"
          clearable
          @change="handleFilterChange"
        >
          <el-option
            v-for="option in statusOptions"
            :key="option.value || 'all'"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-button @click="loadTickets" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <VxeTableBar
      class="tickets-table-bar"
      :vxeTableRef="vxeTableRef"
      title="工单列表"
      :columns="columns"
      @refresh="loadTickets"
    >
      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid
          ref="vxeTableRef"
          v-loading="loading"
          border
          stripe
          show-overflow
          :height="getTableHeight(size)"
          :size="size"
          :data="tickets"
          :columns="dynamicColumns"
          :column-config="{ resizable: true }"
          :row-config="{ isHover: true, keyField: 'id' }"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #title="{ row }">
            <div class="ticket-title" @click="openTicketDetail(row)">
              <span>{{ row.title }}</span>
              <el-icon><View /></el-icon>
            </div>
          </template>
          <template #userId="{ row }">
            <span>{{ row.user?.id ?? "-" }}</span>
          </template>
          <template #userName="{ row }">
            <span>{{ row.user?.username || "未知用户" }}</span>
          </template>
          <template #status="{ row }">
            <el-tag :type="statusMeta[row.status]?.type || 'info'">
              {{ statusMeta[row.status]?.label || row.status }}
            </el-tag>
          </template>
          <template #lastReply="{ row }">
            {{ formatDate(row.updated_at) }}
          </template>
          <template #createdAt="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
          <template #actions="{ row }">
            <el-button type="primary" link @click="openTicketDetail(row)">查看</el-button>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 工单详情与回复 -->
    <el-drawer
      v-model="detailVisible"
      title="工单详情"
      :size="drawerSize"
      :destroy-on-close="true"
    >
      <div v-if="detailLoading" class="drawer-loading">
        <el-skeleton :rows="8" animated />
      </div>

      <div v-else-if="activeTicket" class="ticket-detail">
        <div class="detail-header">
          <div>
            <h3>{{ activeTicket.title }}</h3>
            <p class="detail-meta">
              创建于 {{ formatDate(activeTicket.created_at) }} · 最近更新
              {{ formatDate(activeTicket.updated_at) }}
            </p>
          </div>
          <el-tag :type="statusMeta[activeTicket.status]?.type || 'info'">
            {{ statusMeta[activeTicket.status]?.label || activeTicket.status }}
          </el-tag>
        </div>

        <div class="detail-sections">
          <div class="info-block user-info">
            <div class="block-title">用户信息</div>
            <div class="block-content">
              <p><strong>ID：</strong>{{ activeTicket.user?.id ?? "未知" }}</p>
              <p><strong>昵称：</strong>{{ activeTicket.user?.username || "未知" }}</p>
              <p><strong>邮箱：</strong>{{ activeTicket.user?.email || "未提供" }}</p>
            </div>
          </div>
          <div class="info-block ticket-content">
            <div class="block-title">工单内容</div>
            <div class="block-content">
              <div class="markdown-block" v-html="detailContentHtml"></div>
            </div>
          </div>
        </div>

        <el-form inline label-width="80px" class="status-form">
          <el-form-item label="当前状态">
            <el-select v-model="statusSelection" placeholder="选择状态" class="status-select">
              <el-option
                v-for="option in statusOptions.filter((opt) => opt.value)"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button
              type="primary"
              plain
              :disabled="statusSelection === activeTicket.status"
              :loading="statusUpdating"
              @click="applyStatusUpdate"
            >
              更新状态
            </el-button>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">管理员回复</el-divider>
        <div v-if="ticketReplies.length === 0" class="empty-replies">
          <el-empty description="暂无回复" :image-size="100" />
        </div>
        <el-timeline v-else>
          <el-timeline-item
            v-for="reply in ticketReplies"
            :key="reply.id"
            :timestamp="formatDate(reply.created_at)"
            placement="top"
          >
            <el-card shadow="never">
              <div class="reply-header">
                <div class="reply-author">
                  <el-tag size="small" :type="reply.author.role === 'admin' ? 'danger' : 'info'">
                    {{ reply.author.role === 'admin' ? '管理员' : '用户' }}
                  </el-tag>
                  <strong>{{ formatReplyAuthor(reply) }}</strong>
                </div>
              </div>
              <div class="markdown-block" v-html="renderMarkdown(reply.content)"></div>
            </el-card>
          </el-timeline-item>
        </el-timeline>

        <el-divider content-position="left">发送新回复</el-divider>
        <el-alert
          type="info"
          title="只有管理员可以发布回复，内容支持 Markdown。"
          :closable="false"
          show-icon
          class="reply-alert"
        />
        <el-form :model="replyForm" label-width="90px" class="reply-form">
          <el-form-item label="回复内容" required>
            <div class="markdown-editor">
              <el-input
                v-model="replyForm.content"
                type="textarea"
                :rows="8"
                maxlength="8000"
                show-word-limit
                placeholder="输入回复内容，支持 Markdown"
              />
              <div class="markdown-preview">
                <div class="preview-header">实时预览</div>
                <div
                  class="markdown-block"
                  :class="{ 'is-empty': !replyForm.content }"
                  v-html="replyPreviewHtml"
                ></div>
              </div>
            </div>
          </el-form-item>
          <el-form-item label="回复后状态">
            <el-select v-model="replyStatus" placeholder="回复后状态">
              <el-option
                v-for="option in statusOptions.filter((opt) => opt.value)"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="replyLoading" @click="submitReply">
              发送回复
            </el-button>
            <el-button @click="replyForm.content = ''">清空</el-button>
          </el-form-item>
        </el-form>
      </div>
      <div v-else class="drawer-loading">
        <el-empty description="未选择工单" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useWindowSize } from "@vueuse/core";
import { ElMessage } from "element-plus";
import { Refresh, View } from "@element-plus/icons-vue";
import dayjs from "dayjs";
import type {
  TicketDetail,
  TicketReply,
  TicketStatus,
  TicketSummary,
} from "@/api/types";
import {
  fetchAdminTicketDetail,
  fetchAdminTickets,
  replyAdminTicket,
  updateTicketStatus,
} from "@/api/ticket";
import { renderMarkdown } from "@/utils/markdown";
import { useNotificationStore } from "@/store/notification";
import { VxeTableBar } from "@/components/ReVxeTableBar";

const tickets = ref<TicketSummary[]>([]);
const ticketReplies = ref<TicketReply[]>([]);
const loading = ref(false);
const detailLoading = ref(false);
const replyLoading = ref(false);
const statusUpdating = ref(false);
const detailVisible = ref(false);
const activeTicket = ref<TicketDetail | null>(null);
const vxeTableRef = ref();
const filters = reactive<{ status: TicketStatus | "" }>({
  status: "",
});
const pagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 10,
  pageSizes: [10, 20, 50],
  layouts: ["Total", "Sizes", "PrevPage", "Number", "NextPage", "FullJump"]
});

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case "mini":
      return 420;
    case "small":
      return 480;
    case "medium":
    default:
      return 540;
  }
});

const columns = [
  { field: "id", title: "工单ID", width: 90, align: "center", visible: true },
  { field: "user_id", title: "用户ID", width: 100, align: "center", visible: true, slots: { default: "userId" } },
  { field: "user_name", title: "用户名", minWidth: 160, visible: true, slots: { default: "userName" } },
  { field: "title", title: "标题", minWidth: 220, visible: true, slots: { default: "title" } },
  { field: "status", title: "状态", width: 140, align: "center", visible: true, slots: { default: "status" } },
  { field: "last_reply_at", title: "最近更新", width: 200, align: "center", visible: true, slots: { default: "lastReply" } },
  { field: "created_at", title: "创建时间", width: 200, align: "center", visible: true, slots: { default: "createdAt" } },
  { field: "actions", title: "操作", width: 120, fixed: "right", visible: true, slots: { default: "actions" } },
];
const statusSelection = ref<TicketStatus>("open");
const replyStatus = ref<TicketStatus>("answered");
const notificationStore = useNotificationStore();
const { width } = useWindowSize();
const drawerSize = computed(() => (width.value <= 768 ? "100%" : "720px"));

const replyForm = reactive({
  content: "",
});

const statusMeta: Record<
  TicketStatus,
  { label: string; type: "info" | "success" | "warning" | "danger" }
> = {
  open: { label: "待处理", type: "warning" },
  answered: { label: "已回复", type: "success" },
  closed: { label: "已关闭", type: "info" },
};

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "待处理", value: "open" },
  { label: "已回复", value: "answered" },
  { label: "已关闭", value: "closed" },
];

const replyPreviewHtml = computed(() => renderMarkdown(replyForm.content));
const detailContentHtml = computed(() => renderMarkdown(activeTicket.value?.content));

const loadTickets = async () => {
  loading.value = true;
  try {
    const { data } = await fetchAdminTickets({
      page: pagerConfig.currentPage,
      pageSize: pagerConfig.pageSize,
      status: filters.status || undefined,
    });
    tickets.value = data.items;
    pagerConfig.total = data.pagination.total;
    pagerConfig.currentPage = data.pagination.page;
    pagerConfig.pageSize = data.pagination.pageSize;
    notificationStore.refreshAdminTicketPending();
  } catch (error: any) {
    ElMessage.error(error?.message || "加载工单失败");
  } finally {
    loading.value = false;
  }
};

const openTicketDetail = async (ticket: TicketSummary) => {
  detailVisible.value = true;
  detailLoading.value = true;
  replyForm.content = "";
  activeTicket.value = null;
  ticketReplies.value = [];

  try {
    const { data } = await fetchAdminTicketDetail(ticket.id);
    activeTicket.value = data.ticket;
    ticketReplies.value = data.replies;
    statusSelection.value = data.ticket.status;
    replyStatus.value = data.ticket.status === "closed" ? "closed" : "answered";
  } catch (error: any) {
    ElMessage.error(error?.message || "加载工单详情失败");
    detailVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadTickets();
};

const handleFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadTickets();
};

const applyStatusUpdate = async () => {
  if (!activeTicket.value) return;
  statusUpdating.value = true;
  try {
    await updateTicketStatus(activeTicket.value.id, {
      status: statusSelection.value,
    });
    activeTicket.value.status = statusSelection.value;
    ElMessage.success("状态已更新");
    loadTickets();
  } catch (error: any) {
    ElMessage.error(error?.message || "更新状态失败");
  } finally {
    statusUpdating.value = false;
  }
};

const submitReply = async () => {
  if (!activeTicket.value) return;
  if (!replyForm.content.trim()) {
    ElMessage.warning("请输入回复内容");
    return;
  }
  replyLoading.value = true;
  try {
    const { data } = await replyAdminTicket(activeTicket.value.id, {
      content: replyForm.content,
      status: replyStatus.value,
    });
    ticketReplies.value = data.replies;
    activeTicket.value.status = data.status;
    statusSelection.value = data.status;
    replyForm.content = "";
    ElMessage.success("回复已发送");
    loadTickets();
  } catch (error: any) {
    ElMessage.error(error?.message || "回复失败");
  } finally {
    replyLoading.value = false;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return "暂无";
  return dayjs(value).format("YYYY-MM-DD HH:mm");
};

const formatReplyAuthor = (reply: TicketReply) => {
  const fallback = reply.author.role === "admin" ? "管理员" : "用户";
  return reply.author.username || `ID:${reply.author.id}` || fallback;
};

onMounted(() => {
  loadTickets();
});
</script>

<style scoped lang="scss">
.admin-tickets-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;

  h1 {
    margin: 0;
  }

  .subtitle {
    margin: 6px 0 0;
    color: #7f8c8d;
    font-size: 14px;
  }
}

.page-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.status-filter {
  width: 160px;
}

.tickets-table-bar {
  .ticket-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #409eff;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
}

.drawer-loading {
  padding: 20px 0;
}

.ticket-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(45, 140, 240, 0.08);
  max-height: calc(100vh - 140px);
  overflow-y: auto;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-meta {
  color: #909399;
  margin: 4px 0 0;
}

.markdown-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.markdown-preview {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  min-height: 160px;
  overflow: hidden;
  background: #fafafa;

  .preview-header {
    padding: 8px 12px;
    border-bottom: 1px solid #ebeef5;
    font-size: 13px;
    color: #606266;
  }
}

.markdown-block {
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;

  &.is-empty {
    color: #c0c4cc;
  }

  :deep(pre) {
    background: #1f2933;
    color: #f8f8f2;
    padding: 12px;
    border-radius: 6px;
    overflow: auto;
  }

  :deep(code) {
    background: rgba(27, 31, 35, 0.05);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 13px;
  }

  :deep(blockquote) {
    margin: 0;
    padding-left: 12px;
    border-left: 4px solid #dcdfe6;
    color: #606266;
  }
}

:deep(.el-drawer__body) {
  background: #f5f7fb;
  padding: 24px;
}

@media (max-width: 768px) {
  .admin-tickets-page {
    padding: 8px;
  }

  .ticket-detail {
    padding: 12px;
    border-radius: 8px;
    max-height: calc(100vh - 110px);
  }

  :deep(.el-drawer__body) {
    padding: 12px;
  }

  .detail-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .markdown-editor {
    display: flex;
    flex-direction: column;
  }
}

.reply-form {
  margin-top: 8px;
}

.reply-header {
  display: flex;
  justify-content: space-between;
  color: #909399;
  margin-bottom: 8px;

  .reply-author {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.reply-alert {
  margin-bottom: 12px;
}

.status-form {
  margin: 12px 0;

  .status-select {
    width: 160px;
  }
}

.empty-replies {
  padding: 16px 0;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-actions {
    width: 100%;
    justify-content: space-between;
  }

  .status-filter {
    flex: 1;
  }
}

.detail-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-block {
  background: #f8f9fb;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 16px;

  .block-title {
    font-weight: 600;
    margin-bottom: 8px;
  }

  .block-content {
    color: #303133;

    p {
      margin: 4px 0;
    }
  }
}
</style>
