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
      cal.createEvent({
        start: new Date(b.check_in + 'T14:00:00'),
        end:   new Date(b.check_out + 'T10:00:00'),
        summary: `BLOCKED — ${b.reference}`,
        description: `Villa Hola booking ${b.reference}`,
      });
    }

    // Add manually blocked dates as single-day events
    const oneYearAgo  = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAhead = new Date(); oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 2);
    const blocked = db.getBlockedDates(
      oneYearAgo.toISOString().slice(0,10),
      oneYearAhead.toISOString().slice(0,10)
    );
    // Group consecutive days
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

  for (const source of ['airbnb', 'bookingcom']) {
    const urlEnvKey = source === 'airbnb' ? 'AIRBNB_ICAL_URL' : 'BOOKINGCOM_ICAL_URL';
    const url = process.env[urlEnvKey];

    if (!url) {
      results[source] = {
        status: 'skipped',
        message: `${urlEnvKey} not configured. Add it to .env when your ${source} account is ready.`,
      };
      continue;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();

      // Parse iCal — extract DTSTART/DTEND pairs
      const events = parseIcal(text);
      let datesAdded = 0;

      // Clear old entries from this source
      db.clearChannelBlocks(source);

      for (const event of events) {
        if (event.start && event.end) {
          const dates = db.getDatesInRange(event.start, event.end);
          for (const d of dates) {
            db.blockDate(d, source, event.summary || null, source);
            datesAdded++;
          }
        }
      }

      db.logIcalSync(source, 'success', `Synced ${events.length} events`, datesAdded, 0);
      results[source] = { status: 'success', events: events.length, datesAdded };
    } catch (err) {
      db.logIcalSync(source, 'error', err.message);
      results[source] = { status: 'error', message: err.message };
    }
  }

  res.json({ results });
});

// GET /api/ical/sync-status
router.get('/sync-status', requireAdmin, (req, res) => {
  res.json({
    airbnb: {
      configured: !!process.env.AIRBNB_ICAL_URL,
      lastSync: db.getLastIcalSync('airbnb'),
    },
    bookingcom: {
      configured: !!process.env.BOOKINGCOM_ICAL_URL,
      lastSync: db.getLastIcalSync('bookingcom'),
    },
  });
});

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

module.exports = router;
