<template>
  <div
    class="sidebar-collapse"
    :class="{ active: isActive }"
    @click="$emit('toggle')"
  >
    <el-icon class="collapse-icon" :class="{ rotated: !isActive }">
      <ArrowLeft />
    </el-icon>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue';

interface Props {
  isActive: boolean;
}

defineProps<Props>();

defineEmits<{
  (e: 'toggle'): void;
}>();
</script>

<style scoped lang="scss">
.sidebar-collapse {
  position: absolute;
  top: 50%;
  right: -12px;
  z-index: 1002;
  width: 24px;
  height: 34px;
  background: var(--el-bg-color, #ffffff);
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transform: translateY(-50%);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  
  &:hover {
    background: var(--el-color-primary-light-9, #ecf5ff);
    border-color: var(--el-color-primary, #409eff);
    box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
    transform: translateY(-50%) scale(1.1);
    
    .collapse-icon {
      color: var(--el-color-primary, #409eff);
    }
  }
  
  &:active {
    transform: translateY(-50%) scale(0.95);
  }
  
  .collapse-icon {
    font-size: 14px;
    color: var(--el-text-color-regular, #606266);
    transition: all 0.3s ease;
    
    &.rotated {
      transform: rotateY(180deg);
    }
  }
  
  // 深色主题适配
  .dark & {
    background: #374151;
    border-color: #4b5563;
    
    &:hover {
      background: #4b5563;
      border-color: #60a5fa;
      
      .collapse-icon {
        color: #60a5fa;
      }
    }
  }
}
</style>