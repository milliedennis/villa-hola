'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns array of blocked dates in range
router.get('/', (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

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

module.exports = router;
