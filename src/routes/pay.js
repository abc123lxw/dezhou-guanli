import { Router } from 'express';
import { nanoid } from 'nanoid';
import { authMiddleware } from '../middleware/auth.js';
import { fulfillOrder, formatOrderForAdmin } from '../lib/orderService.js';
import { broadcastAdmin } from '../lib/adminBroadcast.js';
import {
  isWxPayReady,
  createJsapiPayment,
  verifyPayNotify,
  okNotifyXml,
} from '../lib/wechatPay.js';

export function createPayNotifyHandler(db) {
  return (req, res) => {
    try {
      const mchKey = process.env.WECHAT_MCH_KEY;
      if (!mchKey) return res.type('text/xml').send(okNotifyXml());

      const data = verifyPayNotify(req.body, mchKey);
      if (data.result_code !== 'SUCCESS') return res.type('text/xml').send(okNotifyXml());

      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(data.out_trade_no);
      if (!order || order.status !== 'pending') return res.type('text/xml').send(okNotifyXml());

      const updated = fulfillOrder(db, order.id, {
        paymentMethod: 'wxpay',
        wxTransactionId: data.transaction_id,
      });
      db.prepare(`
        INSERT INTO payment_logs (id, order_id, channel, raw_payload, created_at)
        VALUES (?, ?, 'wxpay', ?, datetime('now'))
      `).run(nanoid(12), order.id, req.body);

      broadcastAdmin('order_paid', { order: formatOrderForAdmin(db, updated) });
      broadcastAdmin('stats_refresh', {});
      res.type('text/xml').send(okNotifyXml());
    } catch (e) {
      console.error('pay notify error', e);
      res.type('text/xml').send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>');
    }
  };
}

export function payRoutes(db, { devMode }) {
  const router = Router();
  router.use(authMiddleware(db));

  router.post('/submit', async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: '缺少订单号' });

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
      .get(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status !== 'pending') {
      return res.json({
        paid: order.status !== 'pending',
        orderId,
        status: order.status,
        pickupNo: order.pickup_no,
        message: '订单已支付',
      });
    }

    if (devMode && !isWxPayReady()) {
      const wxTxn = `DEV${Date.now()}`;
      const updated = fulfillOrder(db, orderId, {
        paymentMethod: 'wxpay_dev',
        wxTransactionId: wxTxn,
      });
      db.prepare(`
        INSERT INTO payment_logs (id, order_id, channel, raw_payload, created_at)
        VALUES (?, ?, 'dev', ?, datetime('now'))
      `).run(nanoid(12), orderId, JSON.stringify({ mode: 'dev', txn: wxTxn }));

      const formatted = formatOrderForAdmin(db, updated);
      broadcastAdmin('order_paid', { order: formatted });
      broadcastAdmin('stats_refresh', {});

      return res.json({
        paid: true,
        devMode: true,
        orderId,
        pickupNo: updated.pickup_no,
        totalCents: updated.total_cents,
        pointsEarned: updated.points_earned,
        message: '支付成功（开发模式）',
      });
    }

    if (!isWxPayReady()) {
      return res.status(501).json({
        error: '微信支付尚未配置，请在服务器 .env 设置 WECHAT_MCH_ID / WECHAT_MCH_KEY / WECHAT_PAY_NOTIFY_URL',
        orderId,
        needWxPay: true,
      });
    }

    try {
      const user = db.prepare('SELECT openid FROM users WHERE id = ?').get(req.user.id);
      const payment = await createJsapiPayment(order, user.openid);
      db.prepare(`
        INSERT INTO payment_logs (id, order_id, channel, raw_payload, created_at)
        VALUES (?, ?, 'wxpay_prepay', ?, datetime('now'))
      `).run(nanoid(12), orderId, JSON.stringify({ prepayId: payment.prepayId }));

      return res.json({
        paid: false,
        needWxPay: true,
        orderId,
        pickupNo: order.pickup_no,
        payment: {
          timeStamp: payment.timeStamp,
          nonceStr: payment.nonceStr,
          package: payment.package,
          signType: payment.signType,
          paySign: payment.paySign,
        },
        message: '请完成微信支付',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || '微信支付发起失败' });
    }
  });

  router.get('/status/:orderId', (req, res) => {
    const order = db.prepare(`
      SELECT id, status, pickup_no, total_cents, points_earned, payment_method, paid_at
      FROM orders WHERE id = ? AND user_id = ?
    `).get(req.params.orderId, req.user.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    res.json({ order });
  });

  return router;
}
