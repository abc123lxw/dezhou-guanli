import dotenv from 'dotenv';
import { nanoid } from 'nanoid';
import { createDb } from './init.js';
import { genInviteCode } from '../lib/member.js';
import { hashPassword } from '../lib/password.js';

dotenv.config();

const db = createDb(process.env.DATABASE_PATH || './data/bar.db');

const tables = [
  { id: 'table-1', name: '1号娱乐桌', seats_max: 9 },
  { id: 'table-2', name: '2号娱乐桌', seats_max: 9 },
  { id: 'table-3', name: '3号娱乐桌', seats_max: 9 },
];

const products = [
  { name: '美团-团购更优惠', category: '团购券', price: 100, reward: 1000, redeem: null, desc: '好评额外赠送1000积分' },
  { name: '抖音-团购更优惠', category: '团购券', price: 100, reward: 1000, redeem: null, desc: '好评额外赠送1000积分' },
  { name: '长岛冰茶', category: '经典', price: 6800, reward: 1500, redeem: 7000, desc: '7000积分兑换 · 可寄店' },
  { name: '尼格罗尼', category: '经典', price: 6800, reward: 1500, redeem: 7000, desc: '经典鸡尾酒 · 赠1500积分' },
  { name: '金汤力', category: '经典', price: 6800, reward: 1500, redeem: 7000, desc: '经典鸡尾酒 · 赠1500积分' },
  { name: '古典', category: '经典', price: 6800, reward: 1500, redeem: 7000, desc: '经典鸡尾酒 · 赠1500积分' },
  { name: '绯红佳人', category: '特调', price: 6800, reward: 1800, redeem: 7000, desc: '主理特调 · 赠1800积分' },
  { name: '洛神玫瑰', category: '特调', price: 6800, reward: 1800, redeem: 7000, desc: '主理特调 · 赠1800积分' },
  { name: 'All IN 孤注一掷', category: '德州主题', price: 7800, reward: 2500, redeem: 8000, desc: '德州主题特调 · 赠2500积分' },
  { name: '红心皇后', category: '德州主题', price: 7800, reward: 2500, redeem: 8000, desc: '德州主题特调 · 赠2500积分' },
  { name: '黑桃A', category: '德州主题', price: 7800, reward: 2500, redeem: 8000, desc: '德州主题特调 · 赠2500积分' },
  { name: '百香青柠气泡水', category: '无酒精', price: 4800, reward: 800, redeem: 5000, desc: '无酒精 · 赠800积分' },
  { name: '椰汁', category: '无酒精', price: 3500, reward: 500, redeem: 4000, desc: '无酒精 · 赠500积分' },
  { name: '科罗娜', category: '啤酒', price: 2500, reward: 400, redeem: 3000, desc: '3000积分兑换 · 可寄店' },
  { name: '1664', category: '啤酒', price: 3000, reward: 500, redeem: 3500, desc: '3500积分兑换 · 可寄店' },
  { name: '香辣毛豆', category: '小吃', price: 2800, reward: 400, redeem: 3000, desc: '小吃 · 赠400积分' },
  { name: '薯条', category: '小吃', price: 2200, reward: 300, redeem: 2500, desc: '小吃 · 赠300积分' },
  { name: '78元酒券套餐', category: '酒券套餐', price: 7800, reward: 3000, redeem: null, desc: '周末赛唯一入场 · 任选一杯调酒+3000比赛记分 · 赠3000会员积分' },
  { name: '下午场券', category: '积分商城', price: 0, reward: 0, redeem: 6000, desc: '6000积分兑换' },
];

db.pragma('foreign_keys = OFF');
db.exec('DELETE FROM payment_logs');
db.exec('DELETE FROM tournament_registrations');
db.exec('DELETE FROM inventory_items');
db.exec('DELETE FROM admin_users');
db.exec('DELETE FROM point_logs');
db.exec('DELETE FROM redemptions');
db.exec('DELETE FROM recharge_logs');
db.exec('DELETE FROM reservations');
db.exec('DELETE FROM order_items');
db.exec('DELETE FROM orders');
db.exec('DELETE FROM products');
db.exec('DELETE FROM poker_tables');
db.prepare('DELETE FROM users WHERE openid LIKE ?').run('demo_%');
db.pragma('foreign_keys = ON');

const insertTable = db.prepare(`
  INSERT INTO poker_tables (id, name, seats_max) VALUES (@id, @name, @seats_max)
`);
const insertProduct = db.prepare(`
  INSERT INTO products (id, name, category, price_cents, points_reward, points_redeem_cost, description, sort_order)
  VALUES (@id, @name, @category, @price_cents, @points_reward, @points_redeem_cost, @description, @sort_order)
`);

for (const t of tables) insertTable.run(t);
products.forEach((p, i) => {
  insertProduct.run({
    id: nanoid(8),
    name: p.name,
    category: p.category,
    price_cents: p.price,
    points_reward: p.reward,
    points_redeem_cost: p.redeem,
    description: p.desc,
    sort_order: i,
  });
});

const insertUser = db.prepare(`
  INSERT INTO users (id, openid, nickname, points, growth_value, invite_code)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertOrder = db.prepare(`
  INSERT INTO orders (id, user_id, total_cents, points_earned, status, pickup_no, payment_method, paid_at, created_at)
  VALUES (?, ?, ?, ?, 'done', ?, 'wxpay_dev', datetime('now'), datetime('now'))
`);

const adminPassword = process.env.ADMIN_PASSWORD || 'dybar2026';
const ownerId = nanoid(10);
db.prepare(`
  INSERT INTO admin_users (id, username, password_hash, display_name, role)
  VALUES (?, 'bar', ?, '老板账号', 'owner')
`).run(ownerId, hashPassword(adminPassword));
db.prepare(`
  INSERT INTO admin_users (id, username, password_hash, display_name, role)
  VALUES (?, 'staff', ?, '吧台员工', 'staff')
`).run(nanoid(10), hashPassword(adminPassword));

const demoRank = [
  { nickname: '德州小王子', points: 3000, growth: 78, spend: 7800 },
  { nickname: 'AllIn哥', points: 2500, growth: 78, spend: 7800 },
  { nickname: '红心女王', points: 1800, growth: 68, spend: 6800 },
  { nickname: '黑桃A', points: 1500, growth: 68, spend: 6800 },
  { nickname: '筹码猎人', points: 1000, growth: 68, spend: 6800 },
];

for (const d of demoRank) {
  const uid = nanoid(10);
  insertUser.run(uid, `demo_${uid}`, d.nickname, d.points, d.growth, genInviteCode());
  insertOrder.run(nanoid(10), uid, d.spend, d.points, String(1000 + Math.floor(Math.random() * 9000)));
}

const inventory = [
  { name: '金酒', unit: '瓶', stock: 12, alert: 3 },
  { name: '伏特加', unit: '瓶', stock: 10, alert: 3 },
  { name: '朗姆酒', unit: '瓶', stock: 8, alert: 2 },
  { name: '威士忌', unit: '瓶', stock: 6, alert: 2 },
  { name: '柠檬', unit: '斤', stock: 15, alert: 5 },
  { name: '青柠', unit: '斤', stock: 10, alert: 4 },
  { name: '苏打水', unit: '箱', stock: 4, alert: 1 },
  { name: '薄荷叶', unit: '盒', stock: 3, alert: 1 },
];
const insertInv = db.prepare(`
  INSERT INTO inventory_items (id, name, unit, stock_qty, alert_qty)
  VALUES (?, ?, ?, ?, ?)
`);
for (const inv of inventory) {
  insertInv.run(nanoid(8), inv.name, inv.unit, inv.stock, inv.alert);
}

console.log('Seed done:', {
  tables: tables.length,
  products: products.length,
  demoUsers: demoRank.length,
  inventory: inventory.length,
  admin: { owner: 'bar', staff: 'staff', password: adminPassword },
});
