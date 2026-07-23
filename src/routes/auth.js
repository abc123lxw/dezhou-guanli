import { Router } from 'express';
import { formatUser, loginOrRegister } from '../middleware/auth.js';
import { code2Session, isWxConfigured } from '../lib/wechatApi.js';

export function authRoutes(db, { devMode }) {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { code, nickname, avatar, inviteCode } = req.body;

    if (!code) return res.status(400).json({ error: '缺少微信 code' });

    if (devMode && !isWxConfigured()) {
      const openid = code.startsWith('dev_') ? code : `dev_${code}`;
      const user = loginOrRegister(db, { openid, nickname, avatar, inviteCode });
      return res.json({ token: user.id, user: formatUser(db, user) });
    }

    if (!isWxConfigured()) {
      return res.status(501).json({ error: '请配置 WECHAT_APPID 和 WECHAT_SECRET' });
    }

    try {
      const { openid } = await code2Session(code);
      const user = loginOrRegister(db, { openid, nickname, avatar, inviteCode });
      res.json({ token: user.id, user: formatUser(db, user) });
    } catch (e) {
      console.error('[auth]', e.message);
      res.status(401).json({ error: e.message || '微信登录失败' });
    }
  });

  return router;
}
