const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 模拟商户配置
const MERCHANT_CONFIG = {
  '114514': {
    pid: '114514',
    key: 'C4D038B4BED09FDB1471EF51EC3A32CD',
    name: '测试商户'
  }
};

// 存储支付订单
const paymentOrders = new Map();

// MD5签名函数
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// 生成签名 - 与EpayProvider保持一致
function generateSign(params, key) {
  // 按参数名ASCII码从小到大排序
  const sortedKeys = Object.keys(params).sort();
  const signStr = sortedKeys
    .map(k => `${k}=${params[k]}`)
    .join('&') + key;

  console.log('签名字符串:', signStr);
  return md5(signStr);
}

// 验证签名
function verifySign(params, key) {
  const receivedSign = params.sign;
  // 验证时需要排除sign和sign_type参数
  const paramsWithoutSign = { ...params };
  delete paramsWithoutSign.sign;
  delete paramsWithoutSign.sign_type;  // 也要排除sign_type
  const calculatedSign = generateSignForVerify(paramsWithoutSign, key);
  console.log('接收到的签名:', receivedSign);
  console.log('计算的签名:', calculatedSign);
  return receivedSign === calculatedSign;
}

// 用于验证的签名生成（排除sign参数）
function generateSignForVerify(params, key) {
  const sortedKeys = Object.keys(params).sort();
  const signStr = sortedKeys
    .map(k => `${k}=${params[k]}`)
    .join('&') + key;

  console.log('验证签名字符串:', signStr);
  return md5(signStr);
}

// 易支付提交接口 - 处理支付请求
app.all('/submit.php', (req, res) => {
  console.log('收到支付请求:', req.method, req.query, req.body);

  const params = { ...req.query, ...req.body };
  const { pid, type, out_trade_no, notify_url, return_url, name, money, sitename, sign } = params;

  // 验证商户
  if (!MERCHANT_CONFIG[pid]) {
    return res.status(400).send('商户不存在');
  }

  const merchant = MERCHANT_CONFIG[pid];

  // 验证签名
  if (!verifySign(params, merchant.key)) {
    console.log('❌ 签名验证失败');
    return res.status(400).send('签名验证失败');
  }

  console.log('✅ 签名验证成功，继续处理支付请求...');

  // 生成支付订单
  const order = {
    trade_no: `EP${Date.now()}${Math.random().toString(36).substr(2, 4)}`, // 易支付订单号
    out_trade_no,
    pid,
    type,
    money: parseFloat(money),
    name,
    notify_url,
    return_url,
    sitename: sitename || '测试商户',
    status: 0, // 0=待支付 1=已支付
    created_at: new Date().toISOString()
  };

  paymentOrders.set(order.trade_no, order);
  console.log('创建支付订单:', order);

  // 重定向到支付页面
  res.redirect(`/pay.html?trade_no=${order.trade_no}`);
});

// 支付页面数据接口
app.get('/api/order/:trade_no', (req, res) => {
  const { trade_no } = req.params;
  const order = paymentOrders.get(trade_no);

  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  res.json({
    success: true,
    data: order
  });
});

// 模拟支付完成接口
app.post('/api/pay/:trade_no', (req, res) => {
  const { trade_no } = req.params;
  const order = paymentOrders.get(trade_no);

  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  if (order.status === 1) {
    return res.json({ success: false, message: '订单已支付' });
  }

  // 更新订单状态
  order.status = 1;
  order.paid_at = new Date().toISOString();
  paymentOrders.set(trade_no, order);

  console.log('订单支付完成:', order);

  // 发送支付成功通知
  sendPaymentNotification(order);

  res.json({
    success: true,
    message: '支付成功',
    return_url: order.return_url
  });
});

// 发送支付通知
async function sendPaymentNotification(order) {
  if (!order.notify_url) {
    console.log('无通知地址，跳过通知');
    return;
  }

  const notifyParams = {
    pid: order.pid,
    trade_no: order.trade_no,
    out_trade_no: order.out_trade_no,
    type: order.type,
    name: order.name,
    money: order.money.toString(),
    trade_status: 'TRADE_SUCCESS'
  };

  // 生成通知签名
  const merchant = MERCHANT_CONFIG[order.pid];
  notifyParams.sign = generateSign(notifyParams, merchant.key);

  console.log('发送支付通知:', order.notify_url, notifyParams);

  try {
    // 使用fetch发送通知（Node.js 18+）
    const response = await fetch(order.notify_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(notifyParams)
    });

    const result = await response.text();
    console.log('通知响应:', response.status, result);
  } catch (error) {
    console.error('发送通知失败:', error);

    // 尝试GET方式通知
    try {
      const queryString = new URLSearchParams(notifyParams).toString();
      const getUrl = `${order.notify_url}?${queryString}`;
      console.log('尝试GET通知:', getUrl);

      const getResponse = await fetch(getUrl, { method: 'GET' });
      const getResult = await getResponse.text();
      console.log('GET通知响应:', getResponse.status, getResult);
    } catch (getError) {
      console.error('GET通知也失败:', getError);
    }
  }
}

// 查询订单状态接口
app.get('/api/query', (req, res) => {
  const { pid, trade_no, out_trade_no, sign } = req.query;

  // 验证商户
  if (!MERCHANT_CONFIG[pid]) {
    return res.status(400).json({ error: '商户不存在' });
  }

  // 查找订单
  let order = null;
  if (trade_no) {
    order = paymentOrders.get(trade_no);
  } else if (out_trade_no) {
    for (const [key, value] of paymentOrders.entries()) {
      if (value.out_trade_no === out_trade_no && value.pid === pid) {
        order = value;
        break;
      }
    }
  }

  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  res.json({
    success: true,
    data: {
      trade_no: order.trade_no,
      out_trade_no: order.out_trade_no,
      money: order.money,
      status: order.status,
      trade_status: order.status === 1 ? 'TRADE_SUCCESS' : 'WAIT_BUYER_PAY'
    }
  });
});

// 健康检查接口
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'mock-epay-server',
    version: '1.0.0'
  });
});

// 创建公共目录和支付页面
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 模拟易支付服务器启动成功!`);
  console.log(`📱 访问地址: http://localhost:${PORT}`);
  console.log(`💰 支付接口: http://localhost:${PORT}/submit.php`);
  console.log(`📋 商户配置:`);
  Object.values(MERCHANT_CONFIG).forEach(merchant => {
    console.log(`   - PID: ${merchant.pid}, KEY: ${merchant.key}`);
  });
  console.log(`\n🔧 在 wrangler.toml 中配置:`);
  console.log(`EPAY_API_URL="http://localhost:${PORT}/"`);
});