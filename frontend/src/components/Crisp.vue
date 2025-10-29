<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { getUser, isAuthenticated } from "@/utils/auth-soga";
import type { User } from "@/api/types";

interface Props {
  websiteId?: string;
  hideOnRoutes?: string[];
  autoLoad?: boolean;
  pushUserInfo?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  websiteId: "",
  hideOnRoutes: () => [],
  autoLoad: true,
  pushUserInfo: true
});

let crispLoaded = false;

// 流量格式化函数
const formatTraffic = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 计算剩余流量
const getUnusedTraffic = (user: User): string => {
  const used = user.upload_traffic + user.download_traffic;
  const total = user.transfer_enable;
  const unused = Math.max(0, total - used);
  return formatTraffic(unused);
};

// 格式化时间
const formatTime = (timeStr: string): string => {
  if (!timeStr) return "未知";
  try {
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return timeStr;
  }
};

// 获取用户等级名称
const getUserClass = (classLevel: number): string => {
  const classMap = {
    0: "免费用户",
    1: "VIP用户",
    2: "高级VIP",
    3: "至尊VIP"
  };
  return classMap[classLevel] || `等级${classLevel}`;
};

// 推送用户信息到Crisp
const pushUserInfoToCrisp = () => {
  if (!props.pushUserInfo || !window.$crisp || !isAuthenticated()) return;
  
  const user = getUser();
  if (!user) return;

  try {
    // 设置用户基本信息
    window.$crisp.push(["set", "user:nickname", user.username]);
    window.$crisp.push(["set", "user:email", user.email]);
    
    // 使用SSPanel格式推送session:data
    window.$crisp.push(["set", "session:data", [
      [
        ["ID", user.id.toString()],
        ["Email", user.email],
        ["Class", getUserClass(user.class)],
        ["vip-time", formatTime(user.class_expire_time)],
        ["last-use", formatTime(user.last_login_time)],
        ["traffic", getUnusedTraffic(user)],
        ["online-IP", "未知"],
        ["money", "0元"]
      ]
    ]]);
    
    console.log("用户信息已推送到Crisp");
  } catch (error) {
    console.error("推送用户信息到Crisp失败:", error);
  }
};

const loadCrisp = () => {
  if (crispLoaded || !props.websiteId) return;

  // 检查当前路由是否需要隐藏
  const currentRoute = window.location.pathname;
  if (props.hideOnRoutes.some(route => currentRoute.includes(route))) {
    return;
  }

  // 创建Crisp配置
  window.$crisp = [];
  window.CRISP_WEBSITE_ID = props.websiteId;

  // 动态加载Crisp脚本
  const script = document.createElement("script");
  script.src = "https://client.crisp.chat/l.js";
  script.async = true;
  script.onload = () => {
    crispLoaded = true;
    console.log("Crisp客服系统加载成功");
    
    // 脚本加载完成后推送用户信息
    setTimeout(() => {
      pushUserInfoToCrisp();
    }, 1000); // 延迟1秒确保Crisp完全初始化
  };
  script.onerror = () => {
    console.error("Crisp客服系统加载失败");
  };

  document.head.appendChild(script);
};

const unloadCrisp = () => {
  if (!crispLoaded) return;
  
  // 移除Crisp相关元素
  const crispElements = document.querySelectorAll('[data-crisp], [id*="crisp"], [class*="crisp"]');
  crispElements.forEach(el => el.remove());
  
  // 清理全局变量
  delete window.$crisp;
  delete window.CRISP_WEBSITE_ID;
  
  crispLoaded = false;
};

onMounted(() => {
  if (props.autoLoad) {
    loadCrisp();
  }
});

onBeforeUnmount(() => {
  unloadCrisp();
});

// 暴露方法供父组件调用
defineExpose({
  loadCrisp,
  unloadCrisp,
  pushUserInfoToCrisp
});
</script>

<template>
  <!-- 无需模板内容，纯逻辑组件 -->
</template>