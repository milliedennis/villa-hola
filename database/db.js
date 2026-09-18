'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../villa-hola.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initialise();
  }
  return db;
}

function initialise() {
  db.exec(`
    -- ── Bookings ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS bookings (
      id            TEXT PRIMARY KEY,
      reference     TEXT UNIQUE NOT NULL,
      guest_name    TEXT NOT NULL,
      guest_email   TEXT NOT NULL,
      guest_phone   TEXT,
      guest_country TEXT,
      num_guests    INTEGER NOT NULL,
      check_in      TEXT NOT NULL,   -- YYYY-MM-DD
      check_out     TEXT NOT NULL,   -- YYYY-MM-DD
      nights        INTEGER NOT NULL,
      total_price   REAL NOT NULL,
      deposit_paid  REAL NOT NULL,
      balance_due   REAL NOT NULL,
      cleaning_fee  REAL NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'pending',
        -- pending | confirmed | cancelled | completed
      source        TEXT NOT NULL DEFAULT 'direct',
        -- direct | airbnb | bookingcom | manual
      stripe_payment_intent_id TEXT,
      stripe_payment_status    TEXT,
      external_id   TEXT,           -- Airbnb/Booking.com reservation ID
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Blocked dates (manual blocks + channel imports) ─────
    CREATE TABLE IF NOT EXISTS blocked_dates (
      id         TEXT PRIMARY KEY,
      date       TEXT NOT NULL,      -- YYYY-MM-DD
      reason     TEXT,               -- 'manual' | 'airbnb' | 'bookingcom' | 'maintenance'
      source     TEXT DEFAULT 'manual',
      note       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(date);

    -- ── iCal feed log (for future channel sync) ─────────────
    CREATE TABLE IF NOT EXISTS ical_sync_log (
      id         TEXT PRIMARY KEY,
      source     TEXT NOT NULL,      -- 'airbnb' | 'bookingcom'
      synced_at  TEXT NOT NULL DEFAULT (datetime('now')),
      status     TEXT NOT NULL,      -- 'success' | 'error'
      message    TEXT,
      dates_added INTEGER DEFAULT 0,
      dates_removed INTEGER DEFAULT 0
    );

    -- ── Pricing seasons ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS pricing_seasons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      start_date TEXT NOT NULL,  -- MM-DD (month-day)
      end_date   TEXT NOT NULL,  -- MM-DD
      price_per_night REAL NOT NULL,
      min_stay   INTEGER NOT NULL DEFAULT 3
    );

    -- Seed default seasons if none exist
    -- Peak: Dec 20–Jan 6, Jan 13–21, Feb 26–Mar 11, May 29–Jun 6, Jul–Aug, Oct 23–31
    -- Other dates: €325/night | Peak dates: €395/night
    INSERT OR IGNORE INTO pricing_seasons (id, name, start_date, end_date, price_per_night, min_stay)
    VALUES
      (1, 'Other Dates',  '01-07', '01-12', 325, 3),
      (2, 'Peak Season',  '01-13', '01-21', 395, 5),
      (3, 'Other Dates',  '01-22', '02-25', 325, 3),
      (4, 'Peak Season',  '02-26', '03-11', 395, 5),
      (5, 'Other Dates',  '03-12', '05-28', 325, 3),
      (6, 'Peak Season',  '05-29', '06-06', 395, 5),
      (7, 'Other Dates',  '06-07', '06-30', 325, 3),
      (8, 'Peak Season',  '07-01', '08-31', 395, 7),
      (9, 'Other Dates',  '09-01', '10-22', 325, 3),
      (10,'Peak Season',  '10-23', '10-31', 395, 5),
      (11,'Other Dates',  '11-01', '12-19', 325, 3),
      (12,'Peak Season',  '12-20', '12-31', 395, 5);
  `);
}

// ── Availability ─────────────────────────────────────────────────────────────

function isDateRangeAvailable(checkIn, checkOut) {
  const d = getDb();
  // Generate all dates in range (exclusive of check-out)
  const dates = getDatesInRange(checkIn, checkOut);

  // Check blocked_dates
  const blockedCheck = d.prepare(
    `SELECT 1 FROM blocked_dates WHERE date IN (${dates.map(() => '?').join(',')}) LIMIT 1`
  );
  if (blockedCheck.get(...dates)) return false;

  // Check existing confirmed/pending bookings
  const bookingCheck = d.prepare(`
    SELECT 1 FROM bookings
    WHERE status IN ('confirmed','pending')
      AND check_in  < ?
      AND check_out > ?
    LIMIT 1
  `);
  if (bookingCheck.get(checkOut, checkIn)) return false;

  return true;
}

function getBlockedDates(from, to) {
  const d = getDb();
  const blocked = new Set();

  // Explicitly blocked dates
  const rows = d.prepare(
    `SELECT date FROM blocked_dates WHERE date >= ? AND date <= ?`
  ).all(from, to);
  rows.forEach(r => blocked.add(r.date));

  // Dates from existing bookings
  const bookings = d.prepare(`
    SELECT check_in, check_out FROM bookings
    WHERE status IN ('confirmed','pending')
      AND check_out > ? AND check_in < ?
  `).all(from, to);
  bookings.forEach(b => {
    getDatesInRange(b.check_in, b.check_out).forEach(d => blocked.add(d));
  });

  return Array.from(blocked).sort();
}

// ── Bookings ──────────────────────────────────────────────────────────────────

function createBooking(data) {
  const d = getDb();
  const id = uuidv4();
  const reference = generateReference();
  const now = new Date().toISOString();

  d.prepare(`
    INSERT INTO bookings
      (id, reference, guest_name, guest_email, guest_phone, guest_country,
       num_guests, check_in, check_out, nights, total_price, deposit_paid,
       balance_due, cleaning_fee, status, source, stripe_payment_intent_id,
       stripe_payment_status, external_id, notes, created_at, updated_at)
    VALUES
      (@id, @reference, @guest_name, @guest_email, @guest_phone, @guest_country,
       @num_guests, @check_in, @check_out, @nights, @total_price, @deposit_paid,
       @balance_due, @cleaning_fee, @status, @source, @stripe_payment_intent_id,
       @stripe_payment_status, @external_id, @notes, @created_at, @updated_at)
  `).run({
    id,
    reference,
    guest_name: data.guest_name,
    guest_email: data.guest_email,
    guest_phone: data.guest_phone || null,
    guest_country: data.guest_country || null,
    num_guests: data.num_guests,
    check_in: data.check_in,
    check_out: data.check_out,
    nights: data.nights,
    total_price: data.total_price,
    deposit_paid: data.deposit_paid,
    balance_due: data.balance_due,
    cleaning_fee: data.cleaning_fee || 0,
    status: data.status || 'pending',
    source: data.source || 'direct',
    stripe_payment_intent_id: data.stripe_payment_intent_id || null,
    stripe_payment_status: data.stripe_payment_status || null,
    external_id: data.external_id || null,
    notes: data.notes || null,
    created_at: now,
    updated_at: now,
  });

  return getBookingById(id);
}

function getBookingById(id) {
  return getDb().prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);
}

function getBookingByReference(reference) {
  return getDb().prepare(`SELECT * FROM bookings WHERE reference = ?`).get(reference);
}

function getBookingByStripeIntent(intentId) {
  return getDb().prepare(
    `SELECT * FROM bookings WHERE stripe_payment_intent_id = ?`
  ).get(intentId);
}

function updateBookingStatus(id, status, extras = {}) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(`
    UPDATE bookings
    SET status = ?, stripe_payment_status = COALESCE(?, stripe_payment_status),
        updated_at = ?
    WHERE id = ?
  `).run(status, extras.stripe_payment_status || null, now, id);
}

function confirmBooking(id, stripeIntentId) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(`
    UPDATE bookings
    SET status = 'confirmed',
        stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
        stripe_payment_status = 'paid',
        updated_at = ?
    WHERE id = ?
  `).run(stripeIntentId || null, now, id);
}

function getAllBookings({ status, source, from, to } = {}) {
  let sql = `SELECT * FROM bookings WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (source) { sql += ` AND source = ?`; params.push(source); }
  if (from)   { sql += ` AND check_in >= ?`; params.push(from); }
  if (to)     { sql += ` AND check_in <= ?`; params.push(to); }
  sql += ` ORDER BY check_in ASC`;
  return getDb().prepare(sql).all(...params);
}

function updateBooking(id, data) {
  const d = getDb();
  const allowed = ['guest_name','guest_email','guest_phone','guest_country',
                   'num_guests','check_in','check_out','nights','total_price',
                   'deposit_paid','balance_due','cleaning_fee','status','notes'];
  const sets = allowed.filter(k => data[k] !== undefined).map(k => `${k} = @${k}`);
  if (!sets.length) return;
  sets.push(`updated_at = @updated_at`);
  d.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = @id`)
   .run({ ...data, id, updated_at: new Date().toISOString() });
}

function deleteBooking(id) {
  return getDb().prepare(`DELETE FROM bookings WHERE id = ?`).run(id);
}

// ── Blocked dates ────────────────────────────────────────────────────────────

function blockDate(date, reason = 'manual', note = null, source = 'manual') {
  const d = getDb();
  const id = uuidv4();
  d.prepare(`
    INSERT OR REPLACE INTO blocked_dates (id, date, reason, source, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, date, reason, source, note);
}

function blockDateRange(from, to, reason = 'manual', note = null, source = 'manual') {
  const dates = getDatesInRange(from, to);
  const insert = getDb().prepare(
    `INSERT OR REPLACE INTO blocked_dates (id, date, reason, source, note) VALUES (?,?,?,?,?)`
  );
  const insertMany = getDb().transaction((dates) => {
    for (const date of dates) insert.run(uuidv4(), date, reason, source, note);
  });
  insertMany(dates);
}

function unblockDate(date) {
  return getDb().prepare(`DELETE FROM blocked_dates WHERE date = ?`).run(date);
}

function unblockDateRange(from, to) {
  const dates = getDatesInRange(from, to);
  const del = getDb().prepare(`DELETE FROM blocked_dates WHERE date = ?`);
  const delMany = getDb().transaction((dates) => {
    for (const d of dates) del.run(d);
  });
  delMany(dates);
}

function clearChannelBlocks(source) {
  return getDb().prepare(`DELETE FROM blocked_dates WHERE source = ?`).run(source);
}

// ── Pricing ──────────────────────────────────────────────────────────────────

function getPricingSeasons() {
  return getDb().prepare(`SELECT * FROM pricing_seasons ORDER BY id`).all();
}

function calculatePrice(checkIn, checkOut) {
  const seasons = getPricingSeasons();
  const dates = getDatesInRange(checkIn, checkOut); // nights = dates.length
  const cleaningFee = parseFloat(process.env.CLEANING_FEE || '80');
  const depositPct  = parseFloat(process.env.DEPOSIT_PERCENT || '20') / 100;

  let total = 0;
  let minStay = parseInt(process.env.MIN_STAY_NIGHTS || '3');

  for (const date of dates) {
    const [year, month, day] = date.split('-').map(Number);
    const mmdd = `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const season = getSeason(mmdd, seasons);
    total += season ? season.price_per_night : parseFloat(process.env.PRICE_LOW_SEASON || '325');
    if (season && season.min_stay > minStay) minStay = season.min_stay;
  }

  const nights = dates.length;
  const subtotal = total;
  const grandTotal = subtotal + cleaningFee;
  const deposit = Math.round(grandTotal * depositPct * 100) / 100;
  const balance = Math.round((grandTotal - deposit) * 100) / 100;

  return { nights, subtotal, cleaningFee, grandTotal, deposit, balance, minStay };
}

function getSeason(mmdd, seasons) {
  // Handle wrap-around (e.g. 11-01 to 03-31)
  for (const s of seasons) {
    const { start_date: start, end_date: end } = s;
    if (start <= end) {
      if (mmdd >= start && mmdd <= end) return s;
    } else {
      // Wraps year boundary
      if (mmdd >= start || mmdd <= end) return s;
    }
  }
  return seasons[0]; // fallback to first season
}

function updatePricingSeason(id, data) {
  const d = getDb();
  d.prepare(`
    UPDATE pricing_seasons
    SET name = @name, start_date = @start_date, end_date = @end_date,
        price_per_night = @price_per_night, min_stay = @min_stay
    WHERE id = @id
  `).run({ ...data, id });
}

// ── iCal sync log ────────────────────────────────────────────────────────────

function logIcalSync(source, status, message, datesAdded = 0, datesRemoved = 0) {
  const d = getDb();
  d.prepare(`
    INSERT INTO ical_sync_log (id, source, status, message, dates_added, dates_removed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), source, status, message, datesAdded, datesRemoved);
}

function getLastIcalSync(source) {
  return getDb().prepare(
    `SELECT * FROM ical_sync_log WHERE source = ? ORDER BY synced_at DESC LIMIT 1`
  ).get(source);
}

// ── Stats for admin ──────────────────────────────────────────────────────────

function getStats() {
  const d = getDb();
  const now = new Date().toISOString().slice(0, 10);

  const total       = d.prepare(`SELECT COUNT(*) as c FROM bookings WHERE status != 'cancelled'`).get().c;
  const upcoming    = d.prepare(`SELECT COUNT(*) as c FROM bookings WHERE status = 'confirmed' AND check_in >= ?`).get(now).c;
  const revenue     = d.prepare(`SELECT COALESCE(SUM(total_price),0) as s FROM bookings WHERE status = 'confirmed'`).get().s;
  const depositsIn  = d.prepare(`SELECT COALESCE(SUM(deposit_paid),0) as s FROM bookings WHERE status = 'confirmed'`).get().s;
  const outstanding = d.prepare(`SELECT COALESCE(SUM(balance_due),0) as s FROM bookings WHERE status = 'confirmed'`).get().s;

  return { total, upcoming, revenue, depositsIn, outstanding };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDatesInRange(checkIn, checkOut) {
  const dates = [];
  const start = new Date(checkIn);
  const end   = new Date(checkOut);
  const cur   = new Date(start);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function generateReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'VH-';
  for (let i = 0; i < 8; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

module.exports = {
  getDb,
  // Availability
  isDateRangeAvailable,
  getBlockedDates,
  // Bookings
  createBooking,
  getBookingById,
  getBookingByReference,
  getBookingByStripeIntent,
  updateBookingStatus,
  confirmBooking,
  getAllBookings,
  updateBooking,
  deleteBooking,
  // Blocked dates
  blockDate,
  blockDateRange,
  unblockDate,
  unblockDateRange,
  clearChannelBlocks,
  // Pricing
  getPricingSeasons,
  calculatePrice,
  updatePricingSeason,
  // iCal
  logIcalSync,
  getLastIcalSync,
  // Stats
  getStats,
  // Utils
  getDatesInRange,
};
