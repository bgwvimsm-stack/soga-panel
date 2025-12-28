<template>
  <div class="doc-full">
    <iframe
      ref="frameRef"
      class="doc-iframe"
      :src="frameSrc"
      title="教程文档"
      loading="lazy"
      frameborder="0"
      allow="fullscreen"
      @load="handleLoaded"
    />
    <div v-if="loading" class="loading-mask">
      <el-icon class="loading-icon" size="28">
        <Loading />
      </el-icon>
      <span>正在加载文档…</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading } from "@element-plus/icons-vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSiteStore } from "@/store/site";

const siteStore = useSiteStore();
const fallbackDocsUrl = "https://vitepress.dev/zh";
const frameSrc = computed(() => {
  const url = (siteStore.docsUrl || "").trim();
  return url || fallbackDocsUrl;
});
const loading = ref(true);
const frameRef = ref<HTMLIFrameElement | null>(null);
const fallbackTimer = ref<number | null>(null);

const handleLoaded = () => {
  loading.value = false;
  if (fallbackTimer.value) {
    clearTimeout(fallbackTimer.value);
    fallbackTimer.value = null;
  }
};

onMounted(() => {
  fallbackTimer.value = window.setTimeout(() => {
    loading.value = false;
  }, 1800);
});

onBeforeUnmount(() => {
  if (fallbackTimer.value) {
    clearTimeout(fallbackTimer.value);
  }
});
</script>

<style scoped lang="scss">
.doc-full {
  position: relative;
  height: calc(100vh - 100px);
  min-height: 600px;
}

.doc-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.loading-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #f7f8fa;
  color: #606266;
}

.loading-icon {
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

@media (max-width: 768px) {
  .doc-full {
    height: calc(100vh - 80px);
    min-height: 480px;
  }
}
</style>
