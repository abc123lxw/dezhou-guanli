import { sendOrderDoneSubscribe } from './wechatApi.js';
import { getOrderItems } from './orderService.js';

export async function notifyOrderDone(db, orderId) {
  const order = db.prepare('SELECT o.*, u.openid FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?')
    .get(orderId);
  if (!order?.openid) return { sent: false, reason: '无 openid' };

  const items = getOrderItems(db, orderId);
  const summary = items.map((i) => `${i.name}×${i.qty}`).join('、').slice(0, 20);

  try {
    return await sendOrderDoneSubscribe({
      openid: order.openid,
      pickupNo: order.pickup_no,
      itemSummary: summary || '酒水',
    });
  } catch (e) {
    console.error('[subscribe]', e.message);
    return { sent: false, reason: e.message };
  }
}
