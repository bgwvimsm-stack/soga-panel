<template>
  <div class="user-layout">
    <slot />
    
    <!-- Crisp客服系统 - 仅在用户页面加载 -->
    <Crisp 
      v-if="crispWebsiteId"
      ref="crispRef"
      :website-id="crispWebsiteId"
      :auto-load="true"
      :push-user-info="true"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { isAuthenticated } from '@/utils/auth-soga';
import Crisp from '@/components/Crisp.vue';
const crispRef = ref();

// Crisp配置
const crispWebsiteId = import.meta.env.VITE_CRISP_WEBSITE_ID || "";

// 组件挂载后，如果用户已登录则推送用户信息
onMounted(() => {
  if (isAuthenticated() && crispRef.value) {
    setTimeout(() => {
      crispRef.value?.pushUserInfoToCrisp?.();
    }, 1500); // 稍微延迟确保页面完全加载
  }
});
</script>

<style scoped>
.user-layout {
  min-height: 100vh;
  padding-bottom: 40px;
}
</style>