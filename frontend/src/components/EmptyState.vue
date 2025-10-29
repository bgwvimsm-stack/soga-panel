<template>
  <div class="empty-state">
    <div class="empty-content">
      <el-icon class="empty-icon">
        <component :is="iconComponent" />
      </el-icon>
      <h3 class="empty-title">{{ title }}</h3>
      <p v-if="description" class="empty-description">{{ description }}</p>
      <div v-if="$slots.action" class="empty-action">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { 
  DocumentRemove, 
  Connection, 
  User, 
  DataLine,
  FolderOpened
} from '@element-plus/icons-vue';

interface Props {
  type?: 'default' | 'nodes' | 'users' | 'traffic' | 'data';
  title?: string;
  description?: string;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'default',
  title: '暂无数据',
  description: ''
});

const iconComponent = computed(() => {
  const iconMap = {
    default: DocumentRemove,
    nodes: Connection,
    users: User,
    traffic: DataLine,
    data: FolderOpened
  };
  return iconMap[props.type];
});
</script>

<style scoped lang="scss">
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 40px;
  
  .empty-content {
    text-align: center;
    max-width: 400px;
    
    .empty-icon {
      font-size: 64px;
      color: var(--el-color-info-light-5);
      margin-bottom: 20px;
    }
    
    .empty-title {
      font-size: 18px;
      color: var(--el-text-color-primary);
      margin: 0 0 12px 0;
      font-weight: 500;
    }
    
    .empty-description {
      font-size: 14px;
      color: var(--el-text-color-regular);
      margin: 0 0 24px 0;
      line-height: 1.5;
    }
    
    .empty-action {
      margin-top: 24px;
    }
  }
}
</style>