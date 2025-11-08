<template>
  <div class="user-page user-nodes">
    <div class="page-header">
      <h2>节点列表</h2>
      <p>查看可用节点及其状态信息</p>
    </div>

    <!-- 节点统计 -->
    <el-row :gutter="20" class="stats-overview">
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ totalNodes }}</div>
            <div class="stat-label">总节点数</div>
          </div>
          <div class="stat-icon"><el-icon><Connection /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ onlineNodes }}</div>
            <div class="stat-label">在线节点</div>
          </div>
          <div class="stat-icon online"><el-icon><CircleCheck /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ offlineNodes }}</div>
            <div class="stat-label">离线节点</div>
          </div>
          <div class="stat-icon offline"><el-icon><CircleClose /></el-icon></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-number">{{ availableNodes }}</div>
            <div class="stat-label">可用节点</div>
          </div>
          <div class="stat-icon available"><el-icon><Select /></el-icon></div>
        </el-card>
      </el-col>
    </el-row>

    <VxeTableBar :vxeTableRef="vxeTableRef" :columns="columns" title="节点列表" @refresh="loadNodes">
      <template #buttons>
        <el-select v-model="filterType" placeholder="节点类型" clearable @change="handleFilterChange" style="width: 150px">
          <el-option label="全部" value="" />
          <el-option label="Shadowsocks" value="ss" />
          <el-option label="V2Ray" value="v2ray" />
          <el-option label="Trojan" value="trojan" />
          <el-option label="Hysteria" value="hysteria" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="节点状态" clearable @change="handleFilterChange" style="width: 120px; margin-left: 12px;">
          <el-option label="全部" value="" />
          <el-option label="在线" :value="1" />
          <el-option label="离线" :value="0" />
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
          @page-change="handlePageChange"
        >
          <template #name="{ row }">
            <div class="node-name">
              <el-icon class="node-icon" :class="getNodeStatusClass(row)">
                <component :is="getNodeStatusIcon(row)" />
              </el-icon>
              <span>{{ row.name }}</span>
            </div>
          </template>
          <template #type="{ row }">
            <el-tag :type="getNodeTypeColor(row.type)" size="small">{{ getNodeTypeName(row.type) }}</el-tag>
          </template>
          <template #node_class="{ row }">
            <el-tag size="small">等级{{ row.node_class }}</el-tag>
          </template>
          <template #traffic="{ row }">
            <div class="traffic-info">
              <span>{{ (row.user_total_traffic || 0) === 0 ? '未使用' : formatTraffic(row.user_total_traffic || 0) }}</span>
            </div>
          </template>
          <template #status="{ row }">
            <el-tag :type="isNodeOnline(row) ? 'success' : 'danger'" size="small">
              {{ isNodeOnline(row) ? '在线' : '离线' }}
            </el-tag>
          </template>
          <template #actions="{ row }">
            <el-button type="primary" size="small" @click="showNodeDetails(row)">详情</el-button>
          </template>
        </vxe-grid>
      </template>
    </VxeTableBar>

    <!-- 节点详情对话框 -->
    <el-dialog v-model="showDetailsDialog" title="节点详情" width="800px">
      <div v-if="selectedNode" class="node-details">
        <el-tabs v-model="activeTab" type="border-card">
          <!-- 基本信息 -->
          <el-tab-pane label="基本信息" name="basic">
            <!-- 桌面端显示 -->
            <el-descriptions :column="2" border class="desktop-descriptions">
              <el-descriptions-item label="节点名称">{{ selectedNode.name }}</el-descriptions-item>
              <el-descriptions-item label="节点类型">{{ getNodeTypeName(selectedNode.type) }}</el-descriptions-item>
              <el-descriptions-item label="节点地址">{{ formatNodeAddress(selectedNode) }}</el-descriptions-item>
              <el-descriptions-item label="节点限速">{{ getSpeedLimit(selectedNode) }}</el-descriptions-item>
              <el-descriptions-item label="节点等级">等级{{ selectedNode.node_class }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag :type="isNodeOnline(selectedNode) ? 'success' : 'danger'">
                  {{ isNodeOnline(selectedNode) ? '在线' : '离线' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="个人流量使用">
                {{ (selectedNode.user_total_traffic || 0) === 0 ? '未使用' : formatTraffic(selectedNode.user_total_traffic || 0) }}
              </el-descriptions-item>
              <el-descriptions-item label="在线状态">
                <el-tag :type="isNodeOnline(selectedNode) ? 'success' : 'info'" size="small">
                  {{ isNodeOnline(selectedNode) ? '5分钟内有活动' : '超过5分钟无活动' }}
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>

            <!-- 移动端显示 -->
            <div class="mobile-node-info">
              <div class="info-item">
                <div class="info-label">节点名称</div>
                <div class="info-value">{{ selectedNode.name }}</div>
              </div>
              <div class="info-item">
                <div class="info-label">节点类型</div>
                <div class="info-value">
                  <el-tag :type="getNodeTypeColor(selectedNode.type)">
                    {{ getNodeTypeName(selectedNode.type) }}
                  </el-tag>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">节点地址</div>
                <div class="info-value">{{ formatNodeAddress(selectedNode) }}</div>
              </div>
              <div class="info-item">
                <div class="info-label">节点限速</div>
                <div class="info-value">{{ getSpeedLimit(selectedNode) }}</div>
              </div>
              <div class="info-item">
                <div class="info-label">节点等级</div>
                <div class="info-value">
                  <el-tag size="small">等级{{ selectedNode.node_class }}</el-tag>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">状态</div>
                <div class="info-value">
                  <el-tag :type="isNodeOnline(selectedNode) ? 'success' : 'danger'">
                    {{ isNodeOnline(selectedNode) ? '在线' : '离线' }}
                  </el-tag>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">个人流量使用</div>
                <div class="info-value">
                  {{ (selectedNode.user_total_traffic || 0) === 0 ? '未使用' : formatTraffic(selectedNode.user_total_traffic || 0) }}
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">在线状态</div>
                <div class="info-value">
                  <el-tag :type="isNodeOnline(selectedNode) ? 'success' : 'info'" size="small">
                    {{ isNodeOnline(selectedNode) ? '5分钟内有活动' : '超过5分钟无活动' }}
                  </el-tag>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 详细配置 -->
          <el-tab-pane label="详细配置" name="config">
            <div class="config-section">
              <div class="connection-link">
                <h4 style="margin-left: 8px;">连接链接</h4>
                <el-input
                  v-model="connectionUrl"
                  type="textarea"
                  :rows="3"
                  readonly
                  placeholder="连接链接"
                  @click="copyConnectionUrl"
                  style="cursor: pointer;"
                />
              </div>

              <div class="node-config" style="margin-top: 20px;">
                <h4 style="margin-left: 8px;">节点配置 (JSON)</h4>
                <el-input
                  v-model="nodeConfigJson"
                  type="textarea"
                  :rows="8"
                  readonly
                  placeholder="节点配置信息"
                  @click="copyNodeConfigJson"
                  style="cursor: pointer;"
                />
              </div>
            </div>
          </el-tab-pane>

          <!-- 二维码 -->
          <el-tab-pane label="连接二维码" name="qrcode">
            <div class="qr-section">
              <div class="qr-container">
                <div ref="qrCodeRef" class="qr-code"></div>
              </div>
              <div class="qr-info">
                <el-alert
                  title="使用说明"
                  type="info"
                  :closable="false"
                >
                  <p>扫描二维码快速配置代理客户端：</p>
                  <ul>
                    <li>Shadowsocks: SS客户端 (Android/iOS/Windows/macOS)</li>
                    <li>V2Ray: V2RayNG (Android) / V2RayX (macOS) / V2RayN (Windows)</li>
                    <li>Trojan: Clash、V2Ray 等客户端</li>
                    <li>Clash: Clash for Android / ClashX (macOS) / Clash for Windows</li>
                    <li>其他支持相应协议的客户端</li>
                  </ul>
                </el-alert>
                <div class="qr-actions" style="margin-top: 15px;">
                  <el-button type="primary" @click="copyNodeConfig">
                    <el-icon><CopyDocument /></el-icon>
                    复制{{ getNodeTypeName(selectedNode?.type) }}链接
                  </el-button>
                  <el-button @click="downloadQRCode">
                    <el-icon><Download /></el-icon>
                    下载二维码
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, nextTick, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Connection, CircleCheck, CircleClose, Select, CopyDocument, Download } from '@element-plus/icons-vue';
import { VxeTableBar } from '@/components/ReVxeTableBar';
import { getUserNodes } from '@/api/user';
import { useUserStore } from '@/store/user';
import QRCode from 'qrcode';

const userStore = useUserStore();
const vxeTableRef = ref();
const loading = ref(false);
const showDetailsDialog = ref(false);
const nodes = ref([]);
const selectedNode = ref(null);
const filterType = ref('');
const filterStatus = ref('');
const totalNodes = ref(0);
const onlineNodes = ref(0);
const offlineNodes = ref(0);
const availableNodes = ref(0);
const activeTab = ref('basic');
const qrCodeRef = ref<HTMLElement>();

const pagerConfig = reactive({
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
  { field: 'name', title: '节点名称', minWidth: 180, visible: true, slots: { default: 'name' } },
  { field: 'type', title: '类型', width: 120, visible: true, slots: { default: 'type' } },
  { field: 'node_class', title: '等级', width: 100, visible: true, slots: { default: 'node_class' } },
  { field: 'traffic', title: '流量使用', width: 180, visible: true, slots: { default: 'traffic' } },
  { field: 'status', title: '状态', width: 100, visible: true, slots: { default: 'status' } },
  { field: 'actions', title: '操作', width: 100, fixed: 'right', visible: true, slots: { default: 'actions' } }
];

// 判断节点是否在线
const isNodeOnline = (node: any) => {
  // 优先使用后端返回的 is_online 字段(基于最近5分钟的活动)
  if (typeof node.is_online === 'boolean') {
    return node.is_online;
  }
  // 如果没有 is_online 字段,使用 status 字段作为后备
  return node.status === 1;
};

const getNodeStatusIcon = (node: any) => {
  return isNodeOnline(node) ? CircleCheck : CircleClose;
};

const getNodeStatusClass = (node: any) => {
  return isNodeOnline(node) ? 'online' : 'offline';
};

const getNodeTypeColor = (type: string) => {
  const colorMap: Record<string, string> = {
    ss: 'primary',
    v2ray: 'success',
    trojan: 'warning',
    hysteria: 'danger',
    vless: 'success'
  };
  return colorMap[type?.toLowerCase()] || 'info';
};

const getNodeTypeName = (type: string) => {
  const nameMap: Record<string, string> = {
    ss: 'Shadowsocks',
    shadowsocks: 'Shadowsocks',
    v2ray: 'V2Ray',
    vmess: 'VMess',
    vless: 'VLESS',
    trojan: 'Trojan',
    hysteria: 'Hysteria',
    hysteria2: 'Hysteria2'
  };
  return nameMap[type?.toLowerCase()] || type?.toUpperCase() || 'Unknown';
};

const formatTraffic = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const wrapIPv6Host = (host: string): string => {
  if (!host) return host;
  const trimmed = host.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed;
  }
  return trimmed.includes(':') ? `[${trimmed}]` : trimmed;
};

const formatNodeAddress = (node: any): string => {
  if (!node) return '';
  const host = wrapIPv6Host(node.server);
  return `${host}:${node.server_port}`;
};

// 获取节点限速显示
const getSpeedLimit = (node: any): string => {
  try {
    const config = JSON.parse(node.node_config);
    const speedLimit = config.basic?.speed_limit || 0;
    return speedLimit === 0 ? '不限制' : `${speedLimit} Mbps`;
  } catch {
    return '不限制';
  }
};

// 生成连接链接(ss://、vmess:// 等)
const connectionUrl = computed(() => {
  if (!selectedNode.value) return '';

  try {
    // 检查node_config是否存在且有效
    if (!selectedNode.value.node_config || selectedNode.value.node_config === 'undefined') {
      console.warn('节点配置为空或无效，使用默认配置');
      const defaultConfig = {};
      switch (selectedNode.value.type.toLowerCase()) {
        case 'ss':
        case 'shadowsocks':
          return generateShadowsocksUrl(selectedNode.value, defaultConfig);
        case 'v2ray':
          return generateVMessUrl(selectedNode.value, defaultConfig);
        case 'vless':
          return generateVLessUrl(selectedNode.value, defaultConfig);
        case 'trojan':
          return generateTrojanUrl(selectedNode.value, defaultConfig);
        case 'hysteria':
        case 'hysteria2':
          return generateHysteriaUrl(selectedNode.value, defaultConfig);
        default:
          return `${selectedNode.value.type}://${wrapIPv6Host(selectedNode.value.server)}:${selectedNode.value.server_port}`;
      }
    }

    const config = JSON.parse(selectedNode.value.node_config);
    const nodeConfig = config.config || {};

    // 根据节点类型生成相应的配置URL
    switch (selectedNode.value.type.toLowerCase()) {
      case 'ss':
      case 'shadowsocks':
        return generateShadowsocksUrl(selectedNode.value, nodeConfig);
      case 'v2ray':
        return generateVMessUrl(selectedNode.value, nodeConfig);
      case 'vless':
        return generateVLessUrl(selectedNode.value, nodeConfig);
      case 'trojan':
        return generateTrojanUrl(selectedNode.value, nodeConfig);
      case 'hysteria':
      case 'hysteria2':
        return generateHysteriaUrl(selectedNode.value, nodeConfig);
      default:
        return `${selectedNode.value.type}://${selectedNode.value.server}:${selectedNode.value.server_port}`;
    }
  } catch (error) {
    console.error('解析节点配置失败:', error);
    return `${selectedNode.value.type}://${wrapIPv6Host(selectedNode.value.server)}:${selectedNode.value.server_port}`;
  }
});

// 生成节点配置JSON
const nodeConfigJson = computed(() => {
  if (!selectedNode.value) return '';

  try {
    let nodeConfig = {};

    // 检查node_config是否存在且有效
    if (selectedNode.value.node_config && selectedNode.value.node_config !== 'undefined') {
      try {
        const config = JSON.parse(selectedNode.value.node_config);
        nodeConfig = config.config || config || {};
      } catch (parseError) {
        console.warn('节点配置JSON解析失败，使用默认配置:', parseError);
      }
    }

    // 根据节点类型生成相应的JSON配置
    switch (selectedNode.value.type.toLowerCase()) {
      case 'ss':
      case 'shadowsocks':
        const ssConfig = {
          name: selectedNode.value.name,
          type: "ss",
          server: selectedNode.value.server,
          port: selectedNode.value.server_port,
          cipher: nodeConfig.cipher || "aes-256-gcm",
          password: userStore.user?.passwd || '',
          udp: true
        };

        // 混淆插件配置
        if (nodeConfig.obfs && nodeConfig.obfs !== "plain") {
          ssConfig.plugin = "obfs";
          ssConfig["plugin-opts"] = {
            mode: nodeConfig.obfs === "simple_obfs_http" ? "http" : "tls",
            host: selectedNode.value.tls_host || nodeConfig.server || "bing.com"
          };
        }

        return JSON.stringify(ssConfig, null, 2);

      case 'v2ray':
        const vmessConfig = {
          name: selectedNode.value.name,
          type: "vmess",
          server: selectedNode.value.server,
          port: selectedNode.value.server_port,
          uuid: userStore.user?.uuid || '',
          alterId: nodeConfig.aid || 0,
          cipher: "auto",
          tls: nodeConfig.tls_type === "tls",
          "skip-cert-verify": true,
          network: nodeConfig.stream_type || "tcp"
        };

        // 添加 TLS 配置
        if (nodeConfig.tls_type === "tls") {
          if (selectedNode.value.tls_host) {
            vmessConfig.servername = selectedNode.value.tls_host;
          }
        }

        // WebSocket 配置
        if (nodeConfig.stream_type === "ws") {
          vmessConfig["ws-opts"] = {
            path: nodeConfig.path || "/",
            headers: { Host: selectedNode.value.tls_host || nodeConfig.server || selectedNode.value.server }
          };
        }
        // gRPC 配置
        else if (nodeConfig.stream_type === "grpc") {
          vmessConfig["grpc-opts"] = {
            "grpc-service-name": nodeConfig.service_name || "grpc"
          };
        }
        // HTTP 配置
        else if (nodeConfig.stream_type === "http") {
          vmessConfig["http-opts"] = {
            method: "GET",
            path: [nodeConfig.path || "/"]
          };
          if (nodeConfig.server) {
            vmessConfig["http-opts"].headers = {
              Connection: ["keep-alive"],
              Host: [selectedNode.value.tls_host || nodeConfig.server]
            };
          }
        }

        return JSON.stringify(vmessConfig, null, 2);

      case 'vless':
        const vlessConfig = {
          name: selectedNode.value.name,
          type: "vless",
          server: selectedNode.value.server,
          port: selectedNode.value.server_port,
          uuid: userStore.user?.uuid || '',
          tls: nodeConfig.tls_type === "tls" || nodeConfig.tls_type === "reality",
          "skip-cert-verify": true,
          network: nodeConfig.stream_type || "tcp"
        };

        // TLS 配置
        if (nodeConfig.tls_type === "tls") {
          if (selectedNode.value.tls_host) {
            vlessConfig.servername = selectedNode.value.tls_host;
          }
        }

        // Reality 配置
        if (nodeConfig.tls_type === "reality") {
          vlessConfig["reality-opts"] = {
            "public-key": nodeConfig.public_key || "",
            "short-id": nodeConfig.short_ids ? nodeConfig.short_ids[0] : ""
          };
          vlessConfig["client-fingerprint"] = nodeConfig.fingerprint || "chrome";
          if (nodeConfig.server_names && nodeConfig.server_names.length > 0) {
            vlessConfig.servername = nodeConfig.server_names[0];
          }
        }

        if (nodeConfig.flow) {
          vlessConfig.flow = nodeConfig.flow;
        }

        // WebSocket 配置
        if (nodeConfig.stream_type === "ws") {
          vlessConfig["ws-opts"] = {
            path: nodeConfig.path || "/",
            headers: { Host: selectedNode.value.tls_host || nodeConfig.server || selectedNode.value.server }
          };
        }
        // gRPC 配置
        else if (nodeConfig.stream_type === "grpc") {
          vlessConfig["grpc-opts"] = {
            "grpc-service-name": nodeConfig.service_name || "grpc"
          };
        }

        return JSON.stringify(vlessConfig, null, 2);

      case 'trojan':
        const trojanConfig = {
          name: selectedNode.value.name,
          type: "trojan",
          server: selectedNode.value.server,
          port: selectedNode.value.server_port,
          password: userStore.user?.passwd || '',
          "skip-cert-verify": true,
          sni: selectedNode.value.tls_host || selectedNode.value.server
        };

        // 添加 WebSocket 配置
        if (nodeConfig.stream_type === "ws") {
          trojanConfig.network = "ws";
          trojanConfig["ws-opts"] = {
            path: nodeConfig.path || "/",
            headers: {
              Host: selectedNode.value.tls_host || selectedNode.value.server
            }
          };
        }
        // 添加 gRPC 配置
        else if (nodeConfig.stream_type === "grpc") {
          trojanConfig.network = "grpc";
          trojanConfig["grpc-opts"] = {
            "grpc-service-name": nodeConfig.service_name || "grpc"
          };
        }

        return JSON.stringify(trojanConfig, null, 2);

      case 'hysteria':
      case 'hysteria2':
        const hysteriaConfig = {
          name: selectedNode.value.name,
          type: "hysteria2",
          server: selectedNode.value.server,
          port: selectedNode.value.server_port,
          password: userStore.user?.passwd || '',
          "skip-cert-verify": true
        };

        // 添加 SNI 配置
        if (selectedNode.value.tls_host) {
          hysteriaConfig.sni = selectedNode.value.tls_host;
        }

        // 添加混淆配置
        if (nodeConfig.obfs && nodeConfig.obfs !== "plain") {
          hysteriaConfig.obfs = nodeConfig.obfs;
          if (nodeConfig.obfs_password) {
            hysteriaConfig["obfs-password"] = nodeConfig.obfs_password;
          }
        }

        // 添加带宽配置
        if (nodeConfig.up_mbps) {
          hysteriaConfig.up = `${nodeConfig.up_mbps} Mbps`;
        }
        if (nodeConfig.down_mbps) {
          hysteriaConfig.down = `${nodeConfig.down_mbps} Mbps`;
        }

        return JSON.stringify(hysteriaConfig, null, 2);

      default:
        return JSON.stringify({
          server: selectedNode.value.server,
          server_port: selectedNode.value.server_port,
          type: selectedNode.value.type,
          remarks: selectedNode.value.name
        }, null, 2);
    }
  } catch (error) {
    console.error('生成节点配置失败:', error);
    return JSON.stringify({
      server: selectedNode.value.server,
      server_port: selectedNode.value.server_port,
      type: selectedNode.value.type,
      error: '配置生成失败',
      remarks: selectedNode.value.name
    }, null, 2);
  }
});

// 生成各类协议的URL
const generateVMessUrl = (node: any, config: any): string => {
  const vmessConfig = {
    v: "2",
    ps: node.name,
    add: node.server,
    port: node.server_port.toString(),
    id: userStore.user?.uuid || '',
    aid: "0",
    net: config.stream_type || 'tcp',
    type: "auto",
    host: node.tls_host || node.server,
    path: config.path || '',
  };

  if (config.tls_type === 'tls') {
    vmessConfig.tls = 'tls';
  }

  const vmessJson = JSON.stringify(vmessConfig);
  const vmessBase64 = btoa(vmessJson);
  return `vmess://${vmessBase64}`;
};

const generateVLessUrl = (node: any, config: any): string => {
  const uuid = userStore.user?.uuid || '';
  const hostParam = node.tls_host || node.server;
  const serverHost = wrapIPv6Host(node.server);
  const port = node.server_port;
  const streamType = config.stream_type || 'tcp';
  const path = config.path || '';
  const nodeName = encodeURIComponent(node.name);

  return `vless://${uuid}@${serverHost}:${port}?encryption=none&security=tls&type=${streamType}&host=${hostParam}&path=${path}#${nodeName}`;
};

const generateTrojanUrl = (node: any, config: any): string => {
  const password = userStore.user?.passwd || '';
  const host = node.tls_host || node.server;
  const serverHost = wrapIPv6Host(node.server);
  const port = node.server_port;
  const streamType = config.stream_type || 'tcp';
  const nodeName = encodeURIComponent(node.name);

  const params = new URLSearchParams();

  if (streamType === 'ws') {
    params.set('type', 'ws');
    params.set('host', host);
    params.set('path', config.path || '/');
  } else if (streamType === 'grpc') {
    params.set('type', 'grpc');
    params.set('serviceName', config.service_name || 'grpc');
  }

  params.set('sni', host);

  const queryString = params.toString();
  return `trojan://${password}@${serverHost}:${port}?${queryString}#${nodeName}`;
};

const generateShadowsocksUrl = (node: any, config: any): string => {
  const password = userStore.user?.passwd || '';
  const method = config.cipher || 'aes-256-gcm';
  const nodeName = encodeURIComponent(node.name);

  const serverHost = wrapIPv6Host(node.server);
  const auth = `${method}:${password}@${serverHost}:${node.server_port}`;
  const authBase64 = btoa(auth);
  return `ss://${authBase64}#${nodeName}`;
};

const generateHysteriaUrl = (node: any, config: any): string => {
  const password = userStore.user?.passwd || '';
  const host = node.tls_host || node.server;
  const serverHost = wrapIPv6Host(node.server);
  const port = node.server_port;
  const nodeName = encodeURIComponent(node.name);

  return `hysteria2://${password}@${serverHost}:${port}/?sni=${host}#${nodeName}`;
};

const loadNodes = async () => {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      page: pagerConfig.currentPage,
      limit: pagerConfig.pageSize
    };

    if (filterType.value) {
      params.type = filterType.value;
    }

    if (filterStatus.value !== '' && filterStatus.value !== null && filterStatus.value !== undefined) {
      params.status = filterStatus.value;
    }

    const response = await getUserNodes(params);
    const responseData = response.data;

    nodes.value = responseData.nodes || [];
    pagerConfig.total = responseData.pagination?.total || nodes.value.length;
    totalNodes.value = responseData.statistics?.total || 0;
    onlineNodes.value = responseData.statistics?.online || 0;
    offlineNodes.value = responseData.statistics?.offline || 0;
    availableNodes.value = responseData.statistics?.accessible || 0;
  } catch (error) {
    console.error('加载节点列表失败:', error);
    ElMessage.error('加载节点列表失败');
  } finally {
    loading.value = false;
  }
};

const handleFilterChange = () => {
  pagerConfig.currentPage = 1;
  loadNodes();
};

const handlePageChange = ({ currentPage, pageSize }) => {
  pagerConfig.currentPage = currentPage;
  pagerConfig.pageSize = pageSize;
  loadNodes();
};

const showNodeDetails = (node: any) => {
  selectedNode.value = node;
  activeTab.value = 'basic';
  showDetailsDialog.value = true;
};

// 生成二维码
const generateQRCode = async () => {
  if (!selectedNode.value || !qrCodeRef.value) return;

  try {
    const qrUrl = connectionUrl.value;

    if (!qrUrl) {
      console.warn('无法生成连接链接，跳过二维码生成');
      return;
    }

    // 清空之前的二维码并重新生成
    qrCodeRef.value.innerHTML = '';

    // 生成二维码到Canvas元素
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, qrUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    qrCodeRef.value.appendChild(canvas);
    console.log('生成二维码成功，节点:', selectedNode.value.name, '链接:', qrUrl);
  } catch (error) {
    console.error('生成二维码失败:', error);
    ElMessage.error('生成二维码失败');
  }
};

// 复制连接链接
const copyConnectionUrl = async () => {
  if (!connectionUrl.value) return;

  try {
    await navigator.clipboard.writeText(connectionUrl.value);
    ElMessage.success('连接链接已复制到剪贴板');
  } catch (error) {
    console.error('复制连接链接失败:', error);
    ElMessage.error('复制失败，请手动复制');
  }
};

// 复制节点配置JSON
const copyNodeConfigJson = async () => {
  if (!nodeConfigJson.value) return;

  try {
    await navigator.clipboard.writeText(nodeConfigJson.value);
    ElMessage.success('节点配置已复制到剪贴板');
  } catch (error) {
    console.error('复制节点配置失败:', error);
    ElMessage.error('复制失败，请手动复制');
  }
};

// 复制节点配置链接
const copyNodeConfig = async () => {
  if (!selectedNode.value) return;

  try {
    const configUrl = connectionUrl.value;

    if (!configUrl) {
      ElMessage.error('无法生成连接链接');
      return;
    }

    await navigator.clipboard.writeText(configUrl);

    const protocolName = getNodeTypeName(selectedNode.value.type);
    ElMessage.success(`${protocolName}配置链接已复制到剪贴板`);
  } catch (error) {
    console.error('复制失败:', error);
    ElMessage.error('复制失败，请手动复制');
  }
};

// 下载二维码
const downloadQRCode = () => {
  if (!qrCodeRef.value) return;

  const canvas = qrCodeRef.value.querySelector('canvas');
  if (!canvas) return;

  try {
    const link = document.createElement('a');
    link.download = `${selectedNode.value?.name || 'node'}_qrcode.png`;
    link.href = canvas.toDataURL();
    link.click();
    ElMessage.success('二维码下载成功');
  } catch (error) {
    console.error('下载失败:', error);
    ElMessage.error('下载失败');
  }
};

// 监听选择的节点变化，当切换到二维码tab时自动生成
watch([() => selectedNode.value, () => activeTab.value, () => showDetailsDialog.value], ([node, tab, visible], [oldNode, oldTab, oldVisible]) => {
  if (node && tab === 'qrcode' && visible) {
    const nodeChanged = node !== oldNode;
    const tabChanged = tab !== oldTab && tab === 'qrcode';
    const dialogOpened = visible && !oldVisible;

    if (nodeChanged || tabChanged || dialogOpened) {
      nextTick(() => {
        console.log('触发二维码重新生成，节点:', node.name);
        generateQRCode();
      });
    }
  }
});

onMounted(() => {
  loadNodes();
});
</script>

<style scoped lang="scss">
.user-nodes {
  .page-header {
    margin-bottom: 24px;
    h2 { margin: 0 0 8px 0; color: #303133; font-size: 24px; }
    p { margin: 0; color: #909399; }
  }

  .stats-overview {
    margin-bottom: 24px;
    .stat-card {
      :deep(.el-card__body) {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
      }
      .stat-content {
        .stat-number { font-size: 28px; font-weight: 700; color: #303133; margin-bottom: 8px; }
        .stat-label { font-size: 14px; color: #909399; }
      }
      .stat-icon {
        font-size: 32px;
        color: #909399;
        opacity: 0.6;
        &.online { color: #67c23a; }
        &.offline { color: #f56c6c; }
        &.available { color: #409eff; }
      }
    }
  }

  .node-name {
    display: flex;
    align-items: center;
    .node-icon {
      margin-right: 8px;
      &.online { color: #67c23a; }
      &.offline { color: #f56c6c; }
    }
  }

  .traffic-info { font-size: 13px; color: #606266; }

  .node-details {
    .config-section {
      h4 {
        margin-bottom: 10px;
        color: #303133;
      }
    }

    .qr-section {
      display: flex;
      gap: 20px;
      align-items: flex-start;

      .qr-container {
        flex-shrink: 0;

        .qr-code {
          padding: 15px;
          background: white;
          border: 1px solid #dcdfe6;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 256px;
          min-width: 256px;

          canvas {
            border-radius: 4px;
          }
        }
      }

      .qr-info {
        flex: 1;

        .qr-actions {
          display: flex;
          gap: 10px;
        }
      }
    }

    :deep(.el-tabs__content) {
      padding: 20px 0;
    }

    :deep(.el-alert) {
      ul {
        margin: 10px 0;
        padding-left: 20px;

        li {
          margin: 5px 0;
        }
      }
    }
  }

  // 桌面端显示 - 默认样式
  .mobile-node-info {
    display: none; // 桌面端隐藏移动端布局
  }

  .desktop-descriptions {
    display: block; // 桌面端显示描述列表
  }
}

// 响应式设计 - 移动端
@media (max-width: 768px) {
  .user-nodes {
    .node-details {
      // 移动端隐藏桌面端描述列表
      .desktop-descriptions {
        display: none;
      }

      // 移动端信息卡片
      .mobile-node-info {
        display: block;

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          margin-bottom: 8px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e9ecef;

          .info-label {
            font-weight: 500;
            color: #495057;
            font-size: 13px;
            min-width: 80px;
            flex-shrink: 0;
          }

          .info-value {
            color: #212529;
            font-size: 13px;
            text-align: right;
            word-break: break-all;

            .el-tag {
              font-size: 11px;
              padding: 2px 8px;
            }
          }
        }
      }

      .config-section {
        h4 {
          font-size: 14px;
          margin: 15px 0 10px 0;
        }

        :deep(.el-textarea__inner) {
          font-size: 12px;
          line-height: 1.4;
        }
      }

      .qr-section {
        flex-direction: column;

        .qr-container {
          margin-bottom: 20px;
          align-self: center;
          width: 100%;
          display: flex;
          justify-content: center;

          .qr-code {
            min-width: 200px;
            min-height: 200px;
          }
        }

        .qr-info {
          width: 100%;

          :deep(.el-alert) {
            padding: 12px 16px !important;

            .el-alert__content {
              padding: 10px 0;

              p {
                margin: 8px 0 4px 0;
                font-size: 12px;
              }

              ul {
                margin: 8px 0;
                padding-left: 16px;

                li {
                  margin: 4px 0;
                  font-size: 11px;
                  line-height: 1.4;
                }
              }
            }
          }

          .qr-actions {
            flex-direction: column;
            margin-top: 15px;

            .el-button {
              width: 100% !important;
              padding: 12px 16px !important;
              font-size: 13px;
              margin: 0 !important;
            }
          }
        }
      }
    }
  }
}
</style>
