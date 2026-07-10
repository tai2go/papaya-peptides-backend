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
  const first = order.customer.firstName ? ', ' + order.customer.firstName : '';
  const itemsBox = `<div style="background:#faf9f7;border:1px solid #eee;border-radius:8px;padding:14px 16px;font-size:14px">${items}<br><br><b>Total: $${order.total} CAD</b> · includes tax</div>`;

  if (order.method === 'etransfer') {
    const et = {
      email: process.env.ETRANSFER_EMAIL || 'set ETRANSFER_EMAIL',
      name: process.env.ETRANSFER_NAME || STORE,
      autodeposit: String(process.env.ETRANSFER_AUTODEPOSIT || 'true') === 'true',
      question: process.env.ETRANSFER_QUESTION || '',
      answer: process.env.ETRANSFER_ANSWER || ''
    };
    const row = (k, v) => `<tr><td style="padding:5px 0;color:#6b6b6b;width:150px">${k}</td><td style="padding:5px 0;font-weight:600">${v}</td></tr>`;
    const security = (!et.autodeposit && et.question)
      ? row('Security question', et.question) + row('Answer', et.answer)
      : `<tr><td colspan="2" style="padding:6px 0;color:#6b6b6b">Our account has auto-deposit on — no security question is needed.</td></tr>`;
    const body = `
      <p>Hi${first},</p>
      <p>We've received your order and it's on hold until the payment is confirmed. Here's a reminder of what's in it:</p>
      ${itemsBox}
      <p style="background:#fff7f0;border-left:3px solid #E8731C;padding:11px 14px;border-radius:4px;margin-top:16px">
        <b style="color:#E8731C">Payment required — this order is not yet confirmed.</b><br>
        Please send your Interac e-Transfer <b>within 24 hours</b> so the order isn't automatically cancelled.</p>
      <p style="margin-top:16px"><b>Send your Interac e-Transfer to:</b></p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Send to', et.email)}
        ${row('Recipient name', et.name)}
        ${row('Amount', '$' + order.total + ' CAD')}
        ${row('Message / memo', order.orderNo)}
        ${security}
      </table>
      <p style="margin-top:18px"><b>Please follow these exactly:</b></p>
      <ul style="margin:6px 0 0 18px;padding:0;font-size:14px">
        <li>Confirm the recipient before sending — it must be <b>${et.name}</b>.</li>
        <li>Put <b>only your order number (${order.orderNo})</b> in the message/memo.</li>
        <li>Do not include any product names or other words in the transfer.</li>
        <li>Send the exact total shown above.</li>
      </ul>
      <p style="font-size:12px;color:#777;margin-top:14px">Transfers that don't follow these steps may be delayed. Once the payment is confirmed the order is prepared and ships within 24 hours. Questions? Reply to this email with your order number.</p>`;
    await send(order.customer.email, `Complete your order — payment required · ${order.orderNo}`, wrap(body));
    return;
  }

  await send(order.customer.email, `Order received — ${order.orderNo}`, wrap(
    `<p>Thanks${first}. We've received your order <b>${order.orderNo}</b>.</p>
     ${itemsBox}
     <p style="margin-top:14px">Complete your crypto payment using the secure checkout link. Once the payment confirms, the order is prepared and ships within 24 hours.</p>`));
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
