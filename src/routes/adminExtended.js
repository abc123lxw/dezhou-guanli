import { nanoid } from 'nanoid';
import { formatUser } from '../middleware/auth.js';
import { requireAdminRole } from '../middleware/adminRole.js';
import { formatOrderForAdmin } from '../lib/orderService.js';
import { logOperation } from '../lib/operationLog.js';
import { broadcastAdmin } from '../lib/adminBroadcast.js';
import { cacheDel } from '../lib/memoryCache.js';
import { isWeekend } from '../lib/gameRules.js';

function resolveStatsRange(from, to, date) {
  if (from || to) {
    let f = from;
    let t = to || from;
    if (f > t) [f, t] = [t, f];
    return { start: `${f} 00:00:00`, end: `${t} 23:59:59`, dateFrom: f, dateTo: t };
  }
  const d = date || new Date().toISOString().slice(0, 10);
  return { start: `${d} 00:00:00`, end: `${d} 23:59:59`, dateFrom: d, dateTo: d };
}

export function mountAdminExtended(router, db, { adminAuthMiddleware }) {
  const ownerOnly = [adminAuthMiddleware(db), requireAdminRole('owner')];
  const anyStaff = [adminAuthMiddleware(db)];

  /** 会员码扫码（邀请码或用户ID） */
  router.get('/members/scan/:code', ...anyStaff, (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    let user = db.prepare('SELECT * FROM users WHERE invite_code = ?').get(code);
    if (!user) user = db.prepare('SELECT * FROM users WHERE id = ?').get(code);
    if (!user) return res.status(404).json({ error: '会员码无效' });
    res.json({ user: formatUser(db, user) });
  });

  /** 商品列表（含下架/估清） */
  router.get('/products', ...anyStaff, (_req, res) => {
    const products = db.prepare(`
      SELECT id, name, category, price_cents, points_reward, points_redeem_cost, enabled, sold_out, sort_order
      FROM products ORDER BY category, sort_order, name
    `).all();
    res.json({
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        priceYuan: (p.price_cents / 100).toFixed(p.price_cents % 100 ? 2 : 0),
        pointsReward: p.points_reward,
        pointsRedeemCost: p.points_redeem_cost,
        enabled: !!p.enabled,
        soldOut: !!p.sold_out,
      })),
    });
  });

  router.patch('/products/:id', ...anyStaff, (req, res) => {
    const { enabled, soldOut, pointsRedeemCost } = req.body;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: '商品不存在' });

    if (enabled !== undefined && req.admin.role !== 'owner') {
      return res.status(403).json({ error: '上下架需老板账号' });
    }

    const nextEnabled = enabled !== undefined ? (enabled ? 1 : 0) : product.enabled;
    const nextSoldOut = soldOut !== undefined ? (soldOut ? 1 : 0) : product.sold_out;
    let nextRedeem = product.points_redeem_cost;
    if (pointsRedeemCost !== undefined) {
      if (req.admin.role !== 'owner') {
        return res.status(403).json({ error: '积分兑换价需老板账号' });
      }
      nextRedeem = pointsRedeemCost === null || pointsRedeemCost === ''
        ? null
        : Math.max(0, Math.round(Number(pointsRedeemCost)));
    }

    db.prepare('UPDATE products SET enabled = ?, sold_out = ?, points_redeem_cost = ? WHERE id = ?')
      .run(nextEnabled, nextSoldOut, nextRedeem, req.params.id);
    cacheDel('products:all');

    logOperation(db, {
      userId: null,
      adminId: req.admin.id,
      action: 'admin_product_update',
      detail: JSON.stringify({
        productId: req.params.id,
        enabled: nextEnabled,
        soldOut: nextSoldOut,
        pointsRedeemCost: nextRedeem,
        admin: req.admin.username,
      }),
      ip: req.ip,
    });

    res.json({ message: '商品已更新' });
  });

  /** 导出订单 CSV */
  router.get('/export/orders', ...ownerOnly, (req, res) => {
    const { start, end, dateFrom, dateTo } = resolveStatsRange(req.query.from, req.query.to, req.query.date);
    const rows = db.prepare(`
      SELECT o.id, o.pickup_no, o.status, o.total_cents, o.payment_method,
             o.wx_transaction_id, o.paid_at, o.created_at, o.note,
             u.nickname, u.phone
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE datetime(o.created_at) >= datetime(?)
        AND datetime(o.created_at) <= datetime(?)
      ORDER BY o.created_at
    `).all(start, end);

    const header = '订单号,取餐号,状态,金额元,支付方式,微信交易号,昵称,手机,备注,创建时间,支付时间';
    const lines = rows.map((o) => [
      o.id,
      o.pickup_no || '',
      o.status,
      (o.total_cents / 100).toFixed(2),
      o.payment_method || '',
      o.wx_transaction_id || '',
      csvEsc(o.nickname),
      csvEsc(o.phone),
      csvEsc(o.note),
      o.created_at,
      o.paid_at || '',
    ].join(','));
    const csv = `\uFEFF${header}\n${lines.join('\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders_${dateFrom}_${dateTo}.csv"`);
    res.send(csv);
  });

  /** 团购核销录入 */
  router.post('/groupon/verify', ...ownerOnly, (req, res) => {
    const { platform, code, amountYuan, productName, userId } = req.body;
    if (!platform || !code) return res.status(400).json({ error: '请填写平台和券码' });

    const exists = db.prepare('SELECT id FROM groupon_logs WHERE code = ? AND platform = ?').get(String(code).trim(), platform);
    if (exists) return res.status(400).json({ error: '该团购券已核销过' });

    const amountCents = Math.round(Number(amountYuan || 0) * 100);
    if (amountCents <= 0) return res.status(400).json({ error: '请填写有效金额' });

    const uid = userId || db.prepare('SELECT id FROM users LIMIT 1').get()?.id;
    if (!uid) return res.status(400).json({ error: '无可用用户，请先有小程程序用户登录' });

    const orderId = nanoid(12);
    const pickupNo = String(Math.floor(1000 + Math.random() * 9000));
    const pname = productName || `${platform}团购`;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (id, user_id, total_cents, points_earned, status, pickup_no, payment_method, paid_at, note, operator_id)
        VALUES (?, ?, ?, 0, 'paid', ?, 'groupon', datetime('now'), ?, ?)
      `).run(orderId, uid, amountCents, pickupNo, `团购核销 ${platform} ${code}`, req.admin.id);

      db.prepare(`
        INSERT INTO groupon_logs (id, platform, code, amount_cents, product_name, order_id, operator_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(nanoid(10), platform, String(code).trim(), amountCents, pname, orderId, req.admin.id);
    })();

    logOperation(db, {
      adminId: req.admin.id,
      action: 'admin_groupon_verify',
      detail: JSON.stringify({ platform, code, amountCents, orderId, admin: req.admin.username }),
      ip: req.ip,
    });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    broadcastAdmin('order_paid', { order: formatOrderForAdmin(db, order) });
    broadcastAdmin('stats_refresh', {});

    res.json({ message: `团购已入账 ¥${(amountCents / 100).toFixed(2)}`, orderId, pickupNo });
  });

  /** 现金补录 */
  router.post('/orders/cash', ...ownerOnly, (req, res) => {
    const { amountYuan, productName, qty, userId, tableId, note } = req.body;
    const amountCents = Math.round(Number(amountYuan || 0) * 100);
    if (amountCents <= 0) return res.status(400).json({ error: '请填写有效金额' });

    const uid = userId || db.prepare('SELECT id FROM users ORDER BY created_at DESC LIMIT 1').get()?.id;
    if (!uid) return res.status(400).json({ error: '请先有小程序用户' });

    const orderId = nanoid(12);
    const pickupNo = String(Math.floor(1000 + Math.random() * 9000));
    const pname = productName || '现金消费';
    const itemQty = Math.max(1, Number(qty) || 1);

    let product = db.prepare('SELECT * FROM products WHERE name = ? LIMIT 1').get(pname);
    if (!product) {
      const pid = nanoid(8);
      db.prepare(`
        INSERT INTO products (id, name, category, price_cents, points_reward, enabled, sold_out)
        VALUES (?, ?, '现金补录', ?, 0, 0, 0)
      `).run(pid, pname, amountCents);
      product = { id: pid, price_cents: amountCents, points_reward: 0 };
    }

    const pointsEarned = (product.points_reward || 0) * itemQty;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (id, user_id, table_id, total_cents, points_earned, status, pickup_no, payment_method, paid_at, note, operator_id)
        VALUES (?, ?, ?, ?, ?, 'paid', ?, 'cash_manual', datetime('now'), ?, ?)
      `).run(orderId, uid, tableId || null, amountCents, pointsEarned, pickupNo, String(note || '现金补录'), req.admin.id);

      db.prepare(`
        INSERT INTO order_items (id, order_id, product_id, qty, price_cents)
        VALUES (?, ?, ?, ?, ?)
      `).run(nanoid(10), orderId, product.id, itemQty, amountCents);

      if (pointsEarned > 0) {
        db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsEarned, uid);
        db.prepare(`
          INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type, ref_id)
          VALUES (?, ?, ?, '现金补录赠积分', 'order', ?)
        `).run(nanoid(10), uid, pointsEarned, orderId);
      }
    })();

    logOperation(db, {
      userId: uid,
      adminId: req.admin.id,
      action: 'admin_cash_order',
      detail: JSON.stringify({ orderId, amountCents, admin: req.admin.username }),
      ip: req.ip,
    });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    broadcastAdmin('order_paid', { order: formatOrderForAdmin(db, order) });
    broadcastAdmin('stats_refresh', {});

    res.json({
      message: `现金补录成功 ¥${(amountCents / 100).toFixed(2)}`,
      orderId,
      pickupNo,
    });
  });

  /** 存分调整 */
  router.patch('/members/:id/stored-score', ...ownerOnly, (req, res) => {
    const { delta, reason } = req.body;
    const d = Number(delta);
    if (!d || Number.isNaN(d)) return res.status(400).json({ error: '请填写调整分值' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '会员不存在' });

    const next = Math.max(0, (user.stored_score || 0) + d);
    db.prepare('UPDATE users SET stored_score = ? WHERE id = ?').run(next, user.id);

    logOperation(db, {
      userId: user.id,
      adminId: req.admin.id,
      action: 'admin_stored_score',
      detail: JSON.stringify({ delta: d, next, reason: reason || '', admin: req.admin.username }),
      ip: req.ip,
    });

    res.json({
      message: `存分已更新为 ${next}`,
      storedScore: next,
      user: formatUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)),
    });
  });

  /** 原料库存列表 */
  router.get('/inventory', ...anyStaff, (_req, res) => {
    const rows = db.prepare(`
      SELECT * FROM inventory_items WHERE enabled = 1 ORDER BY name
    `).all();
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        stockQty: r.stock_qty,
        alertQty: r.alert_qty,
        lowStock: r.stock_qty <= r.alert_qty,
      })),
      alerts: rows.filter((r) => r.stock_qty <= r.alert_qty).map((r) => r.name),
    });
  });

  /** 新增原料 */
  router.post('/inventory', ...anyStaff, (req, res) => {
    const name = String(req.body.name || '').trim();
    const unit = String(req.body.unit || '份').trim() || '份';
    const stockQty = Number(req.body.stockQty);
    const alertQty = Number(req.body.alertQty ?? 10);

    if (!name) return res.status(400).json({ error: '原料名称不能为空' });
    if (Number.isNaN(stockQty) || stockQty < 0) return res.status(400).json({ error: '库存数量无效' });
    if (Number.isNaN(alertQty) || alertQty < 0) return res.status(400).json({ error: '预警值无效' });

    const exists = db.prepare('SELECT id FROM inventory_items WHERE name = ? AND enabled = 1').get(name);
    if (exists) return res.status(400).json({ error: '该原料已存在' });

    const id = nanoid(8);
    db.prepare(`
      INSERT INTO inventory_items (id, name, unit, stock_qty, alert_qty, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(id, name, unit, stockQty, alertQty);

    logOperation(db, {
      userId: null,
      adminId: req.admin.id,
      action: 'admin_inventory_create',
      detail: JSON.stringify({ id, name, unit, stockQty, alertQty, admin: req.admin.username }),
      ip: req.ip,
    });

    db.prepare(`
      INSERT INTO inventory_movements (id, item_id, delta_qty, stock_after, reason, ref_type, operator_id)
      VALUES (?, ?, ?, ?, ?, 'create', ?)
    `).run(nanoid(10), id, stockQty, stockQty, '新增原料', req.admin.id);

    res.json({ message: `已新增原料「${name}」`, id });
  });

  router.patch('/inventory/:id', ...anyStaff, (req, res) => {
    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: '原料不存在' });

    const { stockQty, alertQty } = req.body;
    const nextStock = stockQty !== undefined ? Number(stockQty) : item.stock_qty;
    const nextAlert = alertQty !== undefined ? Number(alertQty) : item.alert_qty;

    if (Number.isNaN(nextStock) || nextStock < 0) {
      return res.status(400).json({ error: '库存数量无效' });
    }

    const delta = nextStock - item.stock_qty;

    db.prepare(`
      UPDATE inventory_items
      SET stock_qty = ?, alert_qty = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nextStock, nextAlert, item.id);

    if (delta !== 0) {
      db.prepare(`
        INSERT INTO inventory_movements (id, item_id, delta_qty, stock_after, reason, ref_type, operator_id)
        VALUES (?, ?, ?, ?, ?, 'manual', ?)
      `).run(nanoid(10), item.id, delta, nextStock, '手动调整库存', req.admin.id);
    }

    logOperation(db, {
      userId: null,
      adminId: req.admin.id,
      action: 'admin_inventory_update',
      detail: JSON.stringify({ id: item.id, name: item.name, stockQty: nextStock, delta, admin: req.admin.username }),
      ip: req.ip,
    });

    res.json({ message: '库存已更新', stockQty: nextStock, alertQty: nextAlert });
  });

  /** 库存流水 */
  router.get('/inventory/movements', ...anyStaff, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const itemId = req.query.itemId;
    const rows = itemId
      ? db.prepare(`
          SELECT m.*, i.name AS item_name, i.unit
          FROM inventory_movements m
          JOIN inventory_items i ON i.id = m.item_id
          WHERE m.item_id = ?
          ORDER BY m.created_at DESC LIMIT ?
        `).all(itemId, limit)
      : db.prepare(`
          SELECT m.*, i.name AS item_name, i.unit
          FROM inventory_movements m
          JOIN inventory_items i ON i.id = m.item_id
          ORDER BY m.created_at DESC LIMIT ?
        `).all(limit);
    res.json({
      movements: rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        itemName: r.item_name,
        unit: r.unit,
        deltaQty: r.delta_qty,
        stockAfter: r.stock_after,
        reason: r.reason,
        refType: r.ref_type,
        createdAt: r.created_at,
      })),
    });
  });

  /** 采购入库 */
  router.get('/suppliers', ...anyStaff, (_req, res) => {
    const rows = db.prepare('SELECT * FROM suppliers WHERE enabled = 1 ORDER BY name').all();
    res.json({ suppliers: rows.map((s) => ({ id: s.id, name: s.name, contact: s.contact })) });
  });

  router.post('/suppliers', ...ownerOnly, (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '供应商名称不能为空' });
    const id = nanoid(8);
    try {
      db.prepare('INSERT INTO suppliers (id, name, contact) VALUES (?, ?, ?)')
        .run(id, name, String(req.body.contact || '').trim());
    } catch (_) {
      return res.status(400).json({ error: '供应商已存在' });
    }
    res.json({ message: '供应商已添加', id, name });
  });

  router.post('/inventory/purchase', ...ownerOnly, (req, res) => {
    const itemId = req.body.itemId;
    const qty = Number(req.body.qty);
    const supplierName = String(req.body.supplierName || '').trim();
    const note = String(req.body.note || '').trim();
    if (!itemId || !qty || qty <= 0) return res.status(400).json({ error: '请填写原料和数量' });

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: '原料不存在' });

    let supplierId = null;
    if (supplierName) {
      let sup = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(supplierName);
      if (!sup) {
        supplierId = nanoid(8);
        db.prepare('INSERT INTO suppliers (id, name) VALUES (?, ?)').run(supplierId, supplierName);
      } else {
        supplierId = sup.id;
      }
    }

    const nextStock = item.stock_qty + qty;
    const poId = nanoid(10);

    db.transaction(() => {
      db.prepare(`
        UPDATE inventory_items SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?
      `).run(nextStock, item.id);
      db.prepare(`
        INSERT INTO purchase_orders (id, supplier_id, item_id, qty, note, operator_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(poId, supplierId, item.id, qty, note, req.admin.id);
      db.prepare(`
        INSERT INTO inventory_movements (id, item_id, delta_qty, stock_after, reason, ref_type, ref_id, operator_id)
        VALUES (?, ?, ?, ?, ?, 'purchase', ?, ?)
      `).run(nanoid(10), item.id, qty, nextStock, `采购入库${supplierName ? ` · ${supplierName}` : ''}`, poId, req.admin.id);
    })();

    logOperation(db, {
      userId: null,
      adminId: req.admin.id,
      action: 'admin_inventory_purchase',
      detail: JSON.stringify({ itemId: item.id, qty, supplierName, admin: req.admin.username }),
      ip: req.ip,
    });

    res.json({ message: `已入库 +${qty} ${item.unit}`, stockQty: nextStock });
  });

  router.get('/inventory/purchases', ...anyStaff, (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const rows = db.prepare(`
      SELECT po.*, i.name AS item_name, i.unit, s.name AS supplier_name
      FROM purchase_orders po
      JOIN inventory_items i ON i.id = po.item_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      ORDER BY po.created_at DESC LIMIT ?
    `).all(limit);
    res.json({
      purchases: rows.map((r) => ({
        id: r.id,
        itemName: r.item_name,
        qty: r.qty,
        unit: r.unit,
        supplierName: r.supplier_name || '—',
        note: r.note,
        createdAt: r.created_at,
      })),
    });
  });

  /** 核销历史 */
  router.get('/redeem/history', ...anyStaff, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const status = req.query.status || 'all';
    const rows = (status === 'pending' || status === 'completed')
      ? db.prepare(`
          SELECT r.*, u.nickname, u.phone, a.display_name AS operator_name
          FROM redemptions r
          JOIN users u ON u.id = r.user_id
          LEFT JOIN admin_users a ON a.id = r.operator_id
          WHERE r.status = ?
          ORDER BY COALESCE(r.verified_at, r.created_at) DESC
          LIMIT ?
        `).all(status, limit)
      : db.prepare(`
          SELECT r.*, u.nickname, u.phone, a.display_name AS operator_name
          FROM redemptions r
          JOIN users u ON u.id = r.user_id
          LEFT JOIN admin_users a ON a.id = r.operator_id
          ORDER BY COALESCE(r.verified_at, r.created_at) DESC
          LIMIT ?
        `).all(limit);
    res.json({
      redemptions: rows.map((r) => ({
        id: r.id,
        pickupCode: r.pickup_code,
        productName: r.product_name,
        pointsCost: r.points_cost,
        status: r.status,
        nickname: r.nickname,
        phone: r.phone,
        operatorName: r.operator_name || '—',
        createdAt: r.created_at,
        verifiedAt: r.verified_at,
      })),
    });
  });

  /** 存酒管理（全局待取列表） */
  router.get('/stored-wine', ...anyStaff, (req, res) => {
    const status = req.query.status || 'pending';
    const rows = db.prepare(`
      SELECT r.*, u.nickname, u.phone
      FROM redemptions r
      JOIN users u ON u.id = r.user_id
      WHERE r.status = ?
      ORDER BY r.created_at DESC
    `).all(status);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        nickname: r.nickname,
        phone: r.phone,
        productName: r.product_name,
        pickupCode: r.pickup_code,
        pointsCost: r.points_cost,
        status: r.status,
        createdAt: r.created_at,
        verifiedAt: r.verified_at,
      })),
      total: rows.length,
    });
  });

  /** 审计日志 */
  router.get('/audit-logs', ...ownerOnly, (req, res) => {
    const { start, end } = resolveStatsRange(req.query.from, req.query.to, req.query.date);
    const action = req.query.action ? String(req.query.action).trim() : '';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = action
      ? db.prepare(`
          SELECT l.*, u.nickname, a.display_name AS admin_name, a.username AS admin_username
          FROM operation_logs l
          LEFT JOIN users u ON u.id = l.user_id
          LEFT JOIN admin_users a ON a.id = l.admin_id
          WHERE l.action = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) <= datetime(?)
          ORDER BY l.created_at DESC LIMIT ?
        `).all(action, start, end, limit)
      : db.prepare(`
          SELECT l.*, u.nickname, a.display_name AS admin_name, a.username AS admin_username
          FROM operation_logs l
          LEFT JOIN users u ON u.id = l.user_id
          LEFT JOIN admin_users a ON a.id = l.admin_id
          WHERE datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) <= datetime(?)
          ORDER BY l.created_at DESC LIMIT ?
        `).all(start, end, limit);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        detail: r.detail,
        nickname: r.nickname,
        adminName: r.admin_name || r.admin_username || '—',
        ip: r.ip,
        createdAt: r.created_at,
      })),
    });
  });

  /** 班次管理 */
  router.get('/shift/current', ...anyStaff, (_req, res) => {
    const shift = db.prepare(`
      SELECT s.*, a.display_name AS admin_name
      FROM shifts s
      LEFT JOIN admin_users a ON a.id = s.admin_id
      WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1
    `).get();
    if (!shift) return res.json({ shift: null });

    const cashSales = db.prepare(`
      SELECT COALESCE(SUM(total_cents), 0) AS total
      FROM orders
      WHERE payment_method IN ('cash_manual', 'cash')
        AND status IN ('paid','making','done')
        AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
    `).get(shift.opened_at);

    res.json({
      shift: {
        id: shift.id,
        adminName: shift.admin_name,
        openedAt: shift.opened_at,
        openingCashYuan: ((shift.opening_cash_cents || 0) / 100).toFixed(2),
        cashSalesYuan: ((cashSales?.total || 0) / 100).toFixed(2),
        note: shift.note,
      },
    });
  });

  router.post('/shift/open', ...ownerOnly, (req, res) => {
    const open = db.prepare(`SELECT id FROM shifts WHERE status = 'open' LIMIT 1`).get();
    if (open) return res.status(400).json({ error: '当前已有未交班的班次' });

    const openingCashCents = Math.round(Number(req.body.openingCashYuan || 0) * 100);
    const id = nanoid(10);
    db.prepare(`
      INSERT INTO shifts (id, admin_id, opening_cash_cents, note, status)
      VALUES (?, ?, ?, ?, 'open')
    `).run(id, req.admin.id, openingCashCents, String(req.body.note || '').trim());

    logOperation(db, {
      adminId: req.admin.id,
      action: 'admin_shift_open',
      detail: JSON.stringify({ shiftId: id, openingCashCents, admin: req.admin.username }),
      ip: req.ip,
    });

    res.json({ message: '班次已开班', shiftId: id });
  });

  router.post('/shift/close', ...ownerOnly, (req, res) => {
    const shift = db.prepare(`SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`).get();
    if (!shift) return res.status(400).json({ error: '没有进行中的班次' });

    const closingCashCents = Math.round(Number(req.body.closingCashYuan || 0) * 100);
    const cashSales = db.prepare(`
      SELECT COALESCE(SUM(total_cents), 0) AS total
      FROM orders
      WHERE payment_method IN ('cash_manual', 'cash')
        AND status IN ('paid','making','done')
        AND datetime(COALESCE(paid_at, created_at)) >= datetime(?)
    `).get(shift.opened_at);

    db.prepare(`
      UPDATE shifts SET status = 'closed', closed_at = datetime('now'),
        closing_cash_cents = ?, cash_sales_cents = ?, note = ?
      WHERE id = ?
    `).run(
      closingCashCents,
      cashSales?.total || 0,
      String(req.body.note || shift.note || '').trim(),
      shift.id,
    );

    logOperation(db, {
      adminId: req.admin.id,
      action: 'admin_shift_close',
      detail: JSON.stringify({
        shiftId: shift.id,
        closingCashCents,
        cashSalesCents: cashSales?.total || 0,
        admin: req.admin.username,
      }),
      ip: req.ip,
    });

    res.json({
      message: '班次已交班',
      cashSalesYuan: ((cashSales?.total || 0) / 100).toFixed(2),
      expectedCashYuan: (((shift.opening_cash_cents || 0) + (cashSales?.total || 0)) / 100).toFixed(2),
    });
  });

  /** 积分转存分（周中 10%） */
  router.post('/members/:id/points-to-stored', ...ownerOnly, (req, res) => {
    const { points } = req.body;
    const cost = Number(points);
    if (!cost || cost < 10) return res.status(400).json({ error: '至少转入 10 积分' });
    if (isWeekend()) return res.status(400).json({ error: '周末赛不可转存分' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: '会员不存在' });
    if (user.points < cost) return res.status(400).json({ error: '积分不足' });

    const gain = Math.floor(cost / 10);
    db.transaction(() => {
      db.prepare('UPDATE users SET points = points - ?, stored_score = stored_score + ? WHERE id = ?')
        .run(cost, gain, user.id);
      db.prepare(`
        INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type, ref_id)
        VALUES (?, ?, ?, ?, 'stored', ?)
      `).run(nanoid(10), user.id, -cost, `转入存分 +${gain}`, user.id);
    })();

    cacheDel(`points:mall:${user.id}`);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({
      message: `已转入 ${cost} 积分 → ${gain} 存分`,
      user: formatUser(db, updated),
    });
  });
}

function csvEsc(s) {
  const v = String(s ?? '').replace(/"/g, '""');
  return v.includes(',') || v.includes('"') ? `"${v}"` : v;
}
