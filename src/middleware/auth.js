import { nanoid } from 'nanoid';
import { calcLevel, genInviteCode } from '../lib/member.js';

export function authMiddleware(db) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '未登录' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token);
    if (!user) return res.status(401).json({ error: '登录已失效' });

    req.user = user;
    next();
  };
}

function ensureInviteCode(db, userId) {
  const user = db.prepare('SELECT invite_code FROM users WHERE id = ?').get(userId);
  if (user?.invite_code) return user.invite_code;
  let code = genInviteCode();
  for (let i = 0; i < 5; i++) {
    try {
      db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(code, userId);
      return code;
    } catch (_) {
      code = genInviteCode();
    }
  }
  return code;
}

export function formatUser(db, user) {
  const inviteCode = ensureInviteCode(db, user.id);
  const level = calcLevel(user.growth_value);
  const inviteCount = db.prepare(`
    SELECT COUNT(*) AS c FROM users WHERE invited_by = ?
  `).get(user.id).c;
  return {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    phone: user.phone,
    points: user.points,
    balanceYuan: (user.balance_cents / 100).toFixed(2),
    growthValue: user.growth_value,
    level: level.level,
    levelName: level.levelName,
    toNext: level.toNext,
    nextLevelName: level.nextLevelName,
    inviteCode,
    inviteCount,
    storedScore: user.stored_score || 0,
    memberCode: inviteCode,
  };
}

export function loginOrRegister(db, { openid, nickname, avatar, inviteCode }) {
  let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  if (!user) {
    const id = nanoid(12);
    let inviterId = null;
    if (inviteCode) {
      const inviter = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(inviteCode.toUpperCase());
      inviterId = inviter?.id || null;
    }
    const code = genInviteCode();
    db.prepare(`
      INSERT INTO users (id, openid, nickname, avatar, invite_code, invited_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, openid, nickname || '酒友', avatar || '', code, inviterId);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } else {
    ensureInviteCode(db, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }
  return user;
}

export function rewardInviterOnFirstOrder(db, userId) {
  const user = db.prepare('SELECT invited_by, invite_rewarded FROM users WHERE id = ?').get(userId);
  if (!user?.invited_by || user.invite_rewarded) return;

  const inviter = db.prepare('SELECT id, points FROM users WHERE id = ?').get(user.invited_by);
  if (!inviter) return;

  const bonus = 500;
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(bonus, inviter.id);
  db.prepare(`
    INSERT INTO point_logs (id, user_id, change_amount, reason, ref_type, ref_id)
    VALUES (?, ?, ?, '邀请好友首单奖励', 'invite', ?)
  `).run(nanoid(10), inviter.id, bonus, userId);
  db.prepare('UPDATE users SET invite_rewarded = 1 WHERE id = ?').run(userId);
}
