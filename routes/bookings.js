'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

// POST /api/bookings
// Create a pending booking (before payment)
router.post('/', (req, res) => {
  try {
    const {
      guest_name, guest_email, guest_phone, guest_country,
      num_guests, check_in, check_out
    } = req.body;

    if (!guest_name || !guest_email || !check_in || !check_out || !num_guests) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate dates
    const today = new Date().toISOString().slice(0, 10);
    if (check_in < today) return res.status(400).json({ error: 'Check-in cannot be in the past' });
    if (check_out <= check_in) return res.status(400).json({ error: 'Check-out must be after check-in' });

    // Check availability
    if (!db.isDateRangeAvailable(check_in, check_out)) {
      return res.status(409).json({ error: 'Selected dates are not available' });
    }

    // Calculate pricing
    const pricing = db.calculatePrice(check_in, check_out);

    if (pricing.nights < pricing.minStay) {
      return res.status(400).json({
        error: `Minimum stay is ${pricing.minStay} nights. You selected ${pricing.nights} nights.`
      });
    }

    const booking = db.createBooking({
      guest_name,
      guest_email,
      guest_phone,
      guest_country,
      num_guests: parseInt(num_guests),
      check_in,
      check_out,
      nights: pricing.nights,
      total_price: pricing.grandTotal,
      deposit_paid: pricing.deposit,
      balance_due: pricing.balance,
      cleaning_fee: pricing.cleaningFee,
      status: 'pending',
      source: 'direct',
    });

    res.status(201).json({ booking });
  } catch (err) {
    console.error('Create booking error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/bookings/:reference
// Get booking by reference (public — for confirmation page)
router.get('/ref/:reference', (req, res) => {
  try {
    const booking = db.getBookingByReference(req.params.reference);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    // Return safe subset
    const { id, reference, guest_name, guest_email, num_guests, check_in, check_out,
            nights, total_price, deposit_paid, balance_due, status, created_at } = booking;
    res.json({ booking: { id, reference, guest_name, guest_email, num_guests, check_in,
                          check_out, nights, total_price, deposit_paid, balance_due,
                          status, created_at } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
