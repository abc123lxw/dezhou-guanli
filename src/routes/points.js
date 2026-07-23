import { Router } from 'express';
import { nanoid } from 'nanoid';
import { authMiddleware } from '../middleware/auth.js';
import { cacheGet, cacheSet, cacheDel } from '../lib/memoryCache.js';

function genPickupCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function pointRoutes(db) {
  const router = Router();
  router.use(authMiddleware(db));

  router.get('/balance', (req, res) => {
    const user = db.prepare('SELECT points, growth_value FROM users WHERE id = ?').get(req.user.id);
    res.json({ points: user.points, growthValue: user.growth_value });
  });

  router.get('/logs', (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const logs = db.prepare(`
      SELECT change_amount, reason, created_at
      FROM point_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(req.user.id, limit);
    res.json({ logs });
  });

  /** 积分商城一页数据（合并请求，减少往返） */
  router.get('/mall', (req, res) => {
    const cacheKey = `points:mall:${req.user.id}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const user = db.prepare('SELECT points, growth_value FROM users WHERE id = ?').get(req.user.id);
    const products = db.prepare(`
      SELECT id, name, category, price_cents, points_reward, points_redeem_cost, image_url, description
      FROM products WHERE enabled = 1 AND points_redeem_cost IS NOT NULL
      ORDER BY points_redeem_cost, name
    `).all();
    const redemptions = db.prepare(`
      SELECT id, product_name, points_cost, pickup_code, status, created_at
      FROM redemptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(req.user.id);

    const payload = {
      points: user.points,
      growthValue: user.growth_value,
      products,
      redemptions,
    };
    cacheSet(cacheKey, payload, 15_000);
    res.json(payload);
  });

  router.post('/redeem', (req, res) => {
    const { productId } = req.body;
    const product = db.prepare(`
      SELECT * FROM products WHERE id = ? AND enabled = 1 AND points_redeem_cost IS NOT NULL
    `).get(productId);

    if (!product) return res.status(400).json({ error: '商品不可兑换' });

    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
    if (user.points < product.points_redeem_cost) {
      return res.status(400).json({ error: '积分不足' });
    }

    const pickupCode = genPickupCode();
    const redeemId = nanoid(12);

    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET points = points - ? WHERE id = ?')
        .run(product.points_redeem_cost, req.user.id);
      db.prepare(`
        INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type, ref_id)
        VALUES (?, ?, ?, ?, 'redeem', ?)
      `).run(
        nanoid(10),
        req.user.id,
        -product.points_redeem_cost,
        `兑换 ${product.name}`,
        redeemId,
      );
      db.prepare(`
        INSERT INTO redemptions (id, user_id, product_id, product_name, points_cost, pickup_code)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(redeemId, req.user.id, productId, product.name, product.points_redeem_cost, pickupCode);
    });

    tx();

    cacheDel(`points:mall:${req.user.id}`);

    const updated = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
    const depositCategories = ['经典', '特调', '德州主题', '啤酒', '无酒精'];
    const depositTip = depositCategories.includes(product.category) ? '，酒水已登记寄店' : '';
    res.json({
      pointsBalance: updated.points,
      pickupCode,
      productName: product.name,
      canDeposit: depositCategories.includes(product.category),
      message: `兑换成功，核销码 ${pickupCode}${depositTip}，请到吧台出示`,
    });
  });

  return router;
}
