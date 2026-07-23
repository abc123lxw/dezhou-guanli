import { nanoid } from 'nanoid';

export function logOperation(db, { userId, adminId, action, detail, ip }) {
  db.prepare(`
    INSERT INTO operation_logs (id, user_id, admin_id, action, detail, ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nanoid(12), userId || null, adminId || null, action, detail || '', ip || '');
}
