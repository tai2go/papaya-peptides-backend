// email.js — optional confirmation emails over SMTP (works with Gmail, Zoho, Resend SMTP, etc.).
// If SMTP isn't configured, emails are skipped (logged) — the store still works fine.
import nodemailer from 'nodemailer';

let transport = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

const FROM = process.env.MAIL_FROM || 'Papaya Peptides <orders@papayapeps.com>';
const STORE = process.env.STORE_NAME || 'Papaya Peptides';

async function send(to, subject, html) {
  if (!transport || !to) { console.log(`[email skipped] ${subject} -> ${to || 'no-address'}`); return; }
  try { await transport.sendMail({ from: FROM, to, subject, html }); }
  catch (e) { console.error('[email error]', e.message); }
}

const wrap = (body) => `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#111">
  <h2 style="letter-spacing:2px;text-transform:uppercase;font-weight:600">${STORE}</h2>${body}
  <p style="font-size:11px;color:#888;margin-top:24px">Research Use Only. Not for human or animal consumption.</p></div>`;

export async function emailOrderReceived(order) {
  const items = order.items.map(i => `${i.qty} × ${i.name} (${i.vial}) — $${i.lineTotal}`).join('<br>');
  const pay = order.method === 'etransfer'
    ? `<p>You'll shortly receive an <b>Interac e-Transfer request</b> for <b>$${order.total} CAD</b> (this includes tax) sent to this email address. Just open your banking app and <b>approve the request</b> — your order number <b>${order.orderNo}</b> is included as the reference. Your order ships once the payment clears.</p>`
    : `<p>Complete your crypto payment using the checkout link. Your order ships once payment confirms.</p>`;
  await send(order.customer.email, `Order received — ${order.orderNo}`, wrap(
    `<p>Thanks${order.customer.firstName ? ', ' + order.customer.firstName : ''}. We received your order <b>${order.orderNo}</b>.</p>
     <p>${items}<br><br>Total: <b>$${order.total} CAD</b> · ${order.method === 'etransfer' ? 'Interac e-Transfer' : 'Crypto'}</p>${pay}`));
}

export async function emailPaid(order) {
  await send(order.customer.email, `Payment confirmed — ${order.orderNo}`, wrap(
    `<p>We've confirmed payment for <b>${order.orderNo}</b>. It's now being prepared and you'll get tracking once it ships.</p>
     <p>Track anytime with your order number on the Track Your Package page.</p>`));
}

// Generic transport for the reorder-lifecycle engine (lifecycle.js).
export async function sendLifecycle(to, subject, html) {
  await send(to, subject, wrap(html));
}

export async function emailShipped(order) {
  const t = order.tracking || {};
  await send(order.customer.email, `Your order shipped — ${order.orderNo}`, wrap(
    `<p>Good news — <b>${order.orderNo}</b> is on its way.</p>
     <p>Carrier: <b>${t.carrier || '—'}</b><br>Tracking: <b>${t.number || '—'}</b></p>`));
}
