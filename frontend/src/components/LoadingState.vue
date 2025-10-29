<template>
  <div class="loading-state" :class="{ 'full-page': fullPage }">
    <div class="loading-content">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p class="loading-text">{{ text }}</p>
      <p v-if="subText" class="loading-subtext">{{ subText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading } from '@element-plus/icons-vue';

interface Props {
  text?: string;
  subText?: string;
  fullPage?: boolean;
}

withDefaults(defineProps<Props>(), {
  text: '加载中...',
  subText: '',
  fullPage: false
});
</script>

<style scoped lang="scss">
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  
  &.full-page {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.9);
    z-index: 9999;
    min-height: 100vh;
  }
  
  .loading-content {
    text-align: center;
    
    .el-icon {
      font-size: 32px;
      color: var(--el-color-primary);
      margin-bottom: 16px;
    }
    
    .loading-text {
      font-size: 16px;
      color: var(--el-text-color-primary);
      margin: 0 0 8px 0;
    }
    
    .loading-subtext {
      font-size: 14px;
      color: var(--el-text-color-regular);
      margin: 0;
    }
  }
}
</style>