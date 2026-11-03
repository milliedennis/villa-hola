'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { sendConfirmationEmail, sendOwnerCalendarAlert } = require('./email');

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

    // Send confirmation email + owner calendar alert if configured
    const confirmed = db.getBookingById(booking.id);
    try { await sendConfirmationEmail(confirmed); } catch (_) {}
    try { await sendOwnerCalendarAlert(confirmed); } catch (_) {}

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

// POST /api/payments/balance-link
// Create a Stripe Checkout Session for the remaining balance and return the URL
router.post('/balance-link', async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

    const booking = db.getBookingById(booking_id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.balance_due <= 0) return res.status(400).json({ error: 'No balance outstanding for this booking' });

    const s = getStripe();
    if (!s) return res.status(503).json({ error: 'Stripe not configured' });

    const origin = process.env.SITE_URL || 'https://villahola.es';

    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer_email: booking.guest_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Villa Hola — Remaining Balance',
            description: `Booking ${booking.reference} · Check-in ${booking.check_in} to ${booking.check_out}`,
          },
          unit_amount: Math.round(booking.balance_due * 100),
        },
        quantity: 1,
      }],
      metadata: {
        booking_id: booking.id,
        reference:  booking.reference,
        payment_type: 'balance',
      },
      success_url: `${origin}/?balance_paid=1&ref=${booking.reference}`,
      cancel_url:  `${origin}/`,
    });

    res.json({ url: session.url, session_id: session.id, amount: booking.balance_due });
  } catch (err) {
    console.error('Balance link error:', err);
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
      const wbooking = db.getBookingById(booking.id);
      try { await sendConfirmationEmail(wbooking); } catch (_) {}
      try { await sendOwnerCalendarAlert(wbooking); } catch (_) {}
    }
  }

  // Balance paid via Checkout Session (sent from admin)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.metadata?.payment_type === 'balance' && session.metadata?.booking_id) {
      const booking = db.getBookingById(session.metadata.booking_id);
      if (booking) {
        db.updateBooking(booking.id, {
          balance_due: 0,
          notes: (booking.notes ? booking.notes + '\n' : '') + `Balance paid via Stripe on ${new Date().toISOString().slice(0,10)}`,
        });
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
