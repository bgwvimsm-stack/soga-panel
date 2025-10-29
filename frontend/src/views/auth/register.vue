<template>
  <div class="auth-page">
    <div class="auth-panel">
      <div class="brand">
        <div class="brand-logo">S</div>
        <div class="brand-title">注册账户</div>
        <p class="brand-subtitle">创建您的 {{ appTitle }} 账户</p>
      </div>

      <el-form
        v-if="configLoaded"
        ref="registerFormRef"
        :model="registerForm"
        :rules="registerRules"
        class="auth-form"
        @keyup.enter="handleRegister"
      >
        <el-form-item prop="email">
          <el-input
            v-model="registerForm.email"
            placeholder="请输入邮箱地址"
            size="large"
            clearable
            :prefix-icon="Message"
          />
        </el-form-item>
        <el-form-item prop="username">
          <el-input
            v-model="registerForm.username"
            placeholder="请输入用户名"
            size="large"
            clearable
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="registerForm.password"
            type="password"
            placeholder="请输入密码"
            size="large"
            show-password
            clearable
            :prefix-icon="Lock"
          />
        </el-form-item>
        <el-form-item prop="confirmPassword">
          <el-input
            v-model="registerForm.confirmPassword"
            type="password"
            placeholder="请确认密码"
            size="large"
            show-password
            clearable
            :prefix-icon="Lock"
          />
        </el-form-item>
        <el-form-item v-if="showVerification" prop="verificationCode">
          <div class="code-group">
            <el-input
              v-model="registerForm.verificationCode"
              placeholder="请输入邮箱验证码"
              size="large"
              clearable
              :prefix-icon="MessageBox"
            />
            <el-button
              class="code-btn"
              type="primary"
              size="large"
              :loading="sendingCode"
              :disabled="!configLoaded || sendingCode || codeCountdown > 0"
              @click="handleSendCode"
            >
              {{ codeCountdown > 0 ? `${codeCountdown}s` : "发送验证码" }}
            </el-button>
          </div>
        </el-form-item>
      </el-form>

      <el-button
        v-if="configLoaded"
        type="primary"
        size="large"
        class="auth-submit"
        :loading="loading"
        @click="handleRegister"
      >
        创建账户
      </el-button>

      <div v-else class="config-loading">
        <el-icon class="loading-icon"><Loading /></el-icon>
        <span>加载注册配置...</span>
      </div>

      <div class="auth-footer">
        <span>已有账号？</span>
        <el-button type="primary" link @click="goToLogin">立即登录</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onBeforeUnmount, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { Message, User, Lock, MessageBox, Loading } from "@element-plus/icons-vue";
import {
  register,
  sendRegisterEmailCode,
  getRegisterConfig
} from "@/api/auth";
import { setToken } from "@/utils/auth-soga";
import { useUserStore } from "@/store/user";
import { useSiteStore } from "@/store/site";

const router = useRouter();
const userStore = useUserStore();

const siteStore = useSiteStore();
const appTitle = computed(() => siteStore.siteName || "Soga Panel");
const registerFormRef = ref<FormInstance>();
const loading = ref(false);
const sendingCode = ref(false);
const codeCountdown = ref(0);
const showVerification = ref(false);
const configLoaded = ref(false);
let countdownTimer: number | null = null;

const registerForm = reactive({
  email: "",
  username: "",
  password: "",
  confirmPassword: "",
  verificationCode: ""
});

const isGmailAlias = (email: string) => {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  if (domain !== "gmail.com" && domain !== "googlemail.com") return false;
  return local.includes("+") || local.includes(".");
};

const validateConfirmPassword = (rule: any, value: any, callback: any) => {
  if (value !== registerForm.password) {
    callback(new Error("两次输入密码不一致"));
  } else {
    callback();
  }
};

const registerRules = computed<FormRules>(() => ({
  email: [
    { required: true, message: "请输入邮箱地址", trigger: "blur" },
    { type: "email", message: "请输入正确的邮箱格式", trigger: "blur" }
  ],
  username: [
    { required: true, message: "请输入用户名", trigger: "blur" },
    { min: 3, max: 20, message: "用户名长度在3到20个字符", trigger: "blur" }
  ],
  password: [
    { required: true, message: "请输入密码", trigger: "blur" },
    { min: 6, message: "密码长度不能少于6位", trigger: "blur" }
  ],
  confirmPassword: [
    { required: true, message: "请确认密码", trigger: "blur" },
    { validator: validateConfirmPassword, trigger: "blur" }
  ],
  verificationCode: showVerification.value
    ? [
        { required: true, message: "请输入邮箱验证码", trigger: "blur" },
        { pattern: /^\d{6}$/, message: "请输入6位数字验证码", trigger: "blur" }
      ]
    : []
}));

const clearCountdown = () => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
  codeCountdown.value = 0;
};

const startCountdown = (seconds: number) => {
  clearCountdown();
  if (seconds <= 0) return;
  codeCountdown.value = seconds;
  countdownTimer = window.setInterval(() => {
    if (codeCountdown.value <= 1) {
      clearCountdown();
    } else {
      codeCountdown.value -= 1;
    }
  }, 1000);
};

const handleSendCode = async () => {
  if (!configLoaded.value || !showVerification.value) return;
  if (sendingCode.value || codeCountdown.value > 0) return;

  if (!registerForm.email) {
    ElMessage.warning("请先输入邮箱地址");
    return;
  }

  if (isGmailAlias(registerForm.email)) {
    ElMessage.warning("暂不支持使用 Gmail 别名注册，请使用原始邮箱地址");
    return;
  }

  if (registerFormRef.value) {
    const valid = await registerFormRef.value
      .validateField("email")
      .catch(() => false);
    if (!valid) return;
  }

  try {
    sendingCode.value = true;
    await sendRegisterEmailCode({ email: registerForm.email });
    ElMessage.success("验证码已发送，请查收邮箱");
    startCountdown(60);
  } catch (error) {
    console.error("发送验证码失败:", error);
    ElMessage.error((error as any)?.message || "发送验证码失败，请稍后重试");
  } finally {
    sendingCode.value = false;
  }
};

const handleRegister = async () => {
  if (!registerFormRef.value) return;

  const valid = await registerFormRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    const { data } = await register({
      email: registerForm.email,
      username: registerForm.username,
      password: registerForm.password,
      verificationCode: registerForm.verificationCode
    });

    setToken(data.token);
    userStore.setUser(data.user);
    ElMessage.success("注册成功");
    router.push("/dashboard");
  } catch (error) {
    console.error("注册失败:", error);
    ElMessage.error((error as any)?.message || "注册失败，请稍后重试");
  } finally {
    loading.value = false;
  }
};

const goToLogin = () => {
  router.push("/auth/login");
};

onMounted(async () => {
  try {
    const { data } = await getRegisterConfig();
    showVerification.value = data?.verificationEnabled === true;
  } catch (error) {
    console.error("获取注册配置失败:", error);
    showVerification.value = false;
  } finally {
    configLoaded.value = true;
  }
});

onBeforeUnmount(() => {
  clearCountdown();
});
</script>

<style scoped lang="scss">
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f7f9fc;
  padding: 40px 16px;
}

.auth-panel {
  width: 420px;
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(79, 70, 229, 0.08);
  padding: 36px 40px 32px;
}

.config-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #9ca3af;
  margin-top: 16px;
}

.config-loading .loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.brand {
  text-align: center;
  margin-bottom: 24px;
}

.brand-logo {
  width: 64px;
  height: 64px;
  line-height: 64px;
  margin: 0 auto 12px;
  border-radius: 20px;
  font-size: 28px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #5a6cea 0%, #8f44fd 100%);
  box-shadow: 0 12px 25px rgba(122, 111, 250, 0.22);
}

.brand-title {
  font-size: 24px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
}

.brand-subtitle {
  color: #9ca3af;
  font-size: 14px;
}

.auth-form {
  :deep(.el-input__wrapper) {
    border-radius: 10px;
    box-shadow: none;
    border: 1px solid #e5e7eb;
    padding: 0 14px;
  }

  :deep(.el-input__wrapper.is-focus) {
    border-color: #5a6cea;
    box-shadow: 0 0 0 3px rgba(90, 108, 234, 0.15);
  }

  :deep(.el-input__inner) {
    font-size: 15px;
  }
}

.code-group {
  display: flex;
  gap: 10px;

  :deep(.el-input) {
    flex: 1;
  }
}

.code-btn {
  min-width: 110px;
  border-radius: 10px;
}

.auth-submit {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 12px;
  background: linear-gradient(135deg, #5a6cea 0%, #7c3aed 100%);
  border: none;
  margin-top: 6px;
}

.auth-footer {
  margin-top: 18px;
  text-align: center;
  color: #6b7280;
  font-size: 14px;
}
</style>
