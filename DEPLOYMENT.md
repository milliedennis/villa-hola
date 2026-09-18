# Villa Hola — Deployment & Integration Guide

This guide covers everything you need to take Villa Hola from local development to a fully live booking website.

---

## Table of Contents

1. [Quick Start (Local)](#1-quick-start-local)
2. [Deploy to Railway (Recommended)](#2-deploy-to-railway-recommended)
3. [Deploy to Render (Alternative)](#3-deploy-to-render-alternative)
4. [Configure Environment Variables](#4-configure-environment-variables)
5. [Set Up Stripe Payments](#5-set-up-stripe-payments)
6. [Set Up Email Confirmations (Optional)](#6-set-up-email-confirmations-optional)
7. [Connect Airbnb (When Ready)](#7-connect-airbnb-when-ready)
8. [Connect Booking.com (When Ready)](#8-connect-bookingcom-when-ready)
9. [Set Up Automatic iCal Sync](#9-set-up-automatic-ical-sync)
10. [Custom Domain](#10-custom-domain)
11. [Admin Panel](#11-admin-panel)
12. [Going Live Checklist](#12-going-live-checklist)
13. [Architecture Reference](#13-architecture-reference)

---

## 1. Quick Start (Local)

```bash
cd villa-hola
npm install
cp .env.example .env
# Edit .env with your credentials (see Section 4)
npm run setup-db
npm run dev
```

Open: http://localhost:3000
Admin: http://localhost:3000/admin (username/password from .env)

---

## 2. Deploy to Railway (Recommended)

Railway is the recommended host — it's a cloud platform that keeps your Node.js server running 24/7, handles automatic deployments from GitHub, and supports cron jobs for iCal sync. No computer needs to be left on.

### Step-by-step

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial Villa Hola site"
   # Create a new repo on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/villa-hola.git
   git push -u origin main
   ```

2. **Create Railway account** at https://railway.app and connect your GitHub account.

3. **New Project → Deploy from GitHub repo** → select your `villa-hola` repo.

4. **Set environment variables** in Railway dashboard → your service → Variables tab.
   Add every variable from `.env.example` with real values (see Section 4).

5. **Add a volume for the database**
   - In Railway: your service → Settings → Volumes → New Volume
   - Mount path: `/app/database`
   - This ensures the SQLite database persists across deployments.
   - Update `DATABASE_PATH` in your env vars to `/app/database/villa-hola.db`

6. **Set start command**: Railway auto-detects Node.js. Confirm it runs `node server.js`.

7. **Your site is live** at the Railway-generated URL (e.g. `https://villa-hola-production.up.railway.app`).

8. **Set `BASE_URL`** in Railway env vars to your Railway URL (or your custom domain once set).

### Railway Cron for iCal Sync

Once you have Airbnb/Booking.com iCal URLs configured:

1. In Railway: New Service → Cron Job
2. Command: `curl -X POST https://YOUR-RAILWAY-URL.up.railway.app/api/ical/sync -H "Cookie: connect.sid=YOUR_ADMIN_SESSION"`
3. Schedule: `0 */6 * * *` (every 6 hours)

A simpler approach is to use Railway's HTTP-triggered cron via a separate lightweight service, or use a free cron service like cron-job.org to call your sync endpoint.

---

## 3. Deploy to Render (Alternative)

1. Create account at https://render.com
2. New → Web Service → connect your GitHub repo
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Set environment variables in the Environment tab
6. **Important**: Add a Persistent Disk (Render dashboard → your service → Disks) for the SQLite file. Mount at `/opt/render/project/src/database`.
7. Set `DATABASE_PATH=/opt/render/project/src/database/villa-hola.db` in env vars.

---

## 4. Configure Environment Variables

Copy `.env.example` to `.env` and fill in these values:

### Essential (must set before going live)

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Set to `production` on live server | `production` |
| `BASE_URL` | Your full site URL | `https://www.villahola.es` |
| `SESSION_SECRET` | Random string, 32+ chars | Generate at: https://generate-secret.vercel.app/32 |
| `ADMIN_USERNAME` | Admin login username | `millie` |
| `ADMIN_PASSWORD` | Admin login password (strong!) | `something-very-secure-123!` |

### Stripe (needed for online payments)

| Variable | Description | Where to find |
|----------|-------------|---------------|
| `STRIPE_SECRET_KEY` | Server-side secret key | Stripe Dashboard → Developers → API Keys |
| `STRIPE_PUBLISHABLE_KEY` | Client-side publishable key | Same page |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | Stripe Dashboard → Webhooks |

### Pricing

| Variable | Default | Description |
|----------|---------|-------------|
| `PRICE_LOW_SEASON` | 120 | Price per night (€) in low season |
| `PRICE_MID_SEASON` | 160 | Price per night (€) in mid season |
| `PRICE_HIGH_SEASON` | 220 | Price per night (€) in high season |
| `MIN_STAY_NIGHTS` | 3 | Minimum nights per booking |
| `CLEANING_FEE` | 80 | One-off cleaning fee (€) |
| `DEPOSIT_PERCENT` | 10 | Deposit as % of total (e.g. 10 = 10%) |

### WhatsApp

| Variable | Example |
|----------|---------|
| `WHATSAPP_NUMBER` | `+34600123456` (full international format, no spaces) |

---

## 5. Set Up Stripe Payments

### Create your Stripe account

1. Go to https://stripe.com and create a business account.
2. Complete identity verification (required to receive payouts).
3. Add your bank account details for payouts.

### Get your API keys

1. In Stripe Dashboard → Developers → API Keys
2. Copy **Publishable key** → `STRIPE_PUBLISHABLE_KEY`
3. Copy **Secret key** → `STRIPE_SECRET_KEY`
4. Start with **test mode** keys (they start with `pk_test_` and `sk_test_`). Switch to live keys when ready to accept real payments.

### Set up the Stripe Webhook

Webhooks ensure bookings are confirmed even if the user closes the browser after paying.

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://www.villahola.es/api/payments/webhook`
3. Events to listen for: `payment_intent.succeeded`
4. After creating: copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### Test payments

Use Stripe's test card numbers:
- **Success**: 4242 4242 4242 4242 (any future expiry, any CVC)
- **Declined**: 4000 0000 0000 9995
- **3D Secure**: 4000 0025 0000 3155

### Switch to live

1. In Stripe Dashboard, toggle from "Test mode" to "Live mode"
2. Copy the **live** API keys (start with `pk_live_` and `sk_live_`)
3. Update `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in your server's env vars
4. Create a **new webhook** in live mode pointing to the same URL

---

## 6. Set Up Email Confirmations (Optional)

Email confirmations are sent to guests when their booking is confirmed. If SMTP is not configured, the booking still works — guests just don't receive an email.

### Using Gmail (simplest)

1. Enable 2-factor authentication on your Gmail account
2. Go to Google Account → Security → App passwords
3. Generate an app password for "Mail"
4. Set in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=bookings@villahola.es
   SMTP_PASS=your-app-password
   EMAIL_FROM="Villa Hola <bookings@villahola.es>"
   ```

### Using a dedicated email service (recommended for production)

Services like **Resend** (https://resend.com), **SendGrid**, or **Mailgun** are more reliable and won't get flagged as spam:

1. Sign up and verify your domain
2. Get SMTP credentials from their dashboard
3. Update the `SMTP_*` variables accordingly

---

## 7. Connect Airbnb (When Ready)

When your Airbnb listing is live:

### Step 1: Export our calendar to Airbnb
1. Copy your Villa Hola iCal export URL: `https://www.villahola.es/ical/export.ics`
2. In Airbnb: Listing → Calendar → Availability → Import/Export Calendar → Import
3. Paste the URL. Airbnb will subscribe and block dates automatically.

### Step 2: Import Airbnb's calendar into Villa Hola
1. In Airbnb: Listing → Calendar → Availability → Import/Export Calendar → Export
2. Copy the `.ics` URL Airbnb gives you
3. Add to your server env vars: `AIRBNB_ICAL_URL=https://www.airbnb.com/calendar/ical/...`
4. Restart your server
5. In the Admin Panel → Channel Sync → click "Sync Now" to test

### Step 3: Set up automatic sync
See Section 9 for automatic sync setup.

---

## 8. Connect Booking.com (When Ready)

When your Booking.com property is live:

### Step 1: Export our calendar to Booking.com
1. Copy: `https://www.villahola.es/ical/export.ics`
2. In Booking.com Extranet: Calendar → Sync → Add a calendar → Import
3. Paste the URL

### Step 2: Import Booking.com's calendar
1. In Booking.com Extranet: Calendar → Sync → Export calendar
2. Copy the `.ics` URL
3. Add to env vars: `BOOKINGCOM_ICAL_URL=https://admin.booking.com/hotel/hoteladmin/ical.html?...`
4. Restart your server

### Step 3: Set up automatic sync
See Section 9.

---

## 9. Set Up Automatic iCal Sync

Once Airbnb and/or Booking.com iCal URLs are configured in your env vars, you need to trigger `/api/ical/sync` regularly to pull in their bookings.

### Option A: cron-job.org (Free, easiest)

This free service calls a URL on a schedule — no extra server needed.

1. Sign up at https://cron-job.org
2. Create a new cron job:
   - URL: `https://www.villahola.es/api/ical/sync`
   - Method: POST
   - Schedule: Every 6 hours (or every hour for near-real-time)
   - **Authentication problem**: The sync endpoint requires admin login. You have two options:
     - Add a secret token check (see note below)
     - Use Railway's built-in cron (Option B) which can use your admin session cookie

### Option B: Railway Cron Job

Railway lets you run commands on a schedule within your deployment environment. Create a simple sync script:

```javascript
// scripts/sync-ical.js
const fetch = require('node-fetch');
fetch(process.env.BASE_URL + '/api/ical/sync', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.SYNC_SECRET,
    'Content-Type': 'application/json',
  },
});
```

Add to package.json: `"sync": "node scripts/sync-ical.js"`
Set up in Railway as a cron service running `npm run sync` on schedule `0 */6 * * *`.

### Option C: Add a Secret Token to the Sync Endpoint

For maximum simplicity, you can modify the sync route to also accept a secret token (instead of requiring admin session):

In `routes/ical.js`, update the `/sync` route handler:
```javascript
router.post('/sync', (req, res, next) => {
  const token = req.headers['x-sync-token'];
  if (token && token === process.env.SYNC_SECRET) return next();
  requireAdmin(req, res, next);
}, async (req, res) => { /* existing sync handler */ });
```

Then set `SYNC_SECRET=some-random-string` in your env vars, and call:
```
POST https://www.villahola.es/api/ical/sync
X-Sync-Token: some-random-string
```

This works with any HTTP cron service.

---

## 10. Custom Domain

### On Railway

1. Railway → your service → Settings → Networking → Custom Domain
2. Add your domain: `www.villahola.es`
3. Railway shows you the DNS records to add
4. In your domain registrar (GoDaddy, Namecheap, etc.): add the CNAME record
5. SSL is automatic (Let's Encrypt)

### On Render

1. Render Dashboard → your service → Settings → Custom Domains → Add Custom Domain
2. Follow the DNS instructions shown
3. SSL is automatic

### After adding a domain

Update these env vars on your server:
- `BASE_URL=https://www.villahola.es`
- `NODE_ENV=production`
- `cookie.secure` is already set to `true` in production mode (session cookies are HTTPS-only)

---

## 11. Admin Panel

Access at: `https://www.villahola.es/admin`

Default credentials (set in `.env`):
- Username: `admin` (change to something personal)
- Password: `VillaHola2024!` (change before going live!)

### What you can do in the admin panel

**Dashboard**: See total bookings, upcoming stays, revenue, and outstanding balances at a glance.

**All Bookings**: View, edit, and manage every booking. Filter by status or source. Edit guest details, update payment status, add notes, or cancel bookings.

**New Booking**: Manually create a booking for guests who paid by bank transfer or other means. The price is calculated automatically based on your pricing seasons, or you can override it.

**Block Dates**: Block specific dates or date ranges to prevent bookings — useful for owner stays, maintenance, or holding dates.

**Channel Sync**: Trigger an immediate iCal sync from Airbnb or Booking.com. Shows configuration status and last sync time. Also shows your export iCal URL to share with the channels.

**Pricing Seasons**: Edit your nightly rates for low, mid, and high season. Changes take effect for new bookings immediately.

---

## 12. Going Live Checklist

Before you launch and start sending traffic to your site:

### Essential
- [ ] Site deployed to Railway or Render (not running locally)
- [ ] Custom domain configured with SSL
- [ ] All `.env` variables set (no placeholder values remaining)
- [ ] `NODE_ENV=production` set
- [ ] Admin password changed from the default
- [ ] `SESSION_SECRET` set to a strong random string

### Payments
- [ ] Stripe account verified with bank details added
- [ ] Stripe **live** API keys configured (not test keys)
- [ ] Stripe webhook configured pointing to your live domain
- [ ] Test a real payment end-to-end (make a test booking and pay)

### Content
- [ ] Real photographs uploaded (replace placeholder images in `public/images/`)
- [ ] Google Maps embed code added (replace placeholder in index.html — search for `<!-- MAP PLACEHOLDER -->`)
- [ ] WhatsApp number verified and correct
- [ ] Villa description, facilities, and features reviewed and accurate
- [ ] Pricing correct for all seasons

### Bookings
- [ ] Admin panel tested (login, create booking, block dates)
- [ ] Booking flow tested end-to-end (from homepage to confirmation page)
- [ ] Confirmation email received (if SMTP configured)

### Legal (consult a professional)
- [ ] Privacy Policy page created and linked in footer
- [ ] Terms & Conditions / Booking Terms created and linked
- [ ] Cookie consent banner if needed (for EU visitors)

---

## 13. Architecture Reference

```
Guest Visitor
     │
     ▼
Villa Hola Website (www.villahola.es)
├── index.html — public booking page
├── confirmation.html — post-payment page
└── /admin — owner dashboard
     │
     ▼
Node.js + Express Server (Railway/Render cloud)
├── /api/availability — check dates, calculate price
├── /api/bookings — create/confirm bookings
├── /api/payments — Stripe integration
├── /ical/export.ics — our calendar feed (outbound)
└── /api/ical/sync — pull from Airbnb/Booking.com (inbound)
     │
     ▼
SQLite Database (persistent volume on Railway/Render)
├── bookings
├── blocked_dates
├── pricing_seasons
└── ical_sync_log
```

### Calendar sync architecture (once Airbnb/Booking.com accounts exist)

```
Airbnb                    Villa Hola Server           Booking.com
   │                           │                           │
   │◄── subscribes to ─────────┤ /ical/export.ics          │
   │                           │◄── subscribes to ─────────┤ (same URL)
   │                           │                           │
   │ provides iCal URL ────────►│ AIRBNB_ICAL_URL          │
   │                           │◄─────────────────────────│ provides iCal URL
   │                           │ BOOKINGCOM_ICAL_URL       │
   │                           │                           │
   │              cron (every 6 hrs):                      │
   │              POST /api/ical/sync                      │
   │              fetches Airbnb iCal ────────────────────►│
   │◄────────────── fetches Booking.com iCal               │
   │                           │                           │
   │              blocks dates in DB                       │
   │              from both sources                        │
```

No computer needs to be left running. Everything operates through the cloud server and HTTP-based calendar synchronisation (iCal is a standard widely supported by Airbnb, Booking.com, and virtually every calendar management tool).

---

## Support & Next Steps

### Adding real photos
Replace the placeholder gallery items in `public/index.html`:
```html
<!-- Find this pattern and replace with real images: -->
<div class="gallery-item">
  <img src="/images/your-photo.jpg" alt="Villa Hola pool" loading="lazy">
</div>
```
Upload your photos to `public/images/` and reference them by filename.

### Adding a Google Maps embed
In `public/index.html`, find the comment `<!-- MAP PLACEHOLDER -->` and replace with:
```html
<iframe
  src="https://www.google.com/maps/embed?pb=!1m18!...YOUR_EMBED_CODE..."
  width="100%" height="100%" style="border:0"
  allowfullscreen loading="lazy">
</iframe>
```
Get your embed code from Google Maps → Share → Embed a map.

### Channel manager (for high volume)
Once you're listing on multiple channels and managing many bookings, a dedicated channel manager like **Lodgify**, **Hostaway**, or **Smoobu** can automate the two-way sync more reliably than manual iCal. They connect to Airbnb and Booking.com directly via API (not just iCal) and can push rates and availability in real time.

The Villa Hola booking system is built to be compatible — export your iCal to the channel manager and import theirs.

### Migrating from SQLite to PostgreSQL
For high traffic or multi-server deployments, you can migrate to PostgreSQL. The database layer in `database/db.js` uses better-sqlite3 syntax, but the schema and queries are standard SQL. Railway and Render both offer managed PostgreSQL databases.
