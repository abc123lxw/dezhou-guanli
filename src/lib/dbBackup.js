import fs from 'fs';
import path from 'path';

/** SQLite 在线备份（WAL 模式安全） */
export function backupDatabase(db, dbPath, backupDir) {
  const resolvedDb = path.resolve(dbPath);
  const dir = path.resolve(backupDir || path.join(path.dirname(resolvedDb), 'backups'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `bar-${stamp}.db`);

  db.backup(dest);

  pruneOldBackups(dir, Number(process.env.BACKUP_KEEP_DAYS || 14));
  return dest;
}

function pruneOldBackups(dir, keepDays) {
  const cutoff = Date.now() - keepDays * 86400000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.db')) continue;
    const fp = path.join(dir, f);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
  }
}

export function startBackupScheduler(db, dbPath) {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (hours <= 0) return null;

  const run = () => {
    try {
      const dest = backupDatabase(db, dbPath);
      console.log(`[backup] ${dest}`);
    } catch (e) {
      console.error('[backup] failed', e);
    }
  };

  run();
  return setInterval(run, hours * 3600000);
}
