<template>
  <div class="admin-page admin-whitelist">
    <div class="page-header">
      <h2>白名单管理</h2>
      <p>管理IP白名单规则</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="白名单" @refresh="loadWhitelist">
      <template #buttons>
        <el-button type="primary" @click="showDialog = true"><el-icon><Plus /></el-icon>新增白名单</el-button>
      </template>

      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid ref="vxeTableRef" v-loading="loading" show-overflow :height="getTableHeight(size)" :size="size"
          :column-config="{ resizable: true }" :row-config="{ isHover: true, keyField: 'id' }" :columns="dynamicColumns" :data="whitelist"
          :pager-config="pagerConfig" @page-change="handlePageChange">
          <template #rule="{ row }"><code class="pattern-text">{{ row.rule }}</code></template>
          <template #description="{ row }"><span>{{ row.description || '-' }}</span></template>
          <template #status="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '启用' : '禁用' }}</el-tag>
          </template>
          <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
          <template #actions="{ row }">
            <div class="table-actions">
              <el-button type="primary" size="small" @click="editItem(row)">编辑</el-button>
              <el-button :type="row.status === 1 ? 'warning' : 'success'" size="small" @click="toggleStatus(row)">
                {{ row.status === 1 ? '禁用' : '启用' }}
              </el-button>
              <el-button type="danger" size="small" @click="deleteItem(row)">删除</el-button>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <el-dialog v-model="showDialog" :title="editingItem ? '编辑白名单' : '新增白名单'" width="640px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="规则内容" prop="rule">
          <el-input
            v-model="form.rule"
            type="textarea"
            :rows="4"
            placeholder="请输入白名单规则，支持多行输入"
          />
          <div class="form-hint">
            支持域名、IP、IP段、端口等格式，例如：<br />
            <code>domain:google.com</code>google.com 及 google.com 的任何子域名<br />
            <code>regexp:\\.goo.*\\.com$</code>正则表达式<br />
            <code>geosite:google</code>预定义域名列表<br />
            <code>geoip:cn</code>geoip<br />
            <code>port:1-1024,12345,23456</code>端口和端口段
          </div>
        </el-form-item>
        <el-form-item label="规则描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入规则描述（可选）"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="saveItem" :loading="submitting">{{ editingItem ? '更新' : '创建' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';

const vxeTableRef = ref();
const loading = ref(false);
const submitting = ref(false);
const showDialog = ref(false);
const editingItem = ref<any>(null);
const whitelist = ref([]);
const pagerConfig = reactive({ total: 0, currentPage: 1, pageSize: 20, pageSizes: [10, 20, 50, 100], layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump'] });

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns = [
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'rule', title: '规则内容', minWidth: 220, visible: true, slots: { default: 'rule' } },
  { field: 'description', title: '规则描述', minWidth: 200, visible: true, slots: { default: 'description' } },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'created_at', title: '创建时间', width: 180, visible: true, slots: { default: 'created_at' } },
  { field: 'actions', title: '操作', width: 220, fixed: 'right', visible: true, slots: { default: 'actions' }, columnSelectable: false }
];

const formRef = ref<FormInstance>();
const form = reactive({ rule: '', description: '', status: 1 });
const rules = {
  rule: [{ required: true, message: '请输入规则内容', trigger: 'blur' }]
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  try { return new Date(dateStr).toLocaleString('zh-CN'); } catch { return '-'; }
};

const loadWhitelist = async () => {
  loading.value = true;
  try {
    const response: any = await http.get('/admin/whitelist', { params: { page: pagerConfig.currentPage, limit: pagerConfig.pageSize } });
    const payload: any = response?.data ?? response ?? {};
    const list = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.list)
        ? payload.list
        : Array.isArray(payload.records)
          ? payload.records
          : [];

    whitelist.value = list;
    pagerConfig.total = payload.total ?? payload.pagination?.total ?? list.length;
  } catch (error) {
    ElMessage.error('加载白名单失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadWhitelist();
};

const editItem = (item: any) => {
  editingItem.value = item;
  form.rule = item.rule;
  form.description = item.description;
  form.status = item.status;
  showDialog.value = true;
};

const toggleStatus = async (item: any) => {
  try {
    const action = item.status === 1 ? '禁用' : '启用';
    await ElMessageBox.confirm(`确定要${action}吗？`, '确认操作', { type: 'warning' });
    const newStatus = item.status === 1 ? 0 : 1;
    await http.put(`/admin/whitelist/${item.id}`, {
      rule: item.rule,
      description: item.description,
      status: newStatus
    });
    item.status = newStatus;
    ElMessage.success(`${action}成功`);
  } catch (error) {
    if (error !== 'cancel') ElMessage.error('操作失败');
  }
};

const deleteItem = async (item: any) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '确认删除', { type: 'warning' });
    await http.delete(`/admin/whitelist/${item.id}`);
    await loadWhitelist();
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

const saveItem = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
    submitting.value = true;
    if (editingItem.value) {
      await http.put(`/admin/whitelist/${editingItem.value.id}`, form);
      ElMessage.success('更新成功');
    } else {
      await http.post('/admin/whitelist', form);
      ElMessage.success('创建成功');
    }
    showDialog.value = false;
    resetForm();
    await loadWhitelist();
  } catch (error) {
    ElMessage.error('保存失败');
  } finally {
    submitting.value = false;
  }
};

const resetForm = () => {
  editingItem.value = null;
  form.rule = '';
  form.description = '';
  form.status = 1;
  formRef.value?.clearValidate();
};

onMounted(() => loadWhitelist());
</script>

<style scoped lang="scss">
.admin-whitelist {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .table-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .pattern-text { font-size: 12px; color: #606266; background: #f5f7fa; padding: 2px 6px; border-radius: 3px; }
  .form-hint {
    margin-top: 6px;
    font-size: 12px;
    color: #909399;
    line-height: 1.6;
    code {
      background: #f5f7fa;
      padding: 0 4px;
      border-radius: 2px;
    }
  }
}
</style>
