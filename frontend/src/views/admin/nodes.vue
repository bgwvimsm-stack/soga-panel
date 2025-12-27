<template>
  <div class="admin-page admin-nodes">
    <div class="page-header">
      <h2>节点管理</h2>
      <p>管理系统节点配置和状态监控</p>
    </div>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="节点列表" @refresh="loadNodes">
      <template #buttons>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>新增节点
        </el-button>
        <el-button type="success" @click="batchOnlineNodes" :disabled="selectedNodes.length === 0">
          <el-icon><CircleCheck /></el-icon>批量显示({{ selectedNodes.length }})
        </el-button>
        <el-button type="warning" @click="batchOfflineNodes" :disabled="selectedNodes.length === 0">
          <el-icon><CircleClose /></el-icon>批量隐藏({{ selectedNodes.length }})
        </el-button>
        <el-input
          v-model="searchKeyword"
          placeholder="搜索节点名称或地址"
          clearable
          @keyup.enter="handleSearch"
          @change="handleSearch"
          @clear="handleSearch"
          style="width: 200px; margin-left: 12px;"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="statusFilter" placeholder="显示状态" clearable @change="handleStatusFilterChange" style="width: 120px; margin-left: 12px;">
          <el-option label="显示" :value="1" />
          <el-option label="隐藏" :value="0" />
        </el-select>
      </template>

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
          :data="nodes"
          :pager-config="pagerConfig"
          :checkbox-config="{ reserve: true }"
          @checkbox-change="handleSelectionChange"
          @checkbox-all="handleSelectionChange"
          @page-change="handlePageChange"
        >
          <template #name="{ row }"><span>{{ row.name }}</span></template>
          <template #type="{ row }">
            <el-tag :type="getNodeTypeColor(row.type)" size="small">{{ getNodeTypeName(row.type) }}</el-tag>
          </template>
          <template #server="{ row }"><span>{{ getDisplayServer(row) }}</span></template>
          <template #server_port="{ row }"><span>{{ getDisplayPort(row) }}</span></template>
          <template #node_class="{ row }">
            <el-tag size="small">{{ row.node_class }}</el-tag>
          </template>
          <template #traffic_multiplier="{ row }">
            <el-tag size="small" type="info">
              x{{ Number(row.traffic_multiplier || 1).toFixed(2) }}
            </el-tag>
          </template>
          <template #bandwidth_limit="{ row }">
            <span v-if="row.node_bandwidth_limit > 0">{{ formatTraffic(row.node_bandwidth_limit) }}</span>
            <span v-else>无限制</span>
          </template>
          <template #traffic_used="{ row }">
            <span>{{ formatTraffic(row.node_bandwidth || 0) }}</span>
          </template>
          <template #status="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '显示' : '隐藏' }}
            </el-tag>
          </template>
          <template #created_at="{ row }"><span>{{ formatDateTime(row.created_at) }}</span></template>
          <template #actions="{ row }">
            <div class="table-actions">
              <el-dropdown
                trigger="click"
                @command="(command) => handleRowCommand(command, row)"
              >
                <el-button size="small" plain>
                  更多
                  <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <el-icon><EditPen /></el-icon>
                      编辑节点
                    </el-dropdown-item>
                    <el-dropdown-item command="toggle">
                      <el-icon><SwitchButton /></el-icon>
                      {{ row.status === 1 ? '隐藏节点' : '显示节点' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="copy">
                      <el-icon><CopyDocument /></el-icon>
                      复制节点
                    </el-dropdown-item>
                    <el-dropdown-item command="details">
                      <el-icon><View /></el-icon>
                      查看详情
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      <el-icon><Delete /></el-icon>
                      删除节点
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 创建/编辑节点对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingNode ? '编辑节点' : '新增节点'" width="780px" class="node-dialog" @close="resetForm">
      <el-form ref="nodeFormRef" :model="nodeForm" :rules="nodeRules" label-width="110px">
        <el-scrollbar max-height="65vh" class="form-scroll">
          <div class="section-grid">
          <el-card shadow="never" class="section-card">
            <div class="section-header">
              <div>
                <span class="section-title">基础信息</span>
                <span class="section-sub">节点名称与类型</span>
              </div>
              <el-tag size="small" type="info" effect="plain">{{ advancedView ? '高级 JSON' : '可视化表单' }}</el-tag>
            </div>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="节点名称" prop="name">
                  <el-input v-model="nodeForm.name" placeholder="请输入节点名称" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="节点类型" prop="type">
                  <el-select v-model="nodeForm.type" placeholder="请选择节点类型" @change="handleTypeChange">
                    <el-option label="Shadowsocks" value="ss" />
                    <el-option label="ShadowsocksR" value="ssr" />
                    <el-option label="V2Ray" value="v2ray" />
                    <el-option label="VLess" value="vless" />
                    <el-option label="Trojan" value="trojan" />
                    <el-option label="Hysteria" value="hysteria" />
                    <el-option label="AnyTLS" value="anytls" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <div class="mode-toggle">
              <span>视图模式</span>
              <el-switch v-model="advancedView" active-text="高级视图" inactive-text="普通视图" @change="handleViewToggle" />
              <span class="hint">普通视图提供常用字段，切换到高级视图可直接编辑完整 JSON</span>
            </div>
          </el-card>

          <el-card shadow="never" class="section-card">
            <div class="section-header">
              <div>
                <span class="section-title">额度与计费</span>
                <span class="section-sub">等级、流量与计费规则</span>
              </div>
            </div>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="节点等级" prop="node_class">
                  <el-input-number
                    v-model="nodeForm.node_class"
                    :min="0"
                    :max="10"
                    :step="1"
                    style="width: 100%"
                    placeholder="请输入节点等级"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="流量限制 (GB)">
                  <el-input-number v-model="nodeForm.node_bandwidth_limit_gb" :min="0" placeholder="0表示无限制" style="width: 100%" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="扣费倍率" prop="traffic_multiplier">
                  <el-input-number
                    v-model="nodeForm.traffic_multiplier"
                    :min="0.1"
                    :step="0.1"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="流量重置日期">
                  <el-input-number v-model="nodeForm.bandwidthlimit_resetday" :min="1" :max="31" placeholder="每月重置流量日" style="width: 100%" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="拉取间隔(s)">
                  <el-input v-model.number="nodeForm.basic_pull_interval" type="number" min="0" placeholder="秒" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="推送间隔(s)">
                  <el-input v-model.number="nodeForm.basic_push_interval" type="number" min="0" placeholder="秒" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="总限速(Mbps)">
                  <el-input v-model.number="nodeForm.basic_speed_limit" type="number" min="0" placeholder="Mbps" />
                </el-form-item>
              </el-col>
            </el-row>
          </el-card>

          <template v-if="!advancedView">
            <el-card shadow="never" class="section-card">
              <div class="section-header">
                <div>
                  <span class="section-title">节点连接</span>
                  <span class="section-sub">客户端连接入口</span>
                </div>
              </div>
              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="节点地址" prop="client_server">
                    <el-input v-model="nodeForm.client_server" placeholder="例如 1.1.1.1 或域名" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="连接端口" prop="client_port">
                    <el-input-number v-model="nodeForm.client_port" :min="1" :max="65535" style="width: 100%" placeholder="客户端连接端口" />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-card>

            <el-card shadow="never" class="section-card">
              <div class="section-header">
                <div>
                  <span class="section-title">服务端配置</span>
                  <span class="section-sub">监听端口与协议参数</span>
                </div>
              </div>
              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="服务端口" prop="service_port">
                    <el-input-number v-model="nodeForm.service_port" :min="1" :max="65535" style="width: 100%" placeholder="服务监听端口" />
                  </el-form-item>
                </el-col>
              </el-row>

              <!-- SS 配置 -->
              <template v-if="nodeForm.type === 'ss'">
                <div class="section-subtitle">Shadowsocks</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="加密方式">
                      <el-select v-model="nodeForm.config_method" placeholder="请选择加密方式">
                        <el-option v-for="item in ssCipherOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="混淆">
                      <el-select v-model="nodeForm.config_obfs" placeholder="请选择混淆">
                        <el-option v-for="item in ssObfsOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16" v-if="isSS2022">
                  <el-col :span="12">
                    <el-form-item label="密码" prop="config_password">
                      <el-input v-model="nodeForm.config_password" placeholder="ss2022 需要 base64 密码" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </template>

              <!-- SSR 配置 -->
              <template v-else-if="nodeForm.type === 'ssr'">
                <div class="section-subtitle">ShadowsocksR</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="加密方式">
                      <el-select v-model="nodeForm.config_method" placeholder="请选择加密方式">
                        <el-option v-for="item in ssrMethodOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="协议">
                      <el-select v-model="nodeForm.config_protocol" placeholder="请选择协议">
                        <el-option v-for="item in ssrProtocolOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="混淆">
                      <el-select v-model="nodeForm.config_obfs" placeholder="请选择混淆">
                        <el-option v-for="item in ssrObfsOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="单端口类型">
                      <el-select v-model="nodeForm.config_single_port_type" placeholder="请选择单端口类型">
                        <el-option v-for="item in ssrSinglePortOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="密码">
                      <el-input v-model="nodeForm.config_password" placeholder="节点密码或密钥" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </template>

              <!-- VMess 配置 -->
              <template v-else-if="nodeForm.type === 'v2ray'">
                <div class="section-subtitle">VMess</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="传输协议">
                      <el-select v-model="nodeForm.config_stream_type" placeholder="请选择传输协议">
                        <el-option v-for="item in streamTypeOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="TLS">
                      <el-select v-model="nodeForm.config_tls_type" placeholder="请选择TLS类型">
                        <el-option v-for="item in tlsOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12" v-if="nodeForm.config_tls_type === 'tls'">
                    <el-form-item label="TLS Host">
                      <el-input v-model="nodeForm.client_tls_host" placeholder="SNI/ServerName" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12" v-if="nodeForm.config_stream_type === 'ws'">
                    <el-form-item label="PATH">
                      <el-input v-model="nodeForm.config_path" placeholder="WebSocket 路径，如 /path" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12" v-if="nodeForm.config_stream_type === 'grpc'">
                    <el-form-item label="ServerName">
                      <el-input v-model="nodeForm.config_service_name" placeholder="gRPC service name" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </template>

              <!-- Trojan 配置 -->
              <template v-else-if="nodeForm.type === 'trojan'">
                <div class="section-subtitle">Trojan</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="传输协议">
                      <el-select v-model="nodeForm.config_stream_type" placeholder="请选择传输协议">
                        <el-option v-for="item in streamTypeOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="TLS Host">
                      <el-input v-model="nodeForm.client_tls_host" placeholder="SNI/ServerName" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12" v-if="nodeForm.config_stream_type === 'ws'">
                    <el-form-item label="PATH">
                      <el-input v-model="nodeForm.config_path" placeholder="WebSocket 路径，如 /path" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12" v-if="nodeForm.config_stream_type === 'grpc'">
                    <el-form-item label="ServerName">
                      <el-input v-model="nodeForm.config_service_name" placeholder="gRPC service name" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </template>

              <!-- VLESS 配置 -->
              <template v-else-if="nodeForm.type === 'vless'">
                <div class="section-subtitle">VLESS</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="传输协议">
                      <el-select v-model="nodeForm.config_stream_type" placeholder="请选择传输协议">
                        <el-option v-for="item in streamTypeOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="TLS">
                      <el-select v-model="nodeForm.config_tls_type" placeholder="请选择TLS类型">
                        <el-option v-for="item in vlessTlsOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12" v-if="nodeForm.config_stream_type === 'ws'">
                    <el-form-item label="PATH">
                      <el-input v-model="nodeForm.config_path" placeholder="WebSocket 路径，如 /path" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12" v-if="nodeForm.config_tls_type === 'tls' || nodeForm.config_tls_type === 'reality'">
                    <el-form-item label="TLS Host">
                      <el-input v-model="nodeForm.client_tls_host" placeholder="SNI/ServerName" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12" v-if="nodeForm.config_stream_type === 'grpc'">
                    <el-form-item label="ServerName">
                      <el-input v-model="nodeForm.config_service_name" placeholder="gRPC service name" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <template v-if="nodeForm.config_tls_type === 'reality'">
                  <div class="section-subtitle">Reality</div>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="Flow">
                        <el-input v-model="nodeForm.config_flow" placeholder="xtls-rprx-vision 等" />
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="目标地址">
                        <el-input v-model="nodeForm.config_dest" placeholder="如 www.server.com:443" />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="ServerNames">
                        <el-input
                          v-model="nodeForm.config_server_names"
                          type="textarea"
                          :rows="2"
                          placeholder="用逗号分隔多个 server_name"
                        />
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="Short IDs">
                        <el-input
                          v-model="nodeForm.config_short_ids"
                          type="textarea"
                          :rows="2"
                          placeholder="用逗号分隔多个 short_id"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="PrivateKey">
                        <el-input v-model="nodeForm.config_private_key" placeholder="Reality private key" />
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="PublicKey">
                        <el-input v-model="nodeForm.client_publickey" placeholder="Reality public key" />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item>
                        <el-button type="primary" plain @click="regenerateVlessReality">
                          一键生成 Short IDs / PrivateKey / PublicKey
                        </el-button>
                      </el-form-item>
                    </el-col>
                  </el-row>
                </template>
              </template>

              <!-- Hysteria 配置 -->
              <template v-else-if="nodeForm.type === 'hysteria'">
                <div class="section-subtitle">Hysteria</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="混淆">
                      <el-select v-model="nodeForm.config_obfs" placeholder="请选择混淆">
                        <el-option v-for="item in hysteriaObfsOptions" :key="item" :label="item" :value="item" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="混淆密码">
                      <el-input v-model="nodeForm.config_obfs_password" placeholder="可选，混淆密码" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="上行(Mbps)">
                      <el-input-number v-model="nodeForm.config_up_mbps" :min="0" style="width: 100%" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="下行(Mbps)">
                      <el-input-number v-model="nodeForm.config_down_mbps" :min="0" style="width: 100%" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="TLS Host">
                      <el-input v-model="nodeForm.client_tls_host" placeholder="SNI/ServerName" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </template>

              <!-- AnyTLS 配置 -->
              <template v-else-if="nodeForm.type === 'anytls'">
                <div class="section-subtitle">AnyTLS</div>
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="TLS Host">
                      <el-input v-model="nodeForm.client_tls_host" placeholder="可选 SNI/ServerName" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="16">
                  <el-col :span="24">
                    <el-form-item label="Padding Scheme">
                      <el-input
                        v-model="nodeForm.config_padding_scheme"
                        type="textarea"
                        :rows="4"
                        placeholder="每行一条，如 stop=8 或 1=100-400"
                      />
                    </el-form-item>
                  </el-col>
                </el-row>
              </template>
            </el-card>
          </template>

          <template v-else>
            <el-card shadow="never" class="section-card">
              <div class="section-header">
                <div>
                  <span class="section-title">节点配置 JSON</span>
                  <span class="section-sub">包含 basic、config、client</span>
                </div>
              </div>
              <el-form-item label="节点配置JSON" prop="node_config_json">
                <el-input
                  v-model="nodeForm.node_config_json"
                  type="textarea"
                  :rows="14"
                  placeholder="输入完整节点配置 JSON（包含 basic、config、client）"
                />
                <small>高级视图允许直接粘贴完整节点配置，保存时会覆盖普通视图字段</small>
              </el-form-item>
            </el-card>
          </template>
          </div>
        </el-scrollbar>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveNode" :loading="submitting">{{ editingNode ? '更新' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- 节点详情对话框 -->
    <el-dialog v-model="showDetailsDialog" title="节点详情" width="600px">
      <div v-if="selectedNode" class="node-details">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="节点ID">{{ selectedNode.id }}</el-descriptions-item>
          <el-descriptions-item label="节点名称">{{ selectedNode.name }}</el-descriptions-item>
          <el-descriptions-item label="节点类型">{{ selectedNode.type }}</el-descriptions-item>
          <el-descriptions-item label="节点地址">{{ formatDisplayAddress(selectedNode) }}</el-descriptions-item>
          <el-descriptions-item label="节点等级">等级{{ selectedNode.node_class }}</el-descriptions-item>
          <el-descriptions-item label="扣费倍率">
            x{{ Number(selectedNode.traffic_multiplier || 1).toFixed(2) }}
          </el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="selectedNode.status === 1 ? 'success' : 'info'">{{ selectedNode.status === 1 ? '显示' : '隐藏' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="已用流量">{{ formatTraffic(selectedNode.node_bandwidth || 0) }}</el-descriptions-item>
          <el-descriptions-item label="流量限制">
            {{ selectedNode.node_bandwidth_limit > 0 ? formatTraffic(selectedNode.node_bandwidth_limit) : '无限制' }}
          </el-descriptions-item>
          <el-descriptions-item label="重置日期">
            {{ selectedNode.bandwidthlimit_resetday ? `每月${selectedNode.bandwidthlimit_resetday}号` : '未设置' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDateTime(selectedNode.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatDateTime(selectedNode.updated_at) }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="selectedNode.node_config" style="margin-top: 20px;">
          <h4>节点配置</h4>
          <el-input :model-value="formatNodeConfig(selectedNode.node_config)" type="textarea" :rows="8" readonly />
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { Plus, Search, CircleCheck, CircleClose, EditPen, SwitchButton, ArrowDown, CopyDocument, View, Delete } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getNodes, createNode, updateNode, deleteNode as deleteNodeAPI, batchUpdateNodes, type Node } from '@/api/admin';

const vxeTableRef = ref();
const loading = ref(false);
const submitting = ref(false);
const showCreateDialog = ref(false);
const showDetailsDialog = ref(false);
const editingNode = ref<Node | null>(null);
const selectedNode = ref<Node | null>(null);
const advancedView = ref(false);

const ssCipherOptions = [
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305'
];
const ssObfsOptions = ['plain', 'simple_obfs_http'];
const ss2022Ciphers = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305'
];
const ss2022KeyLengths: Record<string, number> = {
  '2022-blake3-aes-128-gcm': 16,
  '2022-blake3-aes-256-gcm': 32,
  '2022-blake3-chacha20-poly1305': 32
};

const ssrMethodOptions = [
  'none',
  'rc4',
  'rc4-md5',
  'aes-128-cfb',
  'aes-192-cfb',
  'aes-256-cfb',
  'aes-128-ctr',
  'aes-192-ctr',
  'aes-256-ctr',
  'aes-128-ofb',
  'aes-192-ofb',
  'aes-256-ofb',
  'chacha20',
  'chacha20-ietf',
  'salsa20',
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305'
];
const ssrProtocolOptions = [
  'origin',
  'auth_aes128_md5',
  'auth_aes128_sha1',
  'auth_chain_a',
  'auth_chain_b',
  'auth_chain_c',
  'auth_chain_d',
  'auth_chain_e',
  'auth_chain_f'
];
const ssrObfsOptions = [
  'plain',
  'http_simple',
  'http_post',
  'tls1.2_ticket_auth',
  'simple_obfs_http',
  'simple_obfs_tls'
];
const ssrSinglePortOptions = ['protocol', 'obfs'];

const streamTypeOptions = ['tcp', 'ws', 'http', 'h2', 'grpc'];
const tlsOptions = ['none', 'tls'];
const vlessTlsOptions = ['none', 'tls', 'reality'];
const hysteriaObfsOptions = ['plain', 'salamander'];
const nodes = ref<Node[]>([]);
const selectedNodes = ref<Node[]>([]);
const pagerConfig = reactive<VxePagerConfig>({
  total: 0,
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
});

const searchKeyword = ref('');
const statusFilter = ref<number | null>(null);

const getTableHeight = computed(() => (size: string) => {
  switch (size) {
    case 'medium': return 600;
    case 'small': return 550;
    case 'mini': return 500;
    default: return 600;
  }
});

const columns: VxeTableBarColumns = [
  { type: 'checkbox', width: 60, fixed: 'left', visible: true },
  { field: 'id', title: 'ID', width: 80, visible: true },
  { field: 'name', title: '节点名称', minWidth: 150, visible: true, slots: { default: 'name' } },
  { field: 'type', title: '类型', width: 130, visible: true, slots: { default: 'type' } },
  { field: 'server', title: '地址', minWidth: 180, visible: true, slots: { default: 'server' } },
  { field: 'server_port', title: '端口', width: 100, visible: true, slots: { default: 'server_port' } },
  { field: 'node_class', title: '等级', width: 100, visible: true, slots: { default: 'node_class' } },
  { field: 'traffic_multiplier', title: '倍率', width: 100, visible: true, slots: { default: 'traffic_multiplier' } },
  { field: 'bandwidth_limit', title: '流量限制', width: 120, visible: true, slots: { default: 'bandwidth_limit' } },
  { field: 'traffic_used', title: '已用流量', width: 120, visible: true, slots: { default: 'traffic_used' } },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'created_at', title: '创建时间', width: 180, visible: false, slots: { default: 'created_at' } },
  { field: 'actions', title: '操作', width: 90, align: 'right', fixed: 'right', visible: true, columnSelectable: false, slots: { default: 'actions' } }
];

const nodeFormRef = ref<FormInstance>();
const nodeForm = reactive({
  name: '',
  type: 'ss',
  node_class: 0,
  node_bandwidth_limit_gb: 0,
  traffic_multiplier: 1,
  node_bandwidth: 0,
  bandwidthlimit_resetday: 1,
  client_server: '',
  client_port: null as number | null,
  service_port: null as number | null,
  basic_pull_interval: 60,
  basic_push_interval: 60,
  basic_speed_limit: 0,
  client_tls_host: '',
  client_publickey: '',
  config_method: '',
  config_password: '',
  config_protocol: '',
  config_obfs: '',
  config_single_port_type: '',
  config_stream_type: '',
  config_tls_type: '',
  config_path: '',
  config_service_name: '',
  config_flow: '',
  config_server_names: '',
  config_private_key: '',
  config_short_ids: '',
  config_dest: '',
  config_obfs_password: '',
  config_padding_scheme: '',
  config_up_mbps: 1000,
  config_down_mbps: 1000,
  node_config_json: ''
});

const isConfigSyncing = ref(false);

const generateSS2022Password = (method: string) => {
  const length = ss2022KeyLengths[method] || 32;
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
};

const ensureSS2022Password = (forceRegenerate = false) => {
  if (nodeForm.type !== 'ss') return;
  if (ss2022Ciphers.includes(nodeForm.config_method) && (forceRegenerate || !nodeForm.config_password)) {
    nodeForm.config_password = generateSS2022Password(nodeForm.config_method);
  }
};

const generateHysteriaObfsPassword = (byteLength = 8) => {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
};

const ensureHysteriaObfsPassword = (forceRegenerate = false) => {
  if (nodeForm.type !== 'hysteria') return;
  const needAuto = nodeForm.config_obfs === 'salamander';
  if (needAuto && (forceRegenerate || !nodeForm.config_obfs_password)) {
    nodeForm.config_obfs_password = generateHysteriaObfsPassword();
  }
};

const getRandomBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
};

const generateRandomString = (length: number, charset: string) => {
  const bytes = getRandomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  return result;
};

const generateSSRPassword = (length = 8) => generateRandomString(length, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

const ensureSSRPassword = (forceRegenerate = false) => {
  if (nodeForm.type !== 'ssr') return;
  if (forceRegenerate || !nodeForm.config_password) {
    nodeForm.config_password = generateSSRPassword();
  }
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = (value: string) => {
  if (!value) return new Uint8Array(0);
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding) normalized += '='.repeat(4 - padding);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const gf = (init?: number[]) => {
  const r = new Float64Array(16);
  if (init) {
    for (let i = 0; i < init.length; i++) r[i] = init[i];
  }
  return r;
};

const X25519_BASE = new Uint8Array(32);
X25519_BASE[0] = 9;
const x25519Const = gf([0xDB41, 1]);

const car25519 = (o: Float64Array) => {
  for (let i = 0; i < 16; i++) {
    o[i] += 65536;
    const c = Math.floor(o[i] / 65536);
    if (i < 15) {
      o[i + 1] += c - 1;
    } else {
      o[0] += 38 * (c - 1);
    }
    o[i] -= c * 65536;
  }
};

const sel25519 = (p: Float64Array, q: Float64Array, b: number) => {
  const c = ~(b - 1);
  for (let i = 0; i < 16; i++) {
    const t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
};

const pack25519 = (o: Uint8Array, n: Float64Array) => {
  const m = gf();
  const t = gf();
  for (let i = 0; i < 16; i++) t[i] = n[i];
  car25519(t);
  car25519(t);
  car25519(t);
  for (let j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (let i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
      m[i - 1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
    const b = (m[15] >> 16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1 - b);
  }
  for (let i = 0; i < 16; i++) {
    o[2 * i] = t[i] & 0xff;
    o[2 * i + 1] = t[i] >> 8;
  }
};

const unpack25519 = (o: Float64Array, n: Uint8Array) => {
  for (let i = 0; i < 16; i++) o[i] = n[2 * i] + (n[2 * i + 1] << 8);
  o[15] &= 0x7fff;
};

const A = (o: Float64Array, a: Float64Array, b: Float64Array) => {
  for (let i = 0; i < 16; i++) o[i] = a[i] + b[i];
};

const Z = (o: Float64Array, a: Float64Array, b: Float64Array) => {
  for (let i = 0; i < 16; i++) o[i] = a[i] - b[i];
};

const M = (o: Float64Array, a: Float64Array, b: Float64Array) => {
  const t = new Float64Array(31);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      t[i + j] += a[i] * b[j];
    }
  }
  for (let i = 0; i < 15; i++) {
    t[i] += 38 * t[i + 16];
  }
  for (let i = 0; i < 16; i++) o[i] = t[i];
  car25519(o);
  car25519(o);
};

const S = (o: Float64Array, a: Float64Array) => {
  M(o, a, a);
};

const inv25519 = (o: Float64Array, i: Float64Array) => {
  const c = gf();
  for (let a = 0; a < 16; a++) c[a] = i[a];
  for (let a = 253; a >= 0; a--) {
    S(c, c);
    if (a !== 2 && a !== 4) M(c, c, i);
  }
  for (let a = 0; a < 16; a++) o[a] = c[a];
};

const scalarMult = (q: Uint8Array, n: Uint8Array, p: Uint8Array) => {
  const z = new Uint8Array(32);
  const x = gf();
  const a = gf();
  const b = gf();
  const c = gf();
  const d = gf();
  const e = gf();
  const f = gf();
  for (let i = 0; i < 31; i++) z[i] = n[i];
  z[31] = (n[31] & 127) | 64;
  z[0] &= 248;
  unpack25519(x, p);
  for (let i = 0; i < 16; i++) {
    b[i] = x[i];
    d[i] = 0;
    a[i] = 0;
    c[i] = 0;
  }
  a[0] = 1;
  d[0] = 1;
  for (let i = 254; i >= 0; --i) {
    const r = (z[i >>> 3] >>> (i & 7)) & 1;
    sel25519(a, b, r);
    sel25519(c, d, r);
    A(e, a, c);
    Z(a, a, c);
    A(c, b, d);
    Z(b, b, d);
    S(d, e);
    S(f, a);
    M(a, c, a);
    M(c, b, e);
    A(e, a, c);
    Z(a, a, c);
    S(b, a);
    Z(c, d, f);
    M(a, c, x25519Const);
    A(a, a, d);
    M(c, c, a);
    M(a, d, f);
    M(d, b, x);
    S(b, e);
    sel25519(a, b, r);
    sel25519(c, d, r);
  }
  inv25519(c, c);
  M(a, a, c);
  pack25519(q, a);
};

const clampScalar = (scalar: Uint8Array) => {
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
};

const generateX25519KeyPair = () => {
  const privateKeyBytes = getRandomBytes(32);
  clampScalar(privateKeyBytes);
  const publicKeyBytes = new Uint8Array(32);
  scalarMult(publicKeyBytes, privateKeyBytes, X25519_BASE);
  return {
    privateKey: bytesToBase64Url(privateKeyBytes),
    publicKey: bytesToBase64Url(publicKeyBytes)
  };
};

const deriveX25519PublicKey = (privateKey: string) => {
  try {
    const privateKeyBytes = base64UrlToBytes(privateKey);
    if (privateKeyBytes.length !== 32) return '';
    clampScalar(privateKeyBytes);
    const publicKeyBytes = new Uint8Array(32);
    scalarMult(publicKeyBytes, privateKeyBytes, X25519_BASE);
    return bytesToBase64Url(publicKeyBytes);
  } catch {
    return '';
  }
};

const generateShortIds = (count = 5, byteLength = 8) => {
  const list: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = getRandomBytes(byteLength);
    let hex = '';
    bytes.forEach((b) => { hex += b.toString(16).padStart(2, '0'); });
    list.push(hex);
  }
  return list;
};

const ensureVlessRealityDefaults = (forceRegenerate = false) => {
  if (nodeForm.type !== 'vless' || nodeForm.config_tls_type !== 'reality') return;

  if (forceRegenerate || !nodeForm.config_flow) {
    nodeForm.config_flow = 'xtls-rprx-vision';
  }

  if (forceRegenerate || !nodeForm.config_short_ids) {
    nodeForm.config_short_ids = generateShortIds().join(',');
  }

  if (forceRegenerate) {
    const pair = generateX25519KeyPair();
    nodeForm.config_private_key = pair.privateKey;
    nodeForm.client_publickey = pair.publicKey;
    return;
  }

  if (!nodeForm.config_private_key && !nodeForm.client_publickey) {
    const pair = generateX25519KeyPair();
    nodeForm.config_private_key = pair.privateKey;
    nodeForm.client_publickey = pair.publicKey;
    return;
  }

  if (nodeForm.config_private_key && !nodeForm.client_publickey) {
    const derived = deriveX25519PublicKey(nodeForm.config_private_key);
    if (derived) nodeForm.client_publickey = derived;
  }
};

const regenerateVlessReality = () => {
  ensureVlessRealityDefaults(true);
};

const nodeRules = {
  name: [
    { required: true, message: '请输入节点名称', trigger: 'blur' },
    { min: 2, max: 50, message: '节点名称长度应在2-50个字符', trigger: 'blur' }
  ],
  type: [{ required: true, message: '请选择节点类型', trigger: 'change' }],
  node_class: [
    { required: true, message: '请输入节点等级', trigger: 'change' },
    { type: 'number', min: 0, message: '节点等级必须为非负整数', trigger: 'change' }
  ],
  traffic_multiplier: [
    { required: true, message: '请输入扣费倍率', trigger: 'change' },
    { type: 'number', min: 0.1, message: '扣费倍率需大于0', trigger: 'change' }
  ],
  client_server: [
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (advancedView.value) return callback();
        if (!value) return callback(new Error('请输入节点地址'));
        return callback();
      },
      required: true,
      trigger: ['blur', 'change']
    }
  ],
  service_port: [
    {
      validator: (_rule: any, value: number, callback: any) => {
        if (advancedView.value) return callback();
        if (value === null || value === undefined) return callback(new Error('请输入服务端口'));
        if (value < 1 || value > 65535) return callback(new Error('端口号应在1-65535之间'));
        return callback();
      },
      required: true,
      trigger: ['blur', 'change']
    }
  ],
  client_port: [
    {
      validator: (_rule: any, value: number, callback: any) => {
        if (advancedView.value) return callback();
        if (value === null || value === undefined) return callback();
        if (value < 1 || value > 65535) return callback(new Error('端口号应在1-65535之间'));
        return callback();
      },
      trigger: 'blur'
    }
  ],
  config_method: [{ required: false }],
  config_password: [
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (isSS2022.value && !value) {
          ensureSS2022Password();
        }
        callback();
      },
      trigger: 'blur'
    }
  ],
  config_protocol: [{ required: false }],
  config_obfs: [{ required: false }],
  config_single_port_type: [{ required: false }],
  node_config_json: [
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (!advancedView.value) return callback();
        if (!value || value.trim() === '') return callback(new Error('请输入节点配置JSON'));
        try {
          JSON.parse(value);
          callback();
        } catch {
          callback(new Error('节点配置JSON格式错误'));
        }
      },
      trigger: 'blur'
    }
  ]
};

const getNodeTypeColor = (type: string) => {
  const colorMap: Record<string, string> = {
    ss: 'primary',
    ssr: 'primary',
    v2ray: 'success',
    vless: 'info',
    trojan: 'warning',
    hysteria: 'danger',
    anytls: 'info'
  };
  const key = typeof type === 'string' ? type.toLowerCase() : type;
  return colorMap[key] || 'primary';
};

const getNodeTypeName = (type: string) => {
  const nameMap: Record<string, string> = {
    ss: 'Shadowsocks',
    ssr: 'ShadowsocksR',
    v2ray: 'V2Ray',
    vless: 'VLess',
    trojan: 'Trojan',
    hysteria: 'Hysteria',
    anytls: 'AnyTLS'
  };
  const key = typeof type === 'string' ? type.toLowerCase() : type;
  return nameMap[key] || type;
};

const formatTraffic = (bytes: number): string => {
  if (bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  const gb = mb / 1024;
  const tb = gb / 1024;
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  else if (gb >= 1) return `${gb.toFixed(2)} GB`;
  else return `${mb.toFixed(2)} MB`;
};

const formatNodeConfig = (config: any): string => {
  if (!config) return '';
  if (typeof config === 'string') {
    try {
      const parsed = JSON.parse(config);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return config;
    }
  } else {
    return JSON.stringify(config, null, 2);
  }
};

const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleString('zh-CN');
  } catch {
    return '--';
  }
};

type NodeConfigState = {
  basic: {
    pull_interval: number;
    push_interval: number;
    speed_limit: number;
  };
  config: Record<string, any>;
  client: {
    server: string;
    port: number | null;
    tls_host: string;
    publickey?: string;
  };
};

const createDefaultNodeConfig = (type = 'ss'): NodeConfigState => ({
  basic: {
    pull_interval: 60,
    push_interval: 60,
    speed_limit: 0
  },
  config: {
    port: type === 'anytls' ? 443 : 443,
    ...(type === 'ss'
      ? { cipher: 'aes-128-gcm', obfs: 'plain' }
      : {}),
    ...(type === 'ssr'
      ? {
        method: 'chacha20-ietf',
        protocol: 'auth_aes128_sha1',
        obfs: 'plain',
        single_port_type: 'protocol'
      }
      : {}),
    ...(type === 'v2ray'
      ? { stream_type: 'tcp', tls_type: 'none', path: '', service_name: '' }
      : {}),
    ...(type === 'trojan'
      ? { stream_type: 'tcp', path: '', service_name: '' }
      : {}),
    ...(type === 'vless'
      ? { stream_type: 'tcp', tls_type: 'tls' }
      : {}),
    ...(type === 'hysteria'
      ? { obfs: 'plain', obfs_password: '', up_mbps: 1000, down_mbps: 1000 }
      : {}),
    ...(type === 'anytls'
      ? {
        padding_scheme: [
          'stop=8',
          '0=30-30',
          '1=100-400',
          '2=400-500,c,500-1000,c,500-1000,c,500-1000,c,500-1000',
          '3=9-9,500-1000',
          '4=500-1000',
          '5=500-1000',
          '6=500-1000',
          '7=500-1000'
        ]
      }
      : {})
  },
  client: {
    server: '',
    port: type === 'anytls' ? 443 : null,
    tls_host: '',
    publickey: ''
  }
});

const nodeConfigState = reactive<NodeConfigState>(createDefaultNodeConfig());

const parseNodeConfigSafe = (node: any) => {
  try {
    if (!node?.node_config || node.node_config === 'undefined') {
      return { basic: {}, config: {}, client: {} };
    }
    const parsed = typeof node.node_config === 'string' ? JSON.parse(node.node_config) : node.node_config;
    return {
      basic: parsed.basic || {},
      config: parsed.config || parsed || {},
      client: parsed.client || {}
    };
  } catch {
    return { basic: {}, config: {}, client: {} };
  }
};

const resolveClientInfo = (row: any) => {
  const { config, client } = parseNodeConfigSafe(row);
  const server = client.server || '';
  const port = client.port || config.port || '';
  const tlsHost = client.tls_host || config.host || client.server || server;
  return { server, port, tlsHost };
};

const getDisplayServer = (row: any) => resolveClientInfo(row).server || '--';
const getDisplayPort = (row: any) => resolveClientInfo(row).port || '--';
const formatDisplayAddress = (row: any) => {
  const { server, port } = resolveClientInfo(row);
  return server ? `${server}${port ? `:${port}` : ''}` : '--';
};

const normalizeNodeConfig = (config: any, type = nodeForm.type): NodeConfigState => {
  const normalized = createDefaultNodeConfig(type);
  if (config?.basic && typeof config.basic === 'object') {
    normalized.basic = { ...normalized.basic, ...config.basic };
  }
  if (config?.config && typeof config.config === 'object') {
    normalized.config = { ...normalized.config, ...config.config };
  }
  if (config?.client && typeof config.client === 'object') {
    normalized.client = { ...normalized.client, ...config.client };
  }
  return normalized;
};

const applyConfigToState = (config: any) => {
  isConfigSyncing.value = true;
  try {
    const normalized = normalizeNodeConfig(config);
    nodeConfigState.basic = { ...normalized.basic };
    nodeConfigState.config = { ...normalized.config };
    nodeConfigState.client = { ...normalized.client };

    nodeForm.client_server = nodeConfigState.client.server || '';
    nodeForm.client_tls_host = (nodeConfigState.client as any).tls_host || '';
    nodeForm.client_publickey = (nodeConfigState.client as any).publickey || nodeConfigState.config.public_key || '';
    const clientPort = Number(nodeConfigState.client.port);
    nodeForm.client_port = Number.isFinite(clientPort) && clientPort > 0 ? clientPort : null;
    const servicePort = Number(nodeConfigState.config.port);
    nodeForm.service_port = Number.isFinite(servicePort) && servicePort > 0 ? servicePort : null;
    nodeForm.basic_pull_interval = Number(nodeConfigState.basic.pull_interval ?? 60);
    nodeForm.basic_push_interval = Number(nodeConfigState.basic.push_interval ?? 60);
    nodeForm.basic_speed_limit = Number(nodeConfigState.basic.speed_limit ?? 0);
    nodeForm.config_method = nodeConfigState.config.method || nodeConfigState.config.cipher || '';
    nodeForm.config_password = nodeConfigState.config.password || '';
    nodeForm.config_protocol = nodeConfigState.config.protocol || '';
    nodeForm.config_obfs = nodeConfigState.config.obfs || '';
    // 对于已存的 ss config，优先使用 cipher
    if (nodeForm.type === 'ss' && nodeConfigState.config.cipher) {
      nodeForm.config_method = nodeConfigState.config.cipher;
    }
    nodeForm.config_single_port_type = nodeConfigState.config.single_port_type || '';
    nodeForm.config_stream_type = nodeConfigState.config.stream_type || 'tcp';
    nodeForm.config_tls_type = nodeConfigState.config.tls_type || (nodeForm.type === 'vless' ? 'tls' : 'none');
    nodeForm.config_path = nodeConfigState.config.path || '';
    nodeForm.config_service_name = nodeConfigState.config.service_name || '';
    nodeForm.config_flow = nodeConfigState.config.flow || '';
    nodeForm.config_server_names = Array.isArray(nodeConfigState.config.server_names)
      ? nodeConfigState.config.server_names.join(',')
      : nodeConfigState.config.server_names || '';
    nodeForm.config_private_key = nodeConfigState.config.private_key || '';
    nodeForm.config_short_ids = Array.isArray(nodeConfigState.config.short_ids)
      ? nodeConfigState.config.short_ids.join(',')
      : nodeConfigState.config.short_ids || '';
    nodeForm.config_dest = nodeConfigState.config.dest || '';
    nodeForm.config_obfs_password = nodeConfigState.config.obfs_password || '';
    ensureHysteriaObfsPassword();
    ensureSSRPassword();
    ensureVlessRealityDefaults();
    nodeForm.config_padding_scheme = Array.isArray((nodeConfigState.config as any).padding_scheme)
      ? (nodeConfigState.config as any).padding_scheme.join('\n')
      : ((nodeConfigState.config as any).padding_scheme || '');
    const upMbps = Number(nodeConfigState.config.up_mbps);
    nodeForm.config_up_mbps = Number.isFinite(upMbps) ? upMbps : 1000;
    const downMbps = Number(nodeConfigState.config.down_mbps);
    nodeForm.config_down_mbps = Number.isFinite(downMbps) ? downMbps : 1000;
    nodeForm.node_config_json = JSON.stringify(normalized, null, 2);
  } finally {
    isConfigSyncing.value = false;
  }
};

const isSS2022 = computed(() => nodeForm.type === 'ss' && ss2022Ciphers.includes(nodeForm.config_method));

watch(() => nodeForm.config_method, (val, oldVal) => {
  if (isConfigSyncing.value) return;
  if (val !== oldVal && nodeForm.type === 'ss' && ss2022Ciphers.includes(val)) {
    // 切换 SS2022 加密方式时强制重新生成匹配长度的密码
    ensureSS2022Password(true);
  }
});

watch(() => nodeForm.type, (val, oldVal) => {
  if (val === 'ss' && oldVal !== 'ss') {
    ensureSS2022Password();
  }
  if (val === 'ssr' && oldVal !== 'ssr') {
    ensureSSRPassword();
  }
  if (val === 'vless' && oldVal !== 'vless') {
    ensureVlessRealityDefaults();
  }
});

watch(() => nodeForm.config_obfs, (val, oldVal) => {
  if (isConfigSyncing.value) return;
  if (val !== oldVal && nodeForm.type === 'hysteria') {
    ensureHysteriaObfsPassword(true);
  }
});

watch(() => nodeForm.config_tls_type, (val, oldVal) => {
  if (val !== oldVal) {
    ensureVlessRealityDefaults();
  }
});

const buildConfigFromForm = () => {
  const merged = normalizeNodeConfig(nodeConfigState);
  merged.basic.pull_interval = Number(nodeForm.basic_pull_interval ?? merged.basic.pull_interval ?? 60);
  merged.basic.push_interval = Number(nodeForm.basic_push_interval ?? merged.basic.push_interval ?? 60);
  merged.basic.speed_limit = Number(nodeForm.basic_speed_limit ?? merged.basic.speed_limit ?? 0);
  merged.client.server = nodeForm.client_server || merged.client.server;
  if (!merged.client) merged.client = { server: '', port: null, tls_host: '', publickey: '' } as any;
  (merged.client as any).tls_host = nodeForm.client_tls_host || (merged.client as any).tls_host || '';
  const clientPort = nodeForm.client_port ?? merged.client.port ?? nodeForm.service_port ?? null;
  merged.client.port = clientPort ? Number(clientPort) : null;
  const servicePort = nodeForm.service_port ?? merged.config.port ?? nodeForm.client_port ?? null;
  merged.config.port = servicePort ? Number(servicePort) : null;
  if (!merged.client.port && merged.config.port) {
    merged.client.port = merged.config.port;
  }
  switch (nodeForm.type) {
    case 'ss':
      if (nodeForm.config_method) {
        merged.config.cipher = nodeForm.config_method;
      }
      // SS 不存 method 字段，避免与 cipher 重复
      if ('method' in merged.config) delete merged.config.method;
      if (nodeForm.config_obfs) merged.config.obfs = nodeForm.config_obfs;
      if (isSS2022.value) {
        ensureSS2022Password();
        merged.config.password = nodeForm.config_password;
      } else {
        // 非 ss2022 移除密码字段，避免存储空串
        if ('password' in merged.config) delete merged.config.password;
      }
      break;
    case 'ssr':
      if (nodeForm.config_method) merged.config.method = nodeForm.config_method;
      if (nodeForm.config_protocol) merged.config.protocol = nodeForm.config_protocol;
      if (nodeForm.config_obfs) merged.config.obfs = nodeForm.config_obfs;
      if (nodeForm.config_single_port_type) merged.config.single_port_type = nodeForm.config_single_port_type;
      if (nodeForm.config_password) merged.config.password = nodeForm.config_password;
      break;
    case 'v2ray':
      merged.config.stream_type = nodeForm.config_stream_type || merged.config.stream_type || 'tcp';
      merged.config.tls_type = nodeForm.config_tls_type || merged.config.tls_type || 'none';
      merged.config.path = nodeForm.config_path || merged.config.path || '';
      if (merged.config.stream_type === 'grpc') {
        merged.config.service_name = nodeForm.config_service_name || merged.config.service_name || '';
      } else {
        if ('service_name' in merged.config) delete merged.config.service_name;
      }
      break;
    case 'trojan':
      merged.config.stream_type = nodeForm.config_stream_type || merged.config.stream_type || 'tcp';
      merged.config.path = nodeForm.config_path || merged.config.path || '';
      if (merged.config.stream_type === 'grpc') {
        merged.config.service_name = nodeForm.config_service_name || merged.config.service_name || '';
      } else {
        if ('service_name' in merged.config) delete merged.config.service_name;
      }
      if (nodeForm.config_password) merged.config.password = nodeForm.config_password;
      break;
    case 'vless':
      merged.config.stream_type = nodeForm.config_stream_type || merged.config.stream_type || 'tcp';
      merged.config.tls_type = nodeForm.config_tls_type || merged.config.tls_type || 'tls';
      if (merged.config.stream_type === 'ws') {
        merged.config.path = nodeForm.config_path || merged.config.path || '';
      } else if ('path' in merged.config) {
        delete merged.config.path;
      }
      if (merged.config.stream_type === 'grpc') {
        merged.config.service_name = nodeForm.config_service_name || merged.config.service_name || '';
      } else if ('service_name' in merged.config) {
        delete merged.config.service_name;
      }
      if (nodeForm.config_flow) {
        merged.config.flow = nodeForm.config_flow;
      } else if ('flow' in merged.config) {
        delete merged.config.flow;
      }
      if (nodeForm.config_dest) merged.config.dest = nodeForm.config_dest;
      if (nodeForm.config_server_names) {
        merged.config.server_names = nodeForm.config_server_names.split(',').map(item => item.trim()).filter(Boolean);
      }
      if (nodeForm.config_short_ids) {
        merged.config.short_ids = nodeForm.config_short_ids.split(',').map(item => item.trim()).filter(Boolean);
      }
      if (nodeForm.config_private_key) merged.config.private_key = nodeForm.config_private_key;
      if ('public_key' in merged.config) delete merged.config.public_key;
      if (nodeForm.client_publickey) {
        (merged.client as any).publickey = nodeForm.client_publickey;
      } else if ('publickey' in merged.client) {
        delete (merged.client as any).publickey;
      }
      break;
    case 'hysteria':
      if (nodeForm.config_obfs) merged.config.obfs = nodeForm.config_obfs;
      merged.config.obfs_password = nodeForm.config_obfs_password || merged.config.obfs_password || '';
      merged.config.up_mbps = Number(nodeForm.config_up_mbps ?? merged.config.up_mbps ?? 1000);
      merged.config.down_mbps = Number(nodeForm.config_down_mbps ?? merged.config.down_mbps ?? 1000);
      break;
    case 'anytls':
      if (nodeForm.config_padding_scheme) {
        merged.config.padding_scheme = nodeForm.config_padding_scheme
          .split(/\r?\n/)
          .map(item => item.trim())
          .filter(Boolean);
      } else if (Array.isArray(merged.config.padding_scheme)) {
        merged.config.padding_scheme = merged.config.padding_scheme.filter(Boolean);
        if (merged.config.padding_scheme.length === 0) {
          delete merged.config.padding_scheme;
        }
      }
      break;
    default:
      if (nodeForm.config_method) merged.config.method = nodeForm.config_method;
      if (nodeForm.config_password) merged.config.password = nodeForm.config_password;
      if (nodeForm.config_protocol) merged.config.protocol = nodeForm.config_protocol;
      if (nodeForm.config_obfs) merged.config.obfs = nodeForm.config_obfs;
      if (nodeForm.config_single_port_type) merged.config.single_port_type = nodeForm.config_single_port_type;
      merged.config.stream_type = nodeForm.config_stream_type || merged.config.stream_type || 'tcp';
      merged.config.tls_type = nodeForm.config_tls_type || merged.config.tls_type || '';
      merged.config.path = nodeForm.config_path || merged.config.path || '';
      merged.config.service_name = nodeForm.config_service_name || merged.config.service_name || '';
  }
  return merged;
};

const parseNodeConfigJson = (jsonText: string) => {
  if (!jsonText) return createDefaultNodeConfig();
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('解析节点配置JSON失败:', error);
    throw new Error('节点配置JSON格式错误');
  }
};

const handleViewToggle = (val: boolean) => {
  if (val) {
    // 切到高级视图，使用当前状态填充JSON
    nodeForm.node_config_json = JSON.stringify(normalizeNodeConfig(nodeConfigState), null, 2);
  } else {
    // 切回普通视图，尝试解析JSON同步字段
    try {
      const parsed = parseNodeConfigJson(nodeForm.node_config_json);
      applyConfigToState(parsed);
    } catch {
      // 保持当前表单状态并提示
      ElMessage.warning('节点配置JSON解析失败，已保留当前字段值');
    }
  }
};

const loadNodes = async () => {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    const keyword = searchKeyword.value.trim();
    if (keyword) {
      params.keyword = keyword;
    }

    if (statusFilter.value !== null && statusFilter.value !== undefined) {
      params.status = statusFilter.value;
    }

    const response = await getNodes(params);
    const payload = response.data;

    nodes.value = payload.data || [];
    pagerConfig.total = payload.total || 0;
  } catch (error) {
    console.error('加载节点失败:', error);
    ElMessage.error('加载节点列表失败');
    nodes.value = [];
    pagerConfig.total = 0;
  } finally {
    loading.value = false;
  }
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadNodes();
};

const handleSearch = () => {
  pagerConfig.currentPage = 1;
  loadNodes();
};

const handleStatusFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadNodes();
};

const handleSelectionChange = () => {
  const records = vxeTableRef.value?.getCheckboxRecords?.() || [];
  selectedNodes.value = records;
};

const handleTypeChange = (value: string) => {
  applyConfigToState(createDefaultNodeConfig(value));
  advancedView.value = false;
  ensureSS2022Password();
  ensureSSRPassword();
  ensureVlessRealityDefaults();
};

const editNode = (node: Node) => {
  editingNode.value = node;
  nodeForm.name = node.name;
  nodeForm.type = node.type;
  nodeForm.node_class = node.node_class;

  if (node.node_bandwidth_limit && node.node_bandwidth_limit > 0) {
    nodeForm.node_bandwidth_limit_gb = Math.round(node.node_bandwidth_limit / (1024 * 1024 * 1024));
  } else {
    nodeForm.node_bandwidth_limit_gb = 0;
  }

  nodeForm.node_bandwidth = node.node_bandwidth || 0;
  nodeForm.bandwidthlimit_resetday = node.bandwidthlimit_resetday || 1;
  nodeForm.traffic_multiplier = Number(node.traffic_multiplier || 1);

  try {
    const rawConfig = node.node_config ? (typeof node.node_config === 'string' ? node.node_config : JSON.stringify(node.node_config)) : '';
    applyConfigToState(rawConfig ? JSON.parse(rawConfig) : createDefaultNodeConfig(node.type));
  } catch (error) {
    console.error('解析节点配置失败，使用默认配置:', error);
    applyConfigToState(createDefaultNodeConfig(node.type));
  }
  advancedView.value = false;

  showCreateDialog.value = true;
};

const copyNode = (node: Node) => {
  editingNode.value = null;
  nodeForm.name = `${node.name} - 副本`;
  nodeForm.type = node.type;
  nodeForm.node_class = node.node_class;

  if (node.node_bandwidth_limit && node.node_bandwidth_limit > 0) {
    nodeForm.node_bandwidth_limit_gb = Math.round(node.node_bandwidth_limit / (1024 * 1024 * 1024));
  } else {
    nodeForm.node_bandwidth_limit_gb = 0;
  }

  nodeForm.node_bandwidth = node.node_bandwidth || 0;
  nodeForm.bandwidthlimit_resetday = node.bandwidthlimit_resetday || 1;
  nodeForm.traffic_multiplier = Number(node.traffic_multiplier || 1);

  try {
    const rawConfig = node.node_config ? (typeof node.node_config === 'string' ? node.node_config : JSON.stringify(node.node_config)) : '';
    applyConfigToState(rawConfig ? JSON.parse(rawConfig) : createDefaultNodeConfig(node.type));
  } catch (error) {
    console.error('复制节点解析配置失败，使用默认配置:', error);
    applyConfigToState(createDefaultNodeConfig(node.type));
  }

  advancedView.value = false;
  showCreateDialog.value = true;
};

const showNodeDetails = (node: Node) => {
  selectedNode.value = node;
  showDetailsDialog.value = true;
};

const handleRowCommand = (command: string, row: Node) => {
  switch (command) {
    case 'edit':
      editNode(row);
      break;
    case 'toggle':
      toggleNodeStatus(row);
      break;
    case 'copy':
      copyNode(row);
      break;
    case 'details':
      showNodeDetails(row);
      break;
    case 'delete':
      deleteNode(row);
      break;
    default:
      break;
  }
};

const toggleNodeStatus = async (node: Node) => {
  try {
    const newStatus = node.status === 1 ? 0 : 1;
    const action = newStatus === 1 ? '显示' : '隐藏';

    await ElMessageBox.confirm(`确定要${action}节点"${node.name}"吗？`, '确认操作', { type: 'warning' });

    await updateNode(node.id, { status: newStatus } as any);
    node.status = newStatus;
    ElMessage.success(`节点${action}成功`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('切换节点状态失败:', error);
      ElMessage.error('操作失败，请重试');
    }
  }
};

const deleteNode = async (node: Node) => {
  try {
    await ElMessageBox.confirm(`确定要删除节点"${node.name}"吗？此操作不可撤销。`, '确认删除', { type: 'warning' });

    await deleteNodeAPI(node.id);
    await loadNodes();
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除节点失败:', error);
      ElMessage.error('删除失败，请重试');
    }
  }
};

const saveNode = async () => {
  if (!nodeFormRef.value) return;

  try {
    try {
      await nodeFormRef.value.validate();
    } catch (validateErr) {
      ElMessage.error('请完善必填项后再提交');
      return;
    }
    submitting.value = true;

    let finalConfig;
    try {
      finalConfig = advancedView.value
        ? normalizeNodeConfig(parseNodeConfigJson(nodeForm.node_config_json), nodeForm.type)
        : buildConfigFromForm();
    } catch (err) {
      console.error('构建节点配置失败:', err);
      ElMessage.error(err instanceof Error ? err.message : '配置构建失败');
      return;
    }

    // 为兼容后端旧字段，使用 client.server / client.port 进行填充
    const resolvedServer = finalConfig.client?.server || '';
    const resolvedPort = Number(finalConfig.client?.port || finalConfig.config?.port || 443);

    const formData = {
      name: nodeForm.name,
      type: nodeForm.type,
      server: resolvedServer,
      server_port: resolvedPort || nodeForm.service_port || 443,
      node_class: nodeForm.node_class,
      node_bandwidth_limit: nodeForm.node_bandwidth_limit_gb > 0 ? nodeForm.node_bandwidth_limit_gb * 1024 * 1024 * 1024 : 0,
      node_bandwidth: nodeForm.node_bandwidth,
      traffic_multiplier: nodeForm.traffic_multiplier > 0 ? nodeForm.traffic_multiplier : 1,
      bandwidthlimit_resetday: nodeForm.bandwidthlimit_resetday,
      node_config: JSON.stringify(finalConfig)
    };

    if (editingNode.value) {
      await updateNode(editingNode.value.id, formData);
      ElMessage.success('节点更新成功');
    } else {
      await createNode(formData);
      ElMessage.success('节点创建成功');
    }

    showCreateDialog.value = false;
    resetForm();
    await loadNodes();
  } catch (error) {
    console.error('保存节点失败:', error);
    ElMessage.error('保存失败，请重试');
  } finally {
    submitting.value = false;
  }
};

const resetForm = () => {
  editingNode.value = null;
  nodeForm.name = '';
  nodeForm.type = 'ss';
  nodeForm.node_class = 0;
  nodeForm.node_bandwidth_limit_gb = 0;
  nodeForm.node_bandwidth = 0;
  nodeForm.traffic_multiplier = 1;
  nodeForm.bandwidthlimit_resetday = 1;
  nodeForm.client_server = '';
  nodeForm.client_port = null;
  nodeForm.client_tls_host = '';
  nodeForm.client_publickey = '';
  nodeForm.service_port = null;
  nodeForm.basic_pull_interval = 60;
  nodeForm.basic_push_interval = 60;
  nodeForm.basic_speed_limit = 0;
  nodeForm.config_method = '';
  nodeForm.config_password = '';
  nodeForm.config_protocol = '';
  nodeForm.config_obfs = '';
  nodeForm.config_single_port_type = '';
  nodeForm.config_stream_type = '';
  nodeForm.config_tls_type = '';
  nodeForm.config_path = '';
  nodeForm.config_service_name = '';
  nodeForm.config_flow = '';
  nodeForm.config_server_names = '';
  nodeForm.config_private_key = '';
  nodeForm.config_short_ids = '';
  nodeForm.config_dest = '';
  nodeForm.config_obfs_password = '';
  nodeForm.config_padding_scheme = '';
  nodeForm.config_up_mbps = 1000;
  nodeForm.config_down_mbps = 1000;
  nodeForm.node_config_json = '';
  applyConfigToState(createDefaultNodeConfig('ss'));
  advancedView.value = false;
  nodeFormRef.value?.clearValidate();
  submitting.value = false;
};

const batchOnlineNodes = async () => {
  try {
    const nodeIds = selectedNodes.value.map(node => node.id);

    await ElMessageBox.confirm(`确定要批量显示选中的 ${selectedNodes.value.length} 个节点吗？`, '确认操作', { type: 'warning' });

    const { data } = await batchUpdateNodes({ action: 'enable', node_ids: nodeIds });

    selectedNodes.value.forEach(node => {
      node.status = 1;
    });

    ElMessage.success(data.message || `成功显示 ${data.affected_count} 个节点`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量显示节点失败:', error);
      ElMessage.error('批量显示失败，请重试');
    }
  }
};

const batchOfflineNodes = async () => {
  try {
    const nodeIds = selectedNodes.value.map(node => node.id);

    await ElMessageBox.confirm(`确定要批量隐藏选中的 ${selectedNodes.value.length} 个节点吗？`, '确认操作', { type: 'warning' });

    const { data } = await batchUpdateNodes({ action: 'disable', node_ids: nodeIds });

    selectedNodes.value.forEach(node => {
      node.status = 0;
    });

    ElMessage.success(data.message || `成功隐藏 ${data.affected_count} 个节点`);
  } catch (error) {
    if (error !== 'cancel') {
      console.error('批量隐藏节点失败:', error);
      ElMessage.error('批量隐藏失败，请重试');
    }
  }
};

onMounted(() => {
  loadNodes();
});
</script>

<style scoped lang="scss">
.admin-nodes {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }
  .table-actions {
    display: flex;
    justify-content: flex-end;
  }
  .dropdown-icon {
    margin-left: 4px;
    font-size: 12px;
  }
  .node-details {
    :deep(.el-descriptions-item__label) { width: 120px; }
    h4 { margin: 20px 0 10px 0; color: #303133; }
  }
}

.node-dialog {
  :deep(.el-dialog__body) {
    padding-top: 10px;
  }
  .form-scroll {
    padding-right: 4px;
  }
}

.section-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.section-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-weight: 600;
  color: #303133;
  margin-right: 8px;
}

.section-sub {
  color: #909399;
  font-size: 12px;
}

.section-subtitle {
  font-weight: 600;
  color: #606266;
  margin: 6px 0 4px;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: #606266;
}

.mode-toggle .hint {
  color: #909399;
  font-size: 12px;
}
</style>
