import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

class StmtWrapper {
  constructor(stmt) {
    this._stmt = stmt;
  }

  all(...args) {
    return this._stmt.all(...args);
  }

  get(...args) {
    const rows = this._stmt.all(...args);
    return rows.length ? rows[0] : undefined;
  }

  run(...args) {
    return this._stmt.run(...args);
  }
}

/** better-sqlite3 兼容封装，底层使用 Node 内置 node:sqlite */
export default class Database {
  constructor(dbPath) {
    this._db = new DatabaseSync(dbPath);
    this._path = dbPath;
  }

  exec(sql) {
    this._db.exec(sql);
  }

  pragma(value) {
    this._db.exec(`PRAGMA ${value}`);
  }

  prepare(sql) {
    return new StmtWrapper(this._db.prepare(sql));
  }

  transaction(fn) {
    return () => {
      this._db.exec('BEGIN IMMEDIATE');
      try {
        fn();
        this._db.exec('COMMIT');
      } catch (err) {
        try {
          this._db.exec('ROLLBACK');
        } catch (_) {
          /* ignore */
        }
        throw err;
      }
    };
  }

  backup(dest) {
    sqliteBackup(this._db, dest);
  }

  close() {
    this._db.close();
  }
}
