import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { setupStore } from "@/store";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import i18n from "@/locales";
import { installGlobalErrorHandler, globalErrorHandler } from "@/utils/error-handler";
import { useVxeTable } from "@/plugins/vxeTable";
import Vue3GoogleLogin from "vue3-google-login";
import { useSiteStore } from "@/store/site";

// 引入样式
import "element-plus/dist/index.css";
import "@/styles/mobile.scss";

// 安装全局错误处理
installGlobalErrorHandler();

// 简化版应用创建
const app = createApp(App);

// 处理Vue应用级错误
app.config.errorHandler = (err, instance, info) => {
  const normalizedError = err instanceof Error ? err : new Error(String(err));
  globalErrorHandler.handleComponentError(normalizedError, instance, info);
};

// 全局注册简化图标组件
import Icon from "./components/Icon.vue";
app.component("Icon", Icon);

// 配置Element Plus
app.use(ElementPlus, {
  locale: zhCn,
});

// 安装国际化插件
app.use(i18n);

// 配置VxeTable
useVxeTable(app);

// 设置store和路由
setupStore(app);
app.use(router);

const siteStore = useSiteStore();
siteStore.init().catch((error) => {
  console.warn("初始化站点配置失败", error);
});

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
if (googleClientId) {
  app.use(Vue3GoogleLogin, {
    clientId: googleClientId,
  });
}

app.mount("#app");
