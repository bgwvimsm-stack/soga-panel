<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElIcon, ElDivider, ElDropdown, ElDropdownMenu, ElDropdownItem, ElPopover, ElScrollbar, ElCheckboxGroup, ElCheckbox } from 'element-plus';
import { FullScreen, ScaleToOriginal, Refresh, Setting } from '@element-plus/icons-vue';
import CollapseIcon from '@/assets/table-bar/collapse.svg?component';

interface ColumnConfig {
  field?: string;
  title?: string;
  columnSelectable?: boolean;
  visible?: boolean;
  [key: string]: unknown;
}

const props = withDefaults(defineProps<{
  title?: string;
  vxeTableRef?: unknown;
  columns: ColumnConfig[];
}>(), {
  title: '列表',
  vxeTableRef: null,
  columns: () => []
});

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'fullscreen', value: boolean): void;
}>();

const size = ref('small');
const loading = ref(false);
const isFullscreen = ref(false);
const dynamicColumns = ref<ColumnConfig[]>([...props.columns]);

const selectableColumns = computed(() =>
  props.columns.filter((col) => col.columnSelectable !== false && (col.title || col.field))
);

const checkedColumns = ref(
  selectableColumns.value
    .filter((col) => col.visible !== false)
    .map((col) => col.title || String(col.field ?? ''))
);

// 监听 columns 变化
watch(() => props.columns, (newVal) => {
  dynamicColumns.value = [...newVal];
  const nextSelectable = newVal.filter((col: any) => col.columnSelectable !== false);
  checkedColumns.value = nextSelectable
    .filter((col: any) => col.visible !== false)
    .map((col: any) => col.title);
}, { immediate: true });

// 刷新
const onRefresh = () => {
  loading.value = true;
  emit('refresh');
  setTimeout(() => {
    loading.value = false;
  }, 500);
};

// 密度切换
const onSizeChange = (newSize: string) => {
  size.value = newSize;
};

// 全屏切换
const onFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
  emit('fullscreen', isFullscreen.value);
};

// 列显示切换
const handleCheckedColumnsChange = (values: string[]) => {
  dynamicColumns.value = props.columns.map((col) => {
    const identifier = col.title || String(col.field ?? "");
    return {
      ...col,
      visible: col.columnSelectable === false ? col.visible !== false : values.includes(identifier)
    };
  });
};

const getSizeLabel = (s: string) => {
  const map = {
    large: '默认',
    default: '默认',
    medium: '中等',
    small: '紧凑',
    mini: '迷你'
  };
  return map[s] || s;
};
</script>

<template>
  <div :class="['vxe-table-bar-wrapper', { 'is-fullscreen': isFullscreen }]">
    <div class="vxe-table-bar-header">
      <div class="vxe-table-bar-title">
        <slot name="title">
          <p class="title-text">{{ title }}</p>
        </slot>
      </div>

      <div class="vxe-table-bar-actions">
        <div v-if="$slots.buttons" class="vxe-table-bar-buttons">
          <slot name="buttons" />
        </div>

        <ElIcon class="action-icon" @click="onRefresh" title="刷新">
          <Refresh :class="{ 'is-loading': loading }" />
        </ElIcon>

        <ElDivider direction="vertical" />

        <ElDropdown @command="onSizeChange" trigger="click">
          <CollapseIcon class="action-icon" title="密度" />
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="large" :class="{ active: size === 'large' }">默认</ElDropdownItem>
              <ElDropdownItem command="medium" :class="{ active: size === 'medium' }">中等</ElDropdownItem>
              <ElDropdownItem command="small" :class="{ active: size === 'small' }">紧凑</ElDropdownItem>
              <ElDropdownItem command="mini" :class="{ active: size === 'mini' }">迷你</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <ElDivider direction="vertical" />

        <ElPopover placement="bottom-end" :width="200" trigger="click">
          <template #reference>
            <ElIcon class="action-icon" title="列设置">
              <Setting />
            </ElIcon>
          </template>
          <div class="column-setting">
            <ElScrollbar max-height="400px">
              <ElCheckboxGroup v-model="checkedColumns" @change="handleCheckedColumnsChange">
                <div
                  v-for="(col, index) in selectableColumns"
                  :key="col.field || col.title || index"
                  class="column-item"
                >
                  <ElCheckbox
                    :label="col.title || col.field || `column_${index}`"
                    :value="col.title || col.field || `column_${index}`"
                  >
                    {{ col.title || col.field || `列${index + 1}` }}
                  </ElCheckbox>
                </div>
              </ElCheckboxGroup>
            </ElScrollbar>
          </div>
        </ElPopover>

        <ElDivider direction="vertical" />

        <ElIcon class="action-icon" @click="onFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">
          <component :is="isFullscreen ? ScaleToOriginal : FullScreen" />
        </ElIcon>
      </div>
    </div>

    <div class="vxe-table-bar-content">
      <slot :size="size" :dynamicColumns="dynamicColumns" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.vxe-table-bar-wrapper {
  width: 100%;
  padding: 8px;
  background-color: var(--el-bg-color);
  margin-top: 8px;

  &.is-fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2002;
    height: 100vh !important;
    margin: 0;
  }
}

.vxe-table-bar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  height: 60px;
  padding: 0 16px;
}

.vxe-table-bar-title {
  .title-text {
    font-weight: 600;
    font-size: 16px;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.vxe-table-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vxe-table-bar-buttons {
  display: flex;
  align-items: center;
  margin-right: 16px;
}

.action-icon {
  width: 16px;
  height: 16px;
  cursor: pointer;
  color: var(--el-text-color-primary);
  transition: color 0.2s;

  &:hover {
    color: var(--el-color-primary);
  }

  .is-loading {
    animation: rotating 1s linear infinite;
  }
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.vxe-table-bar-content {
  padding: 8px 0;
}

.column-setting {
  .column-item {
    padding: 4px 0;
  }
}

:deep(.el-dropdown-menu__item.active) {
  background-color: var(--el-color-primary);
  color: #fff;
}
</style>
