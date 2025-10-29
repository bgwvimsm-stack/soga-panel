import { defineStore } from "pinia";
import { ref } from "vue";

export const useEpThemeStore = defineStore("epTheme", () => {
  const epThemeColor = ref("#409EFF");
  const epTheme = ref("default");

  function setEpThemeColor(newColor: string) {
    epThemeColor.value = newColor;
  }

  return {
    epTheme,
    epThemeColor,
    setEpThemeColor
  };
});

export function useEpThemeStoreHook() {
  return useEpThemeStore();
}
