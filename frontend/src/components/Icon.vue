<template>
  <i :class="iconClass" />
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  name: string;
  size?: string | number;
}

const props = withDefaults(defineProps<Props>(), {
  size: "16px"
});

const iconClass = computed(() => {
  // 使用Element Plus内置图标
  const iconMap: Record<string, string> = {
    'search-eye-line': 'el-icon-search',
    'fullscreen-fill': 'el-icon-full-screen',
    'fullscreen-exit-fill': 'el-icon-aim',
    'user': 'el-icon-user',
    'message': 'el-icon-message',
    'lock': 'el-icon-lock',
    'dashboard': 'el-icon-odometer',
    'nodes': 'el-icon-connection',
    'traffic': 'el-icon-trend-charts',
    'subscription': 'el-icon-link',
    'profile': 'el-icon-user-filled',
    'admin': 'el-icon-setting',
    'statistics': 'el-icon-data-analysis',
    'logout': 'el-icon-switch-button'
  };
  
  return iconMap[props.name] || 'el-icon-document';
});
</script>

<style scoped>
i {
  font-size: v-bind('typeof props.size === "number" ? props.size + "px" : props.size');
}
</style>