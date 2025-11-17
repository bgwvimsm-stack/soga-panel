import type { RouteRecordRaw } from "vue-router";

// 路由配置
export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/user/dashboard"
  },
  // 旧路由兼容重定向
  {
    path: "/login",
    redirect: "/auth/login"
  },
  {
    path: "/register",
    redirect: "/auth/register"
  },
  {
    path: "/dashboard",
    redirect: "/user/dashboard"
  },
  {
    path: "/auth/login",
    name: "Login",
    component: () => import("@/views/auth/login.vue"),
    meta: {
      title: "登录",
      requiresAuth: false,
      layout: false
    }
  },
  {
    path: "/auth/register",
    name: "Register",
    component: () => import("@/views/auth/register.vue"),
    meta: {
      title: "注册",
      requiresAuth: false,
      layout: false
    }
  },
  {
    path: "/auth/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/auth/forgot-password.vue"),
    meta: {
      title: "找回密码",
      requiresAuth: false,
      layout: false
    }
  },
  // 用户页面路由
  {
    path: "/user",
    component: () => import("@/layouts/MainLayout.vue"),
    children: [
      {
        path: "dashboard",
        name: "Dashboard",
        component: () => import("@/views/user/dashboard.vue"),
        meta: {
          title: "仪表板",
          requiresAuth: true
        }
      },
      {
        path: "nodes",
        name: "Nodes",
        component: () => import("@/views/user/nodes.vue"),
        meta: {
          title: "节点列表",
          requiresAuth: true
        }
      },
      {
        path: "traffic",
        name: "Traffic",
        component: () => import("@/views/user/traffic.vue"),
        meta: {
          title: "流量统计",
          requiresAuth: true
        }
      },
      {
        path: "subscription",
        name: "Subscription",
        component: () => import("@/views/user/subscription.vue"),
        meta: {
          title: "订阅管理",
          requiresAuth: true
        }
      },
      {
        path: "shared-ids",
        name: "SharedIds",
        component: () => import("@/views/user/shared-ids.vue"),
        meta: {
          title: "苹果账号",
          requiresAuth: true
        }
      },
      {
        path: "subscription-logs",
        name: "SubscriptionLogs",
        component: () => import("@/views/user/subscription-logs.vue"),
        meta: {
          title: "订阅记录",
          requiresAuth: true
        }
      },
      {
        path: "announcements",
        name: "Announcements",
        component: () => import("@/views/user/announcements.vue"),
        meta: {
          title: "公告详情",
          requiresAuth: true
        }
      },
      {
        path: "tickets",
        name: "UserTickets",
        component: () => import("@/views/user/tickets.vue"),
        meta: {
          title: "工单中心",
          requiresAuth: true
        }
      },
      {
        path: "profile",
        name: "Profile",
        component: () => import("@/views/user/profile.vue"),
        meta: {
          title: "个人资料",
          requiresAuth: true
        }
      },
      {
        path: "wallet",
        name: "Wallet",
        component: () => import("@/views/user/wallet.vue"),
        meta: {
          title: "我的钱包",
          requiresAuth: true
        }
      },
      {
        path: "store",
        name: "Store",
        component: () => import("@/views/user/store.vue"),
        meta: {
          title: "套餐商店",
          requiresAuth: true
        }
      },
      {
        path: "audit-rules",
        name: "AuditRules",
        component: () => import("@/views/user/audit-rules.vue"),
        meta: {
          title: "审计规则",
          requiresAuth: true
        }
      },
      {
        path: "audit-logs",
        name: "AuditLogs",
        component: () => import("@/views/user/audit-logs.vue"),
        meta: {
          title: "审计记录",
          requiresAuth: true
        }
      }
    ]
  },
  // 管理员布局路由
  {
    path: "/admin",
    component: () => import("@/layouts/MainLayout.vue"),
    children: [
      {
        path: "",
        redirect: "/admin/dashboard"
      },
      {
        path: "dashboard",
        name: "AdminDashboard",
        component: () => import("@/views/admin/dashboard.vue"),
        meta: {
          title: "管理员仪表板",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "users",
        name: "AdminUsers",
        component: () => import("@/views/admin/users.vue"),
        meta: {
          title: "用户管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "nodes",
        name: "AdminNodes",
        component: () => import("@/views/admin/nodes.vue"),
        meta: {
          title: "节点管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "announcements",
        name: "AdminAnnouncements",
        component: () => import("@/views/admin/announcements.vue"),
        meta: {
          title: "公告管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "tickets",
        name: "AdminTickets",
        component: () => import("@/views/admin/tickets.vue"),
        meta: {
          title: "工单管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "subscription-logs",
        name: "AdminSubscriptionLogs",
        component: () => import("@/views/admin/subscription-logs.vue"),
        meta: {
          title: "订阅记录",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "login-logs",
        name: "AdminLoginLogs",
        component: () => import("@/views/admin/login-logs.vue"),
        meta: {
          title: "登录记录",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "online-ips",
        name: "AdminOnlineIPs",
        component: () => import("@/views/admin/online-ips.vue"),
        meta: {
          title: "在线IP",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "audit-rules",
        name: "AdminAuditRules",
        component: () => import("@/views/admin/audit-rules.vue"),
        meta: {
          title: "审计规则",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "audit-logs",
        name: "AdminAuditLogs",
        component: () => import("@/views/admin/audit-logs.vue"),
        meta: {
          title: "审计记录",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "whitelist",
        name: "AdminWhitelist",
        component: () => import("@/views/admin/whitelist.vue"),
        meta: {
          title: "审计白名单",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "statistics",
        name: "AdminStatistics",
        component: () => import("@/views/admin/statistics.vue"),
        meta: {
          title: "系统统计",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "system-configs",
        name: "AdminSystemConfigs",
        component: () => import("@/views/admin/system-configs.vue"),
        meta: {
          title: "系统配置",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "shared-ids",
        name: "AdminSharedIds",
        component: () => import("@/views/admin/shared-ids.vue"),
        meta: {
          title: "苹果账号管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "packages",
        name: "AdminPackages",
        component: () => import("@/views/admin/packages.vue"),
        meta: {
          title: "套餐管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "gift-cards",
        name: "AdminGiftCards",
        component: () => import("@/views/admin/gift-cards.vue"),
        meta: {
          title: "礼品卡管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "coupons",
        name: "AdminCoupons",
        component: () => import("@/views/admin/coupons.vue"),
        meta: {
          title: "优惠券管理",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "recharge-records",
        name: "AdminRechargeRecords",
        component: () => import("@/views/admin/recharge-records.vue"),
        meta: {
          title: "充值记录",
          requiresAuth: true,
          requiresAdmin: true
        }
      },
      {
        path: "purchase-records",
        name: "AdminPurchaseRecords",
        component: () => import("@/views/admin/purchase-records.vue"),
        meta: {
          title: "购买记录",
          requiresAuth: true,
          requiresAdmin: true
        }
      }
    ]
  },
  // 错误页面
  {
    path: "/error",
    name: "Error",
    children: [
      {
        path: "403",
        name: "Error403",
        component: () => import("@/views/error/403.vue"),
        meta: {
          title: "403 - 访问被拒绝",
          layout: false
        }
      },
      {
        path: "404",
        name: "Error404",
        component: () => import("@/views/error/404.vue"),
        meta: {
          title: "404 - 页面不存在",
          layout: false
        }
      },
      {
        path: "500",
        name: "Error500",
        component: () => import("@/views/error/500.vue"),
        meta: {
          title: "500 - 服务器错误",
          layout: false
        }
      }
    ]
  },
  {
    path: "/403",
    redirect: "/error/403"
  },
  {
    path: "/404",
    redirect: "/error/404"
  },
  {
    path: "/500",
    redirect: "/error/500"
  },
  // 404页面
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/error/404.vue"),
    meta: {
      title: "页面不存在",
      layout: false
    }
  }
];
