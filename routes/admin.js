'use strict';
const express  = require('express');
const router   = express.Router();
const db       = require('../database/db');
const { requireAdmin, loginAdmin } = require('../middleware/adminAuth');

// ── Auth ─────────────────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session && req.session.adminLoggedIn) return res.redirect('/admin/');
  res.send(loginPageHtml());
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ok = await loginAdmin(username, password);
  if (ok) {
    req.session.adminLoggedIn = true;
    return res.redirect('/admin/');
  }
  res.send(loginPageHtml('Invalid username or password'));
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── All admin API routes require authentication ───────────────────────────────

// GET /admin/api/stats
router.get('/api/stats', requireAdmin, (req, res) => {
  res.json(db.getStats());
});

// GET /admin/api/bookings
router.get('/api/bookings', requireAdmin, (req, res) => {
  const bookings = db.getAllBookings(req.query);
  res.json({ bookings });
});

// GET /admin/api/bookings/:id
router.get('/api/bookings/:id', requireAdmin, (req, res) => {
  const booking = db.getBookingById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  res.json({ booking });
});

// PUT /admin/api/bookings/:id
router.put('/api/bookings/:id', requireAdmin, (req, res) => {
  try {
    db.updateBooking(req.params.id, req.body);
    res.json({ booking: db.getBookingById(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/api/bookings/:id
router.delete('/api/bookings/:id', requireAdmin, (req, res) => {
  db.deleteBooking(req.params.id);
  res.json({ success: true });
});

// POST /admin/api/bookings — manual booking creation
router.post('/api/bookings', requireAdmin, (req, res) => {
  try {
    const {
      guest_name, guest_email, guest_phone, guest_country,
      num_guests, check_in, check_out, source = 'manual',
      notes, override_price
    } = req.body;

    if (!guest_name || !guest_email || !check_in || !check_out || !num_guests) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const pricing = db.calculatePrice(check_in, check_out);
    const totalPrice = override_price ? parseFloat(override_price) : pricing.grandTotal;
    const depositPct = parseFloat(process.env.DEPOSIT_PERCENT || '10') / 100;
    const deposit    = Math.round(totalPrice * depositPct * 100) / 100;
    const balance    = Math.round((totalPrice - deposit) * 100) / 100;

    const booking = db.createBooking({
      guest_name, guest_email, guest_phone, guest_country,
      num_guests: parseInt(num_guests),
      check_in, check_out,
      nights: pricing.nights,
      total_price: totalPrice,
      deposit_paid: deposit,
      balance_due: balance,
      cleaning_fee: pricing.cleaningFee,
      status: req.body.status || 'confirmed',
      source,
      notes,
    });

    res.status(201).json({ booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Blocked dates ─────────────────────────────────────────────────────────────

// GET /admin/api/blocked?from=&to=
router.get('/api/blocked', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  const f = from || new Date().toISOString().slice(0,10);
  const t = to   || new Date(Date.now() + 365*24*3600*1000).toISOString().slice(0,10);
  const d = db.getDb();
  const rows = d.prepare(
    `SELECT * FROM blocked_dates WHERE date >= ? AND date <= ? ORDER BY date`
  ).all(f, t);
  res.json({ blocked: rows });
});

// POST /admin/api/blocked — block a date range
router.post('/api/blocked', requireAdmin, (req, res) => {
  const { from, to, note } = req.body;
  if (!from) return res.status(400).json({ error: 'from is required' });
  const end = to || from;
  db.blockDateRange(from, end, 'manual', note || null, 'manual');
  res.json({ success: true });
});

// DELETE /admin/api/blocked — unblock a date range
router.delete('/api/blocked', requireAdmin, (req, res) => {
  const { from, to } = req.body;
  if (!from) return res.status(400).json({ error: 'from is required' });
  const end = to || from;
  db.unblockDateRange(from, end);
  res.json({ success: true });
});

// ── Pricing ───────────────────────────────────────────────────────────────────

router.get('/api/pricing', requireAdmin, (req, res) => {
  res.json({ seasons: db.getPricingSeasons() });
});

router.put('/api/pricing/:id', requireAdmin, (req, res) => {
  db.updatePricingSeason(req.params.id, req.body);
  res.json({ seasons: db.getPricingSeasons() });
});

// ── Dashboard page ────────────────────────────────────────────────────────────

router.get('/', requireAdmin, (req, res) => {
  res.sendFile('index.html', { root: require('path').join(__dirname, '../public/admin') });
});

router.get('/*', requireAdmin, (req, res) => {
  res.sendFile('index.html', { root: require('path').join(__dirname, '../public/admin') });
});

// ── Login page HTML ───────────────────────────────────────────────────────────

function loginPageHtml(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login — Villa Hola</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,system-ui,sans-serif;background:#F5EFE0;min-height:100vh;
       display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:16px;padding:40px;width:100%;max-width:380px;
        box-shadow:0 4px 32px rgba(0,0,0,0.08)}
  h1{font-size:24px;color:#1C1C1C;margin-bottom:4px}
  .subtitle{color:#888;font-size:14px;margin-bottom:28px}
  label{display:block;font-size:13px;font-weight:600;color:#444;margin-bottom:6px}
  input{width:100%;padding:12px 14px;border:1.5px solid #E5DDD0;border-radius:8px;
        font-size:15px;margin-bottom:16px;outline:none;transition:border .2s}
  input:focus{border-color:#C4622D}
  button{width:100%;background:#C4622D;color:#fff;border:none;padding:14px;
         border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#A8521F}
  .error{background:#FFEBEE;color:#C62828;padding:10px 14px;border-radius:8px;
         font-size:14px;margin-bottom:16px}
  .logo{text-align:center;margin-bottom:24px;color:#C4622D;font-size:32px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🏡</div>
  <h1>Villa Hola Admin</h1>
  <p class="subtitle">Playa Blanca, Lanzarote</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/admin/login">
    <label for="username">Username</label>
    <input type="text" id="username" name="username" required autocomplete="username">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required autocomplete="current-password">
    <button type="submit">Sign In</button>
  </form>
</div>
</body>
</html>`;
}

module.exports = router;
