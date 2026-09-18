'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { sendConfirmationEmail } = require('./email');

let stripe;
function getStripe() {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key.startsWith('sk_test_REPLACE')) {
      console.warn('⚠️  Stripe secret key not configured. Payment processing is disabled.');
      return null;
    }
    stripe = require('stripe')(key);
  }
  return stripe;
}

// POST /api/payments/create-intent
// Create a Stripe PaymentIntent for the deposit amount
router.post('/create-intent', async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

    const booking = db.getBookingById(booking_id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'pending') {
      return res.status(400).json({ error: 'Booking is not in pending state' });
    }

    const s = getStripe();
    if (!s) {
      return res.status(503).json({
        error: 'Payment processing not yet configured',
        message: 'Stripe has not been set up. Please contact us directly to arrange your booking.',
        whatsapp: process.env.WHATSAPP_NUMBER,
      });
    }

    const amountCents = Math.round(booking.deposit_paid * 100);
    const intent = await s.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      metadata: {
        booking_id: booking.id,
        reference: booking.reference,
        guest_email: booking.guest_email,
        check_in: booking.check_in,
        check_out: booking.check_out,
      },
      description: `Villa Hola deposit — ${booking.reference} — ${booking.check_in} to ${booking.check_out}`,
      receipt_email: booking.guest_email,
    });

    // Store intent ID on booking
    db.updateBooking(booking.id, { stripe_payment_intent_id: intent.id });

    res.json({
      client_secret: intent.client_secret,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
      amount: booking.deposit_paid,
      currency: 'EUR',
    });
  } catch (err) {
    console.error('Create intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm
// Called by frontend after successful Stripe payment
router.post('/confirm', async (req, res) => {
  try {
    const { payment_intent_id, booking_id } = req.body;

    const booking = db.getBookingById(booking_id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const s = getStripe();
    if (s && payment_intent_id) {
      // Verify with Stripe
      const intent = await s.paymentIntents.retrieve(payment_intent_id);
      if (intent.status !== 'succeeded') {
        return res.status(400).json({ error: 'Payment not confirmed by Stripe' });
      }
    }

    db.confirmBooking(booking.id, payment_intent_id);

    // Send confirmation email if configured
    try { await sendConfirmationEmail(db.getBookingById(booking.id)); } catch (_) {}

    res.json({
      success: true,
      reference: booking.reference,
      booking_id: booking.id,
    });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/webhook
// Raw body required — configured before JSON middleware in server.js
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const s = getStripe();
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!s || !secret || secret.startsWith('whsec_REPLACE')) {
    return res.json({ received: true });
  }

  let event;
  try {
    event = s.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const booking = db.getBookingByStripeIntent(intent.id);
    if (booking && booking.status === 'pending') {
      db.confirmBooking(booking.id, intent.id);
      try { await sendConfirmationEmail(db.getBookingById(booking.id)); } catch (_) {}
    }
  }

  res.json({ received: true });
});

module.exports = router;
