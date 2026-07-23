import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDb } from './db/init.js';
import { authRoutes } from './routes/auth.js';
import { productRoutes } from './routes/products.js';
import { orderRoutes } from './routes/orders.js';
import { pointRoutes } from './routes/points.js';
import { reservationRoutes } from './routes/reservations.js';
import { memberRoutes } from './routes/member.js';
import { rankRoutes } from './routes/rank.js';
import { payRoutes, createPayNotifyHandler } from './routes/pay.js';
import { isWxPayReady } from './lib/wechatPay.js';
import { adminRoutes } from './routes/admin.js';
import { tournamentRoutes } from './routes/tournament.js';
import { configRoutes } from './routes/config.js';
import { startBackupScheduler } from './lib/dbBackup.js';
import { isWxConfigured } from './lib/wechatApi.js';
import { formatChinaDateTime, formatChinaClock } from './lib/chinaTime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const devMode = process.env.DEV_MODE !== 'false';

const dbPath = process.env.DATABASE_PATH || './data/bar.db';
const db = createDb(dbPath);

app.use(cors());
app.post('/api/pay/notify', express.text({ type: '*/*' }), createPayNotifyHandler(db));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    devMode,
    wxLoginReady: isWxConfigured(),
    wxPayReady: isWxPayReady(),
    subscribeReady: !!process.env.WX_SUBSCRIBE_TEMPLATE_ORDER_DONE,
    timezone: 'Asia/Shanghai',
    serverTime: formatChinaDateTime(new Date().toISOString()),
    serverClock: formatChinaClock(),
  });
});

app.use('/api/auth', authRoutes(db, { devMode }));
app.use('/api/products', productRoutes(db));
app.use('/api/orders', orderRoutes(db));
app.use('/api/points', pointRoutes(db));
app.use('/api/reservations', reservationRoutes(db));
app.use('/api/member', memberRoutes(db));
app.use('/api/rank', rankRoutes(db));
app.use('/api/pay', payRoutes(db, { devMode }));
app.use('/api/admin', adminRoutes(db));
app.use('/api/tournament', tournamentRoutes(db));
app.use('/api/config', configRoutes());

app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器错误' });
});

const backupTimer = startBackupScheduler(db, dbPath);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API running at http://0.0.0.0:${PORT} (devMode=${devMode})`);
  console.log(`吧台后台: http://localhost:${PORT}/admin/`);
  if (backupTimer) console.log(`数据库自动备份已开启，间隔 ${process.env.BACKUP_INTERVAL_HOURS || 24}h`);
});
