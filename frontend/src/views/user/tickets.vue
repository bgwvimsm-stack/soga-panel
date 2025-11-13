<template>
  <div class="tickets-page">
    <div class="page-header">
      <div>
        <h1>🧾 工单中心</h1>
        <p class="subtitle">有问题请随时提交工单，管理员会以 Markdown 形式回复。</p>
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
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><ChatLineRound /></el-icon>
          新建工单
        </el-button>
      </div>
    </div>

    <VxeTableBar
      class="tickets-table-bar"
      :vxeTableRef="vxeTableRef"
      title="我的工单列表"
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
          :data="tickets"
          :columns="dynamicColumns"
          :column-config="{ resizable: true }"
          :row-config="{ isHover: true, keyField: 'id' }"
          :pager-config="pagerConfig"
          :size="size"
          @page-change="handlePageChange"
        >
          <template #title="{ row }">
            <div class="ticket-title" @click="openTicketDetail(row)">
              <span>{{ row.title }}</span>
              <el-icon><ArrowRight /></el-icon>
            </div>
          </template>
          <template #status="{ row }">
            <el-tag :type="statusMeta[row.status]?.type || 'info'">
              {{ statusMeta[row.status]?.label || row.status }}
            </el-tag>
          </template>
          <template #lastReply="{ row }">
            {{ formatDate(row.last_reply_at || row.updated_at) }}
          </template>
          <template #createdAt="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 工单详情 -->
    <el-drawer
      v-model="detailVisible"
      title="工单详情"
      size="600px"
      :destroy-on-close="true"
    >
      <div v-if="detailLoading" class="drawer-loading">
        <el-skeleton :rows="6" animated />
      </div>
      <div v-else-if="activeTicket" class="ticket-detail">
        <div class="detail-header">
          <h3>{{ activeTicket.title }}</h3>
          <el-tag :type="statusMeta[activeTicket.status]?.type || 'info'">
            {{ statusMeta[activeTicket.status]?.label || activeTicket.status }}
          </el-tag>
        </div>
        <p class="detail-meta">
          创建于 {{ formatDate(activeTicket.created_at) }} · 最近更新 {{ formatDate(activeTicket.updated_at) }}
        </p>
        <div class="markdown-block" v-html="detailContentHtml"></div>

        <el-divider content-position="left">沟通记录</el-divider>
        <div v-if="ticketReplies.length === 0" class="empty-replies">
          <el-empty description="还没有回复，请耐心等待管理员处理" :image-size="100" />
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

        <el-divider content-position="left">继续沟通</el-divider>
        <el-alert
          v-if="!canUserReply"
          type="info"
          :closable="false"
          show-icon
          title="工单已关闭，如需再次沟通请重新创建工单"
          class="reply-alert"
        />
        <div v-else class="user-reply-section">
          <el-form :model="userReplyForm" label-width="0">
            <el-form-item>
              <div class="markdown-editor">
                <el-input
                  v-model="userReplyForm.content"
                  type="textarea"
                  :rows="6"
                  maxlength="8000"
                  show-word-limit
                  placeholder="补充更多信息，支持 Markdown 语法"
                />
                <div class="markdown-preview">
                  <div class="preview-header">实时预览</div>
                  <div
                    class="markdown-block"
                    :class="{ 'is-empty': !userReplyForm.content }"
                    v-html="userReplyPreviewHtml"
                  ></div>
                </div>
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="userReplyLoading" @click="submitUserReply">
                发送
              </el-button>
              <el-button @click="userReplyForm.content = ''">清空</el-button>
            </el-form-item>
          </el-form>
        </div>
      </div>
      <div v-else class="drawer-loading">
        <el-empty description="未选择工单" />
      </div>
    </el-drawer>

    <!-- 新建工单 -->
    <el-dialog
      v-model="createDialogVisible"
      title="提交工单"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form :model="createForm" label-width="80px" :disabled="createLoading">
        <el-form-item label="标题" required>
          <el-input
            v-model="createForm.title"
            maxlength="120"
            show-word-limit
            placeholder="请简要描述问题"
          />
        </el-form-item>
        <el-form-item label="内容" required>
          <div class="markdown-editor">
            <el-input
              v-model="createForm.content"
              type="textarea"
              :rows="10"
              maxlength="8000"
              show-word-limit
              placeholder="描述详细问题，支持 Markdown 语法"
            />
            <div class="markdown-preview">
              <div class="preview-header">实时预览</div>
              <div
                class="markdown-block"
                :class="{ 'is-empty': !createForm.content }"
                v-html="createPreviewHtml"
              ></div>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="createDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="createLoading" @click="submitTicket">
            提交
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { ChatLineRound, ArrowRight } from "@element-plus/icons-vue";
import dayjs from "dayjs";
import type { TicketDetail, TicketReply, TicketStatus, TicketSummary } from "@/api/types";
import {
  createUserTicket,
  fetchUserTicketDetail,
  fetchUserTickets,
  replyUserTicket,
} from "@/api/ticket";
import { renderMarkdown } from "@/utils/markdown";
import { useUserStore } from "@/store/user";
import { VxeTableBar } from "@/components/ReVxeTableBar";

const tickets = ref<TicketSummary[]>([]);
const ticketReplies = ref<TicketReply[]>([]);
const loading = ref(false);
const detailLoading = ref(false);
const createLoading = ref(false);
const userReplyLoading = ref(false);
const detailVisible = ref(false);
const createDialogVisible = ref(false);
const activeTicket = ref<TicketDetail | null>(null);
const vxeTableRef = ref();
const filters = reactive<{ status: TicketStatus | "" }>({
  status: "",
});
const userStore = useUserStore();

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
      return 460;
    case "medium":
    default:
      return 520;
  }
});

const columns = [
  { field: "id", title: "ID", width: 80, align: "center", visible: true },
  { field: "title", title: "标题", minWidth: 220, visible: true, slots: { default: "title" } },
  { field: "status", title: "状态", width: 120, align: "center", visible: true, slots: { default: "status" } },
  { field: "last_reply_at", title: "最新回复", width: 200, align: "center", visible: true, slots: { default: "lastReply" } },
  { field: "created_at", title: "创建时间", width: 200, align: "center", visible: true, slots: { default: "createdAt" } }
];

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

const createForm = reactive({
  title: "",
  content: "",
});
const userReplyForm = reactive({
  content: "",
});

const createPreviewHtml = computed(() => renderMarkdown(createForm.content));
const detailContentHtml = computed(() => renderMarkdown(activeTicket.value?.content));
const userReplyPreviewHtml = computed(() => renderMarkdown(userReplyForm.content));
const canUserReply = computed(() => (activeTicket.value?.status || "") !== "closed");

const loadTickets = async () => {
  loading.value = true;
  try {
    const { data } = await fetchUserTickets({
      page: pagerConfig.currentPage,
      pageSize: pagerConfig.pageSize,
      status: filters.status || undefined,
    });
    tickets.value = data.items;
    pagerConfig.total = data.pagination.total;
    pagerConfig.currentPage = data.pagination.page;
    pagerConfig.pageSize = data.pagination.pageSize;
  } catch (error: any) {
    ElMessage.error(error?.message || "加载工单失败");
  } finally {
    loading.value = false;
  }
};

const openTicketDetail = async (ticket: TicketSummary) => {
  detailVisible.value = true;
  detailLoading.value = true;
  activeTicket.value = null;
  ticketReplies.value = [];
  userReplyForm.content = "";

  try {
    const { data } = await fetchUserTicketDetail(ticket.id);
    activeTicket.value = data.ticket;
    ticketReplies.value = data.replies;
  } catch (error: any) {
    ElMessage.error(error?.message || "加载工单详情失败");
    detailVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
};

const handleFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadTickets();
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadTickets();
};

const openCreateDialog = () => {
  createForm.title = "";
  createForm.content = "";
  createDialogVisible.value = true;
};

const submitTicket = async () => {
  if (!createForm.title.trim()) {
    ElMessage.warning("请填写工单标题");
    return;
  }
  if (!createForm.content.trim()) {
    ElMessage.warning("请填写工单内容");
    return;
  }
  createLoading.value = true;
  try {
    await createUserTicket({
      title: createForm.title,
      content: createForm.content,
    });
    ElMessage.success("工单提交成功");
    createDialogVisible.value = false;
    loadTickets();
  } catch (error: any) {
    ElMessage.error(error?.message || "提交失败");
  } finally {
    createLoading.value = false;
  }
};

const submitUserReply = async () => {
  if (!activeTicket.value) {
    return;
  }
  if (!userReplyForm.content.trim()) {
    ElMessage.warning("请输入回复内容");
    return;
  }
  userReplyLoading.value = true;
  try {
    const { data } = await replyUserTicket(activeTicket.value.id, {
      content: userReplyForm.content,
    });
    ticketReplies.value = data.replies;
    activeTicket.value.status = data.status;
    userReplyForm.content = "";
    ElMessage.success("回复已发送");
    loadTickets();
  } catch (error: any) {
    ElMessage.error(error?.message || "回复失败");
  } finally {
    userReplyLoading.value = false;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return "暂无";
  return dayjs(value).format("YYYY-MM-DD HH:mm");
};

const formatReplyAuthor = (reply: TicketReply) => {
  if (reply.author.role === "admin") {
    return reply.author.username || reply.author.email || "管理员";
  }
  if (reply.author.id === userStore.user?.id) {
    return "我";
  }
  return reply.author.username || reply.author.email || "用户";
};

onMounted(() => {
  loadTickets();
});
</script>

<style scoped lang="scss">
.tickets-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;

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
  margin-top: 12px;

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
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    h3 {
      margin: 0;
    }
  }

  .detail-meta {
    color: #909399;
    margin-bottom: 12px;
  }
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
  min-height: 180px;
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

.user-reply-section {
  margin-bottom: 12px;
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
</style>
