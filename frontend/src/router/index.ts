import { createRouter, createWebHistory } from "vue-router";
import { isAuthenticated, isAdmin } from "@/utils/auth-soga";
import { ElMessage } from "element-plus";
import { useUserStore } from "@/store/user";
import { useSiteStore } from "@/store/site";
import { routes } from "./routes";

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  }
});

// 检查是否为订阅域名
const isSubscriptionDomain = () => {
  const userStore = useUserStore();
  const currentHost = window.location.hostname;
  const subscriptionUrl = userStore.user?.subscription_url;

  if (!subscriptionUrl || subscriptionUrl.trim() === '') {
    return false;
  }

  try {
    const subscriptionHost = new URL(subscriptionUrl).hostname;
    return currentHost === subscriptionHost;
  } catch (error) {
    console.warn('Invalid subscription URL:', subscriptionUrl);
    return false;
  }
};

// 路由守卫
router.beforeEach((to, from, next) => {
  // 检查订阅域名访问权限（最优先检查）
  if (isSubscriptionDomain()) {
    // 订阅域名只允许访问错误页面，其他页面一律404
    const allowedPaths = ['/error/404', '/404'];
    const isAllowedPath = allowedPaths.some(path => to.path === path || to.path.startsWith(path));

    if (!isAllowedPath) {
      // 重定向到404页面
      next('/error/404');
      return;
    }
  }

  // 设置页面标题
  if (to.meta?.title) {
    const siteStore = useSiteStore();
    const siteName = siteStore.siteName || 'Soga Panel';
    document.title = `${to.meta.title} - ${siteName}`;
  }
  
  // 检查是否需要登录
  if (to.meta?.requiresAuth) {
    if (!isAuthenticated()) {
      ElMessage.warning("请先登录");
      next("/auth/login");
      return;
    }
    
    // 获取用户存储
    const userStore = useUserStore();
    
    // 禁用用户只能访问特定页面
    const allowedPagesForDisabledUser = [
      '/dashboard', '/user/dashboard', 
      '/announcements', '/user/announcements',
      '/profile', '/user/profile'
    ];
    
    // 检查用户是否被禁用
    if (userStore.isDisabledUser()) {
      const isAllowedPage = allowedPagesForDisabledUser.some(allowedPath => 
        to.path === allowedPath || to.path.startsWith(allowedPath)
      );
      
      if (!isAllowedPage) {
        // 管理员被禁用时，仍然允许访问管理页面
        const isAdminPage = to.path.startsWith('/admin/');
        if (!isAdminPage || !userStore.isAdmin()) {
          ElMessage.warning("您的账号已被禁用，只能访问仪表盘、公告详情和个人资料页面");
          next("/dashboard");
          return;
        }
      }
    }
    
    // 检查是否需要管理员权限
    if (to.meta?.requiresAdmin && !isAdmin()) {
      ElMessage.error("权限不足，拒绝访问");
      next("/error/403");
      return;
    }
  }
  
  // 如果已登录用户访问登录页，重定向到仪表板
  if ((to.path === "/login" || to.path === "/auth/login") && isAuthenticated()) {
    next(isAdmin() ? "/admin/dashboard" : "/user/dashboard");
    return;
  }
  
  next();
});

export default router;
