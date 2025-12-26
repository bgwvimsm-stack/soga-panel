<template>
  <div class="user-page user-audit-rules">
    <div class="page-header">
      <h2>审计规则</h2>
      <p>查看当前生效的审计规则和限制条件</p>
    </div>

    <!-- 规则说明 -->
    <el-card class="info-card">
      <template #header><span>规则说明</span></template>
      <el-alert title="重要提醒" type="warning" :closable="false" show-icon>
        <div>
          <p>为了系统的正常运行，特制定了如下过滤规则</p>
          <p>当您使用节点执行这些动作时，您的通信就会被截断</p>
        </div>
      </el-alert>
    </el-card>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="当前生效规则" @refresh="loadRules">
      <template v-slot="{ size, dynamicColumns }">
        <vxe-grid
          ref="vxeTableRef"
          v-loading="loading"
          show-overflow
          :height="getTableHeight(size)"
          :size="size"
          :column-config="{ resizable: true }"
          :row-config="{ isHover: true, keyField: 'id' }"
          :columns="dynamicColumns"
          :data="rules"
          :pager-config="pagerConfig"
          @page-change="handlePageChange"
        >
          <template #name="{ row }">
            <div class="rule-name">
              <el-icon class="rule-icon" :class="getRuleTypeClass(row.action)">
                <component :is="getRuleIcon(row.action)" />
              </el-icon>
              <span>{{ row.name }}</span>
            </div>
          </template>
          <template #pattern="{ row }">
            <el-tag size="small" type="info" class="rule-pattern">{{ row.pattern }}</el-tag>
          </template>
          <template #description="{ row }">
            <span class="rule-description">{{ row.description || '无描述' }}</span>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { CircleClose, Warning } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getUserAuditRules } from '@/api/audit';
import type { AuditRule } from '@/api/types';

const vxeTableRef = ref();
const loading = ref(false);
const rules = ref<AuditRule[]>([]);
const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns = [
  { field: 'name', title: '规则名称', width: 180, visible: true, slots: { default: 'name' } },
  { field: 'pattern', title: '匹配规则', minWidth: 200, visible: true, slots: { default: 'pattern' } },
  { field: 'description', title: '规则描述', minWidth: 250, visible: true, slots: { default: 'description' } }
];

const getRuleIcon = (action: string) => {
  return action === 'block' ? CircleClose : Warning;
};

const getRuleTypeClass = (action: string) => {
  return action === 'block' ? 'blocked' : 'warned';
};

const loadRules = async () => {
  loading.value = true;
  try {
    const response = await getUserAuditRules({
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    });
    
    if (response.code === 0 && response.data) {
      rules.value = response.data.rules;
      pagerConfig.total = response.data.pagination.total || 0;
    } else {
      throw new Error(response.message || '获取审计规则失败');
    }
  } catch (error) {
    console.error('加载审计规则失败:', error);
    ElMessage.error('加载审计规则失败');
    rules.value = [];
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadRules();
};

onMounted(() => {
  loadRules();
});
</script>

<style scoped lang="scss">
.user-audit-rules {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }

  .info-card { margin-bottom: 24px; }

  .rule-name {
    display: flex;
    align-items: center;
    .rule-icon {
      margin-right: 8px;
      &.blocked { color: #f56c6c; }
      &.warned { color: #e6a23c; }
    }
  }

  .rule-pattern {
    font-family: monospace;
    font-size: 12px;
  }

  .rule-description {
    color: #606266;
    font-size: 13px;
  }

  :deep(.el-alert) div p {
    margin: 8px 0;
    color: #606266;
    font-size: 14px;
    line-height: 1.5;
    &:first-child { margin-top: 0; }
    &:last-child { margin-bottom: 0; }
  }
}
</style>
