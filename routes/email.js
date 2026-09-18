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

  const whatsapp = process.env.WHATSAPP_NUMBER || '+34600000000';
  const waLink   = `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`;

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
        </table>
        <div style="background:#FFF3E0;border-left:4px solid #C4622D;padding:16px;margin:24px 0">
          <strong>Remaining Balance (€${booking.balance_due.toFixed(2)})</strong><br>
          The remaining balance will be arranged separately via WhatsApp.
          We will be in touch to confirm the details of your stay.
        </div>
        <p style="text-align:center;margin:32px 0">
          <a href="${waLink}" style="background:#25D366;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">
            💬 Contact Us on WhatsApp
          </a>
        </p>
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

module.exports = { sendConfirmationEmail };
