import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getSiteSettings } from "@/api/system";

type FetchStatus = "idle" | "loading" | "success" | "error";

export const useSiteStore = defineStore("site", () => {
  const siteName = ref<string>(
    import.meta.env.VITE_SITE_NAME || "Soga Panel"
  );
  const siteUrl = ref<string>("");
  const status = ref<FetchStatus>("idle");

  const initialized = computed(() => status.value === "success");

  async function init() {
    if (status.value === "loading" || status.value === "success") return;

    if (import.meta.env.VITE_FORCE_SITE_NAME === "true") {
      status.value = "success";
      return;
    }
    status.value = "loading";
    try {
      const { data } = await getSiteSettings();
      if (data?.siteName) {
        siteName.value = data.siteName;
        updateDocumentTitle();
      }
      if (data?.siteUrl) {
        siteUrl.value = data.siteUrl;
      }
      status.value = "success";
    } catch (error) {
      console.warn("加载站点配置失败", error);
      status.value = "error";
    }
  }

 return {
    siteName,
    siteUrl,
    status,
    initialized,
    init,
  };

  function updateDocumentTitle() {
    if (typeof document === "undefined") return;
    const currentTitle = document.title;
    if (!currentTitle) {
      document.title = siteName.value;
      return;
    }
    const parts = currentTitle.split(" - ");
    if (parts.length > 1) {
      parts[parts.length - 1] = siteName.value;
      document.title = parts.join(" - ");
    } else {
      document.title = `${currentTitle} - ${siteName.value}`;
    }
  }
});
