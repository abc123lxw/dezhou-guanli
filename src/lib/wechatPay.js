import crypto from 'crypto';

/** 微信支付 JSAPI（需配置商户号；未配置时由 pay 路由走开发模拟） */
export function isWxPayReady() {
  return !!(
    process.env.WECHAT_APPID
    && process.env.WECHAT_MCH_ID
    && process.env.WECHAT_MCH_KEY
  );
}

function nonceStr(len = 32) {
  return crypto.randomBytes(len).toString('hex').slice(0, len);
}

function signMd5(params, mchKey) {
  const keys = Object.keys(params).filter((k) => params[k] !== '' && params[k] != null).sort();
  const str = `${keys.map((k) => `${k}=${params[k]}`).join('&')}&key=${mchKey}`;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function toXml(obj) {
  return `<xml>${Object.entries(obj).map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`).join('')}</xml>`;
}

function fromXml(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g)) out[m[1]] = m[2];
  for (const m of xml.matchAll(/<(\w+)>([^<]+)<\/\1>/g)) {
    if (!out[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

/** 统一下单，返回小程序 wx.requestPayment 参数 */
export async function createJsapiPayment(order, openid) {
  const appid = process.env.WECHAT_APPID;
  const mchId = process.env.WECHAT_MCH_ID;
  const mchKey = process.env.WECHAT_MCH_KEY;
  const notifyUrl = process.env.WECHAT_PAY_NOTIFY_URL || '';

  if (!appid || !mchId || !mchKey) {
    throw new Error('微信支付未配置：请设置 WECHAT_APPID / WECHAT_MCH_ID / WECHAT_MCH_KEY');
  }
  if (!openid) throw new Error('用户 openid 缺失，请用真实微信登录');

  const params = {
    appid,
    mch_id: mchId,
    nonce_str: nonceStr(),
    body: '德阳德州酒吧',
    out_trade_no: order.id,
    total_fee: String(order.total_cents),
    spbill_create_ip: '127.0.0.1',
    notify_url: notifyUrl,
    trade_type: 'JSAPI',
    openid,
  };
  params.sign = signMd5(params, mchKey);

  const res = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: toXml(params),
  });
  const text = await res.text();
  const data = fromXml(text);

  if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
    throw new Error(data.err_code_des || data.return_msg || '微信下单失败');
  }

  const pkg = `prepay_id=${data.prepay_id}`;
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const payNonce = nonceStr(16);
  const paySign = signMd5({
    appId: appid,
    timeStamp,
    nonceStr: payNonce,
    package: pkg,
    signType: 'MD5',
  }, mchKey);

  return {
    timeStamp,
    nonceStr: payNonce,
    package: pkg,
    signType: 'MD5',
    paySign,
    prepayId: data.prepay_id,
  };
}

export function verifyPayNotify(xml, mchKey) {
  const data = fromXml(xml);
  const sign = data.sign;
  delete data.sign;
  const expected = signMd5(data, mchKey);
  if (sign !== expected) throw new Error('签名验证失败');
  return data;
}

export function okNotifyXml() {
  return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>';
}
