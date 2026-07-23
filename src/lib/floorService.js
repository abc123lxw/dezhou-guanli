import { chinaTodayStr, formatChinaClock, formatChinaDateTime } from './chinaTime.js';

export const TIME_SLOTS = [
  { start: '18:00', end: '20:00', label: '18:00 - 20:00' },
  { start: '20:00', end: '22:00', label: '20:00 - 22:00' },
  { start: '22:00', end: '00:00', label: '22:00 - 次日 00:00' },
];

export function chinaCurrentSlot() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
  });
  const hour = Number(fmt.formatToParts(new Date()).find((p) => p.type === 'hour')?.value || 0);
  if (hour < 20) return TIME_SLOTS[0];
  if (hour < 22) return TIME_SLOTS[1];
  return TIME_SLOTS[2];
}

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s || '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function statusLabel(status) {
  const map = {
    pending: '待支付',
    paid: '待出酒',
    making: '制作中',
    done: '已完成',
  };
  return map[status] || status;
}

export function buildFloorStatus(db, { date, slotStart } = {}) {
  const reserveDate = date || chinaTodayStr();
  const slot = slotStart
    ? (TIME_SLOTS.find((s) => s.start === slotStart) || chinaCurrentSlot())
    : chinaCurrentSlot();
  const dayStart = `${reserveDate} 00:00:00`;
  const dayEnd = `${reserveDate} 23:59:59`;

  const tables = db.prepare(`
    SELECT id, name, seats_max FROM poker_tables WHERE enabled = 1 ORDER BY name
  `).all();

  const floorTables = tables.map((table) => {
    const bookings = db.prepare(`
      SELECT r.id, r.seat_number, r.people_count, r.note, r.status, r.start_time, r.end_time,
             u.nickname, u.phone
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      WHERE r.table_id = ? AND r.reserve_date = ? AND r.start_time = ?
        AND r.status != 'cancelled'
    `).all(table.id, reserveDate, slot.start);

    const seatMap = {};
    for (const b of bookings) {
      if (b.seat_number) seatMap[b.seat_number] = b;
    }

    const seats = [];
    for (let n = 1; n <= table.seats_max; n++) {
      const b = seatMap[n];
      seats.push({
        number: n,
        status: b ? 'reserved' : 'empty',
        statusLabel: b ? '已预约' : '空位',
        nickname: b?.nickname || '',
        phone: maskPhone(b?.phone),
        reservationId: b?.id || null,
      });
    }

    const tableLevel = bookings.filter((b) => !b.seat_number);

    const activeOrders = db.prepare(`
      SELECT o.id, o.pickup_no, o.status, o.total_cents, o.note, o.created_at, u.nickname, u.phone
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.table_id = ?
        AND o.status IN ('pending', 'paid', 'making')
        AND datetime(o.created_at) >= datetime(?)
        AND datetime(o.created_at) <= datetime(?)
      ORDER BY o.created_at DESC
    `).all(table.id, dayStart, dayEnd);

    const todaySchedule = db.prepare(`
      SELECT r.id, r.start_time, r.end_time, r.seat_number, r.people_count, r.note, r.status,
             u.nickname, u.phone
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      WHERE r.table_id = ? AND r.reserve_date = ? AND r.status != 'cancelled'
      ORDER BY r.start_time, r.seat_number
    `).all(table.id, reserveDate);

    return {
      id: table.id,
      name: table.name,
      seatsMax: table.seats_max,
      seats,
      occupiedSeats: seats.filter((s) => s.status === 'reserved').length,
      tableBookings: tableLevel.map((b) => ({
        id: b.id,
        peopleCount: b.people_count,
        nickname: b.nickname,
        phone: maskPhone(b.phone),
        note: b.note || '',
        time: `${b.start_time}-${b.end_time}`,
      })),
      barOrders: activeOrders.map((o) => ({
        id: o.id,
        pickupNo: o.pickup_no,
        status: o.status,
        statusLabel: statusLabel(o.status),
        totalYuan: (o.total_cents / 100).toFixed(o.total_cents % 100 ? 2 : 0),
        nickname: o.nickname,
        phone: maskPhone(o.phone),
        note: o.note || '',
        createdAt: formatChinaDateTime(o.created_at),
      })),
      todaySchedule: todaySchedule.map((r) => ({
        id: r.id,
        time: `${r.start_time}-${r.end_time}`,
        seat: r.seat_number ? `${r.seat_number}号位` : `整桌 ${r.people_count}人`,
        nickname: r.nickname,
        phone: maskPhone(r.phone),
        note: r.note || '',
      })),
    };
  });

  const totalSeats = floorTables.reduce((n, t) => n + t.seatsMax, 0);
  const totalOccupied = floorTables.reduce((n, t) => n + t.occupiedSeats, 0);
  const totalBarOrders = floorTables.reduce((n, t) => n + t.barOrders.length, 0);
  const totalSchedule = floorTables.reduce((n, t) => n + t.todaySchedule.length, 0);

  return {
    date: reserveDate,
    slot: slot.start,
    slotLabel: slot.label,
    updatedAt: formatChinaClock(),
    timezone: 'Asia/Shanghai',
    summary: {
      totalSeats,
      totalOccupied,
      totalEmpty: totalSeats - totalOccupied,
      totalBarOrders,
      totalSchedule,
      occupancyPct: totalSeats ? Math.round((totalOccupied / totalSeats) * 100) : 0,
    },
    tables: floorTables,
    slots: TIME_SLOTS.map((s) => ({ start: s.start, end: s.end, label: s.label })),
  };
}
