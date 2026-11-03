'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { syncLodgify, getLodgifyEvents } = require('./ical');

// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns array of blocked dates in range (also auto-syncs Lodgify iCal)
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

    // Pull latest Lodgify blocks (cached for 15 mins)
    await syncLodgify();

    const blocked = db.getBlockedDates(from, to);
    res.json({ blocked });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/availability/check
// Check if a date range is available and return pricing
router.post('/check', (req, res) => {
  try {
    const { check_in, check_out, num_guests } = req.body;
    if (!check_in || !check_out) {
      return res.status(400).json({ error: 'check_in and check_out are required' });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (check_in < today) return res.status(400).json({ error: 'Check-in cannot be in the past' });
    if (check_out <= check_in) return res.status(400).json({ error: 'Check-out must be after check-in' });

    const pricing = db.calculatePrice(check_in, check_out);

    if (pricing.nights < pricing.minStay) {
      return res.json({
        available: false,
        reason: `minimum_stay`,
        minStay: pricing.minStay,
        nights: pricing.nights,
      });
    }

    const available = db.isDateRangeAvailable(check_in, check_out);
    res.json({ available, pricing });
  } catch (err) {
    console.error('Check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/availability/reservations
// Returns booking ranges with guest names + changeover dates (for calendar labels)
router.get('/reservations', async (req, res) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to   = req.query.to   || new Date(Date.now() + 550 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    await syncLodgify(); // refresh Lodgify cache if stale

    const reservations = [];

    // Confirmed direct bookings
    for (const b of db.getAllBookings({ status: 'confirmed' })) {
      if (b.check_out >= from && b.check_in <= to) {
        reservations.push({ name: b.guest_name, check_in: b.check_in, check_out: b.check_out, source: 'direct' });
      }
    }
    // Pending direct bookings (also block dates)
    for (const b of db.getAllBookings({ status: 'pending' })) {
      if (b.check_out >= from && b.check_in <= to) {
        reservations.push({ name: b.guest_name, check_in: b.check_in, check_out: b.check_out, source: 'pending' });
      }
    }
    // Lodgify events from in-memory cache
    for (const ev of getLodgifyEvents()) {
      if (ev.end >= from && ev.start <= to) {
        reservations.push({ name: ev.summary || 'Lodgify booking', check_in: ev.start, check_out: ev.end, source: 'lodgify' });
      }
    }

    // Build changeover set: dates that are check_out of a booking (departure/arrival day)
    const changeover = [...new Set(reservations.map(r => r.check_out))];

    res.json({ reservations, changeover });
  } catch (err) {
    console.error('Reservations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
