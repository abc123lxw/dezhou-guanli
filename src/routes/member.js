import { Router } from 'express';
import { nanoid } from 'nanoid';
import { authMiddleware, formatUser } from '../middleware/auth.js';
import { GAME_RULES_SUMMARY, isWeekend } from '../lib/gameRules.js';
import { chinaTodayStr } from '../lib/chinaTime.js';

const RECHARGE_PACKAGES = [
  { id: 'r100', amount: 10000, bonusPoints: 800, label: '充100元 · 赠800积分', tag: '入门' },
  { id: 'r300', amount: 30000, bonusPoints: 3000, label: '充300元 · 赠3000积分', tag: '热门' },
  { id: 'r500', amount: 50000, bonusPoints: 5500, label: '充500元 · 赠5500积分', tag: '超值' },
  { id: 'r1000', amount: 100000, bonusPoints: 12000, label: '充1000元 · 赠12000积分', tag: '尊享' },
];

const POINT_RULES = {
  summary: '买酒送积分，按套餐/商品赠送，非1元1积分',
  highlights: [
    { title: '78元酒券套餐', desc: '任选一杯调酒 + 赠送3000积分' },
    { title: '经典调酒', desc: '单杯约赠1500-1800积分' },
    { title: '储值活动', desc: '充值赠送额外积分，档位越高送越多' },
  ],
  rechargePackages: RECHARGE_PACKAGES.map((p) => ({
    amountYuan: p.amount / 100,
    bonusPoints: p.bonusPoints,
    label: p.label,
  })),
  notice: '积分仅可兑换店内酒水小吃，不可提现、不可转让，与牌局输赢无关',
  weekendEntry: '周末赛唯一入场：¥78酒券套餐 = 1杯特调 + 3000比赛记分，不可带入存分',
};

const COMMUNITY = {
  title: '加入德阳德州酒吧社群',
  desc: '第一时间获取活动、友谊赛、积分福利',
  qrcodeTip: '长按识别二维码加入微信群',
  qrcodeUrl: '',
};

export function memberRoutes(db) {
  const router = Router();
  router.use(authMiddleware(db));

  router.get('/profile', (req, res) => {
    res.json({ user: formatUser(db, req.user) });
  });

  router.get('/point-rules', (_req, res) => {
    res.json(POINT_RULES);
  });

  router.get('/game-rules', (_req, res) => {
    res.json({ ...GAME_RULES_SUMMARY, isWeekend: isWeekend() });
  });

  router.get('/community', (_req, res) => {
    res.json(COMMUNITY);
  });

  router.get('/recharge-packages', (_req, res) => {
    res.json({ packages: RECHARGE_PACKAGES });
  });

  router.post('/recharge', (req, res) => {
    const { packageId } = req.body;
    const pkg = RECHARGE_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) return res.status(400).json({ error: '套餐不存在' });

    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET balance_cents = balance_cents + ?, points = points + ? WHERE id = ?')
        .run(pkg.amount, pkg.bonusPoints, req.user.id);
      db.prepare(`
        INSERT INTO recharge_logs (id, user_id, amount_cents, bonus_points)
        VALUES (?, ?, ?, ?)
      `).run(nanoid(10), req.user.id, pkg.amount, pkg.bonusPoints);
      if (pkg.bonusPoints > 0) {
        db.prepare(`
          INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type, ref_id)
          VALUES (?, ?, ?, ?, 'recharge', ?)
        `).run(nanoid(10), req.user.id, pkg.bonusPoints, `储值${pkg.amount / 100}元赠送积分`, pkg.id);
      }
    });
    tx();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({
      message: `储值成功 +¥${pkg.amount / 100}，赠${pkg.bonusPoints}积分`,
      user: formatUser(db, user),
    });
  });

  router.post('/daily-sign', (req, res) => {
    const today = chinaTodayStr();
    const signed = db.prepare(`
      SELECT id FROM point_logs
      WHERE user_id = ? AND reason = '每日签到'
        AND date(created_at) = date(?)
    `).get(req.user.id, `${today} 12:00:00`);

    if (signed) return res.status(409).json({ error: '今日已签到' });

    const bonus = 50;
    const logId = nanoid(10);
    db.transaction(() => {
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(bonus, req.user.id);
      db.prepare(`
        INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type)
        VALUES (?, ?, ?, '每日签到', 'sign')
      `).run(logId, req.user.id, bonus);
    })();

    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
    res.json({ message: `签到成功 +${bonus} 积分`, points: user.points });
  });

  router.post('/points-to-stored', (req, res) => {
    const points = Number(req.body.points);
    if (!points || points < 100 || points % 100 !== 0) {
      return res.status(400).json({ error: '请输入100的整数倍积分（100积分=10存分）' });
    }

    const user = db.prepare('SELECT points, stored_score FROM users WHERE id = ?').get(req.user.id);
    if (user.points < points) return res.status(400).json({ error: '积分不足' });

    const storedGain = Math.floor(points / 10);
    db.transaction(() => {
      db.prepare('UPDATE users SET points = points - ?, stored_score = stored_score + ? WHERE id = ?')
        .run(points, storedGain, req.user.id);
      db.prepare(`
        INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type)
        VALUES (?, ?, ?, ?, 'convert')
      `).run(nanoid(10), req.user.id, -points, `积分转存分 ${storedGain}`);
    })();

    const updated = db.prepare('SELECT points, stored_score FROM users WHERE id = ?').get(req.user.id);
    res.json({
      message: `已转换 ${points} 积分为 ${storedGain} 存分`,
      points: updated.points,
      storedScore: updated.stored_score,
    });
  });

  router.get('/invite', (req, res) => {
    const user = formatUser(db, req.user);
    res.json({
      inviteCode: user.inviteCode,
      inviteCount: user.inviteCount,
      rewardPoints: 500,
      rule: '好友首次下单后，您获得500积分',
    });
  });

  router.get('/redemptions', (req, res) => {
    const list = db.prepare(`
      SELECT id, product_name, points_cost, pickup_code, status, created_at
      FROM redemptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(req.user.id);
    res.json({ redemptions: list });
  });

  return router;
}
