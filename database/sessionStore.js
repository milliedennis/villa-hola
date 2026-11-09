'use strict';
/**
 * SQLite-backed session store for express-session.
 * Uses the existing better-sqlite3 connection so no extra package is needed.
 * Sessions survive Railway container restarts.
 */
const session = require('express-session');
const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../villa-hola.db');

class SQLiteStore extends session.Store {
  constructor (options = {}) {
    super();

    // Open (or reuse) the DB — deliberately separate from the app DB instance
    // so the session table is always available, even before db.js is loaded.
    this._db = new Database(options.dbPath || DB_PATH);
    this._db.pragma('journal_mode = WAL');

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid       TEXT PRIMARY KEY,
        data      TEXT NOT NULL,
        expires   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    `);

    // Prune expired rows every hour
    this._prune = this._db.prepare('DELETE FROM sessions WHERE expires < ?');
    setInterval(() => {
      try { this._prune.run(Date.now()); } catch (_) { /* ignore */ }
    }, 60 * 60 * 1000).unref();
  }

  /** Retrieve a session by id. */
  get (sid, cb) {
    try {
      const row = this._db
        .prepare('SELECT data, expires FROM sessions WHERE sid = ?')
        .get(sid);

      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        this._db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) { cb(err); }
  }

  /** Save / update a session. */
  set (sid, sessionData, cb) {
    try {
      const expires = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000; // 8-hour fallback

      this._db.prepare(`
        INSERT INTO sessions (sid, data, expires)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires
      `).run(sid, JSON.stringify(sessionData), expires);

      cb(null);
    } catch (err) { cb(err); }
  }

  /** Remove a session. */
  destroy (sid, cb) {
    try {
      this._db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (err) { cb(err); }
  }

  /** Touch (refresh expiry) without replacing data. */
  touch (sid, sessionData, cb) {
    try {
      const expires = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;

      this._db.prepare(`
        UPDATE sessions SET expires = ? WHERE sid = ?
      `).run(expires, sid);

      cb(null);
    } catch (err) { cb(err); }
  }
}

module.exports = SQLiteStore;
