<template>
  <div class="breadcrumb-container">
    <el-breadcrumb separator=">" class="breadcrumb">
      <el-breadcrumb-item :to="homeRoute">
        <el-icon><House /></el-icon>
        {{ homeTitle }}
      </el-breadcrumb-item>
      <el-breadcrumb-item 
        v-for="(item, index) in breadcrumbItems" 
        :key="index"
        :to="item.to"
      >
        {{ item.title }}
      </el-breadcrumb-item>
    </el-breadcrumb>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { House } from '@element-plus/icons-vue';

interface BreadcrumbItem {
  title: string;
  to?: any;
}

const route = useRoute();
const router = useRouter();

// 判断是否为管理员页面
const isAdminPage = computed(() => {
  return route.path.startsWith('/admin/');
});

// 根据页面类型确定首页路由和标题
const homeRoute = computed(() => {
  return isAdminPage.value ? { name: 'AdminDashboard' } : { name: 'Dashboard' };
});

const homeTitle = computed(() => {
  return isAdminPage.value ? '管理中心' : '首页';
});

// 根据当前路由生成面包屑
const breadcrumbItems = computed<BreadcrumbItem[]>(() => {
  const matched = route.matched.filter(item => item.meta && item.meta.title);
  
  return matched.map((item, index) => {
    const isLast = index === matched.length - 1;
    
    return {
      title: item.meta?.title as string,
      to: isLast ? undefined : { name: item.name }
    };
  });
});
</script>

<style scoped lang="scss">
.breadcrumb-container {
  margin-bottom: 20px;
  padding: 12px 0;
  
  .breadcrumb {
    :deep(.el-breadcrumb__item) {
      .el-breadcrumb__inner {
        color: #606266;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
        
        &:hover {
          color: #409eff;
        }
        
        .el-icon {
          font-size: 16px;
        }
      }
      
      &:last-child .el-breadcrumb__inner {
        color: #303133;
        font-weight: 500;
        cursor: text;
        
        &:hover {
          color: #303133;
        }
      }
      
      .el-breadcrumb__separator {
        color: #c0c4cc;
        margin: 0 8px;
      }
    }
  }
}

/* 移动端优化 */
@media (max-width: 768px) {
  .breadcrumb-container {
    margin-bottom: 15px;
    padding: 8px 0;
    
    .breadcrumb {
      :deep(.el-breadcrumb__item) {
        .el-breadcrumb__inner {
          font-size: 13px;
          gap: 4px;
          
          .el-icon {
            font-size: 14px;
          }
        }
        
        .el-breadcrumb__separator {
          margin: 0 6px;
          font-size: 12px;
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .breadcrumb-container {
    padding: 6px 0;
    margin-bottom: 12px;
    
    .breadcrumb {
      :deep(.el-breadcrumb__item) {
        .el-breadcrumb__inner {
          font-size: 12px;
          gap: 3px;
          
          .el-icon {
            font-size: 13px;
          }
        }
        
        .el-breadcrumb__separator {
          margin: 0 4px;
          font-size: 11px;
        }
      }
    }
  }
}
</style>