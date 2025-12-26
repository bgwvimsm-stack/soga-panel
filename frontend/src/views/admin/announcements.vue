<template>
  <div class="admin-page announcements-page">
    <div class="page-header">
      <h2>公告管理</h2>
      <p>管理系统公告和通知</p>
    </div>

    <!-- VxeTable 表格 -->
    <VxeTableBar
      :vxeTableRef="vxeTableRef"
      :columns="columns"
      title="公告列表"
      @refresh="loadAnnouncements"
    >
      <template #buttons>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          新增公告
        </el-button>
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
          :data="announcements"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <!-- 内容预览 -->
          <template #content="{ row }">
            <div class="content-preview">
              {{ row.content.length > 100 ? row.content.substring(0, 100) + '...' : row.content }}
            </div>
          </template>

          <!-- 类型 -->
          <template #type="{ row }">
            <el-tag :type="getTypeColor(row.type)">{{ getTypeName(row.type) }}</el-tag>
          </template>

          <!-- 置顶 -->
          <template #is_pinned="{ row }">
            <el-tag v-if="row.is_pinned" type="warning" size="small">置顶</el-tag>
            <span v-else>-</span>
          </template>

          <!-- 状态 -->
          <template #status="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>

          <!-- 创建时间 -->
          <template #created_at="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>

          <!-- 操作 -->
          <template #actions="{ row }">
            <div class="table-actions">
              <el-button type="primary" size="small" @click="editAnnouncement(row)">
                编辑
              </el-button>
              <el-button
                :type="row.status === 1 ? 'warning' : 'success'"
                size="small"
                @click="toggleStatus(row)"
              >
                {{ row.status === 1 ? '禁用' : '启用' }}
              </el-button>
              <el-button type="danger" size="small" @click="deleteAnnouncementHandler(row)">
                删除
              </el-button>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 创建/编辑公告对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingAnnouncement ? '编辑公告' : '新增公告'"
      width="800px"
      @close="resetForm"
    >
      <el-form
        ref="announcementFormRef"
        :model="announcementForm"
        :rules="announcementRules"
        label-width="100px"
      >
        <el-form-item label="公告标题" prop="title">
          <el-input
            v-model="announcementForm.title"
            placeholder="请输入公告标题"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="公告类型" prop="type">
          <el-select v-model="announcementForm.type" placeholder="请选择公告类型">
            <el-option label="通知" value="notice" />
            <el-option label="警告" value="warning" />
            <el-option label="重要" value="important" />
            <el-option label="维护" value="maintenance" />
          </el-select>
        </el-form-item>

        <el-form-item label="公告内容" prop="content">
          <el-input
            v-model="announcementForm.content"
            type="textarea"
            :rows="8"
            placeholder="请输入公告内容，支持HTML"
            maxlength="2000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="是否置顶" prop="is_pinned">
          <el-switch
            v-model="announcementForm.is_pinned"
            active-text="置顶"
            inactive-text="普通"
          />
        </el-form-item>

        <el-form-item label="优先级" prop="priority">
          <el-input-number
            v-model="announcementForm.priority"
            :min="0"
            :max="999"
            placeholder="数字越大优先级越高"
          />
          <div style="font-size: 12px; color: #909399; margin-top: 4px;">
            数字越大优先级越高，0为默认优先级
          </div>
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="announcementForm.status"
            :active-value="1"
            :inactive-value="0"
            active-text="启用"
            inactive-text="禁用"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveAnnouncement" :loading="submitting">
          {{ editingAnnouncement ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { VxeTableBar } from '@/components/ReVxeTableBar';
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  type Announcement
} from "@/api/admin";

const vxeTableRef = ref();
const loading = ref(false);
const submitting = ref(false);
const showCreateDialog = ref(false);
const editingAnnouncement = ref<any>(null);
const announcements = ref<Announcement[]>([]);

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
  { field: 'title', title: '标题', minWidth: 200, visible: true },
  { field: 'content', title: '内容', minWidth: 300, visible: true, slots: { default: 'content' } },
  { field: 'type', title: '类型', width: 100, visible: true, slots: { default: 'type' } },
  { field: 'is_pinned', title: '置顶', width: 80, visible: true, slots: { default: 'is_pinned' } },
  { field: 'priority', title: '优先级', width: 80, visible: true },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'created_at', title: '创建时间', width: 180, visible: true, slots: { default: 'created_at' } },
  { field: 'actions', title: '操作', width: 250, fixed: 'right', visible: true, slots: { default: 'actions' } }
];

// 表单引用
const announcementFormRef = ref<FormInstance>();

// 公告表单
const announcementForm = reactive({
  title: '',
  content: '',
  type: 'notice',
  status: 1,
  is_pinned: false,
  priority: 0
});

// 表单验证规则
const announcementRules = {
  title: [
    { required: true, message: '请输入公告标题', trigger: 'blur' },
    { min: 5, max: 100, message: '标题长度应在5-100个字符', trigger: 'blur' }
  ],
  content: [
    { required: true, message: '请输入公告内容', trigger: 'blur' },
    { min: 10, max: 2000, message: '内容长度应在10-2000个字符', trigger: 'blur' }
  ],
  type: [
    { required: true, message: '请选择公告类型', trigger: 'change' }
  ]
};

// 获取公告类型名称
const getTypeName = (type: string) => {
  const typeMap: Record<string, string> = {
    notice: '通知',
    warning: '警告',
    important: '重要',
    maintenance: '维护'
  };
  return typeMap[type] || '未知';
};

// 获取公告类型颜色
const getTypeColor = (type: string) => {
  const colorMap: Record<string, string> = {
    notice: 'primary',
    warning: 'warning',
    important: 'danger',
    maintenance: 'info'
  };
  return colorMap[type] || 'primary';
};

// 格式化日期时间
const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  } catch {
    return '--';
  }
};

// 加载公告列表
const loadAnnouncements = async () => {
  loading.value = true;
  try {
    const { data } = await getAnnouncements({
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    });

    announcements.value = data?.data ?? (data as any)?.records ?? [];
    pagerConfig.total = data?.total ?? (data as any)?.pagination?.total ?? 0;
  } catch (error) {
    console.error('加载公告失败:', error);
    ElMessage.error('加载公告列表失败');
  } finally {
    loading.value = false;
  }
};

// 分页变化处理
const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadAnnouncements();
};

// 编辑公告
const editAnnouncement = (announcement: any) => {
  editingAnnouncement.value = announcement;
  announcementForm.title = announcement.title;
  announcementForm.content = announcement.content;
  announcementForm.type = announcement.type;
  announcementForm.status = announcement.status;
  announcementForm.is_pinned = Boolean(announcement.is_pinned);
  announcementForm.priority = Number(announcement.priority) || 0;
  showCreateDialog.value = true;
};

// 切换状态
const toggleStatus = async (announcement: Announcement) => {
  try {
    const newStatus = announcement.status === 1 ? 0 : 1;
    const action = newStatus === 1 ? '启用' : '禁用';

    await ElMessageBox.confirm(
      `确定要${action}公告"${announcement.title}"吗？`,
      '确认操作',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    await updateAnnouncement(announcement.id, {
      ...announcement,
      status: newStatus
    });

    announcement.status = newStatus;
    ElMessage.success(`${action}成功`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('切换状态失败:', error);
      ElMessage.error('操作失败，请重试');
    }
  }
};

// 删除公告
const deleteAnnouncementHandler = async (announcement: Announcement) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除公告"${announcement.title}"吗？此操作不可撤销。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    await deleteAnnouncement(announcement.id);
    await loadAnnouncements();
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除公告失败:', error);
      ElMessage.error('删除失败，请重试');
    }
  }
};

// 保存公告
const saveAnnouncement = async () => {
  if (!announcementFormRef.value) return;

  try {
    await announcementFormRef.value.validate();
    submitting.value = true;

    const formData = {
      title: announcementForm.title,
      content: announcementForm.content,
      type: announcementForm.type,
      status: announcementForm.status,
      is_pinned: announcementForm.is_pinned,
      priority: announcementForm.priority
    };

    if (editingAnnouncement.value) {
      await updateAnnouncement(editingAnnouncement.value.id, formData);
      ElMessage.success('公告更新成功');
    } else {
      await createAnnouncement(formData);
      ElMessage.success('公告创建成功');
    }

    showCreateDialog.value = false;
    resetForm();
    await loadAnnouncements();
  } catch (error) {
    console.error('保存公告失败:', error);
    ElMessage.error('保存失败，请重试');
  } finally {
    submitting.value = false;
  }
};

// 重置表单
const resetForm = () => {
  editingAnnouncement.value = null;
  announcementForm.title = '';
  announcementForm.content = '';
  announcementForm.type = 'notice';
  announcementForm.status = 1;
  announcementForm.is_pinned = false;
  announcementForm.priority = 0;
  announcementFormRef.value?.clearValidate();
};

// 初始化
onMounted(() => {
  loadAnnouncements();
});
</script>

<style scoped lang="scss">
.announcements-page {
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

  .table-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .content-preview {
    max-width: 300px;
    word-break: break-all;
    line-height: 1.4;
  }
}
</style>
