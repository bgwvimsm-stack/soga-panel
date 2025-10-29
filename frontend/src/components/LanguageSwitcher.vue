<template>
  <el-dropdown trigger="click" @command="handleLocaleChange">
    <el-button text>
      <span class="locale-flag">{{ currentLocaleInfo.flag }}</span>
      <span class="locale-name">{{ currentLocaleInfo.name }}</span>
      <el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item 
          v-for="locale in locales" 
          :key="locale.code"
          :command="locale.code"
          :class="{ active: locale.code === currentLocale }"
        >
          <span class="locale-flag">{{ locale.flag }}</span>
          <span class="locale-name">{{ locale.name }}</span>
          <el-icon v-if="locale.code === currentLocale" class="check-icon">
            <Check />
          </el-icon>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDown, Check } from '@element-plus/icons-vue';
import { locales, switchLocale, getCurrentLocaleInfo } from '@/locales';

const { locale } = useI18n();

const currentLocale = computed(() => locale.value);
const currentLocaleInfo = computed(() => getCurrentLocaleInfo());

const handleLocaleChange = (localeCode: string) => {
  if (localeCode !== currentLocale.value) {
    switchLocale(localeCode);
  }
};
</script>

<style scoped lang="scss">
.locale-flag {
  margin-right: 8px;
  font-size: 16px;
}

.locale-name {
  font-size: 14px;
}

.el-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 120px;
  
  &.active {
    background-color: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
  
  .check-icon {
    margin-left: 8px;
    color: var(--el-color-primary);
  }
}
</style>