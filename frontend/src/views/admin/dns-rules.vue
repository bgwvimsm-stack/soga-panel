<template>
  <div class="admin-page admin-dns-rules">
    <div class="page-header">
      <h2>DNS规则管理</h2>
      <p>管理节点 DNS 规则与绑定关系</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="DNS规则" @refresh="loadRules">
      <template #buttons>
        <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新增规则</el-button>
      </template>

      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid ref="vxeTableRef" v-loading="loading" show-overflow :height="getTableHeight(size)" :size="size"
          :column-config="{ resizable: true }" :row-config="{ isHover: true, keyField: 'id' }" :columns="dynamicColumns" :data="rules"
          :pager-config="pagerConfig" @page-change="handlePageChange">
          <template #name="{ row }"><span>{{ row.name }}</span></template>
          <template #rule_json="{ row }">
            <code class="json-preview">{{ formatRulePreview(row.rule_json) }}</code>
          </template>
          <template #node_ids="{ row }">
            <div class="node-tags">
              <el-tag v-for="nodeId in getNodeIds(row)" :key="nodeId" size="small" type="info">
                {{ getNodeLabel(nodeId) }}
              </el-tag>
              <span v-if="!getNodeIds(row).length">-</span>
            </div>
          </template>
          <template #status="{ row }">
            <el-tag :type="row.enabled === 1 ? 'success' : 'danger'" size="small">
              {{ row.enabled === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
          <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
          <template #updated_at="{ row }"><span>{{ formatDateTime(row.updated_at) }}</span></template>
          <template #actions="{ row }">
            <div class="table-actions">
              <el-button type="primary" size="small" @click="editItem(row)">编辑</el-button>
              <el-button :type="row.enabled === 1 ? 'warning' : 'success'" size="small" @click="toggleStatus(row)">
                {{ row.enabled === 1 ? '禁用' : '启用' }}
              </el-button>
              <el-button type="danger" size="small" @click="deleteItem(row)">删除</el-button>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <el-dialog v-model="showDialog" :title="editingItem ? '编辑DNS规则' : '新增DNS规则'" width="720px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="110px">
        <el-form-item label="规则名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入规则名称" maxlength="100" show-word-limit />
        </el-form-item>

        <el-form-item label="绑定节点" prop="node_ids">
          <el-select v-model="form.node_ids" multiple filterable collapse-tags placeholder="请选择节点">
            <el-option
              v-for="node in nodes"
              :key="node.id"
              :label="formatNodeOption(node)"
              :value="node.id"
              :disabled="isNodeDisabled(node.id)"
            />
          </el-select>
          <div class="form-hint">同一节点只能绑定一条 DNS 规则。</div>
        </el-form-item>

        <el-form-item label="规则JSON" prop="rule_json">
          <el-input
            v-model="form.rule_json"
            type="textarea"
            :rows="10"
            placeholder="请输入 DNS 规则 JSON"
          />
          <div class="form-hint">
            建议保持 JSON 格式有效，保存时会自动校验。
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
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
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
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import http from '@/api/http';

type NodeOption = {
  id: number;
  name: string;
  type?: string;
  status?: number;
};

const vxeTableRef = ref();
const loading = ref(false);
const submitting = ref(false);
const showDialog = ref(false);
const editingItem = ref<any>(null);
const rules = ref<any[]>([]);
const nodes = ref<NodeOption[]>([]);
const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns: VxeTableBarColumns = [
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'name', title: '规则名称', minWidth: 160, visible: true, slots: { default: 'name' } },
  { field: 'rule_json', title: '规则JSON', minWidth: 240, visible: true, slots: { default: 'rule_json' } },
  { field: 'node_ids', title: '绑定节点', minWidth: 220, visible: true, slots: { default: 'node_ids' } },
  { field: 'enabled', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'created_at', title: '创建时间', width: 180, visible: true, slots: { default: 'created_at' } },
  { field: 'updated_at', title: '更新时间', width: 180, visible: false, slots: { default: 'updated_at' } },
  { field: 'actions', title: '操作', width: 220, fixed: 'right', visible: true, slots: { default: 'actions' }, columnSelectable: false }
];

const formRef = ref<FormInstance>();
const form = reactive({
  name: '',
  description: '',
  rule_json: '',
  node_ids: [] as number[],
  enabled: 1
});

const validateRuleJson = (_rule: any, value: string, callback: (error?: Error) => void) => {
  if (!value || !value.trim()) return callback(new Error('请输入DNS规则JSON'));
  try {
    JSON.parse(value);
    callback();
  } catch {
    callback(new Error('JSON格式不正确'));
  }
};

const formRules = {
  name: [{ required: true, message: '请输入规则名称', trigger: 'blur' }],
  node_ids: [{ type: 'array', required: true, message: '请选择绑定节点', trigger: 'change' }],
  rule_json: [{ validator: validateRuleJson, trigger: 'blur' }]
};

const nodeMap = computed(() => {
  const map = new Map<number, string>();
  for (const node of nodes.value) {
    map.set(node.id, node.name);
  }
  return map;
});

const occupiedNodeMap = computed(() => {
  const map = new Map<number, number>();
  for (const rule of rules.value) {
    const ids = normalizeNodeIds(rule.node_ids);
    for (const nodeId of ids) {
      map.set(nodeId, rule.id);
    }
  }
  return map;
});

const isNodeDisabled = (nodeId: number) => {
  const boundRuleId = occupiedNodeMap.value.get(nodeId);
  if (!boundRuleId) return false;
  if (editingItem.value && boundRuleId === editingItem.value.id) return false;
  return true;
};

const formatNodeOption = (node: NodeOption) => {
  const suffix = node.type ? `(${node.type})` : '';
  return `${node.name} #${node.id} ${suffix}`.trim();
};

const getNodeLabel = (nodeId: number) => {
  return nodeMap.value.get(nodeId) || `节点#${nodeId}`;
};

const normalizeNodeIds = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
      }
    } catch {
      return trimmed
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isFinite(id) && id > 0);
    }
  }
  return [];
};

const normalizeRuleJson = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getNodeIds = (row: any) => {
  return normalizeNodeIds(row.node_ids);
};

const formatRulePreview = (value: unknown) => {
  const raw = normalizeRuleJson(value).replace(/\s+/g, ' ').trim();
  if (!raw) return '-';
  return raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  try { return new Date(dateStr).toLocaleString('zh-CN'); } catch { return '-'; }
};

const loadNodes = async () => {
  try {
    const response: any = await http.get('/admin/nodes', { params: { page: 1, limit: 2000 } });
    const payload: any = response?.data ?? response ?? {};
    const list = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.records)
        ? payload.records
        : Array.isArray(payload.nodes)
          ? payload.nodes
          : [];
    nodes.value = list;
  } catch {
    nodes.value = [];
  }
};

const loadRules = async () => {
  loading.value = true;
  try {
    const response: any = await http.get('/admin/dns-rules', { params: { page: pagerConfig.currentPage, limit: pagerConfig.pageSize } });
    const payload: any = response?.data ?? response ?? {};
    const list = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.rules)
        ? payload.rules
        : Array.isArray(payload.records)
          ? payload.records
          : [];
    rules.value = list.map((item: any) => ({
      ...item,
      enabled: item.enabled ?? item.status ?? 1,
      node_ids: normalizeNodeIds(item.node_ids),
      rule_json: normalizeRuleJson(item.rule_json)
    }));
    pagerConfig.total = payload.total ?? payload.pagination?.total ?? list.length;
  } catch (error) {
    ElMessage.error('加载DNS规则失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadRules();
};

const openCreate = () => {
  showDialog.value = true;
};

const editItem = (item: any) => {
  editingItem.value = item;
  form.name = item.name || '';
  form.description = item.description || '';
  form.rule_json = normalizeRuleJson(item.rule_json);
  form.node_ids = normalizeNodeIds(item.node_ids);
  form.enabled = item.enabled ?? 1;
  showDialog.value = true;
};

const toggleStatus = async (item: any) => {
  try {
    const newStatus = item.enabled === 1 ? 0 : 1;
    const action = newStatus === 1 ? '启用' : '禁用';
    await ElMessageBox.confirm(`确定要${action}吗？`, '确认操作', { type: 'warning' });
    const ruleJsonText = normalizeRuleJson(item.rule_json).trim();
    if (!ruleJsonText) {
      ElMessage.error('DNS规则JSON无效');
      return;
    }
    try {
      JSON.parse(ruleJsonText);
    } catch {
      ElMessage.error('DNS规则JSON无效');
      return;
    }
    await http.put(`/admin/dns-rules/${item.id}`, {
      name: item.name,
      description: item.description,
      rule_json: ruleJsonText,
      node_ids: normalizeNodeIds(item.node_ids),
      enabled: newStatus
    });
    item.enabled = newStatus;
    ElMessage.success(`${action}成功`);
  } catch (error) {
    if (error !== 'cancel') ElMessage.error('操作失败');
  }
};

const deleteItem = async (item: any) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '确认删除', { type: 'warning' });
    await http.delete(`/admin/dns-rules/${item.id}`);
    await loadRules();
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
    const parsed = JSON.parse(form.rule_json.trim());
    const normalizedRuleJson = JSON.stringify(parsed, null, 2);
    const nodeIds = form.node_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
    const payload = {
      name: form.name,
      description: form.description,
      rule_json: normalizedRuleJson,
      node_ids: nodeIds,
      enabled: form.enabled
    };

    if (editingItem.value) {
      await http.put(`/admin/dns-rules/${editingItem.value.id}`, payload);
      ElMessage.success('更新成功');
    } else {
      await http.post('/admin/dns-rules', payload);
      ElMessage.success('创建成功');
    }
    form.rule_json = normalizedRuleJson;
    showDialog.value = false;
    resetForm();
    await loadRules();
  } catch (error) {
    ElMessage.error('保存失败');
  } finally {
    submitting.value = false;
  }
};

const resetForm = () => {
  editingItem.value = null;
  form.name = '';
  form.description = '';
  form.rule_json = '';
  form.node_ids = [];
  form.enabled = 1;
  formRef.value?.clearValidate();
};

onMounted(() => {
  loadNodes();
  loadRules();
});
</script>

<style scoped lang="scss">
.admin-dns-rules {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .table-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .json-preview { font-size: 12px; color: #606266; background: #f5f7fa; padding: 2px 6px; border-radius: 3px; }
  .node-tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .form-hint {
    margin-top: 6px;
    font-size: 12px;
    color: #909399;
  }
}
</style>
