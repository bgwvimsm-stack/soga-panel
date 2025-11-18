<template>
  <div class="admin-page admin-users">
    <div class="page-header">
      <h2>用户管理</h2>
      <p>管理系统中的所有用户账户</p>
    </div>

    <!-- 用户统计概览 -->
    <div class="stats-overview" v-loading="statsLoading">
      <el-row :gutter="20">
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ systemStats?.total_users || 0 }}</div>
              <div class="stat-label">总用户数</div>
            </div>
            <div class="stat-icon total">
              <el-icon><UserIcon /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ systemStats?.active_users || 0 }}</div>
              <div class="stat-label">活跃用户</div>
            </div>
            <div class="stat-icon active">
              <el-icon><CircleCheck /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ todayNewUsers }}</div>
              <div class="stat-label">今日新增</div>
            </div>
            <div class="stat-icon new">
              <el-icon><Plus /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ formatBytes(systemStats?.total_traffic || 0) }}</div>
              <div class="stat-label">总流量</div>
            </div>
            <div class="stat-icon traffic">
              <el-icon><DataLine /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- VxeTable 表格 -->
    <VxeTableBar
      :vxeTableRef="vxeTableRef"
      :columns="columns"
      title="用户列表"
      @refresh="loadUsers"
    >
      <template #buttons>
        <!-- 批量操作提示 -->
        <el-alert
          v-if="selectedUsers.length > 0"
          :title="`已选中 ${selectedUsers.length} 个用户`"
          type="info"
          :closable="false"
          show-icon
          style="margin-right: 12px;"
        />

        <!-- 批量操作按钮 -->
        <el-button
          v-if="selectedUsers.length > 0"
          type="success"
          size="small"
          @click="batchEnableUsers"
          :loading="batchOperating"
        >
          <el-icon><CircleCheck /></el-icon>
          批量启用
        </el-button>
        <el-button
          v-if="selectedUsers.length > 0"
          type="warning"
          size="small"
          @click="batchDisableUsers"
          :loading="batchOperating"
        >
          <el-icon><CircleClose /></el-icon>
          批量禁用
        </el-button>
        <el-button
          v-if="selectedUsers.length > 0"
          type="danger"
          size="small"
          @click="batchDeleteUsers"
          :loading="batchOperating"
        >
          <el-icon><Delete /></el-icon>
          批量删除
        </el-button>

        <!-- 搜索和筛选 -->
        <el-input
          v-model="searchQuery"
          placeholder="搜索用户邮箱或用户名"
          @keyup.enter="loadUsers"
          @clear="loadUsers"
          clearable
          style="width: 200px; margin-right: 12px;"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-select
          v-model="statusFilter"
          placeholder="用户状态"
          @change="loadUsers"
          clearable
          style="width: 120px; margin-right: 12px;"
        >
          <el-option label="启用" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>

        <el-input
          v-model="classFilter"
          placeholder="用户等级"
          type="number"
          clearable
          @change="handleClassFilterChange"
          @clear="handleClassFilterChange"
          style="width: 140px; margin-right: 12px;"
        />

        <!-- 操作按钮 -->
        <el-button type="primary" @click="showAddUserDialog = true">
          <el-icon><Plus /></el-icon>
          新增用户
        </el-button>

        <el-button @click="exportUsers" :loading="exportingUsers">
          <el-icon><Download /></el-icon>
          导出用户
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
          :data="users"
          :pagerConfig="pagerConfig"
          :checkbox-config="{ reserve: true }"
          @checkbox-change="handleSelectionChange"
          @checkbox-all="handleSelectionChange"
          @page-change="handlePageChange"
        >
          <!-- 用户名 -->
          <template #username="{ row }">
            <span>{{ row.username }}</span>
          </template>

          <!-- 等级 -->
          <template #class="{ row }">
            <el-tag :type="getClassTagType(row.class)" size="small">
              等级{{ row.class }}
            </el-tag>
          </template>

          <!-- 等级过期时间 -->
          <template #class_expire_time="{ row }">
            <span :class="{ 'text-danger': isExpired(row.class_expire_time) }">
              {{ formatDateTime(row.class_expire_time) }}
            </span>
          </template>

          <!-- 流量使用 -->
          <template #traffic_usage="{ row }">
            <div class="traffic-info">
              <div class="progress-text">
                {{ formatBytes(row.transfer_total || 0) }} / {{ formatBytes(row.transfer_enable || 0) }}
              </div>
              <el-progress
                :percentage="getTrafficPercent(row)"
                :color="getTrafficColor(row)"
                :show-text="false"
                :stroke-width="6"
              />
            </div>
          </template>

          <!-- 今日流量 -->
          <template #transfer_today="{ row }">
            <span>{{ formatBytes(row.transfer_today || 0) }}</span>
          </template>

          <!-- 速度限制 -->
          <template #speed_limit="{ row }">
            {{ formatSpeedLimit(row.speed_limit) }}
          </template>

          <!-- 设备限制 -->
          <template #device_limit="{ row }">
            {{ formatDeviceLimit(row.device_limit) }}
          </template>

          <!-- 余额 -->
          <template #money="{ row }">
            <span class="money-text">¥{{ parseFloat(row.money || 0).toFixed(2) }}</span>
          </template>

          <!-- 账户过期时间 -->
          <template #expire_time="{ row }">
            <span :class="{ 'text-danger': isExpired(row.expire_time) }">
              {{ formatDateTime(row.expire_time) }}
            </span>
          </template>

          <!-- 状态 -->
          <template #status="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>

          <!-- 注册时间 -->
          <template #created_at="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>

          <!-- 注册 IP -->
          <template #register_ip="{ row }">
            <span>{{ row.register_ip || '-' }}</span>
          </template>

          <!-- 管理员标志 -->
          <template #is_admin="{ row }">
            <el-tag :type="row.is_admin ? 'success' : 'info'" size="small">
              {{ row.is_admin ? '管理员' : '普通用户' }}
            </el-tag>
          </template>

          <!-- 操作列 -->
          <template #actions="{ row }">
            <div class="table-actions">
              <el-dropdown trigger="click" @command="(command) => handleUserRowCommand(command, row)">
                <el-button size="small" plain>
                  更多
                  <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <el-icon><EditPen /></el-icon>
                      编辑用户
                    </el-dropdown-item>
                    <el-dropdown-item command="toggle" :disabled="row.status === 1 && row.is_admin === 1">
                      <el-icon><SwitchButton /></el-icon>
                      {{ row.status === 1 ? '禁用用户' : '启用用户' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="reset">
                      <el-icon><RefreshRight /></el-icon>
                      重置流量
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided :disabled="row.is_admin === 1">
                      <el-icon><Delete /></el-icon>
                      删除用户
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 新增/编辑用户对话框 -->
    <el-dialog
      v-model="showAddUserDialog"
      :title="editingUser ? '编辑用户' : '新增用户'"
      width="600px"
      @close="resetForm"
    >
      <el-form
        ref="userFormRef"
        :model="userForm"
        :rules="userRules"
        label-width="120px"
      >
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="邮箱" prop="email">
              <el-input v-model="userForm.email" placeholder="请输入邮箱" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="userForm.username" placeholder="请输入用户名" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="账户余额" prop="money">
              <el-input-number
                v-model="userForm.money"
                :min="0"
                :step="0.01"
                :precision="2"
                style="width: 100%"
                placeholder="请输入余额"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="用户等级" prop="class">
              <el-input-number
                v-model="userForm.class"
                :min="0"
                :max="999"
                placeholder="输入用户等级数字"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="密码" prop="password">
              <el-input v-model="userForm.password" type="password" placeholder="请输入密码" show-password />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="流量配额 (GB)" prop="transfer_enable_gb">
              <el-input-number
                v-model="userForm.transfer_enable_gb"
                :min="0"
                :precision="2"
                placeholder="输入GB数量"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="账户过期时间" prop="expire_time">
              <el-date-picker
                v-model="userForm.expire_time"
                type="datetime"
                placeholder="请选择账户过期时间"
                format="YYYY/MM/DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="等级过期时间" prop="class_expire_time">
              <el-date-picker
                v-model="userForm.class_expire_time"
                type="datetime"
                placeholder="请选择等级过期时间"
                format="YYYY/MM/DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="速度限制 (Mbps)" prop="speed_limit">
              <el-input-number
                v-model="userForm.speed_limit"
                :min="0"
                placeholder="0表示不限速"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="设备数量限制" prop="device_limit">
              <el-input-number
                v-model="userForm.device_limit"
                :min="0"
                placeholder="0表示不限制"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="Bark通知Key" prop="bark_key">
              <el-input
                v-model="userForm.bark_key"
                placeholder="请输入Bark通知Key"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="启用Bark通知" prop="bark_enabled">
              <el-switch
                v-model="userForm.bark_enabled"
                active-text="启用"
                inactive-text="禁用"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template #footer>
        <el-button @click="showAddUserDialog = false">取消</el-button>
        <el-button type="primary" @click="saveUser" :loading="submitting">
          {{ editingUser ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import {
  Plus,
  Refresh,
  Search,
  CircleCheck,
  CircleClose,
  Delete,
  User as UserIcon,
  Download,
  DataLine,
  ArrowDown,
  EditPen,
  SwitchButton,
  RefreshRight
} from "@element-plus/icons-vue";
import { VxeTableBar } from '@/components/ReVxeTableBar';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser as deleteUserAPI,
  toggleUserStatus as toggleUserStatusAPI,
  resetUserTraffic,
  getSystemStats,
  type User,
  type CreateUserRequest,
  type UpdateUserRequest
} from "@/api/admin";

const vxeTableRef = ref();
const loading = ref(false);
const statsLoading = ref(false);
const submitting = ref(false);
const exportingUsers = ref(false);
const batchOperating = ref(false);
const showAddUserDialog = ref(false);
const editingUser = ref<User | null>(null);
const users = ref<User[]>([]);
interface UserStatsOverview {
  total_users: number;
  active_users: number;
  total_nodes: number;
  online_nodes: number;
  total_traffic: number;
  today_traffic: number;
}

const systemStats = ref<UserStatsOverview | null>(null);
const selectedUsers = ref<User[]>([]);

// 分页配置
const pagerConfig = reactive({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

// 筛选条件
const searchQuery = ref('');
const statusFilter = ref<number | null>(null);
const classFilter = ref<string>('');

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
const columns = [
  { type: 'checkbox', width: 60, fixed: 'left', visible: true, columnSelectable: false },
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'email', title: '邮箱', minWidth: 200, visible: true },
  { field: 'username', title: '用户名', width: 150, visible: true, slots: { default: 'username' } },
  { field: 'money', title: '余额', width: 120, visible: true, slots: { default: 'money' } },
  { field: 'class', title: '等级', width: 100, visible: true, slots: { default: 'class' } },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'traffic_usage', title: '总流量使用', width: 220, visible: true, slots: { default: 'traffic_usage' } },
  { field: 'transfer_today', title: '今日流量', width: 140, visible: true, slots: { default: 'transfer_today' } },
  { field: 'speed_limit', title: '速度限制', width: 120, visible: true, slots: { default: 'speed_limit' } },
  { field: 'device_limit', title: '设备限制', width: 120, visible: true, slots: { default: 'device_limit' } },
  { field: 'class_expire_time', title: '等级过期时间', width: 180, visible: true, slots: { default: 'class_expire_time' } },
  { field: 'expire_time', title: '账户过期时间', width: 180, visible: false, slots: { default: 'expire_time' } },
  { field: 'created_at', title: '注册时间', width: 180, visible: false, slots: { default: 'created_at' } },
  { field: 'register_ip', title: '注册IP', width: 160, visible: false, slots: { default: 'register_ip' } },
  { field: 'is_admin', title: '管理员', width: 100, visible: false, slots: { default: 'is_admin' } },
  { field: 'actions', title: '操作', width: 90, align: 'right', fixed: 'right', visible: true, slots: { default: 'actions' }, columnSelectable: false }
];

// 表单引用
const userFormRef = ref<FormInstance>();

// 用户表单
const userForm = reactive({
  email: '',
  username: '',
  password: '',
  money: 0,
  class: 1,
  transfer_enable_gb: 10,
  expire_time: '',
  class_expire_time: '',
  speed_limit: 0,
  device_limit: 0,
  bark_key: '',
  bark_enabled: false
});

// 表单验证规则
const userRules = computed(() => ({
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度应在3-20个字符', trigger: 'blur' }
  ],
  password: editingUser.value ? [
    { min: 6, max: 32, message: '密码长度应在6-32个字符', trigger: 'blur' }
  ] : [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 32, message: '密码长度应在6-32个字符', trigger: 'blur' }
  ],
  class: [
    { required: true, message: '请选择用户等级', trigger: 'change' }
  ],
  transfer_enable_gb: [
    { required: true, message: '请输入流量配额', trigger: 'blur' }
  ]
}));

// 计算属性
const todayNewUsers = computed(() => {
  if (!users.value?.length) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return users.value.filter(user => {
    const createdAt = new Date(user.created_at);
    return createdAt >= today;
  }).length;
});

// 工具函数
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  } catch {
    return '--';
  }
};

const formatSpeedLimit = (limit: any): string => {
  if (!limit || limit === '0' || limit === 0) return '无限制';
  return `${Number(limit)} Mbps`;
};

const formatDeviceLimit = (limit: any): string => {
  if (!limit || limit === '0' || limit === 0) return '无限制';
  return `${Number(limit)} 台`;
};

const getClassTagType = (userClass: number) => {
  const typeMap: Record<number, string> = {
    1: 'info',
    2: 'warning',
    3: 'success'
  };
  return typeMap[userClass] || 'info';
};

const getTrafficPercent = (user: User): number => {
  if (!user.transfer_enable || user.transfer_enable === 0) return 0;
  const used = user.transfer_total || 0;
  return Math.min(Math.round((used / user.transfer_enable) * 100), 100);
};

const getTrafficColor = (user: User): string => {
  const percent = getTrafficPercent(user);
  if (percent < 60) return '#67c23a';
  if (percent < 80) return '#e6a23c';
  return '#f56c6c';
};

const isExpired = (expireTime: string | null): boolean => {
  if (!expireTime) return false;
  return new Date(expireTime) < new Date();
};

// 加载系统统计
const loadSystemStats = async () => {
  statsLoading.value = true;
  try {
    const { data } = await getSystemStats();
    systemStats.value = {
      total_users: data.users?.total || 0,
      active_users: data.users?.active || 0,
      total_nodes: data.nodes?.total || 0,
      online_nodes: data.nodes?.online || 0,
      total_traffic: data.traffic?.total || 0,
      today_traffic: data.traffic?.today || 0
    };
  } catch (error) {
    console.error('加载系统统计失败:', error);
    systemStats.value = {
      total_users: 0,
      active_users: 0,
      total_nodes: 0,
      online_nodes: 0,
      total_traffic: 0,
      today_traffic: 0
    };
  } finally {
    statsLoading.value = false;
  }
};

// 加载用户列表
const loadUsers = async () => {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize,
      search: searchQuery.value || undefined,
      status: statusFilter.value !== null ? statusFilter.value : undefined,
    };

    const classValue = classFilter.value.trim();
    if (classValue !== '') {
      const parsedClass = Number(classValue);
      if (!Number.isNaN(parsedClass)) {
        params.class = parsedClass;
      }
    }

    const { data } = await getUsers(params);
    users.value = data?.users || [];
    pagerConfig.total = data?.total || 0;
  } catch (error) {
    console.error('加载用户列表失败:', error);
    ElMessage.error('加载用户列表失败');
    users.value = [];
    pagerConfig.total = 0;
  } finally {
    loading.value = false;
  }
};

const handleClassFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadUsers();
};

// 分页变化处理
const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadUsers();
};

// 多选变化处理
const handleSelectionChange = () => {
  const selectRecords = vxeTableRef.value?.getCheckboxRecords();
  selectedUsers.value = selectRecords || [];
};

// 编辑用户
const editUser = (user: User) => {
  editingUser.value = user;
  userForm.email = user.email;
  userForm.username = user.username;
  userForm.password = '';
  userForm.money = parseFloat(user.money || '0');
  userForm.class = user.class;
  userForm.transfer_enable_gb = user.transfer_enable / (1024 * 1024 * 1024);
  userForm.expire_time = user.expire_time || '';
  userForm.class_expire_time = user.class_expire_time || '';
  userForm.speed_limit = user.speed_limit || 0;
  userForm.device_limit = user.device_limit || 0;
  userForm.bark_key = user.bark_key || '';
  userForm.bark_enabled = user.bark_enabled || false;
  showAddUserDialog.value = true;
};

// 保存用户
const saveUser = async () => {
  if (!userFormRef.value) return;

  try {
    await userFormRef.value.validate();
    submitting.value = true;

    if (editingUser.value) {
      const formData: UpdateUserRequest = {
        email: userForm.email,
        username: userForm.username,
        money: userForm.money,
        class: userForm.class,
        transfer_enable: userForm.transfer_enable_gb * 1024 * 1024 * 1024,
        expire_time: userForm.expire_time || null,
        class_expire_time: userForm.class_expire_time || null,
        speed_limit: userForm.speed_limit,
        device_limit: userForm.device_limit,
        bark_key: userForm.bark_key || null,
        bark_enabled: userForm.bark_enabled
      };

      if (userForm.password) {
        (formData as any).password = userForm.password;
      }

      await updateUser(editingUser.value.id, formData);
      ElMessage.success('用户更新成功');
    } else {
      const formData: CreateUserRequest = {
        email: userForm.email,
        username: userForm.username,
        password: userForm.password,
        class: userForm.class,
        transfer_enable: userForm.transfer_enable_gb * 1024 * 1024 * 1024,
        expire_days: 30,
        expire_time: userForm.expire_time || null,
        class_expire_time: userForm.class_expire_time || null,
        speed_limit: userForm.speed_limit,
        device_limit: userForm.device_limit,
        bark_key: userForm.bark_key || null,
        bark_enabled: userForm.bark_enabled
      };

      await createUser(formData);
      ElMessage.success('用户创建成功');
    }

    showAddUserDialog.value = false;
    resetForm();
    await loadUsers();
  } catch (error) {
    console.error('保存用户失败:', error);
    ElMessage.error('保存失败，请重试');
  } finally {
    submitting.value = false;
  }
};

// 切换用户状态

const handleUserRowCommand = (command: string, row: User) => {
  switch (command) {
    case 'edit':
      editUser(row);
      break;
    case 'toggle':
      toggleUserStatus(row);
      break;
    case 'reset':
      resetTraffic(row);
      break;
    case 'delete':
      deleteUser(row);
      break;
    default:
      break;
  }
};

const toggleUserStatus = async (user: User) => {
  try {
    const action = user.status === 1 ? '禁用' : '启用';

    if (action === '禁用' && user.is_admin === 1) {
      ElMessage.error('不能禁用管理员账号');
      return;
    }

    await ElMessageBox.confirm(
      `确定要${action}用户"${user.email}"吗？`,
      '确认操作',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    await toggleUserStatusAPI(user.id);
    user.status = user.status === 1 ? 0 : 1;
    ElMessage.success(`用户${action}成功`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('切换用户状态失败:', error);
      ElMessage.error('操作失败，请重试');
    }
  }
};

// 重置流量
const resetTraffic = async (user: User) => {
  try {
    await ElMessageBox.confirm(
      `确定要重置用户"${user.email}"的流量使用吗？`,
      '确认重置',
      {
        confirmButtonText: '确定重置',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    await resetUserTraffic(user.id);
    user.transfer_total = 0;
    ElMessage.success('流量重置成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('重置流量失败:', error);
      ElMessage.error('重置失败，请重试');
    }
  }
};

// 删除用户
const deleteUser = async (user: User) => {
  if (user.is_admin === 1) {
    ElMessage.warning('管理员账号无法删除');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定要删除用户"${user.email}"吗？此操作不可撤销。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    await deleteUserAPI(user.id);
    await loadUsers();
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除用户失败:', error);
      ElMessage.error('删除失败，请重试');
    }
  }
};

// 导出用户
const exportUsers = async () => {
  exportingUsers.value = true;
  try {
    const usersToExport = selectedUsers.value.length > 0 ? selectedUsers.value : users.value;

    await ElMessageBox.confirm(
      `确定要导出 ${usersToExport.length} 个用户吗？`,
      '确认导出',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'info'
      }
    );

    const csvContent = generateCSV(usersToExport);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `用户数据_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    ElMessage.success('导出成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('导出用户失败:', error);
      ElMessage.error('导出失败，请重试');
    }
  } finally {
    exportingUsers.value = false;
  }
};

// 生成CSV内容
const generateCSV = (usersToExport: User[]): string => {
  const headers = ['用户名', '邮箱'];
  const rows = usersToExport.map(user => [user.username, user.email]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => `"${field}"`).join(','))
  ].join('\n');

  return '\uFEFF' + csvContent;
};

// 批量启用用户
const batchEnableUsers = async () => {
  try {
    const disabledUsers = selectedUsers.value.filter(user => user.status === 0);
    if (disabledUsers.length === 0) {
      ElMessage.warning('没有需要启用的用户');
      return;
    }

    await ElMessageBox.confirm(
      `确定要启用选中的 ${disabledUsers.length} 个用户吗？`,
      '批量启用确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    batchOperating.value = true;
    const promises = disabledUsers.map(user => toggleUserStatusAPI(user.id));
    await Promise.allSettled(promises);

    ElMessage.success(`成功启用 ${disabledUsers.length} 个用户`);
    await loadUsers();

  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量启用用户失败:', error);
      ElMessage.error('批量启用失败，请重试');
    }
  } finally {
    batchOperating.value = false;
  }
};

// 批量禁用用户
const batchDisableUsers = async () => {
  try {
    const enabledNonAdminUsers = selectedUsers.value.filter(user => user.status === 1 && user.is_admin !== 1);
    const adminUsers = selectedUsers.value.filter(user => user.is_admin === 1);

    if (adminUsers.length > 0) {
      ElMessage.warning(`已跳过 ${adminUsers.length} 个管理员账号`);
    }

    if (enabledNonAdminUsers.length === 0) {
      ElMessage.warning('没有可禁用的用户');
      return;
    }

    await ElMessageBox.confirm(
      `确定要禁用选中的 ${enabledNonAdminUsers.length} 个用户吗？`,
      '批量禁用确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );

    batchOperating.value = true;
    const promises = enabledNonAdminUsers.map(user => toggleUserStatusAPI(user.id));
    await Promise.allSettled(promises);

    ElMessage.success(`成功禁用 ${enabledNonAdminUsers.length} 个用户`);
    await loadUsers();

  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量禁用用户失败:', error);
      ElMessage.error('批量禁用失败，请重试');
    }
  } finally {
    batchOperating.value = false;
  }
};

// 批量删除用户
const batchDeleteUsers = async () => {
  const nonAdminUsers = selectedUsers.value.filter(user => user.is_admin !== 1);
  const adminUsers = selectedUsers.value.filter(user => user.is_admin === 1);

  if (adminUsers.length > 0) {
    ElMessage.warning(`已过滤 ${adminUsers.length} 个管理员账号`);
  }

  if (nonAdminUsers.length === 0) {
    ElMessage.warning('没有可删除的用户');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${nonAdminUsers.length} 个用户吗？此操作无法撤销！`,
      '批量删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'error'
      }
    );

    batchOperating.value = true;
    const promises = nonAdminUsers.map(user => deleteUserAPI(user.id));
    await Promise.allSettled(promises);

    ElMessage.success(`成功删除 ${nonAdminUsers.length} 个用户`);
    await loadUsers();

  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量删除用户失败:', error);
      ElMessage.error('批量删除失败，请重试');
    }
  } finally {
    batchOperating.value = false;
  }
};

// 重置表单
const resetForm = () => {
  editingUser.value = null;
  userForm.email = '';
  userForm.username = '';
  userForm.password = '';
  userForm.money = 0;
  userForm.class = 1;
  userForm.transfer_enable_gb = 10;
  userForm.speed_limit = 0;
  userForm.device_limit = 0;
  userForm.bark_key = '';
  userForm.bark_enabled = false;

  const now = new Date();
  const defaultExpireTime = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const timeString = defaultExpireTime.toISOString().slice(0, 19).replace('T', ' ');

  userForm.expire_time = timeString;
  userForm.class_expire_time = timeString;

  userFormRef.value?.clearValidate();
};

// 初始化
onMounted(async () => {
  await loadSystemStats();
  await loadUsers();
});
</script>

<style scoped lang="scss">
.admin-users {
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

  .stats-overview {
    margin-bottom: 24px;

    .stat-card {
      :deep(.el-card__body) {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px;
      }

      .stat-content {
        .stat-number {
          font-size: 28px;
          font-weight: bold;
          color: #303133;
          margin-bottom: 5px;
        }

        .stat-label {
          color: #909399;
          font-size: 14px;
        }
      }

      .stat-icon {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 24px;

        &.total { background: #409eff; }
        &.active { background: #67c23a; }
        &.new { background: #e6a23c; }
        &.traffic { background: #f56c6c; }
      }
    }
  }

  .table-actions {
    display: flex;
    justify-content: flex-end;
  }

  .dropdown-icon {
    margin-left: 4px;
    font-size: 12px;
  }

  .traffic-info {
    .progress-text {
      font-size: 12px;
      color: #606266;
      margin-bottom: 5px;
    }
  }

  .text-danger {
    color: #f56c6c;
  }

  .money-text {
    font-weight: 600;
    color: #67c23a;
  }
}
</style>
