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

const IMG_BASE = process.env.PUBLIC_URL || 'https://papayapeps.com';

// A line-item block with a product thumbnail, name, quantity and line total.
function itemsTable(order) {
  const rows = order.items.map(i => `
    <tr>
      <td style="padding:10px 0;width:64px;vertical-align:middle">
        <img src="${IMG_BASE}/product-img/${i.id}.jpg" width="52" height="52" alt="${i.name}"
             style="width:52px;height:52px;border-radius:8px;border:1px solid #eee;background:#faf9f7;object-fit:cover;display:block">
      </td>
      <td style="padding:10px 12px;vertical-align:middle;font-size:14px">
        <b>${i.name}</b><br>
        <span style="color:#8a8a8a;font-size:12px">${i.vial} · Qty ${i.qty}</span>
      </td>
      <td style="padding:10px 0;vertical-align:middle;text-align:right;font-size:14px;font-weight:600;white-space:nowrap">$${i.lineTotal}</td>
    </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;background:#faf9f7;border:1px solid #eee;border-radius:8px">
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" style="border-top:1px solid #eee;padding:12px;text-align:right;font-size:14px">
        <b>Total: $${order.total} CAD</b> <span style="color:#8a8a8a">· includes tax</span>
      </td></tr></tfoot>
    </table>`;
}

export async function emailOrderReceived(order) {
  const first = order.customer.firstName ? ', ' + order.customer.firstName : '';
  const itemsBox = itemsTable(order);

  if (order.method === 'etransfer') {
    const body = `
      <p>Hi${first},</p>
      <p>Thanks for your order. Here's what you ordered:</p>
      ${itemsBox}
      <p style="background:#fff7f0;border-left:3px solid #E8731C;padding:12px 14px;border-radius:4px;margin-top:18px">
        <b style="color:#E8731C">We've sent you an Interac e-Transfer request for $${order.total} CAD.</b><br>
        Look for a separate email or text from Interac (or your own bank) requesting the payment — it's on its way to <b>${order.customer.email}</b>.</p>
      <p style="margin-top:16px"><b>To pay, all you have to do is:</b></p>
      <ol style="margin:6px 0 0 18px;padding:0;font-size:14px;line-height:1.7">
        <li>Open the <b>Interac e-Transfer request</b> in your inbox or text messages.</li>
        <li>Tap <b>Accept / Deposit the request</b>.</li>
        <li>Choose your bank and sign in — the payment links to your bank and completes automatically.</li>
      </ol>
      <p style="font-size:13px;color:#555;margin-top:14px">The request is for <b>$${order.total} CAD</b> with your order number <b>${order.orderNo}</b> as the reference. No security question — accepting the request through your bank is all that's needed.</p>
      <p style="font-size:12px;color:#777;margin-top:14px">Once the request is accepted and the payment clears, your order is prepared and ships within 24 hours. If you don't see the request within a few minutes, check your spam folder or reply to this email with your order number.</p>`;
    await send(order.customer.email, `Your payment request is on its way — ${order.orderNo}`, wrap(body));
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
