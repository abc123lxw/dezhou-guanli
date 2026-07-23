import { nanoid } from 'nanoid';
import { isWeekend, WEEKEND_ENTRY_PRODUCT_NAME } from './gameRules.js';
import { chinaTodayStr, parseDbTime } from './chinaTime.js';
import { getOrderItems } from './orderService.js';

export function todayDateStr(date = new Date()) {
  return chinaTodayStr(date);
}

export function modeForDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return isWeekend(d) ? 'weekend' : 'weekday';
}

export function registerTournament(db, userId, eventDate, mode) {
  const existing = db.prepare(`
    SELECT * FROM tournament_registrations
    WHERE user_id = ? AND event_date = ? AND mode = ? AND status != 'cancelled'
  `).get(userId, eventDate, mode);

  if (existing) return existing;

  const id = nanoid(10);
  db.prepare(`
    INSERT INTO tournament_registrations (id, user_id, event_date, mode, status)
    VALUES (?, ?, ?, ?, 'registered')
  `).run(id, userId, eventDate, mode);

  return db.prepare('SELECT * FROM tournament_registrations WHERE id = ?').get(id);
}

/** 周末赛 ¥78 支付成功后自动签到 */
export function linkWeekendEntryOrder(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;

  const items = getOrderItems(db, orderId);
  const hasEntry = items.some((i) => i.name === WEEKEND_ENTRY_PRODUCT_NAME);
  if (!hasEntry) return null;

  const paidInstant = parseDbTime(order.paid_at || order.created_at) || new Date();
  const eventDate = todayDateStr(paidInstant);
  if (modeForDate(eventDate) !== 'weekend') return null;

  const reg = registerTournament(db, order.user_id, eventDate, 'weekend');
  db.prepare(`
    UPDATE tournament_registrations
    SET status = 'checked_in', order_id = ?, checked_in_at = datetime('now')
    WHERE id = ?
  `).run(orderId, reg.id);

  return db.prepare('SELECT * FROM tournament_registrations WHERE id = ?').get(reg.id);
}

export function getEventStats(db, eventDate, mode) {
  const capacity = 18;
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS c FROM tournament_registrations
    WHERE event_date = ? AND mode = ? AND status != 'cancelled'
    GROUP BY status
  `).all(eventDate, mode);

  const map = Object.fromEntries(rows.map((r) => [r.status, r.c]));
  const registered = (map.registered || 0) + (map.checked_in || 0);
  const checkedIn = map.checked_in || 0;

  return { eventDate, mode, capacity, registered, checkedIn, joined: registered };
}
