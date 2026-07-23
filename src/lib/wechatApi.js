/** 微信小程序服务端 API：登录、订阅消息 */

let tokenCache = { token: '', expiresAt: 0 };

export function isWxConfigured() {
  return !!(process.env.WECHAT_APPID && process.env.WECHAT_SECRET);
}

export async function code2Session(code) {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  if (!appid || !secret) throw new Error('未配置 WECHAT_APPID / WECHAT_SECRET');

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(data.errmsg || '微信登录失败');
  return { openid: data.openid, sessionKey: data.session_key, unionid: data.unionid };
}

export async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  if (!appid || !secret) throw new Error('未配置微信 AppID');

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);

  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(data.errmsg || '获取 access_token 失败');

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };
  return tokenCache.token;
}

/** 发送订阅消息（订单制作完成） */
export async function sendOrderDoneSubscribe({ openid, pickupNo, itemSummary }) {
  const templateId = process.env.WX_SUBSCRIBE_TEMPLATE_ORDER_DONE;
  if (!templateId || !openid) return { sent: false, reason: '未配置模板或未登录' };

  const token = await getAccessToken();
  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: openid,
      template_id: templateId,
      page: 'pages/orders/orders',
      miniprogram_state: 'formal',
      lang: 'zh_CN',
      data: {
        character_string1: { value: String(pickupNo || '----').slice(0, 32) },
        thing2: { value: String(itemSummary || '您的酒水').slice(0, 20) },
        phrase3: { value: '已完成，请取餐' },
      },
    }),
  });
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    return { sent: false, reason: data.errmsg, errcode: data.errcode };
  }
  return { sent: true };
}
