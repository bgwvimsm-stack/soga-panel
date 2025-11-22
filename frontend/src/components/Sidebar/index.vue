<template>
  <div class="sidebar-wrapper" :class="$attrs.class">
    <div
      class="sidebar-container"
      :class="{
        'sidebar-collapse': isCollapse,
        'sidebar-mobile-show': isMobileMenuVisible
      }"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <SidebarLogo :collapse="isCollapse" />
      <el-scrollbar wrap-class="scrollbar-wrapper" class="scrollbar">
        <el-menu
          unique-opened
          mode="vertical"
          class="sidebar-menu"
          :collapse="isCollapse"
          :collapse-transition="false"
          :default-active="activeMenu"
          @select="handleMenuSelect"
        >
          <SidebarItem
            v-for="route in menuRoutes"
            :key="route.path"
            :item="route"
            :base-path="route.path"
          />
        </el-menu>
      </el-scrollbar>


      <!-- 管理员模式切换 (管理员被禁用时仍然显示) -->
      <SidebarModeToggle v-if="isUserAdmin" :is-admin-mode="isAdminMode" :is-collapse="isCollapse" @toggle="toggleAdminMode" />

      <!-- 折叠控制按钮 -->
      <SidebarCollapse
        v-if="showCollapseButton || isCollapse"
        :is-active="!isCollapse"
        @toggle="toggleSidebar"
      />
    </div>

    <!-- 手机端遮罩层 -->
    <div
      v-if="isMobileMenuVisible"
      class="mobile-sidebar-mask mask-show"
      @click="handleMaskClick"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/store/user';

// 禁用属性自动继承
defineOptions({
  inheritAttrs: false
});

import SidebarLogo from './SidebarLogo.vue';
import SidebarItem from './SidebarItem.vue';
import SidebarModeToggle from './SidebarModeToggle.vue';
import SidebarCollapse from './SidebarCollapse.vue';

interface MenuRoute {
  path: string;
  name: string;
  icon: string;
  title: string;
  children?: MenuRoute[];
  meta?: {
    hidden?: boolean;
    adminOnly?: boolean;
    userOnly?: boolean;
  };
}

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

// 状态管理
const isCollapse = ref(false);
const isAdminMode = ref(false);
const showCollapseButton = ref(false);
const isMobileMenuVisible = ref(false);

// 计算属性
const activeMenu = computed(() => route.path);

// 响应式检查管理员状态
const isUserAdmin = computed(() => userStore.isAdmin());

// 菜单路由配置
const userRoutes: MenuRoute[] = [
  { path: '/user/dashboard', name: 'dashboard', icon: 'user-dashboard', title: '仪表板' },
  { path: '/user/announcements', name: 'announcements', icon: 'user-announcement', title: '公告详情' },
  { path: '/user/docs', name: 'docs', icon: 'user-docs', title: '文档教程' },
  { path: '/user/tickets', name: 'tickets', icon: 'user-tickets', title: '工单中心' },
  { path: '/user/wallet', name: 'wallet', icon: 'user-wallet', title: '我的钱包' },
  { path: '/user/invite', name: 'invite', icon: 'user-invite', title: '邀请返利' },
  { path: '/user/store', name: 'store', icon: 'user-store', title: '套餐商店' },
  { path: '/user/nodes', name: 'nodes', icon: 'user-nodes', title: '节点列表' },
  { path: '/user/traffic', name: 'traffic', icon: 'user-traffic', title: '流量统计' },
  { path: '/user/subscription', name: 'subscription', icon: 'user-subscription', title: '订阅管理' },
  { path: '/user/shared-ids', name: 'shared-ids', icon: 'user-shared-ids', title: '苹果账号' },
  { path: '/user/subscription-logs', name: 'subscription-logs', icon: 'user-subscription-logs', title: '订阅记录' },
  { path: '/user/audit-rules', name: 'audit-rules', icon: 'user-audit-rules', title: '审计规则' },
  { path: '/user/audit-logs', name: 'audit-logs', icon: 'user-audit-logs', title: '审计记录' },
  { path: '/user/profile', name: 'profile', icon: 'user-profile', title: '个人资料' }
];

const adminRoutes: MenuRoute[] = [
  { path: '/admin/dashboard', name: 'admin-dashboard', icon: 'admin-dashboard', title: '管理概览' },
  { path: '/admin/announcements', name: 'admin-announcements', icon: 'admin-announcements', title: '公告管理' },
  { path: '/admin/tickets', name: 'admin-tickets', icon: 'admin-tickets', title: '工单管理' },
  { path: '/admin/packages', name: 'admin-packages', icon: 'admin-packages', title: '套餐管理' },
  { path: '/admin/nodes', name: 'admin-nodes', icon: 'admin-nodes', title: '节点列表' },
  { path: '/admin/users', name: 'admin-users', icon: 'admin-users', title: '用户列表' },
  { path: '/admin/shared-ids', name: 'admin-shared-ids', icon: 'admin-apple', title: '苹果账号' },
  {
    path: '/admin/promotions',
    name: 'admin-promotions',
    icon: 'admin-promotions',
    title: '优惠礼卡',
    children: [
      { path: '/admin/coupons', name: 'admin-coupons', icon: 'admin-coupons', title: '优惠券管理' },
      { path: '/admin/gift-cards', name: 'admin-gift-cards', icon: 'admin-gift-cards', title: '礼品卡管理' }
    ]
  },
  {
    path: '/admin/transactions',
    name: 'admin-transactions',
    icon: 'admin-transactions',
    title: '交易记录',
    children: [
      { path: '/admin/recharge-records', name: 'admin-recharge-records', icon: 'admin-recharge', title: '充值记录' },
      { path: '/admin/purchase-records', name: 'admin-purchase-records', icon: 'admin-purchase', title: '购买记录' },
      { path: '/admin/rebate-withdrawals', name: 'admin-rebate-withdrawals', icon: 'admin-withdraw', title: '返利提现' }
    ]
  },
  {
    path: '/admin/log-records',
    name: 'admin-log-records',
    icon: 'admin-logs-group',
    title: '日志记录',
    children: [
      { path: '/admin/subscription-logs', name: 'admin-subscription-logs', icon: 'admin-subscription-logs', title: '订阅记录' },
      { path: '/admin/login-logs', name: 'admin-login-logs', icon: 'admin-login-logs', title: '登录记录' },
      { path: '/admin/online-ips', name: 'admin-online-ips', icon: 'admin-online-ips', title: '在线IP' }
    ]
  },
  {
    path: '/admin/audit-system',
    name: 'admin-audit-system',
    icon: 'admin-audit-group',
    title: '审计系统',
    children: [
      { path: '/admin/audit-rules', name: 'admin-audit-rules', icon: 'admin-audit-rules', title: '审计规则' },
      { path: '/admin/whitelist', name: 'admin-whitelist', icon: 'admin-whitelist', title: '审计白名单' },
      { path: '/admin/audit-logs', name: 'admin-audit-logs', icon: 'admin-audit-logs', title: '审计记录' }
    ]
  },
  { path: '/admin/system-configs', name: 'admin-system-configs', icon: 'admin-system-configs', title: '系统配置' }
];

// 禁用用户可访问的路由
const allowedRoutesForDisabledUser = [
  '/user/dashboard',
  '/user/announcements',
  '/user/docs',
  '/user/profile',
  '/user/tickets'
];

// 当前显示的菜单路由
const menuRoutes = computed(() => {
  if (isAdminMode.value) {
    return adminRoutes;
  }

  // 如果用户被禁用，只显示允许访问的菜单
  if (userStore.isDisabledUser()) {
    return userRoutes.filter(route =>
      allowedRoutesForDisabledUser.includes(route.path)
    );
  }

  return userRoutes;
});

// 监听路由变化，自动设置管理员模式
watch(() => route.path, (newPath) => {
  if (isUserAdmin.value) {
    isAdminMode.value = newPath.startsWith('/admin/');
  }
}, { immediate: true });

// 监听用户状态变化，确保管理员状态更新
watch(() => userStore.user, (newUser) => {
  if (newUser && isUserAdmin.value && route.path.startsWith('/admin/')) {
    isAdminMode.value = true;
  }
}, { immediate: true });

// 方法
const handleMenuSelect = (index: string) => {
  router.push(index);
  // 手机端选择菜单后自动隐藏侧边栏
  if (window.innerWidth <= 768) {
    isMobileMenuVisible.value = false;
  }
};

const handleMouseEnter = () => {
  showCollapseButton.value = true;
};

const handleMouseLeave = () => {
  showCollapseButton.value = false;
};

const toggleSidebar = () => {
  isCollapse.value = !isCollapse.value;
};

const toggleAdminMode = () => {
  if (isAdminMode.value) {
    router.push('/user/dashboard');
  } else {
    router.push('/admin/dashboard');
  }
};


// 监听手机端侧边栏切换事件
const handleMobileToggle = () => {
  isMobileMenuVisible.value = !isMobileMenuVisible.value;
};

// 点击遮罩层隐藏侧边栏
const handleMaskClick = () => {
  if (isMobileMenuVisible.value) {
    isMobileMenuVisible.value = false;
  }
};

// 监听窗口大小变化
const handleResize = () => {
  if (window.innerWidth > 768) {
    isMobileMenuVisible.value = false;
  }
};


// 监听事件
window.addEventListener('toggleMobileSidebar', handleMobileToggle);
window.addEventListener('resize', handleResize);
</script>

<style scoped lang="scss">
.sidebar-wrapper {
  position: relative;
}

.sidebar-container {
  position: relative;
  width: 250px;
  height: 100vh;
  background: var(--sidebar-bg-color, #f9fafb);
  color: var(--sidebar-text-color, #1f2937);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 6px rgba(15, 23, 42, 0.05);
  border-right: 1px solid rgba(15, 23, 42, 0.06);

  &.sidebar-collapse {
    width: 64px;

    .scrollbar {
      :deep(.el-menu) {
        .el-menu-item {
          text-align: center;
          padding: 0 !important;

          span {
            display: none;
          }

          .el-icon {
            margin-right: 0;
          }
        }
      }
    }
  }

  .scrollbar {
    flex: 1;
    overflow: hidden;

    :deep(.scrollbar-wrapper) {
      overflow-x: hidden !important;
    }

    :deep(.el-scrollbar__bar) {
      &.is-vertical {
        right: 0;
        width: 6px;

        .el-scrollbar__thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
      }
    }
  }

  .sidebar-menu {
    border: none;
    background: transparent;
    width: 100%;

    :deep(.el-menu-item) {
      height: 48px;
      line-height: 48px;
      color: var(--sidebar-text-color, #4b5563);
      border-bottom: none;
      margin: 4px 12px;
      width: calc(100% - 24px);
      border-radius: 8px;
      padding: 0 16px;
      font-weight: 500;
      transition: all 0.3s ease;

      &:hover {
        background-color: var(--sidebar-hover-bg);
        color: var(--sidebar-text-color);
      }

      &.is-active {
        background-color: #3b82f6;
        color: #ffffff;
        box-shadow: none;
      }

      .el-icon {
        margin-right: 12px;
        font-size: 18px;
        min-width: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
    }

    :deep(.el-sub-menu__title) {
      height: 48px;
      line-height: 48px;
      color: var(--sidebar-text-color, #4b5563);
      margin: 4px 12px;
      width: calc(100% - 24px);
      border-radius: 8px;
      padding: 0 16px;
      font-weight: 500;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 12px;
      position: relative;

      &:hover {
        background-color: var(--sidebar-hover-bg);
        color: var(--sidebar-text-color);
      }

      .menu-title {
        flex: 1;
      }

      .el-sub-menu__icon-arrow {
        position: static;
        margin-left: auto;
        margin-right: 0;
        align-self: center;
      }
    }

    :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
      background-color: var(--sidebar-active-bg);
      color: #1f2937;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    }

    :deep(.el-menu--inline) {
      background: transparent;
      padding-left: 12px;

      .el-menu-item {
        margin: 4px 0 4px 12px;
        width: calc(100% - 36px);
      }
    }
  }
}

// CSS 变量定义
:root,
[data-theme='dark'],
[data-theme='light'] {
  --sidebar-bg-color: #f9fafb;
  --sidebar-text-color: #1f2937;
  --sidebar-active-bg: rgba(59, 130, 246, 0.15);
  --sidebar-hover-bg: rgba(17, 24, 39, 0.05);
}

// 响应式设计
@media (max-width: 768px) {
  .sidebar-wrapper {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2000;
    pointer-events: none; // 默认不拦截点击事件

    &:has(.sidebar-mobile-show) {
      pointer-events: auto; // 只有当侧边栏显示时才拦截点击事件
    }
  }

  .sidebar-container {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2001; // 比wrapper高
    height: 100vh;
    height: 100dvh; // 动态视口高度，排除浏览器UI
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    box-shadow: 2px 0 12px rgba(0, 0, 0, 0.25); // 增加阴影效果
    max-height: 100vh;
    max-height: 100dvh;
    overflow: hidden;

    &.sidebar-mobile-show {
      transform: translateX(0);
    }

    // 确保滚动容器正确计算高度
    .scrollbar {
      flex: 1;
      min-height: 0; // 允许flexbox子元素缩小

      :deep(.scrollbar-wrapper) {
        height: 100%;
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }
    }

    &.sidebar-collapse {
      width: 250px; // 手机端不使用折叠模式

      .scrollbar {
        :deep(.el-menu) {
          .el-menu-item {
            text-align: left;
            padding: 0 20px !important;
            min-height: 48px; // 确保足够的点击区域
            display: flex;
            align-items: center;

            span {
              display: inline;
            }

            .el-icon {
              margin-right: 12px;
              flex-shrink: 0; // 防止图标被压缩
            }
          }
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .sidebar-container {
    width: 220px;

    .sidebar-menu {
      :deep(.el-menu-item) {
        height: 44px;
        line-height: 44px;
        padding: 0 16px;
        font-size: 14px;

        .el-icon {
          margin-right: 10px;
          font-size: 16px;
        }
      }
    }
  }
}

// 手机端遮罩层
.mobile-sidebar-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000; // 与wrapper同级，在侧边栏下方
  backdrop-filter: blur(3px); // 添加模糊效果
  transition: opacity 0.3s ease;
  opacity: 0;
  visibility: hidden;

  @media (max-width: 768px) {
    display: block;
  }

  // 当遮罩层需要显示时
  &.mask-show {
    opacity: 1;
    visibility: visible;
  }
}
</style>
    :deep(.el-sub-menu__title .menu-icon) {
      min-width: 18px;
      font-size: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 0;
    }
