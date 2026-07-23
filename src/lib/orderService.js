import { nanoid } from 'nanoid';
import { cacheDel } from './memoryCache.js';
import { rewardInviterOnFirstOrder } from '../middleware/auth.js';
import { logOperation } from './operationLog.js';
import { WEEKEND_ENTRY_PRODUCT_NAME } from './gameRules.js';
import { linkWeekendEntryOrder } from './tournamentService.js';
import {
  buildOrderTimeline,
  buildTimeSummary,
  formatDateTime,
  formatDateTimeShort,
  formatTime,
  formatWaitDuration,
} from './datetimeFormat.js';
import { parseDbTime } from './chinaTime.js';

export function getOrderItems(db, orderId) {
  return db.prepare(`
    SELECT oi.qty, oi.price_cents, p.name, p.category, p.id AS product_id
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(orderId);
}

export function fulfillOrder(db, orderId, { paymentMethod, wxTransactionId = '', operatorId = null } = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('订单不存在');
  if (order.status !== 'pending') throw new Error('订单状态不可支付');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
  const growthEarned = Math.floor(order.total_cents / 100);
  const orderCount = db.prepare(`
    SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status IN ('paid','making','done')
  `).get(order.user_id).c;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE orders SET
        status = 'paid',
        payment_method = ?,
        wx_transaction_id = ?,
        paid_at = datetime('now'),
        operator_id = ?
      WHERE id = ?
    `).run(paymentMethod, wxTransactionId || null, operatorId, orderId);

    db.prepare(`
      UPDATE users SET points = points + ?, growth_value = growth_value + ? WHERE id = ?
    `).run(order.points_earned, growthEarned, order.user_id);

    if (order.points_earned > 0) {
      db.prepare(`
        INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type, ref_id)
        VALUES (?, ?, ?, '买酒消费获赠积分', 'order', ?)
      `).run(nanoid(10), order.user_id, order.points_earned, orderId);
    }

    if (orderCount === 0) rewardInviterOnFirstOrder(db, order.user_id);
  });

  tx();

  cacheDel(`points:mall:${order.user_id}`);

  const items = getOrderItems(db, orderId);
  const hasWeekendEntry = items.some((i) => i.name === WEEKEND_ENTRY_PRODUCT_NAME);
  if (hasWeekendEntry) {
    const qty = items.filter((i) => i.name === WEEKEND_ENTRY_PRODUCT_NAME)
      .reduce((s, i) => s + i.qty, 0);
    logOperation(db, {
      userId: order.user_id,
      action: 'weekend_entry_paid',
      detail: JSON.stringify({ orderId, qty, tableId: order.table_id }),
      ip: '',
    });
    linkWeekendEntryOrder(db, orderId);
  }

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function parseTime(iso) {
  const d = parseDbTime(iso);
  return d ? d.getTime() : null;
}

function elapsedSeconds(fromIso) {
  const t = parseTime(fromIso);
  if (!t) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

const STATUS_LABELS = {
  pending: '待支付',
  paid: '待制作',
  making: '制作中',
  done: '已完成',
  cancelled: '已取消',
};

function maskOpenid(openid) {
  const s = String(openid || '');
  if (s.length <= 10) return s || '—';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function formatOrderForAdmin(db, order) {
  const user = db.prepare('SELECT id, openid, nickname, phone, invite_code FROM users WHERE id = ?').get(order.user_id);
  const items = getOrderItems(db, order.id);
  const table = order.table_id
    ? db.prepare('SELECT name FROM poker_tables WHERE id = ?').get(order.table_id)
    : null;

  const weekendQty = items
    .filter((i) => i.name === WEEKEND_ENTRY_PRODUCT_NAME)
    .reduce((s, i) => s + i.qty, 0);

  const timerFrom = order.status === 'making'
    ? (order.making_at || order.paid_at || order.created_at)
    : order.status === 'paid'
      ? (order.paid_at || order.created_at)
      : order.created_at;

  return {
    id: order.id,
    pickupNo: order.pickup_no,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status] || order.status,
    paymentMethod: order.payment_method,
    wxTransactionId: order.wx_transaction_id || '',
    internalOrderId: order.id,
    userId: user?.id || order.user_id,
    openidMasked: maskOpenid(user?.openid),
    inviteCode: user?.invite_code || '',
    phoneFull: user?.phone || '',
    totalCents: order.total_cents,
    totalYuan: (order.total_cents / 100).toFixed(order.total_cents % 100 ? 2 : 0),
    pointsEarned: order.points_earned,
    tableId: order.table_id,
    tableName: table?.name ? `送至 ${table.name}` : '外场派送',
    nickname: user?.nickname || '酒友',
    phone: user?.phone ? maskPhone(user.phone) : '',
    items: items.map((i) => ({
      name: i.name,
      qty: i.qty,
      category: i.category,
      isWeekendEntry: i.name === WEEKEND_ENTRY_PRODUCT_NAME,
    })),
    isWeekendEntry: weekendQty > 0,
    weekendQty,
    note: order.note || '',
    createdAt: order.created_at,
    paidAt: order.paid_at,
    makingAt: order.making_at,
    doneAt: order.done_at,
    createdAtLabel: formatDateTime(order.created_at),
    createdAtShort: formatDateTimeShort(order.created_at),
    paidAtLabel: formatDateTime(order.paid_at),
    paidAtShort: formatDateTimeShort(order.paid_at),
    makingAtLabel: formatDateTime(order.making_at),
    doneAtLabel: formatDateTime(order.done_at),
    orderTimeLabel: formatTime(order.created_at),
    timeSummary: buildTimeSummary(order),
    timeline: buildOrderTimeline(order),
    currentStep: {
      pending: 'created',
      paid: 'paid',
      making: 'making',
      done: 'done',
      cancelled: 'created',
    }[order.status] || 'created',
    waitLabel: ['paid', 'making'].includes(order.status)
      ? formatWaitDuration(elapsedSeconds(timerFrom))
      : '',
    elapsedSeconds: elapsedSeconds(timerFrom),
    urgency: urgencyLevel(elapsedSeconds(timerFrom), order.status),
  };
}

function maskPhone(phone) {
  const s = String(phone);
  if (s.length < 7) return s;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function urgencyLevel(seconds, status) {
  if (!['paid', 'making'].includes(status)) return 'normal';
  if (seconds >= 480) return 'critical';
  if (seconds >= 300) return 'warning';
  if (seconds >= 120) return 'attention';
  return 'fresh';
}
