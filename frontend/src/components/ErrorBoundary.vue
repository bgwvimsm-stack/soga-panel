<template>
  <div v-if="hasError" class="error-boundary">
    <el-result icon="error" title="出现了错误" :sub-title="errorMessage">
      <template #extra>
        <el-button type="primary" @click="retry">重试</el-button>
        <el-button @click="reload">刷新页面</el-button>
      </template>
    </el-result>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, nextTick } from 'vue';
import { ElMessage } from 'element-plus';

const hasError = ref(false);
const errorMessage = ref('');

// 捕获组件内部错误
onErrorCaptured((error, instance, info) => {
  console.error('Error captured:', error);
  console.error('Component info:', info);
  
  hasError.value = true;
  errorMessage.value = error.message || '未知错误';
  
  // 向父组件报告错误
  ElMessage.error('页面渲染出现问题，请尝试刷新');
  
  return false; // 阻止错误继续向上传播
});

const retry = async () => {
  hasError.value = false;
  errorMessage.value = '';
  
  // 等待下一个tick让组件重新渲染
  await nextTick();
};

const reload = () => {
  window.location.reload();
};
</script>

<style scoped lang="scss">
.error-boundary {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
</style>