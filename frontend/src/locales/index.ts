import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';
import zhCNEleLocale from 'element-plus/es/locale/lang/zh-cn';
import enUSEleLocale from 'element-plus/es/locale/lang/en';

// 支持的语言列表
export const locales = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' }
];

// 获取浏览器默认语言
export function getBrowserLocale(): string {
  const navigator = window.navigator;
  const languages = navigator.languages || [navigator.language];
  
  for (const lang of languages) {
    const locale = lang.toLowerCase();
    if (locale.startsWith('zh')) return 'zh-CN';
    if (locale.startsWith('en')) return 'en-US';
  }
  
  return 'zh-CN'; // 默认中文
}

// 从本地存储获取语言设置
export function getStoredLocale(): string {
  return localStorage.getItem('locale') || getBrowserLocale();
}

// 保存语言设置到本地存储
export function setStoredLocale(locale: string): void {
  localStorage.setItem('locale', locale);
}

// 创建 i18n 实例
const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  },
  globalInjection: true
});

export default i18n;

// 切换语言的辅助函数
export function switchLocale(locale: string) {
  i18n.global.locale.value = locale as any;
  setStoredLocale(locale);
  
  // 更新 HTML lang 属性
  document.documentElement.lang = locale;
  
  // 更新 Element Plus 语言
  const elementLocaleMap: Record<string, any> = {
    'zh-CN': zhCNEleLocale,
    'en-US': enUSEleLocale
  };

  const elementLocale = elementLocaleMap[locale];
  if (elementLocale) {
    // 这里可以通过事件或状态管理来更新 Element Plus 语言
    // 由于我们在 main.ts 中已经设置了中文，这里只是示例
  }
}

// 获取当前语言信息
export function getCurrentLocaleInfo() {
  const currentLocale = i18n.global.locale.value;
  return locales.find(locale => locale.code === currentLocale) || locales[0];
}

// 类型安全的翻译函数
export function t(key: string, ...args: any[]): string {
  const translate = i18n.global.t as (...params: any[]) => string;
  return translate(key, ...args);
}
