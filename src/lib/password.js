import crypto from 'crypto';

const SALT = process.env.ADMIN_SALT || 'deyang-bar-admin';

export function hashPassword(password) {
  return crypto.createHash('sha256').update(`${SALT}:${password}`).digest('hex');
}

export function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}
