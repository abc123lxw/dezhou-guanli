import Database from './database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDb(dbPath = './data/bar.db') {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT UNIQUE NOT NULL,
      nickname TEXT DEFAULT '酒友',
      avatar TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      points INTEGER DEFAULT 0,
      growth_value INTEGER DEFAULT 0,
      balance_cents INTEGER DEFAULT 0,
      invite_code TEXT UNIQUE,
      invited_by TEXT,
      invite_rewarded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS redemptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      points_cost INTEGER NOT NULL,
      pickup_code TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS recharge_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      bonus_points INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      points_reward INTEGER NOT NULL,
      points_redeem_cost INTEGER,
      image_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      table_id TEXT,
      total_cents INTEGER NOT NULL,
      points_earned INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS point_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      change_amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS poker_tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seats_max INTEGER NOT NULL,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      table_id TEXT NOT NULL,
      seat_number INTEGER,
      reserve_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      people_count INTEGER NOT NULL,
      status TEXT DEFAULT 'confirmed',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (table_id) REFERENCES poker_tables(id)
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '吧台',
      role TEXT DEFAULT 'staff',
      enabled INTEGER DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_logs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      raw_payload TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS tournament_registrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT DEFAULT 'registered',
      order_id TEXT,
      checked_in_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, event_date, mode)
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      unit TEXT DEFAULT '份',
      stock_qty REAL NOT NULL DEFAULT 0,
      alert_qty REAL NOT NULL DEFAULT 5,
      enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );

  `);

  const migrations = [
    'ALTER TABLE reservations ADD COLUMN seat_number INTEGER',
    'ALTER TABLE orders ADD COLUMN table_id TEXT',
    'ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ""',
    'ALTER TABLE users ADD COLUMN growth_value INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN balance_cents INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN invite_code TEXT',
    'ALTER TABLE users ADD COLUMN invited_by TEXT',
    'ALTER TABLE users ADD COLUMN invite_rewarded INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN description TEXT DEFAULT ""',
    'ALTER TABLE orders ADD COLUMN pickup_no TEXT',
    'ALTER TABLE orders ADD COLUMN payment_method TEXT',
    'ALTER TABLE orders ADD COLUMN wx_transaction_id TEXT',
    'ALTER TABLE orders ADD COLUMN paid_at TEXT',
    'ALTER TABLE orders ADD COLUMN operator_id TEXT',
    'ALTER TABLE orders ADD COLUMN making_at TEXT',
    'ALTER TABLE orders ADD COLUMN done_at TEXT',
    'ALTER TABLE orders ADD COLUMN note TEXT DEFAULT ""',
    'ALTER TABLE users ADD COLUMN stored_score INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN sold_out INTEGER DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_seat
      ON reservations(table_id, reserve_date, start_time, seat_number)
      WHERE status != 'cancelled' AND seat_number IS NOT NULL;

    CREATE TABLE IF NOT EXISTS groupon_logs (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      code TEXT NOT NULL,
      amount_cents INTEGER DEFAULT 0,
      product_name TEXT DEFAULT '',
      order_id TEXT,
      operator_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      opening_cash_cents INTEGER DEFAULT 0,
      closing_cash_cents INTEGER,
      cash_sales_cents INTEGER DEFAULT 0,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      delta_qty REAL NOT NULL,
      stock_after REAL NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT DEFAULT 'manual',
      ref_id TEXT,
      operator_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES inventory_items(id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      contact TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      item_id TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'received',
      note TEXT DEFAULT '',
      operator_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      received_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES inventory_items(id)
    );
  `);

  const extraMigrations = [
    'ALTER TABLE redemptions ADD COLUMN verified_at TEXT',
    'ALTER TABLE redemptions ADD COLUMN operator_id TEXT',
    'ALTER TABLE operation_logs ADD COLUMN admin_id TEXT',
  ];
  for (const sql of extraMigrations) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }

  const hasTable3 = db.prepare("SELECT id FROM poker_tables WHERE id = 'table-3'").get();
  if (!hasTable3) {
    db.prepare(`
      INSERT INTO poker_tables (id, name, seats_max, enabled)
      VALUES ('table-3', '3号娱乐桌', 9, 1)
    `).run();
  }

  // 旧版整桌唯一索引会阻止同桌多座位预约，需移除
  try { db.exec('DROP INDEX IF EXISTS idx_reservation_slot'); } catch (_) { /* ignore */ }

  return db;
}
