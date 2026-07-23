import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getEventStats,
  modeForDate,
  registerTournament,
  todayDateStr,
} from '../lib/tournamentService.js';

function dateOffsetStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function tournamentRoutes(db) {
  const router = Router();
  router.use(authMiddleware(db));

  /** 未来 N 天赛事（小程序活动页） */
  router.get('/events', (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 14);
    const events = [];

    for (let i = 0; i < days; i++) {
      const eventDate = dateOffsetStr(i);
      const mode = modeForDate(eventDate);
      const stats = getEventStats(db, eventDate, mode);
      const reg = db.prepare(`
        SELECT status, order_id FROM tournament_registrations
        WHERE user_id = ? AND event_date = ? AND mode = ? AND status != 'cancelled'
      `).get(req.user.id, eventDate, mode);

      events.push({
        ...stats,
        offset: i,
        userStatus: reg?.status || null,
        userRegistered: !!reg,
        orderId: reg?.order_id || null,
      });
    }

    res.json({ events, today: todayDateStr() });
  });

  /** 手动报名（周中局免费预约） */
  router.post('/register', (req, res) => {
    const { eventDate, mode } = req.body;
    if (!eventDate || !mode) return res.status(400).json({ error: '缺少日期或模式' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return res.status(400).json({ error: '日期格式错误' });

    const actualMode = modeForDate(eventDate);
    if (mode !== actualMode) {
      return res.status(400).json({ error: `该日为${actualMode === 'weekend' ? '周末赛' : '周中局'}` });
    }

    const stats = getEventStats(db, eventDate, mode);
    if (stats.registered >= stats.capacity) {
      return res.status(400).json({ error: '名额已满' });
    }

    const reg = registerTournament(db, req.user.id, eventDate, mode);
    res.json({
      message: mode === 'weekend' ? '已登记，请购买 ¥78 套餐完成入场' : '预约成功',
      registration: reg,
      stats: getEventStats(db, eventDate, mode),
    });
  });

  /** 我的报名记录 */
  router.get('/mine', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM tournament_registrations
      WHERE user_id = ? AND status != 'cancelled'
      ORDER BY event_date DESC LIMIT 20
    `).all(req.user.id);

    res.json({
      registrations: rows.map((r) => ({
        id: r.id,
        eventDate: r.event_date,
        mode: r.mode,
        status: r.status,
        orderId: r.order_id,
        checkedInAt: r.checked_in_at,
        createdAt: r.created_at,
      })),
    });
  });

  return router;
}
