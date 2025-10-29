<template>
  <div class="auth-page">
    <div class="auth-panel">
      <div class="brand">
        <div class="brand-logo">S</div>
        <div class="brand-title">找回密码</div>
        <p class="brand-subtitle">输入注册邮箱获取验证码并重置密码</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        class="auth-form"
        @keyup.enter="handleResetPassword"
      >
        <el-form-item prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入注册邮箱地址"
            size="large"
            clearable
            :prefix-icon="Message"
          />
        </el-form-item>
        <el-form-item prop="verificationCode">
          <div class="code-group">
            <el-input
              v-model="form.verificationCode"
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
              :disabled="sendingCode || codeCountdown > 0"
              @click="handleSendCode"
            >
              {{ codeCountdown > 0 ? `${codeCountdown}s` : "获取验证码" }}
            </el-button>
          </div>
        </el-form-item>
        <el-form-item prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            placeholder="请输入新密码"
            size="large"
            show-password
            clearable
            :prefix-icon="Lock"
          />
        </el-form-item>
        <el-form-item prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            size="large"
            show-password
            clearable
            :prefix-icon="Lock"
          />
        </el-form-item>
      </el-form>

      <el-button
        type="primary"
        size="large"
        class="auth-submit"
        :loading="loading"
        @click="handleResetPassword"
      >
        重置密码
      </el-button>

      <div class="auth-footer">
        <el-button type="primary" link @click="goToLogin">返回登录</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { Message, MessageBox, Lock } from "@element-plus/icons-vue";
import {
  sendPasswordResetCode,
  confirmPasswordReset
} from "@/api/auth";

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const sendingCode = ref(false);
const codeCountdown = ref(0);
let countdownTimer: number | null = null;

const form = reactive({
  email: "",
  verificationCode: "",
  newPassword: "",
  confirmPassword: ""
});

const validateConfirmPassword = (rule: any, value: any, callback: any) => {
  if (value !== form.newPassword) {
    callback(new Error("两次输入的新密码不一致"));
  } else {
    callback();
  }
};

const formRules: FormRules = {
  email: [
    { required: true, message: "请输入注册邮箱地址", trigger: "blur" },
    { type: "email", message: "请输入正确的邮箱格式", trigger: "blur" }
  ],
  verificationCode: [
    { required: true, message: "请输入邮箱验证码", trigger: "blur" },
    { pattern: /^\d{6}$/, message: "请输入6位数字验证码", trigger: "blur" }
  ],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 6, message: "新密码长度不能少于6位", trigger: "blur" }
  ],
  confirmPassword: [
    { required: true, message: "请确认新密码", trigger: "blur" },
    { validator: validateConfirmPassword, trigger: "blur" }
  ]
};

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
  if (sendingCode.value || codeCountdown.value > 0) return;

  if (!form.email) {
    ElMessage.warning("请先输入注册邮箱地址");
    return;
  }

  if (formRef.value) {
    const valid = await formRef.value
      .validateField("email")
      .catch(() => false);
    if (!valid) return;
  }

  try {
    sendingCode.value = true;
    await sendPasswordResetCode({ email: form.email });
    ElMessage.success("验证码已发送，请查收邮箱");
    startCountdown(60);
  } catch (error) {
    console.error("发送验证码失败:", error);
    ElMessage.error((error as any)?.message || "发送验证码失败，请稍后重试");
  } finally {
    sendingCode.value = false;
  }
};

const handleResetPassword = async () => {
  if (!formRef.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    await confirmPasswordReset({
      email: form.email,
      verificationCode: form.verificationCode,
      newPassword: form.newPassword,
      confirmPassword: form.confirmPassword
    });
    ElMessage.success("密码重置成功，请使用新密码登录");
    router.push("/auth/login");
  } catch (error) {
    console.error("重置密码失败:", error);
    ElMessage.error((error as any)?.message || "重置密码失败，请稍后重试");
  } finally {
    loading.value = false;
  }
};

const goToLogin = () => {
  router.push("/auth/login");
};

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
