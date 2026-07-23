import dotenv from 'dotenv';
import { createDb } from '../src/db/init.js';
import { backupDatabase } from '../src/lib/dbBackup.js';

dotenv.config();

const dbPath = process.env.DATABASE_PATH || './data/bar.db';
const db = createDb(dbPath);
const dest = backupDatabase(db, dbPath);
console.log('Backup saved:', dest);
db.close();
