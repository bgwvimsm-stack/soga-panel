<template>
  <el-dialog
    v-model="visible"
    title="扫码支付"
    width="350px"
    center
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <div class="payment-qrcode-container">
      <div class="amount-info">
        <span class="label">应付金额</span>
        <span class="amount">¥{{ amount.toFixed(2) }}</span>
      </div>
      
      <div 
        class="qrcode-wrapper" 
        v-loading="loading || !url"
        element-loading-text="正在获取二维码..."
      >
        <canvas v-show="url && !loading" ref="qrcodeCanvas"></canvas>
        <div v-if="!url && !loading" class="qrcode-placeholder">
          <el-icon class="loading-icon"><Loading /></el-icon>
          <p>正在生成支付订单...</p>
        </div>
      </div>
      
      <div class="payment-tips">
        <p v-if="paymentType === 'wechat'"><el-icon><ChatLineRound /></el-icon> 请使用微信扫码完成支付</p>
        <p v-else-if="paymentType === 'alipay'"><el-icon><CreditCard /></el-icon> 请使用支付宝扫码完成支付</p>
        <p v-else>请使用对应 APP 扫码支付</p>
      </div>

      <div class="action-footer">
        <el-button v-if="isMobile && url" type="primary" link @click="openApp">
          打开 APP 支付
        </el-button>
      </div>
    </div>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="visible = false">取消支付</el-button>
        <el-button type="success" @click="handleSuccess">已完成支付</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import QRCode from 'qrcode';
import { ElMessage } from 'element-plus';
import { ChatLineRound, CreditCard, Loading } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: Boolean,
  url: {
    type: String,
    default: ''
  },
  amount: {
    type: Number,
    default: 0
  },
  paymentType: {
    type: String,
    default: 'alipay'
  }
});

const emit = defineEmits(['update:modelValue', 'success', 'closed']);

const visible = ref(false);
const loading = ref(false);
const qrcodeCanvas = ref<HTMLCanvasElement | null>(null);
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// 监听弹窗显示
watch(() => props.modelValue, (val) => {
  visible.value = val;
  if (val && props.url) {
    nextTick(() => {
      generateQRCode();
    });
  }
});

// 监听 URL 变化，自动刷新二维码
watch(() => props.url, (newUrl) => {
  if (visible.value && newUrl) {
    nextTick(() => {
      generateQRCode();
    });
  }
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

const generateQRCode = async () => {
  if (!props.url || !qrcodeCanvas.value) return;
  
  loading.value = true;
  try {
    await QRCode.toCanvas(qrcodeCanvas.value, props.url, {
      width: 250,
      margin: 2,
      color: {
        dark: '#333333',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('QR Code generation failed:', err);
    ElMessage.error('二维码生成失败');
  } finally {
    loading.value = false;
  }
};

const openApp = () => {
  if (props.url) {
    window.location.href = props.url;
  }
};

const handleSuccess = () => {
  emit('success');
  visible.value = false;
};

const handleClosed = () => {
  emit('closed');
};
</script>

<style scoped>
.payment-qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
}

.amount-info {
  margin-bottom: 20px;
  text-align: center;
}

.amount-info .label {
  font-size: 14px;
  color: #909399;
  margin-right: 8px;
}

.amount-info .amount {
  font-size: 24px;
  font-weight: bold;
  color: #f56c6c;
}

.qrcode-wrapper {
  background: #fff;
  padding: 10px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
  width: 250px;
  height: 250px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.qrcode-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #909399;
  font-size: 14px;
}

.loading-icon {
  font-size: 32px;
  margin-bottom: 10px;
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.payment-tips {
  color: #606266;
  font-size: 14px;
  margin-bottom: 15px;
}

.payment-tips p {
  display: flex;
  align-items: center;
  gap: 5px;
}

.action-footer {
  margin-top: 10px;
}
</style>
