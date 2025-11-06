<template>
  <div class="profile-page">
    <div class="page-header">
      <h2>个人资料</h2>
      <p>管理您的账户信息和偏好设置</p>
    </div>
    
    <!-- 用户信息卡片 -->
    <el-card class="user-info-card">
      <div class="user-header">
        <div class="user-avatar">
          <el-avatar :size="80" :src="userStore.user?.avatar">
            <el-icon><User /></el-icon>
          </el-avatar>
          <div class="user-basic">
            <h3>{{ userStore.user?.email || '未知用户' }}</h3>
            <p>用户ID: {{ userStore.user?.id || 'N/A' }}</p>
            <el-tag :type="getUserStatusType(userStore.user?.status)">
              {{ getUserStatusText(userStore.user?.status) }}
            </el-tag>
          </div>
        </div>
        <div class="user-stats">
          <div class="stat-item">
            <div class="stat-value">{{ formatBytes(userStore.user?.transfer_enable || 0) }}</div>
            <div class="stat-label">总流量</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ formatBytes(userStore.user?.u + userStore.user?.d || 0) }}</div>
            <div class="stat-label">已使用</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">等级 {{ userStore.user?.class || 0 }}</div>
            <div class="stat-label">用户等级</div>
          </div>
        </div>
      </div>
    </el-card>
    
    <el-row :gutter="20" class="profile-cards-row">
      <!-- 基本信息 -->
      <el-col :xs="24" :sm="24" :md="14" :lg="14" :xl="14">
        <el-card class="profile-form-card">
          <div class="card-header">
            <h3>基本信息</h3>
          </div>
          
          <el-form 
            :model="profileForm"
            label-width="100px"
            class="profile-form"
          >
            <el-form-item label="邮箱地址" prop="email">
              <el-input 
                v-model="profileForm.email"
                disabled
                placeholder="请输入邮箱地址"
              />
            </el-form-item>
            
            <el-form-item label="用户名" prop="username">
              <el-input 
                v-model="profileForm.username"
                disabled
                placeholder="请输入用户名"
              />
            </el-form-item>
            
            
            
            <el-form-item label="注册时间">
              <el-input 
                :value="formatDate(userStore.user?.reg_date)"
                disabled
              />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
      
      <!-- 安全设置 -->
      <el-col :xs="24" :sm="24" :md="10" :lg="10" :xl="10">
        <el-card class="security-card">
          <div class="card-header">
            <h3>安全设置</h3>
          </div>
          
          <div class="security-items">
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">
                  <el-icon><Lock /></el-icon>
                  修改密码
                </div>
                <div class="security-desc">定期更换密码以保护账户安全</div>
              </div>
              <el-button @click="showPasswordDialog = true">修改</el-button>
            </div>
            
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">
                  <el-icon><Key /></el-icon>
                  二步验证
                </div>
                <div class="security-desc">
                  <el-tag :type="hasTwoFactor ? 'success' : 'info'" size="small">
                    {{ hasTwoFactor ? '已开启' : '未开启' }}
                  </el-tag>
                  <span class="security-hint">
                    {{ hasTwoFactor ? '建议保管好备用验证码' : '开启后可显著提升安全性' }}
                  </span>
                </div>
              </div>
              <div class="security-actions">
                <template v-if="hasTwoFactor">
                  <el-button size="small" @click="handleRegenerateBackupCodes">
                    重置备用码
                  </el-button>
                  <el-button size="small" type="danger" @click="openDisableTwoFactorDialog">
                    关闭
                  </el-button>
                </template>
                <template v-else>
                  <el-button type="primary" @click="openTwoFactorSetupDialog">
                    立即开启
                  </el-button>
                </template>
              </div>
            </div>
            
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">
                  <el-icon><Message /></el-icon>
                  Bark通知
                </div>
                <div class="security-desc">接收重要通知和流量提醒</div>
              </div>
              <div class="bark-controls">
                <el-switch 
                  v-model="barkNotifications"
                  @change="updateBarkSettings"
                  :disabled="!barkKey.trim()"
                />
                <el-button 
                  type="text" 
                  size="small" 
                  @click="showBarkDialog = true"
                  :class="{ 'bark-configured': barkKey.trim() }"
                >
                  {{ barkKey ? '已配置' : '配置Key' }}
                </el-button>
              </div>
            </div>
          </div>
        </el-card>
        
      </el-col>
    </el-row>

    <!-- 最近在线IP -->
    <el-card class="online-ips-card" style="margin-top: 20px;">
      <div class="card-header">
        <h3>最近在线IP</h3>
        <p class="card-desc">显示最近五分钟内的在线IP地址</p>
      </div>
      
      <div class="online-ips" v-loading="onlineIpsLoading">
        <div v-if="onlineIps.length === 0" class="no-ips">
          <el-empty description="暂无在线IP记录" />
        </div>
        <div v-else class="ips-list">
          <div class="ips-header">
            <span class="header-ip">IP地址</span>
            <span class="header-node">节点</span>
            <span class="header-time">最后活跃时间</span>
          </div>
          <div
            v-for="ip in onlineIps"
            :key="`${ip.ip}-${ip.node_id}`"
            class="ip-item"
          >
            <span class="ip-address">{{ ip.ip }}</span>
            <span class="node-info">{{ ip.node_name || `节点${ip.node_id}` }}</span>
            <span class="last-seen">{{ formatDateTime(ip.last_seen) }}</span>

            <!-- 移动端卡片布局 -->
            <div class="mobile-card-content">
              <div class="mobile-item-row">
                <span class="mobile-label">IP地址:</span>
                <span class="mobile-value mobile-ip">{{ ip.ip }}</span>
              </div>
              <div class="mobile-item-row">
                <span class="mobile-label">节点:</span>
                <span class="mobile-value">{{ ip.node_name || `节点${ip.node_id}` }}</span>
              </div>
              <div class="mobile-item-row">
                <span class="mobile-label">最后活跃:</span>
                <span class="mobile-value">{{ formatDateTime(ip.last_seen) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 登录记录 -->
    <el-card class="login-logs-card" style="margin-top: 20px;">
      <div class="card-header">
        <h3>登录记录</h3>
        <p class="card-desc">请确认都为自己的IP，如有异常请及时修改密码，并重置订阅链接</p>
      </div>
      
      <div class="login-logs" v-loading="loginLogsLoading">
        <div v-if="loginLogs.length === 0 && !loginLogsLoading" class="no-logs">
          <el-empty description="暂无登录记录" />
        </div>
        <div v-else class="logs-list">
          <div class="logs-header">
            <span class="header-ip">IP地址</span>
            <span class="header-time">登录时间</span>
            <span class="header-status">状态</span>
          </div>
          <div
            v-for="log in loginLogs"
            :key="log.id"
            class="log-item"
            :class="{ 'log-failed': log.login_status !== 1 }"
          >
            <span class="log-ip">{{ log.login_ip }}</span>
            <span class="log-time">{{ formatDateTime(log.login_time) }}</span>
            <span class="log-status">
              <el-tag :type="log.login_status === 1 ? 'success' : 'danger'" size="small">
                {{ log.login_status === 1 ? '成功' : '失败' }}
              </el-tag>
            </span>

          </div>
        </div>
      </div>
    </el-card>
    
    <!-- 修改密码对话框 -->
    <el-dialog
      v-model="showPasswordDialog"
      title="修改密码"
      width="400px"
      :before-close="cancelPasswordChange"
    >
      <el-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        label-width="100px"
      >
        <el-form-item label="当前密码" prop="currentPassword">
          <el-input
            v-model="passwordForm.currentPassword"
            type="password"
            placeholder="请输入当前密码"
            show-password
          />
        </el-form-item>
        
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="passwordForm.newPassword"
            type="password"
            placeholder="请输入新密码"
            show-password
          />
        </el-form-item>
        
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="passwordForm.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="cancelPasswordChange">取消</el-button>
        <el-button type="primary" @click="changePassword" :loading="passwordChanging">
          确认修改
        </el-button>
      </template>
    </el-dialog>

    <!-- 二步验证开启 -->
    <el-dialog
      v-model="twoFactorSetupDialogVisible"
      title="开启二步验证"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @close="closeTwoFactorSetupDialog"
    >
      <div v-loading="twoFactorSetupLoading" class="totp-setup">
        <div class="totp-qr" ref="twoFactorQrRef">
          <div class="qr-placeholder" v-if="!twoFactorSetupData.otpAuthUrl">
            <span>二维码加载中...</span>
          </div>
        </div>
        <div class="totp-details">
          <p>使用支持 TOTP 的 App 扫描二维码，或手动输入密钥：</p>
          <el-input
            v-model="twoFactorSetupData.secret"
            readonly
            class="secret-input"
          >
            <template #append>
              <el-button text @click="copyTwoFactorSecret">
                复制
              </el-button>
            </template>
          </el-input>
          <el-divider />
          <el-input
            v-model="twoFactorCodeInput"
            placeholder="请输入 6 位验证码"
            maxlength="10"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="closeTwoFactorSetupDialog">取消</el-button>
        <el-button type="primary" :loading="twoFactorEnabling" @click="confirmEnableTwoFactor">
          确认开启
        </el-button>
      </template>
    </el-dialog>

    <!-- 备用验证码展示 -->
    <el-dialog
      v-model="twoFactorCodesDialogVisible"
      title="备用验证码"
      width="420px"
      :close-on-click-modal="false"
    >
      <p>以下备用验证码仅显示一次，请妥善保管，可用于无法获取动态码时登录。</p>
      <ul class="backup-code-list">
        <li v-for="code in twoFactorBackupCodes" :key="code">{{ code }}</li>
      </ul>
      <template #footer>
        <el-button type="primary" @click="twoFactorCodesDialogVisible = false">
          我已保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 关闭二步验证 -->
    <el-dialog
      v-model="twoFactorDisableDialogVisible"
      title="关闭二步验证"
      width="420px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-width="100px">
        <el-form-item label="账户密码">
          <el-input
            v-model="disableTwoFactorForm.password"
            type="password"
            placeholder="请输入账户密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="验证码">
          <el-input
            v-model="disableTwoFactorForm.code"
            placeholder="请输入动态码或备用码"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="twoFactorDisableDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="disableTwoFactorLoading"
          @click="confirmDisableTwoFactor"
        >
          确认关闭
        </el-button>
      </template>
    </el-dialog>

    <!-- Bark配置对话框 -->
    <el-dialog v-model="showBarkDialog" title="配置Bark通知" width="500px">
      <el-form label-width="100px">
        <el-form-item label="Bark Key">
          <el-input 
            v-model="barkKeyInput"
            placeholder="请输入您的Bark Key"
            clearable
          />
          <div class="form-help">
            <p>• Bark Key支持两种格式：</p>
            <p>• 官方服务器：输入您的设备Key (如: your_device_key)</p>
            <p>• 自建服务器：输入完整URL (如: https://your-bark-server.com/your_key/)</p>
            <p>• 设备Key可在Bark应用的设置中找到</p>
          </div>
        </el-form-item>
      </el-form>
      
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="cancelBarkConfig">取消</el-button>
          <el-button 
            type="info" 
            @click="testBarkKey" 
            :loading="barkTesting"
            :disabled="!barkKeyInput.trim()"
          >
            测试通知
          </el-button>
          <el-button type="primary" @click="saveBarkConfig">保存</el-button>
        </span>
</template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, nextTick } from "vue";
import { ElMessage, ElMessageBox, type FormInstance } from "element-plus";
import { User, Lock, Key, Message } from "@element-plus/icons-vue";
import { changeUserPassword, getBarkSettings, updateBarkSettings as updateBarkSettingsAPI, testBarkNotification, getLoginLogs, startTwoFactorSetup, enableTwoFactor, regenerateTwoFactorBackupCodes, disableTwoFactor } from "@/api/user";
import { getUserProfile } from "@/api/auth";
import { useUserStore } from "@/store/user";
import router from "@/router";
import http from "@/api/http";
import QRCode from "qrcode";

const userStore = useUserStore();

// 响应式数据
const showPasswordDialog = ref(false);
const passwordChanging = ref(false);
const barkNotifications = ref(false);
const showBarkDialog = ref(false);
const barkKey = ref('');
const barkKeyInput = ref('');
const barkTesting = ref(false);
const loginLogs = ref<any[]>([]);
const loginLogsLoading = ref(false);
const onlineIps = ref<any[]>([]);
const onlineIpsLoading = ref(false);
const hasTwoFactor = computed(() => Boolean(userStore.user?.two_factor_enabled));
const twoFactorSetupDialogVisible = ref(false);
const twoFactorDisableDialogVisible = ref(false);
const twoFactorCodesDialogVisible = ref(false);
const twoFactorSetupLoading = ref(false);
const twoFactorEnabling = ref(false);
const twoFactorSetupData = reactive({
  secret: "",
  otpAuthUrl: ""
});
const twoFactorCodeInput = ref("");
const twoFactorBackupCodes = ref<string[]>([]);
const twoFactorQrRef = ref<HTMLElement | null>(null);
const disableTwoFactorForm = reactive({
  password: "",
  code: ""
});
const disableTwoFactorLoading = ref(false);

// 表单引用
const passwordFormRef = ref<FormInstance>();

// 个人信息表单
const profileForm = reactive({
  email: '',
  username: ''
});

// 密码修改表单
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
});

// 表单验证规则
const passwordRules = {
  currentPassword: [
    { required: true, message: '请输入当前密码', trigger: 'blur' }
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value !== passwordForm.newPassword) {
          callback(new Error('两次输入密码不一致'));
        } else {
          callback();
        }
      },
      trigger: 'blur'
    }
  ]
};

// 工具函数
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateStr: string | number): string => {
  if (!dateStr) return '未知';
  
  let date: Date;
  if (typeof dateStr === 'number') {
    // 如果是时间戳，需要判断是秒还是毫秒
    // 如果数值小于 10^12，则认为是秒级时间戳
    if (dateStr < 1000000000000) {
      date = new Date(dateStr * 1000);
    } else {
      date = new Date(dateStr);
    }
  } else {
    date = new Date(dateStr);
  }
  
  // 检查日期是否有效
  if (isNaN(date.getTime())) {
    return '未知';
  }
  
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const getUserStatusType = (status: number) => {
  const statusMap: Record<number, string> = {
    1: 'success',
    0: 'warning',
    [-1]: 'danger'
  };
  return statusMap[status] || 'info';
};

const renderTwoFactorQr = async () => {
  if (!twoFactorQrRef.value || !twoFactorSetupData.otpAuthUrl) return;
  twoFactorQrRef.value.innerHTML = "";
  try {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, twoFactorSetupData.otpAuthUrl, {
      width: 180,
      margin: 1,
      color: {
        dark: "#1f2937",
        light: "#ffffff"
      }
    });
    twoFactorQrRef.value.appendChild(canvas);
  } catch (error) {
    console.error("二维码生成失败", error);
  }
};

const openTwoFactorSetupDialog = async () => {
  try {
    twoFactorSetupLoading.value = true;
    const { data } = await startTwoFactorSetup();
    twoFactorSetupData.secret = data.secret;
    twoFactorSetupData.otpAuthUrl = data.otp_auth_url || data.provisioning_uri;
    twoFactorCodeInput.value = "";
    twoFactorSetupDialogVisible.value = true;
    await nextTick(() => renderTwoFactorQr());
  } catch (error) {
    console.error("获取二步验证密钥失败:", error);
    ElMessage.error((error as any)?.message || "获取二步验证密钥失败，请稍后重试");
  } finally {
    twoFactorSetupLoading.value = false;
  }
};

const closeTwoFactorSetupDialog = () => {
  twoFactorSetupDialogVisible.value = false;
  twoFactorCodeInput.value = "";
};

const copyTwoFactorSecret = async () => {
  if (!twoFactorSetupData.secret) {
    ElMessage.warning("暂无可复制的密钥");
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(twoFactorSetupData.secret);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = twoFactorSetupData.secret;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    ElMessage.success("密钥已复制");
  } catch (error) {
    console.error("复制二步验证密钥失败:", error);
    ElMessage.error("复制失败，请手动选择密钥复制");
  }
};

const showBackupCodesDialog = (codes: string[]) => {
  twoFactorBackupCodes.value = codes;
  twoFactorCodesDialogVisible.value = true;
};

const confirmEnableTwoFactor = async () => {
  if (!twoFactorCodeInput.value.trim()) {
    ElMessage.warning("请输入动态验证码");
    return;
  }
  twoFactorEnabling.value = true;
  try {
    const { data } = await enableTwoFactor({
      code: twoFactorCodeInput.value.trim(),
    });
    ElMessage.success(data?.message || "二步验证已开启");
    closeTwoFactorSetupDialog();
    userStore.updateUser({
      two_factor_enabled: 1,
      has_two_factor_backup_codes: true,
    });
    localStorage.removeItem("soga_tf_trust_token");
    if (Array.isArray(data?.backup_codes)) {
      showBackupCodesDialog(data.backup_codes);
    }
  } catch (error) {
    console.error("启用二步验证失败:", error);
    ElMessage.error((error as any)?.message || "启用失败，请检查验证码");
  } finally {
    twoFactorEnabling.value = false;
  }
};

const handleRegenerateBackupCodes = async () => {
  if (!hasTwoFactor.value) {
    ElMessage.warning("请先开启二步验证");
    return;
  }
  try {
    const { value, action } = await ElMessageBox.prompt(
      "请输入当前动态验证码或备用码，以生成新的备用验证码。",
      "重置备用验证码",
      {
        confirmButtonText: "生成",
        cancelButtonText: "取消",
        inputPlaceholder: "请输入验证码",
        inputPattern: /\S+/,
        inputErrorMessage: "请输入验证码",
      }
    );
    if (action === "cancel") return;
    const { data } = await regenerateTwoFactorBackupCodes({
      code: value.trim(),
    });
    ElMessage.success(data?.message || "备用验证码已更新");
    if (Array.isArray(data?.backup_codes)) {
      showBackupCodesDialog(data.backup_codes);
    }
  } catch (error) {
    if (error === "cancel") return;
    console.error("生成备用验证码失败:", error);
    ElMessage.error((error as any)?.message || "生成备用验证码失败");
  }
};

const openDisableTwoFactorDialog = () => {
  disableTwoFactorForm.password = "";
  disableTwoFactorForm.code = "";
  twoFactorDisableDialogVisible.value = true;
};

const confirmDisableTwoFactor = async () => {
  if (!disableTwoFactorForm.password || !disableTwoFactorForm.code) {
    ElMessage.warning("请输入密码和验证码");
    return;
  }
  disableTwoFactorLoading.value = true;
  try {
    const { data } = await disableTwoFactor({
      password: disableTwoFactorForm.password,
      code: disableTwoFactorForm.code,
    });
    ElMessage.success(data?.message || "二步验证已关闭");
    twoFactorDisableDialogVisible.value = false;
    userStore.updateUser({
      two_factor_enabled: 0,
      has_two_factor_backup_codes: false,
    });
    localStorage.removeItem("soga_tf_trust_token");
  } catch (error) {
    console.error("关闭二步验证失败:", error);
    ElMessage.error((error as any)?.message || "关闭失败，请检查信息");
  } finally {
    disableTwoFactorLoading.value = false;
  }
};

const getUserStatusText = (status: number) => {
  const statusMap: Record<number, string> = {
    1: '正常',
    0: '未激活',
    [-1]: '已禁用'
  };
  return statusMap[status] || '未知';
};

// 基本信息仅供展示
const initializeForm = () => {
  if (userStore.user) {
    profileForm.email = userStore.user.email || '';
    profileForm.username = userStore.user.username || '';
  }
};

// 密码修改相关方法
const cancelPasswordChange = () => {
  showPasswordDialog.value = false;
  passwordForm.currentPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
  passwordFormRef.value?.clearValidate();
};

const changePassword = async () => {
  if (!passwordFormRef.value) return;
  
  try {
    await passwordFormRef.value.validate();
    passwordChanging.value = true;
    
    await changeUserPassword({
      current_password: passwordForm.currentPassword,
      new_password: passwordForm.newPassword
    });
    
    ElMessage.success('密码修改成功');
    cancelPasswordChange();
    
    // 提示用户重新登录
    setTimeout(() => {
      ElMessageBox.alert('密码已修改，需要重新登录', '提示', {
        confirmButtonText: '确定',
        type: 'info'
      }).then(() => {
        userStore.clearUser();
        router.push('/login');
      });
    }, 1000);
    
  } catch (error) {
    console.error('密码修改失败:', error);
    ElMessage.error('密码修改失败，请检查当前密码是否正确');
  } finally {
    passwordChanging.value = false;
  }
};

// Bark通知设置
const updateBarkSettings = async (value: boolean) => {
  if (!barkKey.value.trim()) {
    ElMessage.error('请先配置Bark Key');
    barkNotifications.value = false;
    return;
  }
  
  try {
    await updateBarkSettingsAPI({
      bark_key: barkKey.value,
      bark_enabled: value
    });
    ElMessage.success(`Bark通知已${value ? '开启' : '关闭'}`);
  } catch (error) {
    console.error('更新Bark设置失败:', error);
    ElMessage.error('更新失败，请重试');
    // 回滚状态
    barkNotifications.value = !value;
  }
};

const cancelBarkConfig = () => {
  barkKeyInput.value = barkKey.value;
  showBarkDialog.value = false;
};

const saveBarkConfig = async () => {
  if (!barkKeyInput.value.trim()) {
    ElMessage.error('请输入Bark Key');
    return;
  }
  
  try {
    await updateBarkSettingsAPI({
      bark_key: barkKeyInput.value,
      bark_enabled: barkNotifications.value
    });
    
    barkKey.value = barkKeyInput.value;
    showBarkDialog.value = false;
    ElMessage.success('Bark Key配置已保存');
  } catch (error) {
    console.error('保存Bark配置失败:', error);
    ElMessage.error('保存失败，请重试');
  }
};

const testBarkKey = async () => {
  if (!barkKeyInput.value.trim()) {
    ElMessage.error('请先输入Bark Key');
    return;
  }
  
  barkTesting.value = true;
  
  try {
    const { data } = await testBarkNotification(barkKeyInput.value);
    
    // 检查API响应的success字段，这是我们后端统一的响应格式
    if (data.success) {
      ElMessage.success(data.message || '测试通知发送成功！请检查您的设备');
    } else {
      ElMessage.error(data.message || '测试失败，请检查Bark Key设置');
    }
  } catch (error) {
    console.error('测试Bark通知失败:', error);
    ElMessage.error('测试失败，请检查Bark Key设置是否正确');
  } finally {
    barkTesting.value = false;
  }
};

// 加载登录记录
const loadLoginLogs = async () => {
  loginLogsLoading.value = true;
  try {
    const response = await getLoginLogs({ limit: 10 });

    // 处理不同的数据结构
    let logs = [];
    if (response.data && response.data.data) {
      logs = response.data.data;
    } else if (response.data && Array.isArray(response.data)) {
      logs = response.data;
    } else if (Array.isArray(response)) {
      logs = response;
    }

    loginLogs.value = logs;
  } catch (error) {
    console.error('加载登录记录失败:', error);
    ElMessage.error('加载登录记录失败');
  } finally {
    loginLogsLoading.value = false;
  }
};

// 加载在线IP记录
const loadOnlineIps = async () => {
  onlineIpsLoading.value = true;
  try {
    const response = await http.get('/user/online-ips-detail');
    onlineIps.value = response.data.data || [];
  } catch (error) {
    console.error('加载在线IP失败:', error);
    onlineIps.value = [];
  } finally {
    onlineIpsLoading.value = false;
  }
};

// 加载Bark设置
const loadBarkSettings = async () => {
  try {
    const { data } = await getBarkSettings();
    barkKey.value = data.bark_key || '';
    barkNotifications.value = data.bark_enabled;
    barkKeyInput.value = barkKey.value;
  } catch (error) {
    console.error('加载Bark设置失败:', error);
  }
};

// 格式化日期时间
const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return '--';
  }
};

// 加载用户资料
const loadUserProfile = async () => {
  try {
    const { data } = await getUserProfile();
    userStore.setUser(data);
    initializeForm();
  } catch (error) {
    console.error('获取用户信息失败:', error);
    ElMessage.error('获取用户信息失败');
  }
};

// 生命周期
onMounted(async () => {
  // 先加载用户资料确保数据是最新的
  await loadUserProfile();
  loadBarkSettings();
  loadLoginLogs();
  loadOnlineIps();
});
</script>

<style scoped lang="scss">
.profile-page {
  .page-header {
    margin-bottom: 20px;
    
    h2 {
      margin: 0 0 8px 0;
      color: #303133;
    }
    
    p {
      margin: 0;
      color: #909399;
    }
  }
}

.user-info-card {
  margin-bottom: 20px;
  
  .user-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    
    .user-avatar {
      display: flex;
      align-items: center;
      gap: 20px;
      
      .user-basic {
        h3 {
          margin: 0 0 8px 0;
          color: #303133;
          font-size: 20px;
        }
        
        p {
          margin: 0 0 8px 0;
          color: #909399;
          font-size: 14px;
        }
      }
    }
    
    .user-stats {
      display: flex;
      gap: 30px;
      
      .stat-item {
        text-align: center;
        
        .stat-value {
          font-size: 18px;
          font-weight: bold;
          color: #303133;
          margin-bottom: 5px;
          display: block;
        }
        
        .stat-label {
          color: #909399;
          font-size: 12px;
        }
      }
    }
  }
}

.profile-form-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid #ebeef5;
    
    h3 {
      margin: 0;
      color: #303133;
    }
    
    .edit-actions {
      display: flex;
      gap: 10px;
    }
  }
  
  .profile-form {
    :deep(.el-form-item__label) {
      color: #606266;
    }
  }
}

.security-card {
  .card-header {
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid #ebeef5;
    
    h3 {
      margin: 0;
      color: #303133;
    }
  }
  
  .security-items {
    .security-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 0;
      border-bottom: 1px solid #f5f7fa;
      
      &:last-child {
        border-bottom: none;
      }
      
      .security-info {
        .security-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #303133;
          font-weight: 500;
          margin-bottom: 5px;
          
          .el-icon {
            color: #409eff;
          }
        }
        
        .security-desc {
          color: #909399;
          font-size: 12px;
          
          .security-hint {
            margin-left: 8px;
          }
        }
      }
      
      .security-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      
      .bark-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        
        .bark-configured {
          color: #67c23a;
          font-weight: 500;
        }
      }
    }
  }
}

:deep(.el-dialog__body) {
  padding: 20px 20px 10px 20px;
}

.form-help {
  margin-top: 10px;
  padding: 10px;
  background-color: #f8f9fa;
  border-radius: 4px;
  
  p {
    margin: 5px 0;
    font-size: 12px;
    color: #606266;
    
    &:first-child {
      margin-top: 0;
    }
    
    &:last-child {
      margin-bottom: 0;
    }
  }
}

.totp-setup {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  min-height: 220px;
}

.totp-qr {
  width: 200px;
  height: 200px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  
  canvas {
    width: 100%;
    height: 100%;
  }
  
  .qr-placeholder {
    font-size: 13px;
    color: #909399;
  }
}

.totp-details {
  flex: 1;
  font-size: 13px;
  color: #606266;
  
  .secret-input {
    margin: 12px 0;
  }
}

.backup-code-list {
  list-style: none;
  padding: 0;
  margin: 16px 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  
  li {
    background: #f5f7fa;
    border-radius: 6px;
    padding: 8px;
    text-align: center;
    font-family: 'Roboto Mono', monospace;
    letter-spacing: 1px;
    color: #303133;
  }
}

.online-ips-card {
  .card-header {
    margin-bottom: 20px;
    
    h3 {
      margin: 0 0 8px 0;
      color: #303133;
    }
    
    .card-desc {
      margin: 0;
      color: #909399;
      font-size: 13px;
    }
  }
  
  .online-ips {
    .no-ips {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 200px;
    }
    
    .ips-list {
      .ips-header {
        display: flex;
        background: #f8f9fa;
        padding: 12px 16px;
        border-radius: 4px;
        margin-bottom: 8px;
        font-weight: 500;
        color: #606266;
        font-size: 14px;
        
        .header-ip {
          flex: 1.2;
        }
        
        .header-node {
          flex: 1;
        }
        
        .header-time {
          flex: 1.2;
        }
      }
      
      .ip-item {
        display: flex;
        padding: 12px 16px;
        border-bottom: 1px solid #f0f0f0;
        align-items: center;
        
        &:last-child {
          border-bottom: none;
        }
        
        .ip-address {
          flex: 1.2;
          font-family: 'Monaco', 'Consolas', monospace;
          font-size: 13px;
          color: #303133;
          font-weight: 500;
        }
        
        .node-info {
          flex: 1;
          color: #606266;
          font-size: 13px;
        }
        
        .last-seen {
          flex: 1.2;
          color: #909399;
          font-size: 13px;
        }
      }

      .ip-item, .log-item {
        .mobile-card-content {
          display: none;
        }
      }
    }
  }
}

.login-logs-card {
  .card-header {
    margin-bottom: 20px;
    
    h3 {
      margin: 0 0 8px 0;
      color: #303133;
    }
    
    .card-desc {
      margin: 0;
      color: #909399;
      font-size: 13px;
    }
  }
  
  .login-logs {
    .no-logs {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 200px;
    }
    
    .logs-list {
      .logs-header {
        display: flex;
        background: #f8f9fa;
        padding: 12px 16px;
        border-radius: 4px;
        margin-bottom: 8px;
        font-weight: 500;
        color: #606266;
        font-size: 14px;
        
        .header-ip {
          flex: 1;
        }
        
        .header-time {
          flex: 1.2;
        }
        
        .header-status {
          flex: 0.6;
          text-align: center;
        }
      }
      
      .log-item {
        display: flex;
        padding: 12px 16px;
        border-bottom: 1px solid #f0f0f0;
        align-items: center;
        
        &:last-child {
          border-bottom: none;
        }
        
        &.log-failed {
          background: #fef0f0;
        }
        
        .log-ip {
          flex: 1;
          font-family: 'Monaco', 'Consolas', monospace;
          font-size: 13px;
        }
        
        .log-time {
          flex: 1.2;
          color: #606266;
          font-size: 13px;
        }
        
        .log-status {
          flex: 0.6;
          text-align: center;
        }
      }

      // 桌面端隐藏移动端卡片内容
      .log-item {
        .mobile-card-content {
          display: none;
        }
      }
    }
  }
}

/* 移动端优化 */
@media (max-width: 768px) {
  .profile-page {
    padding: 10px;
    
    .page-header {
      margin-bottom: 15px;
      
      h2 {
        font-size: 20px;
        margin-bottom: 5px;
      }
      
      p {
        font-size: 13px;
      }
    }
  }
  
  .user-info-card {
    margin-bottom: 15px;
    
    :deep(.el-card__body) {
      padding: 15px;
    }
    
    .user-header {
      flex-direction: column;
      gap: 15px;
      text-align: center;
      
      .user-avatar {
        flex-direction: column;
        gap: 15px;
        
        :deep(.el-avatar) {
          width: 60px !important;
          height: 60px !important;
        }
        
        .user-basic {
          h3 {
            font-size: 18px;
          }
          
          p {
            font-size: 13px;
          }
        }
      }
      
      .user-stats {
        justify-content: center;
        gap: 20px;
        
        .stat-item {
          .stat-value {
            font-size: 16px;
          }
          
          .stat-label {
            font-size: 11px;
          }
        }
      }
    }
  }
  
  .profile-cards-row {
    margin: 0 -10px;
    
    :deep(.el-col) {
      padding: 0 10px;
      margin-bottom: 15px;
    }
  }
  
  .profile-form-card {
    :deep(.el-card__body) {
      padding: 15px;
    }
    
    .card-header {
      margin-bottom: 15px;
      padding-bottom: 10px;
      
      h3 {
        font-size: 16px;
      }
      
      :deep(.el-button) {
        padding: 6px 12px;
        font-size: 12px;
      }
      
      .edit-actions {
        gap: 8px;
        
        :deep(.el-button) {
          padding: 6px 10px;
          font-size: 12px;
        }
      }
    }
    
    .profile-form {
      :deep(.el-form-item) {
        margin-bottom: 15px;
      }
      
      :deep(.el-form-item__label) {
        font-size: 13px;
        font-weight: 500;
        line-height: 30px;
      }
      
      :deep(.el-input__inner) {
        font-size: 13px;
      }
    }
  }
  
  .security-card {
    :deep(.el-card__body) {
      padding: 15px;
    }
    
    .card-header {
      margin-bottom: 15px;
      padding-bottom: 10px;
      
      h3 {
        font-size: 16px;
      }
    }
    
    .security-items {
      .security-item {
        padding: 12px 0;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        
        .security-info {
          .security-title {
            font-size: 14px;
            margin-bottom: 3px;
          }
          
          .security-desc {
            font-size: 11px;
          }
        }
        
        :deep(.el-button) {
          width: 100%;
          font-size: 13px;
          padding: 8px 15px;
        }
        
        .bark-controls {
          width: 100%;
          justify-content: space-between;
          
          :deep(.el-button--text) {
            font-size: 12px;
            padding: 4px 8px;
          }
        }
      }
    }
  }
  .online-ips-card, .login-logs-card {
    margin-top: 15px;

    :deep(.el-card__body) {
      padding: 15px;
    }

    .card-header {
      margin-bottom: 15px;

      h3 {
        font-size: 16px;
        margin-bottom: 5px;
      }

      .card-desc {
        font-size: 12px;
      }
    }

    .ips-list, .logs-list {
      overflow-x: auto;

      .ips-header, .logs-header {
        min-width: 600px;

        .header-ip {
          min-width: 150px;
        }

        .header-time {
          min-width: 180px;
        }

        .header-status {
          min-width: 80px;
        }
      }

      .ip-item, .log-item {
        min-width: 600px;

        .log-ip, .ip-address {
          min-width: 150px;
          font-size: 12px;
        }

        .log-time {
          min-width: 180px;
          font-size: 12px;
        }

        .log-status {
          min-width: 80px;
        }
      }
    }
  }
  
  :deep(.el-dialog) {
    width: 95% !important;
    margin: 5vh auto;
    
    .el-dialog__header {
      padding: 15px 20px 10px;
      
      .el-dialog__title {
        font-size: 16px;
      }
    }
    
    .el-dialog__body {
      padding: 10px 20px 15px;
    }
    
    .el-dialog__footer {
      padding: 10px 20px 15px;
    }
  }
}

@media (max-width: 480px) {
  .profile-page {
    padding: 8px;
  }
  
  .profile-cards-row {
    margin: 0 -8px;
    
    :deep(.el-col) {
      padding: 0 8px;
    }
  }
  
  .user-info-card {
    .user-header {
      .user-stats {
        gap: 15px;
        
        .stat-item {
          .stat-value {
            font-size: 14px;
          }
        }
      }
    }
  }
  
  .security-card {
    .security-items {
      .security-item {
        padding: 10px 0;
        
        .security-info {
          .security-title {
            font-size: 13px;
          }
          
          .security-desc {
            font-size: 10px;
          }
        }
        
        :deep(.el-button) {
          font-size: 12px;
          padding: 6px 12px;
        }
      }
    }
  }
  
  .online-ips-card, .login-logs-card {
    .ips-list, .logs-list {
      .ip-item, .log-item {
        .log-ip, .ip-address {
          font-size: 11px;
        }

        .log-time {
          font-size: 11px;
        }
      }
    }
  }
}
</style>
