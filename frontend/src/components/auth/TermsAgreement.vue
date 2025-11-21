<template>
  <div class="terms-agreement" :class="{ 'is-hidden': hideCheckbox }">
    <el-checkbox v-if="!hideCheckbox" v-model="checkboxValue" class="terms-checkbox">
      <span class="terms-text">
        注册即代表同意
        <button type="button" class="terms-link" @click.stop="openDialog">
          服务条款
        </button>
        。
      </span>
    </el-checkbox>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="520px"
      :append-to-body="true"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <slot name="dialog-top" />
      <div class="terms-body">
        <section v-for="section in termsSections" :key="section.title" class="terms-section">
          <h4>{{ section.title }}</h4>
          <p v-for="(paragraph, idx) in section.content" :key="`${section.title}-${idx}`">
            {{ paragraph }}
          </p>
        </section>
      </div>
      <template #footer>
        <el-button @click="handleDecline">拒绝</el-button>
        <el-button type="primary" @click="handleAccept">同意</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";

interface Props {
  modelValue?: boolean;
  dialogTitle?: string;
  declineMessage?: string;
  hideCheckbox?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  dialogTitle: "服务条款",
  declineMessage: "不同意将无法继续注册账户",
  hideCheckbox: false
});

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "accepted"): void;
  (event: "declined"): void;
}>();

const dialogVisible = ref(false);

const termsSections = [
  {
    title: "服务使用",
    content: [
      "您在本平台创建账号仅限于合法、合规的业务或个人用途，不得用于违反所在地法律法规的活动。",
      "平台可能根据运营需要调整功能或限制访问，您继续使用即视为接受相关调整。"
    ]
  },
  {
    title: "数据与隐私",
    content: [
      "我们会根据隐私政策处理您提供的个人信息，包括账号资料、日志与支付记录。",
      "为保障服务稳定运行，您同意我们在必要范围内存储和传输数据，但不会向无关第三方披露。"
    ]
  },
  {
    title: "用户义务与违约处理",
    content: [
      "您应妥善保管登录凭证，不得转借、出售或擅自共享。",
      "若发现异常登录、数据泄露或违规内容，应第一时间通知平台并配合排查；否则产生的损失由您自行承担。"
    ]
  },
  {
    title: "生效与终止",
    content: [
      "当您点击“同意”按钮或继续使用平台服务时，即视为全面接受本条款。",
      "如您违反条款或相关政策，我们有权暂停或终止服务，并保留追究责任的权利。"
    ]
  }
] as const;

const openDialog = () => {
  dialogVisible.value = true;
};

const closeDialog = () => {
  dialogVisible.value = false;
};

const checkboxValue = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    if (!value) {
      emit("update:modelValue", false);
      return;
    }
    openDialog();
  }
});

const handleAccept = () => {
  emit("update:modelValue", true);
  emit("accepted");
  closeDialog();
};

const handleDecline = () => {
  emit("update:modelValue", false);
  emit("declined");
  if (props.declineMessage) {
    ElMessage.warning(props.declineMessage);
  }
  closeDialog();
};

defineExpose({
  openDialog
});
</script>

<style scoped lang="scss">
.terms-agreement {
  margin: 12px 0;
}

.terms-agreement.is-hidden {
  margin: 0;
}

.terms-checkbox :deep(.el-checkbox__label) {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  color: #6b7280;
}

.terms-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.terms-link {
  background: none;
  border: none;
  padding: 0;
  color: #6366f1;
  cursor: pointer;
  font-size: 13px;
}

.terms-link:hover {
  text-decoration: underline;
}

.terms-body {
  max-height: 360px;
  overflow-y: auto;
  padding-right: 6px;
}

.terms-section + .terms-section {
  margin-top: 12px;
}

.terms-section h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: #374151;
}

.terms-section p {
  margin: 0 0 6px;
  color: #4b5563;
  line-height: 1.6;
}
</style>
