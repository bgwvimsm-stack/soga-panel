export default {
  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    add: 'Add',
    refresh: 'Refresh',
    search: 'Search',
    reset: 'Reset',
    submit: 'Submit',
    loading: 'Loading...',
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Information',
    copy: 'Copy',
    download: 'Download',
    upload: 'Upload',
    back: 'Back',
    next: 'Next',
    prev: 'Previous',
    finish: 'Finish',
    close: 'Close'
  },

  // Navigation Menu
  menu: {
    dashboard: 'Dashboard',
    nodes: 'Nodes',
    traffic: 'Traffic',
    subscription: 'Subscription',
    profile: 'Profile',
    admin: 'Admin',
    adminDashboard: 'Admin Panel',
    userManagement: 'User Management',
    logout: 'Logout'
  },

  // Authentication
  auth: {
    login: 'Login',
    register: 'Register',
    username: 'Username',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    rememberMe: 'Remember Me',
    forgotPassword: 'Forgot Password?',
    loginSuccess: 'Login Successful',
    loginFailed: 'Login Failed',
    registerSuccess: 'Registration Successful',
    registerFailed: 'Registration Failed',
    logoutSuccess: 'Logout Successful',
    pleaseLogin: 'Please Login',
    invalidCredentials: 'Invalid Username or Password',
    accountLocked: 'Account Locked',
    sessionExpired: 'Session Expired, Please Login Again',
    createAccount: 'Create Account',
    verificationCode: 'Verification Code',
    verificationCodePlaceholder: 'Enter the email verification code',
    sendVerificationCode: 'Send Code',
    secondsAbbr: '{seconds}s',
    codeSent: 'Verification code sent. Please check your inbox.',
    codeSendFailed: 'Failed to send verification code. Please try again later.',
    inputEmailFirst: 'Please enter your email address first'
  },

  // Dashboard
  dashboard: {
    welcome: 'Welcome Back',
    userLevel: 'User Level',
    usedTraffic: 'Used Traffic',
    availableNodes: 'Available Nodes',
    accountStatus: 'Account Status',
    trafficUsage: 'Traffic Usage',
    accountInfo: 'Account Information',
    todayUsage: 'Today\'s Usage',
    registrationDate: 'Registration Date',
    expirationDate: 'Expiration Date',
    levelExpiry: 'Level Expiry'
  },

  // Nodes
  nodes: {
    title: 'Node List',
    description: 'View all nodes you have access to',
    totalNodes: 'Total Nodes',
    onlineNodes: 'Online Nodes',
    offlineNodes: 'Offline Nodes',
    myLevel: 'My Level',
    nodeName: 'Node Name',
    nodeType: 'Type',
    location: 'Location',
    status: 'Status',
    traffic: 'Traffic',
    load: 'Load',
    actions: 'Actions',
    details: 'Details',
    test: 'Test',
    online: 'Online',
    offline: 'Offline',
    normal: 'Normal',
    disabled: 'Disabled',
    nodeDetails: 'Node Details',
    nodeConfig: 'Node Configuration',
    serverAddress: 'Server Address',
    port: 'Port',
    nodeLevel: 'Node Level',
    createdAt: 'Created At',
    testingConnection: 'Testing node connection...',
    connectionNormal: 'Connection Normal',
    connectionTimeout: 'Connection Timeout',
    allRegions: 'All Regions',
    allStatus: 'All Status',
    searchPlaceholder: 'Search node name'
  },

  // Traffic
  traffic: {
    title: 'Traffic Statistics',
    description: 'View your traffic usage details',
    overview: 'Traffic Overview',
    totalUsed: 'Total Used',
    totalQuota: 'Total Quota',
    dailyAverage: 'Daily Average',
    remainingQuota: 'Remaining Quota',
    usageChart: 'Usage Trend',
    usageTable: 'Usage Records',
    date: 'Date',
    upload: 'Upload',
    download: 'Download',
    total: 'Total',
    days7: '7 Days',
    days30: '30 Days',
    days90: '90 Days',
    noData: 'No Data'
  },

  // Subscription
  subscription: {
    title: 'Subscription Management',
    description: 'Manage your client subscription links',
    subscriptionLinks: 'Subscription Links',
    clientType: 'Client Type',
    subscriptionUrl: 'Subscription URL',
    qrCode: 'QR Code',
    copyLink: 'Copy Link',
    refreshToken: 'Refresh Token',
    usageGuide: 'Usage Guide',
    tokenRefreshed: 'Token Refreshed',
    linkCopied: 'Link Copied',
    v2rayGuide: 'V2Ray Client Guide: Copy the subscription link and add subscription in your client',
    clashGuide: 'Clash Client Guide: Copy the configuration link and import config file in Clash',
    quantumultGuide: 'Quantumult X Guide: Scan QR code or copy link to add to node list'
  },

  // Profile
  profile: {
    title: 'Profile',
    description: 'Manage your account information',
    basicInfo: 'Basic Information',
    securitySettings: 'Security Settings',
    changePassword: 'Change Password',
    currentPassword: 'Current Password',
    newPassword: 'New Password',
    confirmNewPassword: 'Confirm New Password',
    updateProfile: 'Update Profile',
    updateSuccess: 'Update Successful',
    updateFailed: 'Update Failed',
    passwordChanged: 'Password Changed Successfully',
    passwordMismatch: 'Passwords do not match'
  },

  // Admin
  admin: {
    dashboard: {
      title: 'Admin Panel',
      totalUsers: 'Total Users',
      activeUsers: 'Active Users',
      totalNodes: 'Total Nodes',
      totalTraffic: 'Total Traffic',
      userGrowth: 'User Growth',
      trafficTrend: 'Traffic Trend'
    },
    users: {
      title: 'User Management',
      description: 'Manage all users in the system',
      addUser: 'Add User',
      editUser: 'Edit User',
      deleteUser: 'Delete User',
      userId: 'User ID',
      username: 'Username',
      email: 'Email',
      level: 'Level',
      status: 'Status',
      registrationDate: 'Registration Date',
      lastLogin: 'Last Login',
      actions: 'Actions',
      active: 'Active',
      inactive: 'Inactive',
      banned: 'Banned',
      deleteConfirm: 'Are you sure you want to delete this user?',
      userDeleted: 'User Deleted',
      userUpdated: 'User Information Updated',
      userCreated: 'User Created Successfully'
    }
  },

  // Error Messages
  errors: {
    networkError: 'Network connection failed, please check your network',
    timeoutError: 'Request timeout, please try again later',
    serverError: 'Server internal error, please try again later',
    notFound: 'The requested resource does not exist',
    forbidden: 'Insufficient permissions to access this resource',
    unauthorized: 'Authentication failed, please login again',
    unknownError: 'Unknown error',
    loadFailed: 'Load failed, please refresh the page',
    saveFailed: 'Save failed, please try again',
    deleteFailed: 'Delete failed, please try again',
    copyFailed: 'Copy failed',
    copySuccess: 'Copy successful'
  },

  // Validation Messages
  validation: {
    required: 'This field is required',
    invalidEmail: 'Invalid email format',
    invalidPassword: 'Password must be at least 6 characters',
    passwordMismatch: 'Passwords do not match',
    invalidUsername: 'Invalid username format'
  }
};
