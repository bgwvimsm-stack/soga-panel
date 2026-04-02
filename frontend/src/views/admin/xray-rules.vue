<template>
  <div class="admin-page admin-xray-rules">
    <div class="page-header">
      <h2>路由管理</h2>
      <p>管理节点 Xray 规则内容（DNS / Routing / Outbounds）</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="Xray规则" @refresh="loadRules">
      <template #buttons>
        <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>新增规则</el-button>
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
          :data="rules"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #name="{ row }"><span>{{ row.name }}</span></template>
          <template #rule_type="{ row }">
            <el-tag size="small" type="info">{{ getRuleTypeLabel(row.rule_type) }}</el-tag>
          </template>
          <template #rule_format="{ row }">
            <el-tag size="small">{{ String(row.rule_format || "").toUpperCase() }}</el-tag>
          </template>
          <template #rule_content="{ row }">
            <code class="json-preview">{{ formatRulePreview(row.rule_content) }}</code>
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

    <el-dialog v-model="showDialog" :title="editingItem ? '编辑路由规则' : '新增路由规则'" width="760px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="110px">
        <el-form-item label="规则名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入规则名称" maxlength="100" show-word-limit />
        </el-form-item>

        <el-form-item label="规则类型" prop="rule_type">
          <el-select v-model="form.rule_type" placeholder="请选择规则类型">
            <el-option label="DNS" value="dns" />
            <el-option label="Routing" value="routing" />
            <el-option label="Outbounds" value="outbounds" />
          </el-select>
        </el-form-item>

        <el-form-item label="内容格式" prop="rule_format">
          <el-radio-group v-model="form.rule_format">
            <el-radio label="json">JSON</el-radio>
            <el-radio label="yaml">YAML</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="规则内容" prop="rule_content">
          <el-input
            v-model="form.rule_content"
            type="textarea"
            :rows="12"
            :placeholder="form.rule_format === 'yaml' ? '请输入 YAML 内容' : '请输入 JSON 内容'"
          />
          <div class="form-hint">
            保存前会校验内容格式；YAML 会自动转换为 JSON 存储用于节点下发。
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
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { parse as parseYaml } from "yaml";
import { VxeTableBar } from "@/components/ReVxeTableBar";
import http from "@/api/http";

const vxeTableRef = ref();
const loading = ref(false);
const submitting = ref(false);
const showDialog = ref(false);
const editingItem = ref<any>(null);
const rules = ref<any[]>([]);
const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ["Total", "Sizes", "PrevPage", "Number", "NextPage", "FullJump"]
});

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case "medium": return 600;
    case "small": return 550;
    case "mini": return 500;
    default: return 600;
  }
});

const columns: VxeTableBarColumns = [
  { field: "id", title: "ID", width: 80, visible: true },
  { field: "name", title: "规则名称", minWidth: 160, visible: true, slots: { default: "name" } },
  { field: "rule_type", title: "类型", width: 120, visible: true, slots: { default: "rule_type" } },
  { field: "rule_format", title: "格式", width: 100, visible: true, slots: { default: "rule_format" } },
  { field: "rule_content", title: "规则内容", minWidth: 240, visible: true, slots: { default: "rule_content" } },
  { field: "enabled", title: "状态", width: 100, visible: true, slots: { default: "status" } },
  { field: "created_at", title: "创建时间", width: 180, visible: true, slots: { default: "created_at" } },
  { field: "updated_at", title: "更新时间", width: 180, visible: false, slots: { default: "updated_at" } },
  { field: "actions", title: "操作", width: 220, fixed: "right", visible: true, slots: { default: "actions" }, columnSelectable: false }
];

const formRef = ref<FormInstance>();
const form = reactive({
  name: "",
  description: "",
  rule_type: "dns",
  rule_format: "json",
  rule_content: "",
  enabled: 1
});

const getRuleTypeLabel = (value: string) => {
  if (value === "dns") return "DNS";
  if (value === "routing") return "Routing";
  if (value === "outbounds") return "Outbounds";
  return value || "-";
};

const validateRuleContent = (_rule: any, value: string, callback: (error?: Error) => void) => {
  if (!value || !value.trim()) return callback(new Error("请输入规则内容"));
  try {
    if (form.rule_format === "yaml") {
      parseYaml(value);
    } else {
      JSON.parse(value);
    }
    callback();
  } catch {
    callback(new Error(form.rule_format === "yaml" ? "YAML格式不正确" : "JSON格式不正确"));
  }
};

const formRules = {
  name: [{ required: true, message: "请输入规则名称", trigger: "blur" }],
  rule_type: [{ required: true, message: "请选择规则类型", trigger: "change" }],
  rule_format: [{ required: true, message: "请选择规则格式", trigger: "change" }],
  rule_content: [{ validator: validateRuleContent, trigger: "blur" }]
};

const normalizeRuleContent = (item: any) => {
  const raw = item?.rule_content ?? item?.rule_json ?? "";
  if (typeof raw === "string") {
    return raw;
  }
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw ?? "");
  }
};

const parseRulePayload = (content: string, format: string) => {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("规则内容不能为空");
  }

  if (format === "yaml") {
    const parsed = parseYaml(trimmed);
    return {
      rule_content: trimmed,
      rule_json: parsed
    };
  }

  const parsed = JSON.parse(trimmed);
  return {
    rule_content: JSON.stringify(parsed, null, 2),
    rule_json: parsed
  };
};

const formatRulePreview = (value: unknown) => {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return "-";
  return raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return "-";
  try { return new Date(dateStr).toLocaleString("zh-CN"); } catch { return "-"; }
};

const loadRules = async () => {
  loading.value = true;
  try {
    const response: any = await http.get("/admin/xray-rules", { params: { page: pagerConfig.currentPage, limit: pagerConfig.pageSize } });
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
      rule_type: String(item.rule_type || "dns").toLowerCase(),
      rule_format: String(item.rule_format || "json").toLowerCase(),
      enabled: item.enabled ?? item.status ?? 1,
      rule_content: normalizeRuleContent(item)
    }));
    pagerConfig.total = payload.total ?? payload.pagination?.total ?? list.length;
  } catch {
    ElMessage.error("加载路由规则失败");
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
  form.name = item.name || "";
  form.description = item.description || "";
  form.rule_type = String(item.rule_type || "dns").toLowerCase();
  form.rule_format = String(item.rule_format || "json").toLowerCase();
  form.rule_content = normalizeRuleContent(item);
  form.enabled = item.enabled ?? 1;
  showDialog.value = true;
};

const toggleStatus = async (item: any) => {
  try {
    const newStatus = item.enabled === 1 ? 0 : 1;
    const action = newStatus === 1 ? "启用" : "禁用";
    await ElMessageBox.confirm(`确定要${action}吗？`, "确认操作", { type: "warning" });

    const parsed = parseRulePayload(normalizeRuleContent(item), String(item.rule_format || "json").toLowerCase());
    await http.put(`/admin/xray-rules/${item.id}`, {
      name: item.name,
      description: item.description,
      rule_type: String(item.rule_type || "dns").toLowerCase(),
      rule_format: String(item.rule_format || "json").toLowerCase(),
      rule_content: parsed.rule_content,
      rule_json: parsed.rule_json,
      enabled: newStatus
    });
    item.enabled = newStatus;
    ElMessage.success(`${action}成功`);
  } catch (error) {
    if (error !== "cancel") ElMessage.error("操作失败");
  }
};

const deleteItem = async (item: any) => {
  try {
    await ElMessageBox.confirm("确定要删除吗？", "确认删除", { type: "warning" });
    await http.delete(`/admin/xray-rules/${item.id}`);
    await loadRules();
    ElMessage.success("删除成功");
  } catch (error) {
    if (error !== "cancel") ElMessage.error("删除失败");
  }
};

const saveItem = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
    submitting.value = true;

    const parsed = parseRulePayload(form.rule_content, form.rule_format);
    const payload = {
      name: form.name,
      description: form.description,
      rule_type: form.rule_type,
      rule_format: form.rule_format,
      rule_content: parsed.rule_content,
      rule_json: parsed.rule_json,
      enabled: form.enabled
    };

    if (editingItem.value) {
      await http.put(`/admin/xray-rules/${editingItem.value.id}`, payload);
      ElMessage.success("更新成功");
    } else {
      await http.post("/admin/xray-rules", payload);
      ElMessage.success("创建成功");
    }

    showDialog.value = false;
    resetForm();
    await loadRules();
  } catch {
    ElMessage.error("保存失败");
  } finally {
    submitting.value = false;
  }
};

const resetForm = () => {
  editingItem.value = null;
  form.name = "";
  form.description = "";
  form.rule_type = "dns";
  form.rule_format = "json";
  form.rule_content = "";
  form.enabled = 1;
  formRef.value?.clearValidate();
};

onMounted(() => {
  loadRules();
});
</script>

<style scoped lang="scss">
.admin-xray-rules {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .table-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .json-preview { font-size: 12px; color: #606266; background: #f5f7fa; padding: 2px 6px; border-radius: 3px; }
  .form-hint {
    margin-top: 6px;
    font-size: 12px;
    color: #909399;
  }
}
</style>
