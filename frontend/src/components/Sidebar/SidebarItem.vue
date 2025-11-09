<template>
  <el-menu-item
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
import {
  Odometer,
  Connection,
  TrendCharts,
  Link,
  Document,
  UserFilled,
  User,
  Bell,
  Timer,
  Monitor,
  Lock,
  Warning,
  ShoppingBag,
  List,
  DataAnalysis,
  ChatDotRound,
  GoodsFilled,
  Money,
  ShoppingCart,
  Switch,
  Avatar,
  Tickets,
  Clock,
  LocationInformation,
  View,
  CircleCheckFilled,
  DocumentCopy,
  Tools,
  Wallet,
  Key,
  CollectionTag
} from '@element-plus/icons-vue';

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

const route = useRoute();

// 图标映射
const iconMap = {
  Odometer,
  Connection,
  TrendCharts,
  Link,
  Document,
  UserFilled,
  User,
  Bell,
  Timer,
  Monitor,
  Lock,
  Warning,
  ShoppingBag,
  List,
  DataAnalysis,
  ChatDotRound,
  GoodsFilled,
  Money,
  ShoppingCart,
  Switch,
  Avatar,
  Tickets,
  Clock,
  LocationInformation,
  View,
  CircleCheckFilled,
  DocumentCopy,
  Tools,
  Wallet,
  Key,
  CollectionTag
};

const getIcon = (iconName: string) => {
  return iconMap[iconName] || Document;
};

const isActive = computed(() => {
  return route.path === props.item.path;
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
