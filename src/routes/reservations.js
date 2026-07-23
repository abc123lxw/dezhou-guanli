import { Router } from 'express';
import { nanoid } from 'nanoid';
import { authMiddleware } from '../middleware/auth.js';
import { chinaTodayStr, formatChinaClock } from '../lib/chinaTime.js';
import { TIME_SLOTS, chinaCurrentSlot } from '../lib/floorService.js';

export function reservationRoutes(db) {
  const router = Router();

  router.get('/tables', (_req, res) => {
    const tables = db.prepare(`
      SELECT id, name, seats_max FROM poker_tables WHERE enabled = 1
    `).all();
    res.json({ tables });
  });

  router.get('/floor-overview', (_req, res) => {
    const reserveDate = chinaTodayStr();
    const slot = chinaCurrentSlot();
    const dayStart = `${reserveDate} 00:00:00`;
    const dayEnd = `${reserveDate} 23:59:59`;

    const tables = db.prepare(`
      SELECT id, name, seats_max FROM poker_tables WHERE enabled = 1 ORDER BY name
    `).all();

    const overview = tables.map((table) => {
      const occupied = db.prepare(`
        SELECT COUNT(*) AS c FROM reservations
        WHERE table_id = ? AND reserve_date = ? AND start_time = ?
          AND status != 'cancelled' AND seat_number IS NOT NULL
      `).get(table.id, reserveDate, slot.start).c;

      const barOrders = db.prepare(`
        SELECT COUNT(*) AS c FROM orders
        WHERE table_id = ? AND status IN ('pending', 'paid', 'making')
          AND datetime(created_at) >= datetime(?)
          AND datetime(created_at) <= datetime(?)
      `).get(table.id, dayStart, dayEnd).c;

      return {
        id: table.id,
        name: table.name,
        occupied,
        total: table.seats_max,
        barOrders,
      };
    });

    res.json({
      date: reserveDate,
      slotLabel: slot.label,
      updateTime: formatChinaClock(),
      tables: overview,
    });
  });

  router.get('/table-status', (req, res) => {
    const { tableId, date, slot } = req.query;
    if (!tableId) return res.status(400).json({ error: '缺少 tableId' });

    const reserveDate = date || chinaTodayStr();
    const slotObj = slot
      ? (TIME_SLOTS.find((s) => s.start === slot) || chinaCurrentSlot())
      : chinaCurrentSlot();
    const startTime = slotObj.start;

    const table = db.prepare('SELECT * FROM poker_tables WHERE id = ?').get(tableId);
    if (!table) return res.status(404).json({ error: '牌桌不存在' });

    const bookings = db.prepare(`
      SELECT r.seat_number, r.status, u.nickname, u.avatar
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      WHERE r.table_id = ? AND r.reserve_date = ? AND r.start_time = ?
        AND r.status != 'cancelled' AND r.seat_number IS NOT NULL
    `).all(tableId, reserveDate, startTime);

    const seatMap = {};
    for (const b of bookings) seatMap[b.seat_number] = b;

    const seats = [];
    for (let i = 1; i <= table.seats_max; i++) {
      const b = seatMap[i];
      seats.push({
        number: i,
        occupied: !!b,
        nickname: b?.nickname || '',
        status: b ? '已预约' : '空座位',
      });
    }

    const dayStart = `${reserveDate} 00:00:00`;
    const dayEnd = `${reserveDate} 23:59:59`;
    const barOrders = db.prepare(`
      SELECT COUNT(*) AS c FROM orders
      WHERE table_id = ? AND status IN ('pending', 'paid', 'making')
        AND datetime(created_at) >= datetime(?)
        AND datetime(created_at) <= datetime(?)
    `).get(tableId, dayStart, dayEnd).c;

    const occupied = seats.filter((s) => s.occupied).length;
    res.json({
      tableId,
      tableName: table.name,
      date: reserveDate,
      startTime,
      slotLabel: slotObj.label,
      updateTime: formatChinaClock(),
      seats,
      occupied,
      total: table.seats_max,
      barOrders,
      basePoints: '10/20',
      slots: TIME_SLOTS.map((s) => ({ start: s.start, label: s.label })),
    });
  });

  router.get('/slots', (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: '请传 date=YYYY-MM-DD' });

    const tables = db.prepare(`SELECT id, name, seats_max FROM poker_tables WHERE enabled = 1`).all();

    const slots = [];
    for (const table of tables) {
      for (const slot of TIME_SLOTS) {
        const seatTaken = db.prepare(`
          SELECT COUNT(*) AS c FROM reservations
          WHERE table_id = ? AND reserve_date = ? AND start_time = ?
            AND status != 'cancelled' AND seat_number IS NOT NULL
        `).get(table.id, date, slot.start).c;

        const wholeTable = db.prepare(`
          SELECT id FROM reservations
          WHERE table_id = ? AND reserve_date = ? AND start_time = ?
            AND status != 'cancelled' AND seat_number IS NULL
          LIMIT 1
        `).get(table.id, date, slot.start);

        slots.push({
          tableId: table.id,
          tableName: table.name,
          date,
          startTime: slot.start,
          endTime: slot.end,
          available: !wholeTable && seatTaken < table.seats_max,
        });
      }
    }

    res.json({ slots });
  });

  router.use(authMiddleware(db));

  router.post('/seat', (req, res) => {
    const { tableId, seatNumber, date, startTime, replaceExisting } = req.body;
    const reserveDate = date || chinaTodayStr();
    const slotTime = startTime || chinaCurrentSlot().start;

    const table = db.prepare('SELECT * FROM poker_tables WHERE id = ? AND enabled = 1').get(tableId);
    if (!table) return res.status(400).json({ error: '牌桌不存在' });

    const seat = Number(seatNumber);
    if (!seat || seat < 1 || seat > table.seats_max) {
      return res.status(400).json({ error: '座位号无效' });
    }

    const slot = TIME_SLOTS.find((s) => s.start === slotTime) || TIME_SLOTS[0];

    const taken = db.prepare(`
      SELECT id, user_id FROM reservations
      WHERE table_id = ? AND reserve_date = ? AND start_time = ?
        AND seat_number = ? AND status != 'cancelled'
    `).get(tableId, reserveDate, slotTime, seat);

    if (taken) {
      if (taken.user_id === req.user.id) {
        return res.json({ id: taken.id, message: `您已预约 ${table.name} ${seat} 号位` });
      }
      return res.status(409).json({ error: '该座位已被预约' });
    }

    const myOthers = db.prepare(`
      SELECT id, table_id, seat_number FROM reservations
      WHERE user_id = ? AND reserve_date = ? AND start_time = ?
        AND status != 'cancelled' AND seat_number IS NOT NULL
    `).all(req.user.id, reserveDate, slotTime);

    if (myOthers.length && !replaceExisting) {
      const prev = myOthers[0];
      const prevTable = db.prepare('SELECT name FROM poker_tables WHERE id = ?').get(prev.table_id);
      return res.status(409).json({
        error: `本时段您已预约 ${prevTable?.name || ''} ${prev.seat_number} 号位，请先取消或确认改约`,
        code: 'ALREADY_BOOKED',
        existing: {
          id: prev.id,
          tableId: prev.table_id,
          seatNumber: prev.seat_number,
          tableName: prevTable?.name || '',
        },
      });
    }

    try {
      const tx = db.transaction(() => {
        for (const prev of myOthers) {
          db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).run(prev.id);
        }
        const id = nanoid(12);
        db.prepare(`
          INSERT INTO reservations (id, user_id, table_id, seat_number, reserve_date, start_time, end_time, people_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(id, req.user.id, tableId, seat, reserveDate, slotTime, slot.end);
        return id;
      });
      const id = tx();
      const replaced = myOthers.length > 0;
      res.json({
        id,
        message: replaced
          ? `已改约至 ${table.name} ${seat} 号位`
          : `已预约 ${table.name} ${seat} 号位`,
      });
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: '该座位刚被他人预约，请换一个' });
      }
      console.error('[reservations/seat]', e);
      return res.status(500).json({ error: '预约失败，请稍后重试' });
    }
  });

  router.post('/', (req, res) => {
    const { tableId, date, startTime, peopleCount, note } = req.body;
    if (!tableId || !date || !startTime) {
      return res.status(400).json({ error: '缺少预约信息' });
    }

    const table = db.prepare('SELECT * FROM poker_tables WHERE id = ? AND enabled = 1').get(tableId);
    if (!table) return res.status(400).json({ error: '牌桌不存在' });

    const slot = TIME_SLOTS.find((s) => s.start === startTime);
    if (!slot) return res.status(400).json({ error: '时段无效' });

    const count = Math.min(Math.max(1, Number(peopleCount) || 1), table.seats_max);
    const id = nanoid(12);
    db.prepare(`
      INSERT INTO reservations (id, user_id, table_id, reserve_date, start_time, end_time, people_count, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, tableId, date, startTime, slot.end, count, note || '');

    res.json({ id, message: `已预约 ${table.name} ${date} ${startTime}-${slot.end}` });
  });

  router.get('/mine', (req, res) => {
    const { active } = req.query;
    let list;
    if (active === '1') {
      const today = chinaTodayStr();
      list = db.prepare(`
        SELECT r.id, r.reserve_date, r.start_time, r.end_time, r.seat_number,
               r.people_count, r.status, r.note, r.created_at, t.name AS table_name, t.id AS table_id
        FROM reservations r
        JOIN poker_tables t ON t.id = r.table_id
        WHERE r.user_id = ? AND r.status != 'cancelled'
          AND r.reserve_date >= ?
          AND r.seat_number IS NOT NULL
        ORDER BY r.reserve_date, r.start_time
        LIMIT 10
      `).all(req.user.id, today);
    } else {
      list = db.prepare(`
        SELECT r.id, r.reserve_date, r.start_time, r.end_time, r.seat_number,
               r.people_count, r.status, r.note, r.created_at, t.name AS table_name, t.id AS table_id
        FROM reservations r
        JOIN poker_tables t ON t.id = r.table_id
        WHERE r.user_id = ?
        ORDER BY r.reserve_date DESC, r.start_time DESC
        LIMIT 30
      `).all(req.user.id);
    }
    res.json({ reservations: list });
  });

  router.post('/:id/cancel', (req, res) => {
    const row = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: '预约不存在' });
    if (row.status === 'cancelled') return res.json({ message: '已取消' });

    db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
    res.json({ message: '预约已取消' });
  });

  return router;
}
