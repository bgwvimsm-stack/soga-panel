<template>
  <div class="system-configs-container">
    <!-- 配置详情表格 -->
    <el-card v-loading="loading">
      <template #header>
        <span>系统配置管理</span>
      </template>
      
      <el-table :data="configList" stripe>
        <el-table-column prop="key" label="配置键" width="200" />
        <el-table-column prop="value" label="当前值" min-width="150">
          <template #default="scope">
            <el-input
              v-if="scope.row.editing"
              v-model="scope.row.editValue"
              :type="getInputType(scope.row.key)"
              size="small"
              @keyup.enter="handleSaveEdit(scope.row)"
            >
              <template #append v-if="getUnit(scope.row.key)">
                {{ getUnit(scope.row.key) }}
              </template>
            </el-input>
            <span v-else>{{ scope.row.value }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" />
        <el-table-column label="操作" width="120">
          <template #default="scope">
            <div v-if="scope.row.editing" class="edit-buttons">
              <el-button 
                size="small" 
                type="primary" 
                @click="handleSaveEdit(scope.row)"
                :loading="scope.row.saving"
              >
                保存
              </el-button>
              <el-button 
                size="small" 
                @click="handleCancelEdit(scope.row)"
              >
                取消
              </el-button>
            </div>
            <el-button 
              v-else
              size="small" 
              type="primary" 
              @click="handleStartEdit(scope.row)"
            >
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="config-hints" v-if="configList.length > 0">
        <el-alert 
          title="配置说明" 
          type="info" 
          :closable="false"
          show-icon
        >
          <ul>
            <li><strong>default_traffic</strong>: 默认10GB = 10737418240 字节</li>
            <li><strong>traffic_reset_day</strong>: 0表示不执行每月定时任务，1-31表示每月几号重置流量</li>
            <li><strong>register_enabled</strong>: 0=禁用，1=开放注册，2=仅允许邀请码注册</li>
            <li><strong>default_class</strong>: 新用户默认等级，数字越大权限越高</li>
            <li><strong>register_email_verification_enabled</strong>: 1 开启注册验证码，0 可关闭此功能</li>
            <li><strong>rebate_rate</strong>: 邀请返利比例，0.1 表示 10%</li>
            <li><strong>rebate_mode</strong>: first_order=首单返利，every_order=每笔返利</li>
            <li><strong>invite_default_limit</strong>: 默认邀请码可使用次数（0 表示不限）</li>
            <li><strong>rebate_withdraw_fee_rate</strong>: 返利提现手续费比例（0.05 表示 5%）</li>
            <li><strong>rebate_withdraw_min_amount</strong>: 返利提现最低金额（元）</li>
          </ul>
        </el-alert>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit } from '@element-plus/icons-vue'
import { 
  getSystemConfigs,
  updateSystemConfig,
  type SystemConfig
} from '@/api/admin'

interface ExtendedSystemConfig extends SystemConfig {
  saving?: boolean
  editing?: boolean
  editValue?: string
}

const loading = ref(false)
const configList = ref<ExtendedSystemConfig[]>([])

// 获取系统配置
const fetchConfigs = async () => {
  try {
    loading.value = true
    const response = await getSystemConfigs()
    const configs = Array.isArray(response.data) ? response.data : []
    
    // 初始化扩展属性
    configList.value = configs.map(config => ({
      ...config,
      editing: false,
      editValue: config.value || '',
      saving: false
    }))
  } catch (error: any) {
    ElMessage.error(error.message || '获取系统配置失败')
    configList.value = []
  } finally {
    loading.value = false
  }
}

// 开始编辑
const handleStartEdit = (config: ExtendedSystemConfig) => {
  config.editing = true
  config.editValue = config.value || ''
}

// 取消编辑
const handleCancelEdit = (config: ExtendedSystemConfig) => {
  config.editing = false
  config.editValue = config.value || ''
}

// 保存编辑
const handleSaveEdit = async (config: ExtendedSystemConfig) => {
  try {
    config.saving = true
    
    await updateSystemConfig({
      key: config.key,
      value: config.editValue || ''
    })
    
    config.value = config.editValue || ''
    config.editing = false
    ElMessage.success(`${config.description || config.key} 保存成功`)
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    config.saving = false
  }
}

// 获取输入框类型
const getInputType = (key: string) => {
  if (
    key.includes('traffic') ||
    key.includes('expire_days') ||
    key.includes('class') ||
    key.includes('reset_day') ||
    key.endsWith('_amount') ||
    key.endsWith('_rate')
  ) {
    return 'number'
  }
  if (key.includes('url')) {
    return 'url'
  }
  if (key.includes('email')) {
    return 'email'
  }
  return 'text'
}

// 获取单位
const getUnit = (key: string) => {
  if (key.includes('traffic') && !key.includes('reset')) {
    return '字节'
  }
  if (key.includes('expire_days') || key.includes('reset_day')) {
    return '天'
  }
  if (key.endsWith('_amount')) {
    return '元'
  }
  return ''
}


onMounted(() => {
  fetchConfigs()
})
</script>

<style lang="scss" scoped>
.system-configs-container {
  .edit-buttons {
    display: flex;
    gap: 4px;
    
    .el-button {
      padding: 4px 8px;
    }
  }

  .config-hints {
    margin-top: 16px;
    
    :deep(.el-alert__content) {
      ul {
        margin: 8px 0;
        padding-left: 20px;
        
        li {
          margin-bottom: 4px;
          font-size: 13px;
          line-height: 1.4;
        }
      }
    }
  }
  
  :deep(.el-table) {
    .el-input {
      .el-input__wrapper {
        box-shadow: 0 0 0 1px var(--el-border-color) inset;
      }
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .system-configs-container {
    :deep(.el-table) {
      font-size: 12px;
      
      .el-table__cell {
        padding: 8px 4px;
      }
      
      .el-button {
        font-size: 12px;
        padding: 4px 6px;
      }
    }
    
    .edit-buttons {
      flex-direction: column;
      gap: 2px;
      
      .el-button {
        font-size: 11px;
        padding: 2px 4px;
      }
    }
    
    .config-hints {
      :deep(.el-alert__content) {
        ul li {
          font-size: 12px;
        }
      }
    }
  }
}

@media (max-width: 480px) {
  .system-configs-container {
    :deep(.el-table) {
      .el-table__cell {
        padding: 6px 2px;
      }
    }
  }
}
</style>
