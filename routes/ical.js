'use strict';
/**
 * iCal Integration Routes
 *
 * EXPORT: Our calendar available for Airbnb/Booking.com to subscribe to.
 *         URL: GET /ical/export.ics
 *
 * IMPORT: When Airbnb and Booking.com accounts are created, configure
 *         AIRBNB_ICAL_URL and BOOKINGCOM_ICAL_URL in .env and call
 *         POST /api/ical/sync to pull their calendars in.
 *         In production, trigger this via a cron job or Railway/Render scheduler.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { requireAdmin } = require('../middleware/adminAuth');

// ── Export our calendar as iCal ──────────────────────────────────────────────

router.get('/export.ics', (req, res) => {
  try {
    const IcalGenerator = require('ical-generator').default || require('ical-generator');
    const cal = IcalGenerator({ name: 'Villa Hola — Playa Blanca, Lanzarote' });

    const bookings = db.getAllBookings({ status: 'confirmed' });
    for (const b of bookings) {
      // ── Booking block event ──────────────────────────────────────
      // Span check_in through check_out as an all-day multi-day event
      const ciDate = new Date(b.check_in  + 'T00:00:00');
      const coDate = new Date(b.check_out + 'T00:00:00');
      cal.createEvent({
        start:   ciDate,
        end:     coDate,
        allDay:  true,
        summary: `BOOKED — ${b.guest_name} (${b.reference})`,
        description: `Villa Hola · ${b.reference}\nGuest: ${b.guest_name}\nEmail: ${b.guest_email}\nPhone: ${b.guest_phone || '—'}\nNationality: ${b.guest_country || '—'}\nGuests: ${b.num_guests}\nTotal: €${b.total_price.toFixed(2)}\nDeposit paid: €${b.deposit_paid.toFixed(2)}\nBalance due: €${b.balance_due.toFixed(2)}`,
      });

      // ── Balance reminder — all-day event 30 days before check-in ─
      if (b.balance_due > 0) {
        const checkIn    = new Date(b.check_in + 'T12:00:00');
        const reminderD  = new Date(checkIn);
        reminderD.setDate(reminderD.getDate() - 30);
        const nextDay    = new Date(reminderD);
        nextDay.setDate(nextDay.getDate() + 1);

        const balancePct = Math.round((b.balance_due / b.total_price) * 100);

        cal.createEvent({
          start:    reminderD,
          end:      nextDay,
          allDay:   true,
          summary:  `💰 Collect balance — ${b.guest_name} — €${b.balance_due.toFixed(2)}`,
          description: `Balance collection reminder for ${b.reference}\n\nGuest: ${b.guest_name}\nEmail: ${b.guest_email}\nPhone: ${b.guest_phone || '—'}\n\nAmount due: €${b.balance_due.toFixed(2)} (${balancePct}% of €${b.total_price.toFixed(2)})\nCheck-in: ${b.check_in}\nCheck-out: ${b.check_out}\n\nPayment due 30 days before arrival. Accept bank transfer, card or cash.`,
          alarms: [{ type: 'display', trigger: -7 * 24 * 60 * 60 }], // 7-day alert
        });
      }
    }

    // Add manually blocked dates as single-day events
    const oneYearAgo   = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAhead = new Date(); oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 2);
    const blocked = db.getBlockedDates(
      oneYearAgo.toISOString().slice(0,10),
      oneYearAhead.toISOString().slice(0,10)
    );
    blocked.forEach(date => {
      cal.createEvent({
        start: new Date(date + 'T00:00:00'),
        end:   new Date(date + 'T23:59:59'),
        summary: 'BLOCKED',
      });
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="villa-hola.ics"');
    res.send(cal.toString());
  } catch (err) {
    console.error('iCal export error:', err);
    res.status(500).send('Error generating calendar');
  }
});

// ── Import from Airbnb / Booking.com (requires admin, triggered by cron) ─────

router.post('/sync', requireAdmin, async (req, res) => {
  const results = {};

  const channels = [
    { key: 'airbnb',     envVar: 'AIRBNB_ICAL_URL' },
    { key: 'bookingcom', envVar: 'BOOKINGCOM_ICAL_URL' },
    { key: 'lodgify',    envVar: 'LODGIFY_ICAL_URL' },
    { key: 'optima',     envVar: 'OPTIMA_ICAL_URL' },
  ];

  for (const { key, envVar } of channels) {
    const url = process.env[envVar];

    if (!url) {
      results[key] = {
        status: 'skipped',
        message: `${envVar} not configured — add it to your Railway environment variables.`,
      };
      continue;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();

      const events = parseIcal(text);
      let datesAdded = 0;

      db.clearChannelBlocks(key);

      const isPrepTime = s => /prep.?time|housekeeping|cleaning|maintenance/i.test(s || '');
      for (const event of events) {
        if (event.start && event.end && !isPrepTime(event.summary)) {
          const dates = db.getDatesInRange(event.start, event.end);
          for (const d of dates) {
            db.blockDate(d, key, event.summary || null, key);
            datesAdded++;
          }
        }
      }

      db.logIcalSync(key, 'success', `Synced ${events.length} events`, datesAdded, 0);
      results[key] = { status: 'success', events: events.length, datesAdded };
    } catch (err) {
      db.logIcalSync(key, 'error', err.message);
      results[key] = { status: 'error', message: err.message };
    }
  }

  res.json({ results });
});

// GET /api/ical/sync-status
router.get('/sync-status', requireAdmin, (req, res) => {
  res.json({
    airbnb:     { configured: !!process.env.AIRBNB_ICAL_URL,     lastSync: db.getLastIcalSync('airbnb') },
    bookingcom: { configured: !!process.env.BOOKINGCOM_ICAL_URL,  lastSync: db.getLastIcalSync('bookingcom') },
    lodgify:    { configured: !!process.env.LODGIFY_ICAL_URL,     lastSync: db.getLastIcalSync('lodgify') },
    optima:     { configured: !!process.env.OPTIMA_ICAL_URL,      lastSync: db.getLastIcalSync('optima') },
  });
});

// ── Lodgify sync (called automatically on each availability check) ────────────

let lodgifyLastSynced = 0;
let lodgifyEventsCache = []; // in-memory event range cache {summary, start, end}
const LODGIFY_TTL_MS  = 15 * 60 * 1000; // re-fetch at most every 15 minutes

async function syncLodgify() {
  const url = process.env.LODGIFY_ICAL_URL;
  if (!url) return;
  if (Date.now() - lodgifyLastSynced < LODGIFY_TTL_MS) return; // still fresh

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const events = parseIcal(text);

    db.clearChannelBlocks('lodgify');

    // Skip Lodgify housekeeping/prep events — only block real guest bookings
    const isPrepTime = s => /prep.?time|housekeeping|cleaning|maintenance|block/i.test(s || '');

    for (const event of events) {
      if (event.start && event.end && !isPrepTime(event.summary)) {
        const dates = db.getDatesInRange(event.start, event.end);
        for (const d of dates) {
          db.blockDate(d, 'lodgify', event.summary || 'Lodgify booking', 'lodgify');
        }
      }
    }

    lodgifyEventsCache = events.filter(e => !isPrepTime(e.summary)); // only real bookings cached
    lodgifyLastSynced = Date.now();
    console.log(`[iCal] Lodgify sync: ${events.length} events imported`);
  } catch (err) {
    console.error('[iCal] Lodgify sync error:', err.message);
  }
}

// ── Simple iCal parser ────────────────────────────────────────────────────────

function parseIcal(text) {
  const events = [];
  const lines  = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let current  = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const [key, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    const baseKey = key.split(';')[0];

    if (baseKey === 'DTSTART') current.start = parseIcalDate(val);
    if (baseKey === 'DTEND')   current.end   = parseIcalDate(val);
    if (baseKey === 'SUMMARY') current.summary = val;
    if (baseKey === 'UID')     current.uid = val;
  }
  return events.filter(e => e.start && e.end);
}

function parseIcalDate(val) {
  // DATE-TIME: 20240615T140000Z  or  DATE: 20240615
  const clean = val.replace(/Z$/, '').replace(/T.*/, '');
  if (clean.length === 8) {
    return `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`;
  }
  return null;
}

function getLodgifyEvents() { return lodgifyEventsCache; }

module.exports = router;
module.exports.syncLodgify = syncLodgify;
module.exports.getLodgifyEvents = getLodgifyEvents;
