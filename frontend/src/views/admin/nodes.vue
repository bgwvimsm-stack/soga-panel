<template>
  <div class="admin-page admin-nodes">
    <div class="page-header">
      <h2>节点管理</h2>
      <p>管理系统节点配置和状态监控</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="节点列表" @refresh="loadNodes">
      <template #buttons>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>新增节点
        </el-button>
        <el-button type="success" @click="batchOnlineNodes" :disabled="selectedNodes.length === 0">
          <el-icon><CircleCheck /></el-icon>批量启用({{ selectedNodes.length }})
        </el-button>
        <el-button type="warning" @click="batchOfflineNodes" :disabled="selectedNodes.length === 0">
          <el-icon><CircleClose /></el-icon>批量禁用({{ selectedNodes.length }})
        </el-button>
        <el-input
          v-model="searchKeyword"
          placeholder="搜索节点名称或地址"
          clearable
          @keyup.enter="handleSearch"
          @change="handleSearch"
          @clear="handleSearch"
          style="width: 200px; margin-left: 12px;"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="statusFilter" placeholder="节点状态" clearable @change="handleStatusFilterChange" style="width: 120px; margin-left: 12px;">
          <el-option label="启用" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
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
          :data="nodes"
          :pager-config="pagerConfig"
          :checkbox-config="{ reserve: true }"
          @checkbox-change="handleSelectionChange"
          @checkbox-all="handleSelectionChange"
          @page-change="handlePageChange"
        >
          <template #name="{ row }"><span>{{ row.name }}</span></template>
          <template #type="{ row }">
            <el-tag :type="getNodeTypeColor(row.type)" size="small">{{ getNodeTypeName(row.type) }}</el-tag>
          </template>
          <template #server="{ row }"><span>{{ row.server }}</span></template>
          <template #server_port="{ row }"><span>{{ row.server_port }}</span></template>
          <template #node_class="{ row }">
            <el-tag size="small">{{ row.node_class }}</el-tag>
          </template>
          <template #traffic_multiplier="{ row }">
            <el-tag size="small" type="info">
              x{{ Number(row.traffic_multiplier || 1).toFixed(2) }}
            </el-tag>
          </template>
          <template #bandwidth_limit="{ row }">
            <span v-if="row.node_bandwidth_limit > 0">{{ formatTraffic(row.node_bandwidth_limit) }}</span>
            <span v-else>无限制</span>
          </template>
          <template #traffic_used="{ row }">
            <span>{{ formatTraffic(row.node_bandwidth || 0) }}</span>
          </template>
          <template #status="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
          <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
          <template #actions="{ row }">
            <div class="table-actions">
              <el-dropdown
                trigger="click"
                @command="(command) => handleRowCommand(command, row)"
              >
                <el-button size="small" plain>
                  更多
                  <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <el-icon><EditPen /></el-icon>
                      编辑节点
                    </el-dropdown-item>
                    <el-dropdown-item command="toggle">
                      <el-icon><SwitchButton /></el-icon>
                      {{ row.status === 1 ? '禁用节点' : '启用节点' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="copy">
                      <el-icon><CopyDocument /></el-icon>
                      复制节点
                    </el-dropdown-item>
                    <el-dropdown-item command="details">
                      <el-icon><View /></el-icon>
                      查看详情
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      <el-icon><Delete /></el-icon>
                      删除节点
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 创建/编辑节点对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingNode ? '编辑节点' : '新增节点'" width="700px" @close="resetForm">
      <el-form ref="nodeFormRef" :model="nodeForm" :rules="nodeRules" label-width="110px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="节点名称" prop="name">
              <el-input v-model="nodeForm.name" placeholder="请输入节点名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="节点类型" prop="type">
              <el-select v-model="nodeForm.type" placeholder="请选择节点类型">
                <el-option label="Shadowsocks" value="ss" />
                <el-option label="ShadowsocksR" value="ssr" />
                <el-option label="V2Ray" value="v2ray" />
                <el-option label="VLess" value="vless" />
                <el-option label="Trojan" value="trojan" />
                <el-option label="Hysteria" value="hysteria" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="节点地址" prop="server">
              <el-input v-model="nodeForm.server" placeholder="请输入节点地址" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="端口" prop="server_port">
              <el-input-number v-model="nodeForm.server_port" :min="1" :max="65535" style="width: 100%" placeholder="请输入端口号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="TLS主机名">
          <el-input v-model="nodeForm.tls_host" placeholder="SNI/ServerName (可选)" />
          <small>用于部分协议的servername或sni参数</small>
        </el-form-item>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="节点等级" prop="node_class">
              <el-input-number
                v-model="nodeForm.node_class"
                :min="0"
                :max="10"
                :step="1"
                style="width: 100%"
                placeholder="请输入节点等级"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="流量限制 (GB)">
              <el-input-number v-model="nodeForm.node_bandwidth_limit_gb" :min="0" placeholder="0表示无限制" style="width: 100%" />
              <small>每月流量限制，单位: GB，0表示无限制</small>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="扣费倍率" prop="traffic_multiplier">
              <el-input-number
                v-model="nodeForm.traffic_multiplier"
                :min="0.1"
                :step="0.1"
                :precision="2"
                style="width: 100%"
              />
              <small>节点流量扣费倍率，1表示不加成，可输入小数</small>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="流量重置日期">
              <el-input-number v-model="nodeForm.bandwidthlimit_resetday" :min="1" :max="31" placeholder="每月重置日期" style="width: 100%" />
              <small>每月几号重置流量，1-31</small>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="节点配置">
          <el-input v-model="nodeForm.node_config" type="textarea" :rows="6" placeholder="请输入JSON格式的节点配置" />
          <small>节点的具体配置参数，JSON格式</small>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveNode" :loading="submitting">{{ editingNode ? '更新' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- 节点详情对话框 -->
    <el-dialog v-model="showDetailsDialog" title="节点详情" width="600px">
      <div v-if="selectedNode" class="node-details">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="节点ID">{{ selectedNode.id }}</el-descriptions-item>
          <el-descriptions-item label="节点名称">{{ selectedNode.name }}</el-descriptions-item>
          <el-descriptions-item label="节点类型">{{ selectedNode.type }}</el-descriptions-item>
          <el-descriptions-item label="节点地址">{{ selectedNode.server }}:{{ selectedNode.server_port }}</el-descriptions-item>
          <el-descriptions-item label="节点等级">等级{{ selectedNode.node_class }}</el-descriptions-item>
          <el-descriptions-item label="扣费倍率">
            x{{ Number(selectedNode.traffic_multiplier || 1).toFixed(2) }}
          </el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="selectedNode.status === 1 ? 'success' : 'danger'">{{ selectedNode.status === 1 ? '启用' : '禁用' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="已用流量">{{ formatTraffic(selectedNode.node_bandwidth || 0) }}</el-descriptions-item>
          <el-descriptions-item label="流量限制">
            {{ selectedNode.node_bandwidth_limit > 0 ? formatTraffic(selectedNode.node_bandwidth_limit) : '无限制' }}
          </el-descriptions-item>
          <el-descriptions-item label="重置日期">
            {{ selectedNode.bandwidthlimit_resetday ? `每月${selectedNode.bandwidthlimit_resetday}号` : '未设置' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDateTime(selectedNode.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatDateTime(selectedNode.updated_at) }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="selectedNode.node_config" style="margin-top: 20px;">
          <h4>节点配置</h4>
          <el-input :model-value="formatNodeConfig(selectedNode.node_config)" type="textarea" :rows="8" readonly />
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { Plus, Search, CircleCheck, CircleClose, EditPen, SwitchButton, ArrowDown, CopyDocument, View, Delete } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getNodes, createNode, updateNode, deleteNode as deleteNodeAPI, batchUpdateNodes, type Node } from '@/api/admin';

const vxeTableRef = ref();
const loading = ref(false);
const submitting = ref(false);
const showCreateDialog = ref(false);
const showDetailsDialog = ref(false);
const editingNode = ref<Node | null>(null);
const selectedNode = ref<Node | null>(null);
const nodes = ref<Node[]>([]);
const selectedNodes = ref<Node[]>([]);
const pagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const searchKeyword = ref('');
const statusFilter = ref<number | null>(null);

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns = [
  { type: 'checkbox', width: 60, fixed: 'left', visible: true },
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'name', title: '节点名称', minWidth: 150, visible: true, slots: { default: 'name' } },
  { field: 'type', title: '类型', width: 130, visible: true, slots: { default: 'type' } },
  { field: 'server', title: '地址', minWidth: 180, visible: true, slots: { default: 'server' } },
  { field: 'server_port', title: '端口', width: 100, visible: true, slots: { default: 'server_port' } },
  { field: 'node_class', title: '等级', width: 100, visible: true, slots: { default: 'node_class' } },
  { field: 'traffic_multiplier', title: '倍率', width: 100, visible: true, slots: { default: 'traffic_multiplier' } },
  { field: 'bandwidth_limit', title: '流量限制', width: 120, visible: true, slots: { default: 'bandwidth_limit' } },
  { field: 'traffic_used', title: '已用流量', width: 120, visible: true, slots: { default: 'traffic_used' } },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'created_at', title: '创建时间', width: 180, visible: false, slots: { default: 'created_at' } },
  { field: 'actions', title: '操作', width: 90, align: 'right', fixed: 'right', visible: true, columnSelectable: false, slots: { default: 'actions' } }
];

const nodeFormRef = ref<FormInstance>();
const nodeForm = reactive({
  name: '',
  type: 'ss',
  server: '',
  server_port: 443,
  tls_host: '',
  node_class: 0,
  node_bandwidth_limit_gb: 0,
  traffic_multiplier: 1,
  node_bandwidth: 0,
  bandwidthlimit_resetday: 1,
  node_config: ''
});

const nodeRules = {
  name: [
    { required: true, message: '请输入节点名称', trigger: 'blur' },
    { min: 2, max: 50, message: '节点名称长度应在2-50个字符', trigger: 'blur' }
  ],
  type: [{ required: true, message: '请选择节点类型', trigger: 'change' }],
  server: [{ required: true, message: '请输入节点地址', trigger: 'blur' }],
  server_port: [
    { required: true, message: '请输入端口号', trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: '端口号应在1-65535之间', trigger: 'blur' }
  ],
  node_class: [
    { required: true, message: '请输入节点等级', trigger: 'change' },
    { type: 'number', min: 0, message: '节点等级必须为非负整数', trigger: 'change' }
  ],
  traffic_multiplier: [
    { required: true, message: '请输入扣费倍率', trigger: 'change' },
    { type: 'number', min: 0.1, message: '扣费倍率需大于0', trigger: 'change' }
  ]
};

const getNodeTypeColor = (type: string) => {
  const colorMap: Record<string, string> = { ss: 'primary', ssr: 'primary', v2ray: 'success', vless: 'info', trojan: 'warning', hysteria: 'danger' };
  return colorMap[type] || 'primary';
};

const getNodeTypeName = (type: string) => {
  const nameMap: Record<string, string> = { ss: 'Shadowsocks', ssr: 'ShadowsocksR', v2ray: 'V2Ray', vless: 'VLess', trojan: 'Trojan', hysteria: 'Hysteria' };
  return nameMap[type] || type;
};

const formatTraffic = (bytes: number): string => {
  if (bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  const gb = mb / 1024;
  const tb = gb / 1024;
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  else if (gb >= 1) return `${gb.toFixed(2)} GB`;
  else return `${mb.toFixed(2)} MB`;
};

const formatNodeConfig = (config: any): string => {
  if (!config) return '';
  if (typeof config === 'string') {
    try {
      const parsed = JSON.parse(config);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return config;
    }
  } else {
    return JSON.stringify(config, null, 2);
  }
};

const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleString('zh-CN');
  } catch {
    return '--';
  }
};

const loadNodes = async () => {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    const keyword = searchKeyword.value.trim();
    if (keyword) {
      params.keyword = keyword;
    }

    if (statusFilter.value !== null && statusFilter.value !== undefined) {
      params.status = statusFilter.value;
    }

    const response = await getNodes(params);
    const payload = response.data;

    nodes.value = payload.data || [];
    pagerConfig.total = payload.total || 0;
  } catch (error) {
    console.error('加载节点失败:', error);
    ElMessage.error('加载节点列表失败');
    nodes.value = [];
    pagerConfig.total = 0;
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadNodes();
};

const handleSearch = () => {
  pagerConfig.currentPage = 1;
  loadNodes();
};

const handleStatusFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadNodes();
};

const handleSelectionChange = () => {
  const records = vxeTableRef.value?.getCheckboxRecords?.() || [];
  selectedNodes.value = records;
};

const editNode = (node: Node) => {
  editingNode.value = node;
  nodeForm.name = node.name;
  nodeForm.type = node.type;
  nodeForm.server = node.server;
  nodeForm.server_port = node.server_port;
  nodeForm.tls_host = node.tls_host || '';
  nodeForm.node_class = node.node_class;

  if (node.node_bandwidth_limit && node.node_bandwidth_limit > 0) {
    nodeForm.node_bandwidth_limit_gb = Math.round(node.node_bandwidth_limit / (1024 * 1024 * 1024));
  } else {
    nodeForm.node_bandwidth_limit_gb = 0;
  }

  nodeForm.node_bandwidth = node.node_bandwidth || 0;
  nodeForm.bandwidthlimit_resetday = node.bandwidthlimit_resetday || 1;
  nodeForm.traffic_multiplier = Number(node.traffic_multiplier || 1);

  if (node.node_config) {
    nodeForm.node_config = typeof node.node_config === 'string' ? node.node_config : JSON.stringify(node.node_config, null, 2);
  } else {
    nodeForm.node_config = '';
  }

  showCreateDialog.value = true;
};

const copyNode = (node: Node) => {
  editingNode.value = null;
  nodeForm.name = `${node.name} - 副本`;
  nodeForm.type = node.type;
  nodeForm.server = node.server;
  nodeForm.server_port = node.server_port;
  nodeForm.tls_host = node.tls_host || '';
  nodeForm.node_class = node.node_class;

  if (node.node_bandwidth_limit && node.node_bandwidth_limit > 0) {
    nodeForm.node_bandwidth_limit_gb = Math.round(node.node_bandwidth_limit / (1024 * 1024 * 1024));
  } else {
    nodeForm.node_bandwidth_limit_gb = 0;
  }

  nodeForm.node_bandwidth = node.node_bandwidth || 0;
  nodeForm.bandwidthlimit_resetday = node.bandwidthlimit_resetday || 1;
  nodeForm.traffic_multiplier = Number(node.traffic_multiplier || 1);

  if (node.node_config) {
    nodeForm.node_config = typeof node.node_config === 'string' ? node.node_config : JSON.stringify(node.node_config, null, 2);
  } else {
    nodeForm.node_config = '';
  }

  showCreateDialog.value = true;
};

const showNodeDetails = (node: Node) => {
  selectedNode.value = node;
  showDetailsDialog.value = true;
};

const handleRowCommand = (command: string, row: Node) => {
  switch (command) {
    case 'edit':
      editNode(row);
      break;
    case 'toggle':
      toggleNodeStatus(row);
      break;
    case 'copy':
      copyNode(row);
      break;
    case 'details':
      showNodeDetails(row);
      break;
    case 'delete':
      deleteNode(row);
      break;
    default:
      break;
  }
};

const toggleNodeStatus = async (node: Node) => {
  try {
    const newStatus = node.status === 1 ? 0 : 1;
    const action = newStatus === 1 ? '启用' : '禁用';

    await ElMessageBox.confirm(`确定要${action}节点"${node.name}"吗？`, '确认操作', { type: 'warning' });

    await updateNode(node.id, { status: newStatus } as any);
    node.status = newStatus;
    ElMessage.success(`节点${action}成功`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('切换节点状态失败:', error);
      ElMessage.error('操作失败，请重试');
    }
  }
};

const deleteNode = async (node: Node) => {
  try {
    await ElMessageBox.confirm(`确定要删除节点"${node.name}"吗？此操作不可撤销。`, '确认删除', { type: 'warning' });

    await deleteNodeAPI(node.id);
    await loadNodes();
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除节点失败:', error);
      ElMessage.error('删除失败，请重试');
    }
  }
};

const saveNode = async () => {
  if (!nodeFormRef.value) return;

  try {
    await nodeFormRef.value.validate();
    submitting.value = true;

    const formData = {
      name: nodeForm.name,
      type: nodeForm.type,
      server: nodeForm.server,
      server_port: nodeForm.server_port,
      tls_host: nodeForm.tls_host,
      node_class: nodeForm.node_class,
      node_bandwidth_limit: nodeForm.node_bandwidth_limit_gb > 0 ? nodeForm.node_bandwidth_limit_gb * 1024 * 1024 * 1024 : 0,
      node_bandwidth: nodeForm.node_bandwidth,
      traffic_multiplier: nodeForm.traffic_multiplier > 0 ? nodeForm.traffic_multiplier : 1,
      bandwidthlimit_resetday: nodeForm.bandwidthlimit_resetday,
      node_config: nodeForm.node_config
    };

    if (editingNode.value) {
      await updateNode(editingNode.value.id, formData);
      ElMessage.success('节点更新成功');
    } else {
      await createNode(formData);
      ElMessage.success('节点创建成功');
    }

    showCreateDialog.value = false;
    resetForm();
    await loadNodes();
  } catch (error) {
    console.error('保存节点失败:', error);
    ElMessage.error('保存失败，请重试');
  } finally {
    submitting.value = false;
  }
};

const resetForm = () => {
  editingNode.value = null;
  nodeForm.name = '';
  nodeForm.type = 'ss';
  nodeForm.server = '';
  nodeForm.server_port = 443;
  nodeForm.tls_host = '';
  nodeForm.node_class = 0;
  nodeForm.node_bandwidth_limit_gb = 0;
  nodeForm.node_bandwidth = 0;
  nodeForm.traffic_multiplier = 1;
  nodeForm.bandwidthlimit_resetday = 1;
  nodeForm.node_config = '';
  nodeFormRef.value?.clearValidate();
};

const batchOnlineNodes = async () => {
  try {
    const nodeIds = selectedNodes.value.map(node => node.id);

    await ElMessageBox.confirm(`确定要批量启用选中的 ${selectedNodes.value.length} 个节点吗？`, '确认操作', { type: 'warning' });

    const { data } = await batchUpdateNodes({ action: 'enable', node_ids: nodeIds });

    selectedNodes.value.forEach(node => {
      node.status = 1;
    });

    ElMessage.success(data.message || `成功启用 ${data.affected_count} 个节点`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量启用节点失败:', error);
      ElMessage.error('批量启用失败，请重试');
    }
  }
};

const batchOfflineNodes = async () => {
  try {
    const nodeIds = selectedNodes.value.map(node => node.id);

    await ElMessageBox.confirm(`确定要批量禁用选中的 ${selectedNodes.value.length} 个节点吗？`, '确认操作', { type: 'warning' });

    const { data } = await batchUpdateNodes({ action: 'disable', node_ids: nodeIds });

    selectedNodes.value.forEach(node => {
      node.status = 0;
    });

    ElMessage.success(data.message || `成功禁用 ${data.affected_count} 个节点`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量禁用节点失败:', error);
      ElMessage.error('批量禁用失败，请重试');
    }
  }
};

onMounted(() => {
  loadNodes();
});
</script>

<style scoped lang="scss">
.admin-nodes {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .table-actions {
    display: flex;
    justify-content: flex-end;
  }
  .dropdown-icon {
    margin-left: 4px;
    font-size: 12px;
  }
  .node-details {
    :deep(.el-descriptions-item__label) { width: 120px; }
    h4 { margin: 20px 0 10px 0; color: #303133; }
  }
}
</style>
