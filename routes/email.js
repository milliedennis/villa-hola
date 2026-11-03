'use strict';
const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  if (!host || !user) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user, pass: process.env.SMTP_PASS },
  });
}

async function sendConfirmationEmail(booking) {
  const t = getTransporter();
  if (!t) return; // Email not configured

  // Calculate balance due date (30 days before check-in)
  const checkIn       = new Date(booking.check_in + 'T12:00:00');
  const balanceDueD   = new Date(checkIn);
  balanceDueD.setDate(balanceDueD.getDate() - 30);
  const balanceDueStr = balanceDueD.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const ownerEmail = process.env.EMAIL_FROM || 'Villa Hola <noreply@villahola.es>';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1C1C1C">
      <div style="background:#C4622D;padding:32px 24px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:28px">Villa Hola</h1>
        <p style="color:rgba(255,255,255,0.85);margin:8px 0 0">Playa Blanca, Lanzarote</p>
      </div>
      <div style="padding:32px 24px">
        <h2 style="color:#C4622D">Booking Confirmed ✓</h2>
        <p>Dear ${booking.guest_name},</p>
        <p>Thank you for your booking! We're delighted to welcome you to Villa Hola.</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0">
          <tr><td style="padding:8px;background:#FFF9F2;font-weight:bold">Booking Reference</td>
              <td style="padding:8px;background:#FFF9F2">${booking.reference}</td></tr>
          <tr><td style="padding:8px">Check-in</td>
              <td style="padding:8px">${booking.check_in}</td></tr>
          <tr><td style="padding:8px;background:#FFF9F2">Check-out</td>
              <td style="padding:8px;background:#FFF9F2">${booking.check_out}</td></tr>
          <tr><td style="padding:8px">Nights</td>
              <td style="padding:8px">${booking.nights}</td></tr>
          <tr><td style="padding:8px;background:#FFF9F2">Guests</td>
              <td style="padding:8px;background:#FFF9F2">${booking.num_guests}</td></tr>
          <tr><td style="padding:8px">Total Price</td>
              <td style="padding:8px">€${booking.total_price.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;background:#FFF9F2">Deposit Paid</td>
              <td style="padding:8px;background:#FFF9F2;color:#2E7D32;font-weight:bold">€${booking.deposit_paid.toFixed(2)} ✓</td></tr>
          <tr><td style="padding:8px">Balance Due</td>
              <td style="padding:8px;font-weight:bold">€${booking.balance_due.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;background:#FFF9F2;color:#C62828;font-weight:bold">Balance Due By</td>
              <td style="padding:8px;background:#FFF9F2;color:#C62828;font-weight:bold">${balanceDueStr}</td></tr>
        </table>
        <div style="background:#FFF3E0;border-left:4px solid #C4622D;padding:16px;margin:24px 0">
          <strong>Remaining Balance — €${booking.balance_due.toFixed(2)} due by ${balanceDueStr}</strong><br><br>
          Your remaining balance will be arranged by email. We will contact you ahead of your stay
          to arrange payment. We accept <strong>bank transfer, card payment or cash</strong>.
        </div>
        <p>If you have any questions in the meantime, please don't hesitate to get in touch by replying to this email.</p>
        <p>We look forward to welcoming you to Lanzarote!</p>
        <p>The Villa Hola Team</p>
      </div>
      <div style="background:#F5EFE0;padding:16px 24px;text-align:center;font-size:12px;color:#666">
        Villa Hola · Las Buganvillas · Playa Blanca · Lanzarote
      </div>
    </div>
  `;

  await t.sendMail({
    from: process.env.EMAIL_FROM || 'Villa Hola <noreply@villahola.com>',
    to: booking.guest_email,
    subject: `Booking Confirmed — ${booking.reference} — Villa Hola, Lanzarote`,
    html,
  });
}

// ── Owner payment reminder — generates .ics and emails to owner ───────────────

function generatePaymentIcs(booking) {
  // Calendar event fires 30 days before check-in (to chase balance payment)
  const checkIn    = new Date(booking.check_in + 'T12:00:00');
  const eventDate  = new Date(checkIn);
  eventDate.setDate(eventDate.getDate() - 30);

  const toIcsDate = d =>
    `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

  const now     = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const uid     = `balance-${booking.reference}@villahola.es`;

  const balancePct = Math.round((booking.balance_due / booking.total_price) * 100);
  const phone      = booking.guest_phone || 'not provided';

  // Escape special chars for iCal
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n');

  const description = esc(
    `BALANCE COLLECTION REMINDER\\n` +
    `────────────────────────────\\n` +
    `Guest:        ${booking.guest_name}\\n` +
    `Email:        ${booking.guest_email}\\n` +
    `Phone:        ${phone}\\n` +
    `\\n` +
    `Amount due:   €${booking.balance_due.toFixed(2)} (${balancePct}% of total €${booking.total_price.toFixed(2)})\\n` +
    `Check-in:     ${booking.check_in}\\n` +
    `Check-out:    ${booking.check_out}\\n` +
    `Ref:          ${booking.reference}\\n` +
    `\\n` +
    `Payment is due 30 days before arrival (${booking.check_in}).\\n` +
    `Collect via bank transfer or WhatsApp.`
  );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Villa Hola//Booking System//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}Z`,
    `DTSTART;VALUE=DATE:${toIcsDate(eventDate)}`,
    `DTEND;VALUE=DATE:${toIcsDate(eventDate)}`,
    `SUMMARY:💰 Collect balance — ${booking.guest_name} — €${booking.balance_due.toFixed(2)}`,
    `DESCRIPTION:${description}`,
    'BEGIN:VALARM',
    'TRIGGER:-P7D',        // alert 7 days before the event (= 37 days before check-in)
    'ACTION:DISPLAY',
    `DESCRIPTION:Balance payment due in 7 days — ${esc(booking.guest_name)} — €${booking.balance_due.toFixed(2)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

async function sendOwnerCalendarAlert(booking) {
  const ownerEmail = process.env.OWNER_EMAIL || 'bookings@villahola.es';
  if (!ownerEmail) return; // safety fallback

  const t = getTransporter();
  if (!t) return;

  const icsContent = generatePaymentIcs(booking);
  const balancePct = Math.round((booking.balance_due / booking.total_price) * 100);

  const checkIn   = new Date(booking.check_in + 'T12:00:00');
  const dueDate   = new Date(checkIn);
  dueDate.setDate(dueDate.getDate() - 30);
  const dueDateStr = dueDate.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1C1C1C">
      <div style="background:#2E7D32;padding:24px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:22px">💰 New Booking — Balance Reminder Set</h1>
      </div>
      <div style="padding:24px">
        <p>A new booking has been confirmed. A calendar event has been attached to this email — <strong>open the attachment to add it to your calendar</strong> with a 7-day alert.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px">
          <tr><td style="padding:8px;background:#F5F5F5;font-weight:bold;width:40%">Guest</td>
              <td style="padding:8px;background:#F5F5F5">${booking.guest_name}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Email</td>
              <td style="padding:8px">${booking.guest_email}</td></tr>
          <tr><td style="padding:8px;background:#F5F5F5;font-weight:bold">Phone</td>
              <td style="padding:8px;background:#F5F5F5">${booking.guest_phone || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Check-in</td>
              <td style="padding:8px">${booking.check_in}</td></tr>
          <tr><td style="padding:8px;background:#F5F5F5;font-weight:bold">Check-out</td>
              <td style="padding:8px;background:#F5F5F5">${booking.check_out}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Total booking</td>
              <td style="padding:8px">€${booking.total_price.toFixed(2)}</td></tr>
          <tr><td style="padding:8px;background:#F5F5F5;font-weight:bold">Deposit paid</td>
              <td style="padding:8px;background:#F5F5F5;color:#2E7D32">€${booking.deposit_paid.toFixed(2)} ✓</td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#C62828">Balance due</td>
              <td style="padding:8px;font-weight:bold;color:#C62828">€${booking.balance_due.toFixed(2)} (${balancePct}%)</td></tr>
          <tr><td style="padding:8px;background:#FFF3E0;font-weight:bold">Payment due date</td>
              <td style="padding:8px;background:#FFF3E0;font-weight:bold">${dueDateStr} (30 days before arrival)</td></tr>
        </table>
        <p style="font-size:13px;color:#666">📎 Open the attached <code>.ics</code> file to add a calendar reminder with a 7-day alert.</p>
      </div>
    </div>
  `;

  await t.sendMail({
    from:    process.env.EMAIL_FROM || 'Villa Hola <noreply@villahola.es>',
    to:      ownerEmail,
    subject: `📅 New booking — balance €${booking.balance_due.toFixed(2)} due ${dueDateStr} — ${booking.guest_name}`,
    html,
    attachments: [{
      filename: `villa-hola-balance-${booking.reference}.ics`,
      content:  icsContent,
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
    }],
  });
}

module.exports = { sendConfirmationEmail, sendOwnerCalendarAlert };
