import { Router } from 'express';
import { maskNickname } from '../lib/member.js';

export function rankRoutes(db) {
  const router = Router();

  function weekRange(period) {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    if (period === 'last') monday.setDate(monday.getDate() - 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(monday), end: fmt(sunday), label: `${fmt(monday).slice(5).replace('-', '月')}日 - ${fmt(sunday).slice(5).replace('-', '月')}日` };
  }

  router.get('/leaderboard', (req, res) => {
    const { month, period } = req.query;
    let start;
    let end;
    let periodLabel;

    if (period === 'week' || period === 'last') {
      const w = weekRange(period === 'last' ? 'last' : 'week');
      start = w.start;
      end = w.end;
      periodLabel = w.label;
    } else {
      const now = new Date();
      const m = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [y, mo] = m.split('-');
      start = `${y}-${mo}-01`;
      end = `${y}-${mo}-31`;
      periodLabel = `${y}年${mo}月`;
    }

    const rows = db.prepare(`
      SELECT u.nickname, u.avatar, SUM(o.points_earned) AS total_points, SUM(o.total_cents) AS total_spend
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.status = 'paid' AND date(o.created_at) BETWEEN ? AND ?
      GROUP BY o.user_id
      ORDER BY total_points DESC
      LIMIT 20
    `).all(start, end);

    const list = rows.map((r, i) => ({
      rank: i + 1,
      nickname: maskNickname(r.nickname),
      avatar: r.avatar || '',
      points: r.total_points,
      spendYuan: Math.floor((r.total_spend || 0) / 100),
    }));

    res.json({ period: periodLabel, list });
  });

  return router;
}
