<template>
  <div class="layout-container">
    <el-container>
      <Sidebar class="layout-sidebar" />

      <el-container class="main-container">
        <el-header class="header">
          <div class="header-left">
            <el-button
              class="mobile-menu-btn"
              type="text"
              @click="toggleMobileSidebar"
            >
              <el-icon><Menu /></el-icon>
            </el-button>
            <h3>{{ getPageTitle() }}</h3>
          </div>
          <div class="header-right">
            <el-dropdown @command="handleUserCommand">
              <span class="user-dropdown">
                <el-icon><UserFilled /></el-icon>
                {{ userStore.user?.username }}
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人资料</el-dropdown-item>
                  <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>

        <el-main class="main-content">
          <el-scrollbar>
            <!-- 面包屑导航 - 管理员页面和用户页面都显示，但仪表板页面不显示 -->
            <Breadcrumb v-if="!isDashboard" />

            <router-view />
          </el-scrollbar>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, nextTick } from 'vue';
import { useRouter, useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { UserFilled, ArrowDown, Menu } from "@element-plus/icons-vue";
import { useUserStore } from "@/store/user";
import Sidebar from "@/components/Sidebar/index.vue";
import Breadcrumb from "@/components/Breadcrumb.vue";

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

// CSS已经处理移动端滚动，不再需要JavaScript修复
const fixMobileScrollbar = () => {
  // 保留空函数以防后续需要
};

onMounted(() => {
  // 延迟执行以确保DOM完全渲染
  setTimeout(() => {
    fixMobileScrollbar();
  }, 100);

  // 监听路由变化,每次路由变化后重新修复
  router.afterEach(() => {
    setTimeout(() => {
      fixMobileScrollbar();
    }, 100);
  });

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    setTimeout(() => {
      fixMobileScrollbar();
    }, 100);
  });
});

// 判断是否为管理员页面
const isAdminPage = computed(() => {
  return route.path.startsWith('/admin/');
});

// 判断是否为仪表板页面（管理员或用户仪表板都不显示面包屑）
const isDashboard = computed(() => {
  return route.name === 'AdminDashboard' || route.name === 'Dashboard';
});

const getPageTitle = () => {
  const titleMap: Record<string, string> = {
    '/dashboard': '仪表板',
    '/nodes': '节点列表',
    '/traffic': '流量统计',
    '/subscription': '订阅管理',
    '/user/shared-ids': '苹果账号',
    '/subscription-logs': '订阅记录',
    '/audit-rules': '审计规则',
    '/audit-logs': '审计记录',
    '/profile': '个人资料',
    '/admin/dashboard': '管理概览',
    '/admin/announcements': '公告管理',
    '/admin/nodes': '节点列表',
    '/admin/users': '用户列表',
    '/admin/subscription-logs': '订阅记录',
    '/admin/login-logs': '登录记录',
    '/admin/online-ips': '在线IP',
    '/admin/audit-rules': '审计规则',
    '/admin/audit-logs': '审计记录',
    '/admin/whitelist': '审计白名单',
    '/admin/statistics': '系统统计',
    '/admin/system-configs': '系统配置',
    '/admin/shared-ids': '苹果账号管理',
    '/user/tickets': '工单中心',
    '/admin/tickets': '工单管理'
  };

  return titleMap[route.path] || '控制台';
};

const toggleMobileSidebar = () => {
  // 通过事件发送给Sidebar组件
  const event = new CustomEvent('toggleMobileSidebar');
  window.dispatchEvent(event);
};

const handleUserCommand = (command: string) => {
  switch (command) {
    case 'profile':
      router.push('/user/profile');
      break;
    case 'logout':
      userStore.clearUser();
      ElMessage.success('已退出登录');
      router.push('/login');
      break;
  }
};
</script>

<style scoped lang="scss">
.layout-container {
  height: 100vh;
  display: flex;
}

.layout-sidebar {
  flex-shrink: 0;
}

.main-container {
  flex: 1;
  min-width: 0;
}

.header {
  background-color: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;

  .header-left {
    display: flex;
    align-items: center;

    .mobile-menu-btn {
      display: none;
      margin-right: 10px;
      color: #606266;
      padding: 8px;
      min-width: 40px;
      min-height: 40px;
      border-radius: 6px;

      &:hover {
        color: #409eff;
        background-color: rgba(64, 158, 255, 0.1);
      }

      .el-icon {
        font-size: 20px;
      }
    }

    h3 {
      margin: 0;
      color: #303133;
    }
  }

  .header-right {
    .user-dropdown {
      display: flex;
      align-items: center;
      cursor: pointer;
      color: #606266;

      &:hover {
        color: #409eff;
      }

      .el-icon {
        margin: 0 5px;
      }
    }
  }
}

.main-content {
  background-color: #f5f6fa;
  padding: 0;
  overflow: hidden;

  :deep(.el-scrollbar) {
    height: 100%;
  }

  :deep(.el-scrollbar__wrap) {
    padding: 20px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  :deep(.el-scrollbar__view) {
    height: auto !important;
    min-height: 100%;
  }
}

// 响应式设计
// 移动端样式 - 使用全局样式确保优先级
@media (max-width: 768px) {
  // 禁用HTML和BODY的滚动
  :global(html),
  :global(body) {
    overflow: hidden !important;
    height: 100% !important;
  }

  // 移动端el-scrollbar强制样式 - 针对WebKit优化
  :global(.main-content .el-scrollbar) {
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
  }

  :global(.main-content .el-scrollbar__wrap) {
    flex: 1 !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    -webkit-overflow-scrolling: touch !important;
    padding: 10px !important;
    // WebKit修复：设置明确的高度计算基准
    min-height: 0 !important;
    position: relative !important;
  }

  :global(.main-content .el-scrollbar__view) {
    // WebKit需要明确的高度值，不能用min-content
    min-height: 100% !important;
    height: auto !important;
    // 确保内容可以撑开容器
    display: flex !important;
    flex-direction: column !important;
  }

  // WebKit专用：确保view的子元素正常显示
  :global(.main-content .el-scrollbar__view > *) {
    flex-shrink: 0 !important;
  }

  :global(.main-content .el-scrollbar__bar) {
    display: none !important;
  }

  .layout-container {
    height: 100%;
    overflow: hidden;

    .main-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;

      .header {
        padding: 0 10px;
        flex-shrink: 0;

        .header-left {
          .mobile-menu-btn {
            display: inline-flex;
          }

          h3 {
            font-size: 16px;
          }
        }

        .header-right {
          .user-dropdown {
            font-size: 14px;
          }
        }
      }

      .main-content {
        flex: 1;
        overflow: hidden !important;
        position: relative;
        min-height: 0;
      }
    }
  }
}

@media (max-width: 480px) {
  .layout-container {
    .main-container {
      .header {
        padding: 0 8px;

        .header-left {
          h3 {
            font-size: 14px;
          }
        }
      }

      .main-content {
        :deep(.el-scrollbar__wrap) {
          padding: 8px;
        }
      }
    }
  }
}
</style>
