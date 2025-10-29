<template>
  <div class="sidebar-logo-container" :class="{ collapse: collapse }">
    <transition name="sidebarLogoFade">
      <router-link
        v-if="collapse"
        key="collapse"
        class="sidebar-logo-link"
        to="/dashboard"
        :title="title"
      >
        <div class="logo-icon">S</div>
      </router-link>
      <router-link
        v-else
        key="expand"
        class="sidebar-logo-link"
        to="/dashboard"
        :title="title"
      >
        <div class="logo-icon">S</div>
        <span class="sidebar-title">{{ title }}</span>
      </router-link>
    </transition>
  </div>
</template>

<script setup lang="ts">
interface Props {
  collapse?: boolean;
}

withDefaults(defineProps<Props>(), {
  collapse: false
});

import { computed } from "vue";
import { useSiteStore } from "@/store/site";

const siteStore = useSiteStore();
const title = computed(() => siteStore.siteName || "Soga Panel");
</script>

<style scoped lang="scss">
.sidebar-logo-container {
  position: relative;
  width: 100%;
  height: 56px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  &.collapse {
    .sidebar-logo-link {
      justify-content: center;
      padding: 0;
      
      .logo-icon {
        margin-right: 0;
        font-size: 20px;
      }
    }
  }
  
  .sidebar-logo-link {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    height: 100%;
    padding: 0 20px;
    text-decoration: none;
    transition: all 0.3s ease;
    
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    
    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
      color: white;
      margin-right: 12px;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
    
    .sidebar-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--sidebar-text-color, #ffffff);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1;
    }
  }
}

// Logo过渡动画
.sidebarLogoFade-enter-active,
.sidebarLogoFade-leave-active {
  transition: opacity 0.3s ease;
}

.sidebarLogoFade-enter-from,
.sidebarLogoFade-leave-to {
  opacity: 0;
}
</style>
