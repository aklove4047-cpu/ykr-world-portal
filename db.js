const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

class SQLiteWrapper {
  constructor(filePath) {
    this.filePath = filePath;
    this._db = new DatabaseSync(filePath);
  }

  _cleanArgs(args) {
    if (args.length === 1 && Array.isArray(args[0])) {
      return args[0].map(v => (v === undefined ? null : v));
    }
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Date) && !Buffer.isBuffer(args[0])) {
      const obj = {};
      for (const [k, v] of Object.entries(args[0])) {
        obj[k] = v === undefined ? null : v;
      }
      return [obj];
    }
    return args.map(v => (v === undefined ? null : v));
  }

  pragma(cmd) {
    try {
      this._db.exec(`PRAGMA ${cmd};`);
    } catch (e) {
      // pragma fallback
    }
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  prepare(sql) {
    const stmt = this._db.prepare(sql);
    const self = this;
    return {
      get(...args) {
        const cleaned = self._cleanArgs(args);
        return stmt.get(...cleaned);
      },
      all(...args) {
        const cleaned = self._cleanArgs(args);
        return stmt.all(...cleaned);
      },
      run(...args) {
        const cleaned = self._cleanArgs(args);
        const info = stmt.run(...cleaned);
        return {
          changes: Number(info?.changes || 0),
          lastInsertRowid: Number(info?.lastInsertRowid || 0)
        };
      }
    };
  }

  transaction(fn) {
    const self = this;
    return function (...args) {
      self.exec('BEGIN');
      try {
        const res = fn.apply(this, args);
        self.exec('COMMIT');
        return res;
      } catch (err) {
        try { self.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  }

  async backup(destPath) {
    try {
      const escaped = destPath.replace(/'/g, "''");
      this.exec(`VACUUM INTO '${escaped}';`);
    } catch {
      if (this.filePath && this.filePath !== ':memory:' && fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, destPath);
      }
    }
  }

  close() {
    return this._db.close();
  }
}

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const dbPath = process.env.DB_PATH || path.join(dir, 'ykr.db');
const db = new SQLiteWrapper(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

module.exports = db;
