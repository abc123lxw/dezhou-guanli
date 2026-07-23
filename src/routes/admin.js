import { Router } from 'express';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { verifyPassword } from '../lib/password.js';
import { formatUser } from '../middleware/auth.js';
import { formatOrderForAdmin, getOrderItems } from '../lib/orderService.js';
import { logOperation } from '../lib/operationLog.js';
import { broadcastAdmin, onAdminEvent } from '../lib/adminBroadcast.js';
import { WEEKEND_ENTRY_PRODUCT_NAME } from '../lib/gameRules.js';
import { mountAdminExtended } from './adminExtended.js';
import { notifyOrderDone } from '../lib/subscribeNotify.js';
import { getEventStats, modeForDate, todayDateStr } from '../lib/tournamentService.js';
import { chinaTodayStr, formatChinaClock, formatChinaDateTime } from '../lib/chinaTime.js';
import { buildFloorStatus } from '../lib/floorService.js';

function todayLabel() {
  return chinaTodayStr();
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dateRange(dateStr) {
  let label = dateStr;
  if (!label || !isValidDate(label)) label = todayLabel();
  return resolveRange(label, label);
}

function resolveRange(fromStr, toStr) {
  let from = fromStr;
  let to = toStr;
  if (!from || !isValidDate(from)) from = todayLabel();
  if (!to || !isValidDate(to)) to = from;
  if (from > to) [from, to] = [to, from];

  const today = todayLabel();
  const msPerDay = 86400000;
  const days = Math.floor((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / msPerDay) + 1;
  if (days > 366) {
    throw new Error('查询区间不能超过 366 天');
  }

  const isRange = from !== to;
  const dateLabel = isRange ? `${from} ~ ${to}` : from;

  return {
    start: `${from} 00:00:00`,
    end: `${to} 23:59:59`,
    dateFrom: from,
    dateTo: to,
    dateLabel,
    isRange,
    isToday: from === today && to === today,
    days,
  };
}

function resolveStatsRange(query) {
  const { from, to, date } = query;
  if (from || to) return resolveRange(from, to);
  return dateRange(date);
}

function todayRange() {
  return dateRange();
}

function buildStats(db, range) {
  const { start, end, dateLabel, dateFrom, dateTo, isRange, isToday, days } = range;
  const paidOrders = db.prepare(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(total_cents), 0) AS revenue
    FROM orders
    WHERE status IN ('paid','making','done')
      AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
  `).get(start, end);

  const byMethod = db.prepare(`
    SELECT payment_method, COUNT(*) AS cnt, COALESCE(SUM(total_cents), 0) AS revenue
    FROM orders
    WHERE status IN ('paid','making','done')
      AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
    GROUP BY payment_method
  `).all(start, end);

  const pendingPay = db.prepare(`
    SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'
      AND datetime(created_at) >= datetime(?)
      AND datetime(created_at) <= datetime(?)
  `).get(start, end).c;

  const queuePaid = db.prepare(`
    SELECT COUNT(*) AS c FROM orders WHERE status = 'paid'
      AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
  `).get(start, end).c;

  const queueMaking = db.prepare(`
    SELECT COUNT(*) AS c FROM orders WHERE status = 'making'
      AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
  `).get(start, end).c;

  const weekendEntry = db.prepare(`
    SELECT COALESCE(SUM(oi.qty), 0) AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE p.name = ?
      AND o.status IN ('paid','making','done')
      AND datetime(COALESCE(o.paid_at, o.created_at)) >= datetime(?)
      AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?)
  `).get(WEEKEND_ENTRY_PRODUCT_NAME, start, end);

  const topProducts = db.prepare(`
    SELECT p.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price_cents) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.status IN ('paid','making','done')
      AND datetime(COALESCE(o.paid_at, o.created_at)) >= datetime(?)
      AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?)
    GROUP BY p.name ORDER BY qty DESC LIMIT 8
  `).all(start, end);

  const hourly = !isRange ? db.prepare(`
    SELECT strftime('%H', COALESCE(paid_at, created_at)) AS hour,
           COUNT(*) AS cnt,
           COALESCE(SUM(total_cents), 0) AS revenue
    FROM orders
    WHERE status IN ('paid','making','done')
      AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
    GROUP BY hour ORDER BY hour
  `).all(start, end) : [];

  const customerRow = db.prepare(`
    SELECT
      COUNT(*) AS totalCustomers,
      COALESCE(SUM(CASE WHEN order_cnt >= 2 THEN 1 ELSE 0 END), 0) AS repeatCustomers
    FROM (
      SELECT user_id, COUNT(*) AS order_cnt
      FROM orders
      WHERE status IN ('paid','making','done')
        AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
        AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
      GROUP BY user_id
    )
  `).get(start, end);

  const peakHour = !isRange && hourly.length
    ? hourly.reduce((best, h) => (h.cnt > best.cnt ? h : best), hourly[0])
    : null;

  const daily = isRange ? db.prepare(`
    SELECT date(COALESCE(paid_at, created_at)) AS day,
           COUNT(*) AS cnt,
           COALESCE(SUM(total_cents), 0) AS revenue
    FROM orders
    WHERE status IN ('paid','making','done')
      AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
      AND datetime(COALESCE(paid_at, created_at)) <= datetime(?)
    GROUP BY day ORDER BY day
  `).all(start, end) : [];

  const byTable = db.prepare(`
    SELECT COALESCE(pt.name, '未指定桌') AS table_name,
           COUNT(*) AS cnt,
           COALESCE(SUM(o.total_cents), 0) AS revenue
    FROM orders o
    LEFT JOIN poker_tables pt ON pt.id = o.table_id
    WHERE o.status IN ('paid','making','done')
      AND datetime(COALESCE(o.paid_at, o.created_at)) >= datetime(?)
      AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?)
    GROUP BY o.table_id ORDER BY revenue DESC LIMIT 8
  `).all(start, end);

  const recentOrders = db.prepare(`
    SELECT o.pickup_no, o.total_cents, o.payment_method, o.status,
           o.created_at, o.paid_at, u.nickname, u.phone
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('paid','making','done')
      AND datetime(COALESCE(o.paid_at, o.created_at)) >= datetime(?)
      AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?)
    ORDER BY datetime(COALESCE(o.paid_at, o.created_at)) DESC
    LIMIT 30
  `).all(start, end);

  return {
    date: dateLabel,
    dateFrom,
    dateTo,
    isRange,
    isToday,
    days,
    orderCount: paidOrders.cnt,
    revenueCents: paidOrders.revenue,
    revenueYuan: (paidOrders.revenue / 100).toFixed(2),
    avgOrderYuan: paidOrders.cnt
      ? (paidOrders.revenue / paidOrders.cnt / 100).toFixed(2)
      : '0.00',
    pendingPay,
    kitchenQueue: queuePaid + queueMaking,
    queuePaid,
    queueMaking,
    weekendEntryCount: weekendEntry.qty,
    byMethod: byMethod.map((m) => ({
      method: m.payment_method || 'unknown',
      label: methodLabel(m.payment_method),
      count: m.cnt,
      revenueYuan: (m.revenue / 100).toFixed(2),
    })),
    topProducts: topProducts.map((p) => ({
      name: p.name,
      qty: p.qty,
      revenueYuan: (p.revenue / 100).toFixed(0),
    })),
    hourly: hourly.map((h) => ({
      hour: h.hour,
      count: h.cnt,
      revenueYuan: (h.revenue / 100).toFixed(0),
    })),
    daily: daily.map((d) => ({
      date: d.day,
      count: d.cnt,
      revenueYuan: (d.revenue / 100).toFixed(0),
    })),
    totalCustomers: customerRow.totalCustomers || 0,
    repeatCustomers: customerRow.repeatCustomers || 0,
    repeatRatePct: customerRow.totalCustomers
      ? Math.round((customerRow.repeatCustomers / customerRow.totalCustomers) * 100)
      : 0,
    peakHour: peakHour ? `${peakHour.hour}:00` : null,
    peakHourOrders: peakHour?.cnt || 0,
    byTable: byTable.map((t) => ({
      name: t.table_name,
      count: t.cnt,
      revenueYuan: (t.revenue / 100).toFixed(0),
    })),
    recentOrders: recentOrders.map((o) => ({
      pickupNo: o.pickup_no,
      totalYuan: (o.total_cents / 100).toFixed(2),
      paymentMethod: o.payment_method,
      paymentLabel: methodLabel(o.payment_method),
      status: o.status,
      nickname: o.nickname || '散客',
      phone: o.phone || '',
      paidAt: o.paid_at || o.created_at,
      createdAt: o.created_at,
    })),
  };
}

function sseAuth(db, req) {
  const header = req.headers.authorization;
  const token = req.query.token || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return null;
  return db.prepare('SELECT id, username, display_name, role FROM admin_users WHERE id = ? AND enabled = 1')
    .get(token);
}

export function adminRoutes(db) {
  const router = Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请输入账号密码' });

    const admin = db.prepare('SELECT * FROM admin_users WHERE username = ? AND enabled = 1')
      .get(username.trim());
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    db.prepare('UPDATE admin_users SET last_login_at = datetime(\'now\') WHERE id = ?').run(admin.id);
    logOperation(db, {
      adminId: admin.id,
      action: 'admin_login',
      detail: JSON.stringify({ username: admin.username }),
      ip: req.ip,
    });

    res.json({
      token: admin.id,
      admin: {
        username: admin.username,
        displayName: admin.display_name,
        role: admin.role,
      },
    });
  });

  /** SSE 实时事件流 */
  router.get('/events', (req, res) => {
    const admin = sseAuth(db, req);
    if (!admin) return res.status(401).json({ error: '未登录' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: 'connected', at: new Date().toISOString() });
    const off = onAdminEvent(send);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      off();
    });
  });

  /** 经营概览（支持 ?date=YYYY-MM-DD） */
  router.get('/stats', adminAuthMiddleware(db), (req, res) => {
    try {
      const range = resolveStatsRange(req.query);
      res.json(buildStats(db, range));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/stats/today', adminAuthMiddleware(db), (_req, res) => {
    res.json(buildStats(db, todayRange()));
  });

  /** 实时订单看板 */
  router.get('/orders/live', adminAuthMiddleware(db), (req, res) => {
    const status = req.query.status || 'active';
    const { start } = todayRange();

    let statusFilter = `o.status IN ('pending','paid','making')`;
    if (status === 'pending') statusFilter = `o.status = 'pending'`;
    else if (status === 'paid') statusFilter = `o.status = 'paid'`;
    else if (status === 'making') statusFilter = `o.status = 'making'`;
    else if (status === 'done') statusFilter = `o.status = 'done'`;
    else if (status === 'all_today') {
      statusFilter = `o.status IN ('pending','paid','making','done')`;
    }

    const rows = db.prepare(`
      SELECT o.* FROM orders o
      WHERE ${statusFilter}
        AND datetime(o.created_at) >= datetime(?)
      ORDER BY
        CASE o.status
          WHEN 'pending' THEN 1
          WHEN 'paid' THEN 2
          WHEN 'making' THEN 3
          WHEN 'done' THEN 4
          ELSE 5
        END,
        COALESCE(o.paid_at, o.created_at) ASC
      LIMIT 80
    `).all(start);

    res.json({
      orders: rows.map((o) => formatOrderForAdmin(db, o)),
      serverTime: formatChinaDateTime(new Date().toISOString()),
      timezone: 'Asia/Shanghai',
    });
  });

  /** 订单历史（支持 ?date=YYYY-MM-DD） */
  router.get('/orders/history', adminAuthMiddleware(db), (req, res) => {
    const { start, end, dateLabel } = resolveStatsRange(req.query);
    const limit = Math.min(Number(req.query.limit) || 80, 200);
    const rows = db.prepare(`
      SELECT o.* FROM orders o
      WHERE datetime(o.created_at) >= datetime(?)
        AND datetime(o.created_at) <= datetime(?)
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(start, end, limit);

    res.json({
      date: dateLabel,
      orders: rows.map((o) => formatOrderForAdmin(db, o)),
    });
  });

  /** 订单详情（吧台查账 / 客诉） */
  router.get('/orders/:id', adminAuthMiddleware(db), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    const formatted = formatOrderForAdmin(db, order);
    const rawItems = getOrderItems(db, order.id);
    const paymentLogs = db.prepare(`
      SELECT id, channel, created_at FROM payment_logs WHERE order_id = ? ORDER BY created_at
    `).all(order.id);

    let operatorName = '';
    if (order.operator_id) {
      const op = db.prepare('SELECT display_name, username FROM admin_users WHERE id = ?').get(order.operator_id);
      operatorName = op?.display_name || op?.username || '';
    }

    res.json({
      order: {
        ...formatted,
        openid: user?.openid || '',
        phone: user?.phone || '未绑定',
        inviteCode: user?.invite_code || '',
        wxTransactionId: order.wx_transaction_id || '',
        operatorName,
        itemsDetail: rawItems.map((i) => ({
          name: i.name,
          qty: i.qty,
          category: i.category,
          unitYuan: (i.price_cents / 100).toFixed(2),
          lineYuan: (i.price_cents * i.qty / 100).toFixed(2),
        })),
      },
      paymentLogs: paymentLogs.map((p) => ({
        channel: p.channel,
        at: p.created_at,
      })),
    });
  });

  /** 出酒汇总：待制作+制作中的酒水数量（调酒师看） */
  router.get('/kitchen/summary', adminAuthMiddleware(db), (_req, res) => {
    const { start, end } = todayRange();
    const rows = db.prepare(`
      SELECT p.name, p.category, SUM(oi.qty) AS qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.status IN ('paid', 'making')
        AND datetime(COALESCE(o.paid_at, o.created_at)) >= datetime(?)
        AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?)
      GROUP BY p.name, p.category
      ORDER BY qty DESC, p.name
    `).all(start, end);

    const items = rows.map((r) => ({
      name: r.name,
      category: r.category,
      qty: r.qty,
      isWeekendEntry: r.name === WEEKEND_ENTRY_PRODUCT_NAME,
    }));
    const byCategory = {};
    for (const item of items) {
      const cat = item.category || '其他';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    }

    res.json({
      items,
      byCategory,
      totalDrinks: rows.reduce((s, r) => s + r.qty, 0),
    });
  });

  function memberStoredWine(db, userId) {
    const pending = db.prepare(`
      SELECT product_name, pickup_code, created_at
      FROM redemptions WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `).all(userId);
    return { count: pending.length, items: pending };
  }

  /** 手机号 / 尾号查会员（吧台主入口） */
  router.get('/members/lookup', adminAuthMiddleware(db), (req, res) => {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    const tail = String(req.query.tail || '').replace(/\D/g, '');

    if (!phone && !tail) return res.status(400).json({ error: '请输入手机号或尾号' });

    let user;
    let candidates = [];

    if (phone.length >= 4) {
      user = db.prepare(`
        SELECT * FROM users WHERE REPLACE(phone, ' ', '') LIKE ?
        ORDER BY CASE WHEN REPLACE(phone, ' ', '') = ? THEN 0 ELSE 1 END, LENGTH(phone) ASC
        LIMIT 1
      `).get(`%${phone}%`, phone);
    } else if (tail.length >= 4) {
      candidates = db.prepare(`
        SELECT * FROM users WHERE REPLACE(phone, ' ', '') LIKE ?
        ORDER BY created_at DESC LIMIT 10
      `).all(`%${tail}`);
      if (candidates.length === 1) user = candidates[0];
      else if (candidates.length > 1) {
        return res.json({
          multiple: true,
          members: candidates.map((u) => {
            const wine = memberStoredWine(db, u.id);
            return {
              id: u.id,
              nickname: u.nickname,
              phone: maskPhone(u.phone),
              points: u.points,
              storedWineCount: wine.count,
              levelName: formatUser(db, u).levelName,
            };
          }),
        });
      }
    } else {
      return res.status(400).json({ error: '手机号至少4位，尾号需4位' });
    }

    if (!user) return res.status(404).json({ error: '未找到匹配会员' });

    const wine = memberStoredWine(db, user.id);
    res.json({
      user: formatUser(db, user),
      storedWineCount: wine.count,
      storedWine: wine.items,
    });
  });

  /** 会员搜索（昵称 / 手机 / 邀请码） */
  router.get('/members/search', adminAuthMiddleware(db), (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ members: [] });

    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const rows = db.prepare(`
      SELECT id, nickname, phone, points, balance_cents, growth_value, stored_score, created_at
      FROM users
      WHERE nickname LIKE ? OR phone LIKE ? OR invite_code LIKE ?
      ORDER BY CASE WHEN phone LIKE ? THEN 0 WHEN phone LIKE ? THEN 1 ELSE 2 END, points DESC
      LIMIT 20
    `).all(like, like, like.toUpperCase(), q, digits ? `%${digits}%` : like);

    res.json({
      members: rows.map((u) => {
        const wine = memberStoredWine(db, u.id);
        return {
          id: u.id,
          nickname: u.nickname,
          phone: maskPhone(u.phone),
          points: u.points,
          balanceYuan: (u.balance_cents / 100).toFixed(2),
          storedScore: u.stored_score || 0,
          storedWineCount: wine.count,
          growthValue: u.growth_value,
          levelName: formatUser(db, u).levelName,
        };
      }),
    });
  });

  mountAdminExtended(router, db, { adminAuthMiddleware });

  /** 会员详情（与小程序「我的」一致） */
  router.get('/members/:id', adminAuthMiddleware(db), (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '会员不存在' });

    const pointLogs = db.prepare(`
      SELECT change_amount, reason, created_at
      FROM point_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 15
    `).all(user.id);

    const redemptions = db.prepare(`
      SELECT product_name, points_cost, pickup_code, status, created_at
      FROM redemptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(user.id);

    const orders = db.prepare(`
      SELECT id, status, total_cents, points_earned, pickup_no, payment_method, created_at, paid_at
      FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(user.id);

    const wine = memberStoredWine(db, user.id);

    res.json({
      user: formatUser(db, user),
      storedWineCount: wine.count,
      storedWine: wine.items,
      pointLogs,
      redemptions,
      orders: orders.map((o) => ({
        id: o.id,
        pickupNo: o.pickup_no,
        status: o.status,
        totalYuan: (o.total_cents / 100).toFixed(o.total_cents % 100 ? 2 : 0),
        pointsEarned: o.points_earned,
        paymentMethod: o.payment_method,
        createdAt: o.created_at,
        paidAt: o.paid_at,
      })),
    });
  });

  /** 待核销兑换列表 */
  router.get('/redeem/pending', adminAuthMiddleware(db), (_req, res) => {
    const rows = db.prepare(`
      SELECT r.id, r.product_name, r.points_cost, r.pickup_code, r.created_at,
             u.nickname, u.phone
      FROM redemptions r
      JOIN users u ON u.id = r.user_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 30
    `).all();

    res.json({
      redemptions: rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        pointsCost: r.points_cost,
        pickupCode: r.pickup_code,
        nickname: r.nickname,
        phone: maskPhone(r.phone),
        createdAt: r.created_at,
      })),
    });
  });

  /** 桌位实况：德州桌座位 + 吧台桌在店订单 */
  router.get('/floor/status', adminAuthMiddleware(db), (req, res) => {
    const { date, slot } = req.query;
    res.json(buildFloorStatus(db, { date, slotStart: slot }));
  });

  /** 今日预约 */
  router.get('/reservations/today', adminAuthMiddleware(db), (_req, res) => {
    const { dateLabel } = todayRange();
    const rows = db.prepare(`
      SELECT r.id, r.start_time, r.end_time, r.people_count, r.status, r.note,
             t.name AS table_name, u.nickname
      FROM reservations r
      JOIN poker_tables t ON t.id = r.table_id
      JOIN users u ON u.id = r.user_id
      WHERE r.reserve_date = ? AND r.status != 'cancelled'
      ORDER BY r.start_time
    `).all(dateLabel);

    res.json({ date: dateLabel, reservations: rows });
  });

  router.patch('/orders/:id/status', adminAuthMiddleware(db), async (req, res) => {
    const { status } = req.body;
    const allowed = ['making', 'done', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: '无效状态' });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: '订单不存在' });

    if (status === 'making' && order.status !== 'paid') {
      return res.status(400).json({ error: '仅「已支付待制作」订单可开始制作' });
    }
    if (status === 'done' && !['paid', 'making'].includes(order.status)) {
      return res.status(400).json({ error: '订单状态不可完成' });
    }
    if (status === 'cancelled' && order.status !== 'pending') {
      return res.status(400).json({ error: '仅未支付订单可取消' });
    }

    if (status === 'making') {
      db.prepare('UPDATE orders SET status = ?, making_at = datetime(\'now\'), operator_id = ? WHERE id = ?')
        .run(status, req.admin.id, req.params.id);
    } else if (status === 'done') {
      db.prepare(`
        UPDATE orders SET status = ?, done_at = datetime('now'), operator_id = ? WHERE id = ?
      `).run(status, req.admin.id, req.params.id);
    } else {
      db.prepare('UPDATE orders SET status = ?, operator_id = ? WHERE id = ?')
        .run(status, req.admin.id, req.params.id);
    }

    logOperation(db, {
      adminId: req.admin.id,
      action: 'admin_order_status',
      detail: JSON.stringify({
        orderId: req.params.id,
        from: order.status,
        to: status,
        admin: req.admin.username,
      }),
      ip: req.ip,
    });

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const formatted = formatOrderForAdmin(db, updated);
    broadcastAdmin('order_updated', { order: formatted });
    broadcastAdmin('stats_refresh', {});

    let subscribeResult = null;
    if (status === 'done') {
      subscribeResult = await notifyOrderDone(db, req.params.id);
    }

    res.json({ order: formatted, message: statusText(status), subscribeResult });
  });

  /** 今日赛事报名 */
  router.get('/tournament/today', adminAuthMiddleware(db), (_req, res) => {
    const eventDate = todayDateStr();
    const mode = modeForDate(eventDate);
    const stats = getEventStats(db, eventDate, mode);
    const rows = db.prepare(`
      SELECT r.*, u.nickname, u.phone
      FROM tournament_registrations r
      JOIN users u ON u.id = r.user_id
      WHERE r.event_date = ? AND r.mode = ? AND r.status != 'cancelled'
      ORDER BY r.created_at
    `).all(eventDate, mode);

    res.json({
      ...stats,
      registrations: rows.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        phone: maskPhone(r.phone),
        status: r.status,
        orderId: r.order_id,
        checkedInAt: r.checked_in_at,
        createdAt: r.created_at,
      })),
    });
  });

  router.patch('/tournament/:id/checkin', adminAuthMiddleware(db), (req, res) => {
    const reg = db.prepare('SELECT * FROM tournament_registrations WHERE id = ?').get(req.params.id);
    if (!reg) return res.status(404).json({ error: '报名记录不存在' });

    db.prepare(`
      UPDATE tournament_registrations
      SET status = 'checked_in', checked_in_at = datetime('now')
      WHERE id = ?
    `).run(reg.id);

    res.json({ message: '已签到', id: reg.id });
  });

  /** 核销积分兑换 */
  router.post('/redeem/verify', adminAuthMiddleware(db), (req, res) => {
    const { pickupCode } = req.body;
    if (!pickupCode) return res.status(400).json({ error: '请输入核销码' });

    const row = db.prepare(`
      SELECT * FROM redemptions WHERE pickup_code = ? AND status = 'pending'
    `).get(String(pickupCode).trim());

    if (!row) return res.status(404).json({ error: '核销码无效或已使用' });

    db.prepare(`
      UPDATE redemptions SET status = 'completed', verified_at = datetime('now'), operator_id = ?
      WHERE id = ?
    `).run(req.admin.id, row.id);
    logOperation(db, {
      userId: row.user_id,
      adminId: req.admin.id,
      action: 'admin_redeem_verify',
      detail: JSON.stringify({ pickupCode, product: row.product_name, admin: req.admin.username }),
      ip: req.ip,
    });

    res.json({
      message: `已核销：${row.product_name}`,
      productName: row.product_name,
      pointsCost: row.points_cost,
    });
  });

  /** 客显大屏（取餐叫号，无需登录） */
  router.get('/display/public', (_req, res) => {
    const { start, dateLabel } = todayRange();

    const stats = db.prepare(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(total_cents), 0) AS revenue
      FROM orders WHERE status IN ('paid','making','done')
        AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
    `).get(start);

    const making = db.prepare(`
      SELECT o.* FROM orders o
      WHERE o.status IN ('paid','making')
        AND datetime(COALESCE(o.paid_at, o.created_at)) >= datetime(?)
      ORDER BY COALESCE(o.paid_at, o.created_at) ASC
      LIMIT 12
    `).all(start);

    const recentDone = db.prepare(`
      SELECT o.* FROM orders o
      WHERE o.status = 'done'
        AND datetime(COALESCE(o.done_at, o.paid_at, o.created_at)) >= datetime(?)
      ORDER BY COALESCE(o.done_at, o.paid_at) DESC
      LIMIT 5
    `).all(start);

    const callNo = recentDone[0]
      ? formatOrderForAdmin(db, recentDone[0]).pickupNo
      : null;

    res.json({
      date: dateLabel,
      orderCount: stats.cnt,
      revenueYuan: (stats.revenue / 100).toFixed(0),
      brand: '德阳德州酒吧',
      tip: '所有消费请通过小程序下单',
      currentCall: callNo,
      queue: making.map((o) => {
        const f = formatOrderForAdmin(db, o);
        return {
          pickupNo: f.pickupNo,
          status: f.status,
          items: f.items.map((i) => `${i.name}×${i.qty}`).join('、'),
          elapsedSeconds: f.elapsedSeconds,
          urgency: f.urgency,
        };
      }),
      recentReady: recentDone.map((o) => {
        const f = formatOrderForAdmin(db, o);
        return { pickupNo: f.pickupNo, doneAt: f.doneAt };
      }),
    });
  });

  return router;
}

function methodLabel(method) {
  const map = {
    wxpay: '微信支付',
    wxpay_dev: '微信支付(开发)',
    balance: '储值余额',
    groupon: '团购核销',
    cash_manual: '现金补录',
  };
  return map[method] || method || '未知';
}

function statusText(status) {
  const map = {
    making: '已开始制作',
    done: '订单已完成',
    cancelled: '订单已取消',
  };
  return map[status] || '状态已更新';
}

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s || '未绑定';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}
