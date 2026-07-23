import { Router } from 'express';
import { nanoid } from 'nanoid';
import { authMiddleware } from '../middleware/auth.js';
import { isWeekend, validateWeekendOrder, WEEKEND_ENTRY_PRODUCT_NAME } from '../lib/gameRules.js';
import { logOperation } from '../lib/operationLog.js';
import { fulfillOrder, formatOrderForAdmin } from '../lib/orderService.js';
import { broadcastAdmin } from '../lib/adminBroadcast.js';
import { cacheDel } from '../lib/memoryCache.js';
import { formatChinaDateTime } from '../lib/chinaTime.js';

export function orderRoutes(db) {
  const router = Router();

  router.get('/weekend-status', (_req, res) => {
    res.json({ isWeekend: isWeekend(), entryProduct: WEEKEND_ENTRY_PRODUCT_NAME });
  });

  router.use(authMiddleware(db));

  router.post('/', (req, res) => {
    const { items, tableId, payWithBalance, tournamentEntry, note } = req.body;
    if (!items?.length) return res.status(400).json({ error: '订单为空' });

    const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND enabled = 1');
    let totalCents = 0;
    const lineItems = [];

    for (const item of items) {
      const product = getProduct.get(item.productId);
      if (!product) return res.status(400).json({ error: `商品不存在: ${item.productId}` });
      const qty = Math.max(1, Number(item.qty) || 1);
      totalCents += product.price_cents * qty;
      lineItems.push({ product, qty });
    }

    if (totalCents <= 0) return res.status(400).json({ error: '订单金额异常，请通过小程序正常下单' });

    let pointsEarned = 0;
    for (const { product, qty } of lineItems) {
      pointsEarned += (product.points_reward || 0) * qty;
    }

    if (isWeekend()) {
      const weekendErr = validateWeekendOrder(lineItems, { tournamentEntry: !!tournamentEntry });
      if (weekendErr) return res.status(400).json({ error: weekendErr });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (payWithBalance && user.balance_cents < totalCents) {
      return res.status(400).json({ error: '余额不足' });
    }

    const orderId = nanoid(12);
    const pickupNo = String(Math.floor(1000 + Math.random() * 9000));

    const createTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (
          id, user_id, table_id, total_cents, points_earned, status,
          pickup_no, payment_method, note
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, ?)
      `).run(orderId, req.user.id, tableId || null, totalCents, pointsEarned, pickupNo, String(note || '').slice(0, 200));

      const insertItem = db.prepare(`
        INSERT INTO order_items (id, order_id, product_id, qty, price_cents)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const { product, qty } of lineItems) {
        insertItem.run(nanoid(10), orderId, product.id, qty, product.price_cents);
      }

      if (payWithBalance) {
        db.prepare('UPDATE users SET balance_cents = balance_cents - ? WHERE id = ?')
          .run(totalCents, req.user.id);
      }
    });

    createTx();

    if (payWithBalance) {
      fulfillOrder(db, orderId, {
        paymentMethod: 'balance',
        wxTransactionId: `BAL${Date.now()}`,
      });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const updated = db.prepare('SELECT points, growth_value, balance_cents FROM users WHERE id = ?')
      .get(req.user.id);

    cacheDel(`points:mall:${req.user.id}`);

    const formatted = formatOrderForAdmin(db, order);
    broadcastAdmin(order.status === 'paid' ? 'order_paid' : 'order_new', { order: formatted });
    broadcastAdmin('stats_refresh', {});

    res.json({
      orderId,
      pickupNo: order.pickup_no,
      totalCents,
      pointsEarned,
      status: order.status,
      needPay: order.status === 'pending',
      pointsBalance: updated.points,
      tableId: tableId || null,
      message: order.status === 'paid' ? '储值支付成功' : '订单已创建，请完成支付',
    });
  });

  router.get('/mine', (req, res) => {
    const orders = db.prepare(`
      SELECT id, table_id, total_cents, points_earned, status, pickup_no,
             payment_method, created_at, paid_at, making_at, done_at, note
      FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
    `).all(req.user.id);
    res.json({
      orders,
      serverTime: formatChinaDateTime(new Date().toISOString()),
      timezone: 'Asia/Shanghai',
    });
  });

  router.get('/:orderId', (req, res) => {
    const order = db.prepare(`
      SELECT id, status, pickup_no, total_cents, points_earned, payment_method, paid_at, created_at
      FROM orders WHERE id = ? AND user_id = ?
    `).get(req.params.orderId, req.user.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    res.json({ order });
  });

  return router;
}
