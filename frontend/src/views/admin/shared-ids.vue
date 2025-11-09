<template>
  <div class="admin-shared-ids">
    <el-card class="toolbar-card">
      <div class="toolbar">
        <div class="filters">
          <el-input
            v-model="filters.keyword"
            placeholder="名称搜索"
            clearable
            @clear="handleSearch"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select v-model="filters.status" placeholder="状态" clearable @change="handleSearch">
            <el-option label="全部" value="" />
            <el-option label="启用" value="1" />
            <el-option label="禁用" value="0" />
          </el-select>
        </div>
        <div class="actions">
          <el-button :icon="RefreshRight" @click="fetchList" :loading="loading">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">新增苹果账号</el-button>
        </div>
      </div>
    </el-card>

    <el-card>
      <el-table :data="records" v-loading="loading" border>
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="fetch_url" label="拉取地址" min-width="220">
          <template #default="{ row }">
            <el-link :href="row.fetch_url" type="primary" target="_blank">{{ row.fetch_url }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="remote_account_id" label="远程ID" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'">
              {{ row.status === 1 ? "启用" : "禁用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="更新时间" min-width="180">
          <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-footer">
        <el-pagination
          background
          layout="total, prev, pager, next, sizes"
          :page-size="pagination.limit"
          :page-sizes="[10, 20, 50]"
          :current-page="pagination.page"
          :total="pagination.total"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="展示给用户的名称" />
        </el-form-item>
        <el-form-item label="拉取URL" prop="fetch_url">
          <el-input v-model="form.fetch_url" placeholder="https://example.com/accounts.json" />
        </el-form-item>
        <el-form-item label="远程ID" prop="remote_account_id">
          <el-input-number
            v-model="form.remote_account_id"
            :min="1"
            :precision="0"
            :controls="false"
            style="width: 100%;"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { Search, RefreshRight, Plus } from "@element-plus/icons-vue";
import {
  getSharedIdConfigs,
  createSharedIdConfig,
  updateSharedIdConfig,
  deleteSharedIdConfig,
  type SharedIdConfig,
} from "@/api/admin";

const loading = ref(false);
const saving = ref(false);
const records = ref<SharedIdConfig[]>([]);
const pagination = reactive({
  page: 1,
  limit: 10,
  total: 0,
});
const filters = reactive({
  keyword: "",
  status: "",
});

const dialogVisible = ref(false);
const isEdit = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({
  id: 0,
  name: "",
  fetch_url: "",
  remote_account_id: 1,
  status: 1,
});

const rules: FormRules = {
  name: [
    { required: true, message: "请输入名称", trigger: "blur" },
    { min: 2, max: 30, message: "名称长度需在2~30个字符之间", trigger: "blur" },
  ],
  fetch_url: [
    { required: true, message: "请输入获取URL", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (!value) {
          callback(new Error("请输入获取URL"));
          return;
        }
        try {
          new URL(value);
          callback();
        } catch {
          callback(new Error("URL格式不正确"));
        }
      },
      trigger: "blur",
    },
  ],
  remote_account_id: [
    { required: true, message: "请输入远程ID", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (!value || value <= 0) {
          callback(new Error("远程ID需大于0"));
          return;
        }
        callback();
      },
      trigger: "blur",
    },
  ],
};

const dialogTitle = computed(() => (isEdit.value ? "编辑苹果账号" : "新增苹果账号"));

const fetchList = async () => {
  loading.value = true;
  try {
    const { data } = await getSharedIdConfigs({
      page: pagination.page,
      limit: pagination.limit,
      keyword: filters.keyword || undefined,
      status: filters.status === "" ? undefined : Number(filters.status),
    });
    records.value = data?.records ?? [];
    pagination.total = data?.pagination?.total ?? 0;
    pagination.page = data?.pagination?.page ?? pagination.page;
    pagination.limit = data?.pagination?.limit ?? pagination.limit;
  } catch (error) {
    console.error(error);
    ElMessage.error("获取苹果账号失败");
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  pagination.page = 1;
  fetchList();
};

const handlePageChange = (page: number) => {
  pagination.page = page;
  fetchList();
};

const handleSizeChange = (size: number) => {
  pagination.limit = size;
  pagination.page = 1;
  fetchList();
};

const openCreate = () => {
  isEdit.value = false;
  Object.assign(form, {
    id: 0,
    name: "",
    fetch_url: "",
    remote_account_id: 1,
    status: 1,
  });
  dialogVisible.value = true;
};

const openEdit = (record: SharedIdConfig) => {
  isEdit.value = true;
  Object.assign(form, record);
  dialogVisible.value = true;
};

const handleSubmit = async () => {
  const formInstance = formRef.value;
  if (!formInstance) return;
  await formInstance.validate();

  saving.value = true;
  try {
    const payload = {
      name: form.name,
      fetch_url: form.fetch_url,
      remote_account_id: form.remote_account_id,
      status: form.status,
    };
    if (isEdit.value && form.id) {
      await updateSharedIdConfig(form.id, payload);
      ElMessage.success("更新成功");
    } else {
      await createSharedIdConfig(payload);
      ElMessage.success("创建成功");
    }
    dialogVisible.value = false;
    fetchList();
  } catch (error) {
    console.error(error);
    ElMessage.error("保存失败");
  } finally {
    saving.value = false;
  }
};

const handleDelete = async (record: SharedIdConfig) => {
  try {
    await ElMessageBox.confirm(`确定删除苹果账号【${record.name}】吗？`, "提示", {
      type: "warning",
    });
    await deleteSharedIdConfig(record.id);
    ElMessage.success("删除成功");
    fetchList();
  } catch (error) {
    if (error === "cancel" || error === "close") {
      return;
    }
    console.error(error);
    ElMessage.error("删除失败");
  }
};

const formatTime = (time?: string) => {
  if (!time) return "-";
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? time : date.toLocaleString();
};

onMounted(fetchList);
</script>

<style scoped lang="scss">
.admin-shared-ids {
  .toolbar-card {
    margin-bottom: 16px;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;

    .filters {
      display: flex;
      gap: 12px;
      min-width: 260px;

      .el-input {
        width: 240px;
      }

      .el-select {
        width: 140px;
      }
    }

    .actions {
      display: flex;
      gap: 12px;
    }
  }

  .table-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
}
</style>
