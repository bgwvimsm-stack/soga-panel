<template>
  <template v-if="hasChildren">
    <el-sub-menu :index="item.path">
      <template #title>
        <el-icon class="menu-icon">
          <component :is="getIcon(item.icon)" />
        </el-icon>
        <span class="menu-title">{{ item.title }}</span>
      </template>
      <SidebarItem
        v-for="child in item.children"
        :key="child.path"
        :item="child"
        :base-path="child.path"
      />
    </el-sub-menu>
  </template>
  <el-menu-item
    v-else
    :index="item.path"
    class="sidebar-menu-item"
    :class="{ 'is-active': isActive }"
  >
    <el-icon class="menu-icon">
      <component :is="getIcon(item.icon)" />
    </el-icon>
    <span class="menu-title">{{ item.title }}</span>
  </el-menu-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import IconUserDashboard from '~icons/tabler/layout-dashboard';
import IconUserAnnouncement from '~icons/mdi/bullhorn-outline';
import IconUserTickets from '~icons/mdi/chat-processing-outline';
import IconUserWallet from '~icons/mdi/wallet-outline';
import IconUserStore from '~icons/tabler/shopping-bag';
import IconUserNodes from '~icons/mdi/source-branch';
import IconUserTraffic from '~icons/mdi/chart-line-variant';
import IconUserSubscription from '~icons/mdi/link-variant';
import IconUserSharedIds from '~icons/mdi/key-chain-variant';
import IconUserSubscriptionLogs from '~icons/mdi/history';
import IconUserInvite from '~icons/mdi/account-multiple-plus-outline';
import IconUserAuditRules from '~icons/mdi/shield-sync-outline';
import IconUserAuditLogs from '~icons/mdi/file-search-outline';
import IconUserProfile from '~icons/mdi/account-circle-outline';
import IconAdminDashboard from '~icons/mdi/chart-bell-curve';
import IconAdminAnnouncement from '~icons/mdi/message-badge-outline';
import IconAdminTickets from '~icons/mdi/inbox-multiple-outline';
import IconAdminPackages from '~icons/mdi/package-variant';
import IconAdminPromotions from '~icons/mdi/gift-outline';
import IconAdminCoupons from '~icons/mdi/ticket-percent-outline';
import IconAdminGiftCards from '~icons/mdi/card-giftcard';
import IconAdminTransactions from '~icons/mdi/cash-multiple';
import IconAdminRecharge from '~icons/mdi/cash-plus';
import IconAdminPurchase from '~icons/mdi/cart-variant';
import IconAdminLogsGroup from '~icons/mdi/notebook-outline';
import IconAdminSubscriptionLogs from '~icons/mdi/rss';
import IconAdminLoginLogs from '~icons/mdi/login-variant';
import IconAdminOnlineIps from '~icons/mdi/ip-network-outline';
import IconAdminNodes from '~icons/mdi/server';
import IconAdminUsers from '~icons/mdi/account-group-outline';
import IconAdminAuditGroup from '~icons/mdi/shield-star-outline';
import IconAdminAuditRules from '~icons/mdi/shield-edit-outline';
import IconAdminWhitelist from '~icons/mdi/shield-plus-outline';
import IconAdminAuditLogs from '~icons/mdi/book-search-outline';
import IconAdminSystemConfigs from '~icons/mdi/tune-variant';
import IconAdminAppleAccounts from '~icons/mdi/apple-ios';
import IconAdminWithdraw from '~icons/mdi/cash-refund';

interface MenuItem {
  path: string;
  name: string;
  icon: string;
  title: string;
  children?: MenuItem[];
  meta?: {
    hidden?: boolean;
    adminOnly?: boolean;
    userOnly?: boolean;
  };
}

interface Props {
  item: MenuItem;
  basePath?: string;
}

const props = withDefaults(defineProps<Props>(), {
  basePath: ''
});

defineOptions({ name: 'SidebarItem' });

const route = useRoute();

// 图标映射
const iconMap = {
  'user-dashboard': IconUserDashboard,
  'user-announcement': IconUserAnnouncement,
  'user-tickets': IconUserTickets,
  'user-wallet': IconUserWallet,
  'user-invite': IconUserInvite,
  'user-store': IconUserStore,
  'user-nodes': IconUserNodes,
  'user-traffic': IconUserTraffic,
  'user-subscription': IconUserSubscription,
  'user-shared-ids': IconUserSharedIds,
  'user-subscription-logs': IconUserSubscriptionLogs,
  'user-audit-rules': IconUserAuditRules,
  'user-audit-logs': IconUserAuditLogs,
  'user-profile': IconUserProfile,
  'admin-dashboard': IconAdminDashboard,
  'admin-announcements': IconAdminAnnouncement,
  'admin-tickets': IconAdminTickets,
  'admin-packages': IconAdminPackages,
  'admin-promotions': IconAdminPromotions,
  'admin-coupons': IconAdminCoupons,
  'admin-gift-cards': IconAdminGiftCards,
  'admin-transactions': IconAdminTransactions,
  'admin-recharge': IconAdminRecharge,
  'admin-purchase': IconAdminPurchase,
  'admin-logs-group': IconAdminLogsGroup,
  'admin-subscription-logs': IconAdminSubscriptionLogs,
  'admin-login-logs': IconAdminLoginLogs,
  'admin-online-ips': IconAdminOnlineIps,
  'admin-nodes': IconAdminNodes,
  'admin-users': IconAdminUsers,
  'admin-audit-group': IconAdminAuditGroup,
  'admin-audit-rules': IconAdminAuditRules,
  'admin-whitelist': IconAdminWhitelist,
  'admin-audit-logs': IconAdminAuditLogs,
  'admin-system-configs': IconAdminSystemConfigs,
  'admin-apple': IconAdminAppleAccounts,
  'admin-withdraw': IconAdminWithdraw
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || IconUserDashboard;
};

const hasChildren = computed(() => Array.isArray(props.item.children) && props.item.children.length > 0);

const isActive = computed(() => {
  if (route.path === props.item.path) return true;
  if (hasChildren.value) {
    return props.item.children?.some((child) => route.path.startsWith(child.path));
  }
  return false;
});
</script>

<style scoped lang="scss">
.sidebar-menu-item {
  position: relative;
  
  .menu-icon {
    min-width: 18px;
    margin-right: 12px;
    font-size: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  
  .menu-title {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
  }
}
</style>
