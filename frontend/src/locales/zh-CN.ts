export default {
  // 通用
  common: {
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    view: '查看',
    add: '添加',
    refresh: '刷新',
    search: '搜索',
    reset: '重置',
    submit: '提交',
    loading: '加载中...',
    success: '成功',
    error: '错误',
    warning: '警告',
    info: '信息',
    copy: '复制',
    download: '下载',
    upload: '上传',
    back: '返回',
    next: '下一步',
    prev: '上一步',
    finish: '完成',
    close: '关闭'
  },

  // 导航菜单
  menu: {
    dashboard: '仪表板',
    nodes: '节点列表',
    traffic: '流量统计',
    subscription: '订阅管理',
    profile: '个人资料',
    admin: '管理员',
    adminDashboard: '管理面板',
    userManagement: '用户管理',
    logout: '退出登录'
  },

  // 认证相关
  auth: {
    login: '登录',
    register: '注册',
    username: '用户名',
    email: '邮箱',
    password: '密码',
    confirmPassword: '确认密码',
    rememberMe: '记住我',
    forgotPassword: '忘记密码？',
    loginSuccess: '登录成功',
    loginFailed: '登录失败',
    registerSuccess: '注册成功',
    registerFailed: '注册失败',
    logoutSuccess: '退出成功',
    pleaseLogin: '请先登录',
    invalidCredentials: '用户名或密码错误',
    accountLocked: '账户已被锁定',
    sessionExpired: '会话已过期，请重新登录',
    createAccount: '创建账户',
    verificationCode: '验证码',
    verificationCodePlaceholder: '请输入邮箱验证码',
    sendVerificationCode: '获取验证码',
    secondsAbbr: '{seconds}秒',
    codeSent: '验证码已发送，请查收邮箱',
    codeSendFailed: '发送验证码失败，请稍后重试',
    inputEmailFirst: '请先输入邮箱地址'
  },

  // 仪表板
  dashboard: {
    welcome: '欢迎回来',
    userLevel: '用户等级',
    usedTraffic: '已用流量',
    availableNodes: '可用节点',
    accountStatus: '账户状态',
    trafficUsage: '流量使用情况',
    accountInfo: '账户信息',
    todayUsage: '今日使用',
    registrationDate: '注册时间',
    expirationDate: '到期时间',
    levelExpiry: '等级过期'
  },

  // 节点管理
  nodes: {
    title: '节点列表',
    description: '查看您可以访问的所有节点',
    totalNodes: '总节点数',
    onlineNodes: '在线节点',
    offlineNodes: '离线节点',
    myLevel: '我的等级',
    nodeName: '节点名称',
    nodeType: '类型',
    location: '位置',
    status: '状态',
    traffic: '流量',
    load: '负载',
    actions: '操作',
    details: '详情',
    test: '测试',
    online: '在线',
    offline: '离线',
    normal: '正常',
    disabled: '停用',
    nodeDetails: '节点详情',
    nodeConfig: '节点配置',
    serverAddress: '服务器地址',
    port: '端口',
    nodeLevel: '节点等级',
    createdAt: '创建时间',
    testingConnection: '正在测试节点连接...',
    connectionNormal: '连接正常',
    connectionTimeout: '连接超时',
    allRegions: '全部地区',
    allStatus: '全部状态',
    searchPlaceholder: '搜索节点名称'
  },

  // 流量统计
  traffic: {
    title: '流量统计',
    description: '查看您的流量使用详情',
    overview: '流量概览',
    totalUsed: '总用量',
    totalQuota: '总配额',
    dailyAverage: '日均用量',
    remainingQuota: '剩余配额',
    usageChart: '使用趋势',
    usageTable: '使用记录',
    date: '日期',
    upload: '上传',
    download: '下载',
    total: '总计',
    days7: '7天',
    days30: '30天',
    days90: '90天',
    noData: '暂无数据'
  },

  // 订阅管理
  subscription: {
    title: '订阅管理',
    description: '管理您的客户端订阅链接',
    subscriptionLinks: '订阅链接',
    clientType: '客户端类型',
    subscriptionUrl: '订阅地址',
    qrCode: 'QR码',
    copyLink: '复制链接',
    refreshToken: '刷新令牌',
    usageGuide: '使用说明',
    tokenRefreshed: '令牌已刷新',
    linkCopied: '链接已复制',
    v2rayGuide: 'V2Ray客户端使用说明：复制订阅链接，在客户端中添加订阅即可',
    clashGuide: 'Clash客户端使用说明：复制配置链接，在Clash中导入配置文件',
    quantumultGuide: 'Quantumult X使用说明：扫描二维码或复制链接添加到节点列表'
  },

  // 个人资料
  profile: {
    title: '个人资料',
    description: '管理您的账户信息',
    basicInfo: '基本信息',
    securitySettings: '安全设置',
    changePassword: '修改密码',
    currentPassword: '当前密码',
    newPassword: '新密码',
    confirmNewPassword: '确认新密码',
    updateProfile: '更新资料',
    updateSuccess: '更新成功',
    updateFailed: '更新失败',
    passwordChanged: '密码修改成功',
    passwordMismatch: '两次输入的密码不一致'
  },

  // 管理员
  admin: {
    dashboard: {
      title: '管理面板',
      totalUsers: '总用户数',
      activeUsers: '活跃用户',
      totalNodes: '总节点数',
      totalTraffic: '总流量',
      userGrowth: '用户增长',
      trafficTrend: '流量趋势'
    },
    users: {
      title: '用户管理',
      description: '管理系统中的所有用户',
      addUser: '添加用户',
      editUser: '编辑用户',
      deleteUser: '删除用户',
      userId: '用户ID',
      username: '用户名',
      email: '邮箱',
      level: '等级',
      status: '状态',
      registrationDate: '注册日期',
      lastLogin: '最后登录',
      actions: '操作',
      active: '活跃',
      inactive: '非活跃',
      banned: '已禁用',
      deleteConfirm: '确定要删除这个用户吗？',
      userDeleted: '用户已删除',
      userUpdated: '用户信息已更新',
      userCreated: '用户创建成功'
    }
  },

  // 错误消息
  errors: {
    networkError: '网络连接失败，请检查网络设置',
    timeoutError: '请求超时，请稍后重试',
    serverError: '服务器内部错误，请稍后重试',
    notFound: '请求的资源不存在',
    forbidden: '权限不足，无法访问该资源',
    unauthorized: '身份验证失败，请重新登录',
    unknownError: '未知错误',
    loadFailed: '加载失败，请刷新页面重试',
    saveFailed: '保存失败，请重试',
    deleteFailed: '删除失败，请重试',
    copyFailed: '复制失败',
    copySuccess: '复制成功'
  },

  // 验证消息
  validation: {
    required: '此字段为必填项',
    invalidEmail: '邮箱格式不正确',
    invalidPassword: '密码长度至少为6位',
    passwordMismatch: '两次输入的密码不一致',
    invalidUsername: '用户名格式不正确'
  }
};
