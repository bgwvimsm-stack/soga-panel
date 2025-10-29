<template>
  <div class="admin-mode-toggle" :class="{ collapse: isCollapse }">
    <el-button 
      :type="isAdminMode ? 'danger' : 'primary'"
      :size="isCollapse ? 'small' : 'default'"
      class="mode-toggle-btn"
      @click="$emit('toggle')"
    >
      <el-icon class="toggle-icon">
        <component :is="isAdminMode ? 'User' : 'Setting'" />
      </el-icon>
      <span v-if="!isCollapse" class="toggle-text">
        {{ isAdminMode ? '切换到用户页面' : '切换到管理页面' }}
      </span>
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { User, Setting } from '@element-plus/icons-vue';

interface Props {
  isAdminMode: boolean;
  isCollapse?: boolean;
}

withDefaults(defineProps<Props>(), {
  isCollapse: false
});

defineEmits<{
  (e: 'toggle'): void;
}>();
</script>

<style scoped lang="scss">
.admin-mode-toggle {
  padding: 15px 20px;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  
  &.collapse {
    padding: 15px 10px;
    
    .mode-toggle-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      padding: 0;
      
      .toggle-icon {
        margin: 0;
      }
    }
  }
  
  .mode-toggle-btn {
    width: 100%;
    height: 40px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 8px;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    
    .toggle-icon {
      font-size: 16px;
      flex-shrink: 0;
    }
    
    .toggle-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      text-align: center;
    }
    
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    
    &:active {
      transform: translateY(0);
    }
  }
}

// 移动端优化
@media (max-width: 768px) {
  .admin-mode-toggle {
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);

    .mode-toggle-btn {
      height: 44px;
      font-size: 13px;

      .toggle-icon {
        font-size: 18px;
      }

      .toggle-text {
        font-size: 13px;
      }
    }

    &.collapse {
      .mode-toggle-btn {
        width: 44px;
        height: 44px;
      }
    }
  }
}

@media (max-width: 480px) {
  .admin-mode-toggle {
    padding: 10px 14px;

    .mode-toggle-btn {
      height: 40px;
      font-size: 12px;

      .toggle-icon {
        font-size: 16px;
      }

      .toggle-text {
        font-size: 12px;
      }
    }
  }
}
</style>