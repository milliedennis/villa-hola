'use strict';
require('dotenv').config();

const express  = require('express');
const path     = require('path');
const session  = require('express-session');
const cors     = require('cors');

const availabilityRoutes = require('./routes/availability');
const bookingRoutes      = require('./routes/bookings');
const paymentRoutes      = require('./routes/payments');
const adminRoutes        = require('./routes/admin');
const icalRoutes         = require('./routes/ical');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Stripe webhook needs raw body — register BEFORE JSON middleware ────────────
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ── Core middleware ────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.BASE_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Static files ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────────
app.use('/api/availability', availabilityRoutes);
app.use('/api/bookings',     bookingRoutes);
app.use('/api/payments',     paymentRoutes);
app.use('/ical',             icalRoutes);
app.use('/api/ical',         icalRoutes);

// ── Admin routes ───────────────────────────────────────────────────────────────
app.use('/admin', adminRoutes);

// ── Config endpoint (public — only exposes safe values) ───────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    stripePubKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    whatsapp:     process.env.WHATSAPP_NUMBER || '+34600000000',
    depositPct:   parseFloat(process.env.DEPOSIT_PERCENT || '20'),
    cleaningFee:  parseFloat(process.env.CLEANING_FEE || '80'),
    minStay:      parseInt(process.env.MIN_STAY_NIGHTS || '3'),
    currency:     'EUR',
  });
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── SPA fallback (confirmation page, etc.) ─────────────────────────────────────
app.get('/confirmation', (req, res) => {
  res.sendFile('confirmation.html', { root: path.join(__dirname, 'public') });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏡 Villa Hola server running on http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin`);
  console.log(`   iCal export: http://localhost:${PORT}/ical/export.ics\n`);
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_REPLACE')) {
    console.warn('⚠️  Stripe not configured — payment processing is disabled.');
    console.warn('   Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in .env\n');
  }
});

module.exports = app;
