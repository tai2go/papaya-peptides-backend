// email.js — optional confirmation emails over SMTP (works with Gmail, Zoho, Resend SMTP, etc.).
// If SMTP isn't configured, emails are skipped (logged) — the store still works fine.
// Styling mirrors the storefront: white canvas, letter-spaced uppercase wordmark, hairline
// rules, muted greys, and the papaya accent used sparingly — so the emails feel seamless
// with papayapeps.com.
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
const IMG_BASE = process.env.PUBLIC_URL || 'https://papayapeps.com';
const PAPAYA = '#E8731C';
const INK = '#000000';
const MUTED = '#767676';
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

async function send(to, subject, html) {
  if (!transport || !to) { console.log(`[email skipped] ${subject} -> ${to || 'no-address'}`); return; }
  try { await transport.sendMail({ from: FROM, to, subject, html }); }
  catch (e) { console.error('[email error]', e.message); }
}

// The shared shell: announcement strip + wordmark + hairline + content + RUO footer.
const wrap = (body) => `<div style="margin:0;padding:0;background:#ffffff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
    <tr><td align="center" style="background:#f4f4f4;padding:9px 16px;font-family:${FONT};font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:${INK}">
      Research Use Only · Not for Human Consumption · Free Shipping Over $150
    </td></tr>
    <tr><td align="center" style="padding:40px 24px 56px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:544px;font-family:${FONT};color:${INK};letter-spacing:.2px">
        <tr><td align="center" style="padding-bottom:22px;border-bottom:1px solid ${INK}">
          <div style="font-size:19px;text-transform:uppercase;letter-spacing:3px;font-weight:500">${STORE}</div>
        </td></tr>
        <tr><td style="padding-top:30px;font-size:13px;line-height:1.7;color:${INK}">${body}</td></tr>
        <tr><td style="padding-top:40px">
          <div style="border-top:1px solid #e5e5e5;padding-top:18px;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:${MUTED};line-height:1.9">
            ${STORE} · Shipped within Canada<br>
            Research Use Only. Not for human or animal consumption.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

// Small uppercase section label, matching the storefront's filter/section headings.
const label = (t) => `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:400;color:${INK};margin:30px 0 14px">${t}</div>`;

// Numbered steps rendered as a clean editorial list (01 / 02 / 03).
function steps(list) {
  const rows = list.map((s, idx) => `
    <tr>
      <td style="width:30px;vertical-align:top;padding:7px 0;font-size:11px;letter-spacing:.5px;color:${MUTED}">${String(idx + 1).padStart(2, '0')}</td>
      <td style="vertical-align:top;padding:7px 0;font-size:13px;line-height:1.6;color:${INK}">${s}</td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

// A framed accent block (papaya for "action needed", ink for "confirmed").
function accent(color, kicker, text) {
  return `<div style="border-top:1px solid ${color};border-bottom:1px solid ${color};padding:16px 0;margin:28px 0">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.9px;font-weight:600;color:${color}">${kicker}</div>
      <div style="font-size:13px;line-height:1.6;color:${INK};margin-top:8px">${text}</div>
    </div>`;
}

// Order line-items: product thumbnail, uppercase name, vial · qty, line total — framed by
// hairline rules the same way the storefront frames its product rows.
function itemsTable(order) {
  const rows = order.items.map((i, idx) => {
    const bt = idx > 0 ? `border-top:1px solid #ececec;` : '';
    return `
    <tr>
      <td style="${bt}padding:18px 16px 18px 12px;width:70px;vertical-align:middle">
        <img src="${IMG_BASE}/product-img/${i.id}.jpg" alt="${i.name}" height="90" style="height:90px;width:auto;display:block">
      </td>
      <td style="${bt}padding:18px 12px 18px 4px;vertical-align:middle">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.4px;font-weight:700;color:${INK}">${i.name}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};margin-top:5px">${i.vial} · Qty ${i.qty}</div>
      </td>
      <td style="${bt}padding:18px 12px 18px 4px;text-align:right;vertical-align:middle;font-size:12px;font-weight:700;color:${INK};white-space:nowrap">$${i.lineTotal}</td>
    </tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${INK};border-bottom:1px solid ${INK}">
      ${rows}
      <tr><td colspan="3" style="border-top:1px solid ${INK};padding:15px 12px 15px 4px;text-align:right">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:${MUTED}">Total · incl. tax</span>
        &nbsp;&nbsp;<span style="font-size:13px;font-weight:700;color:${INK}">$${order.total} CAD</span>
      </td></tr>
    </table>`;
}

export async function emailOrderReceived(order) {
  const first = order.customer.firstName ? ' ' + order.customer.firstName : '';
  const itemsBox = itemsTable(order);

  if (order.method === 'etransfer') {
    const body = `
      <p style="margin:0 0 16px">Hi${first},</p>
      <p style="margin:0 0 6px">Thank you for your order. Here's what you ordered:</p>
      ${label('Your Order')}
      ${itemsBox}
      ${accent(PAPAYA, 'Payment Requested',
        `We've sent an Interac e-Transfer request for <b>$${order.total} CAD</b> to <b>${order.customer.email}</b>. Look for a separate message from Interac or your own bank — it's on its way.`)}
      ${label('To Pay, All You Have To Do Is')}
      ${steps([
        'Open the Interac e-Transfer request in your inbox or text messages.',
        'Tap <b>Accept</b> to deposit the request.',
        'Choose your bank and sign in — the payment links to your bank and completes automatically.'
      ])}
      <p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:${MUTED}">The request is for <b style="color:${INK}">$${order.total} CAD</b> with order <b style="color:${INK}">${order.orderNo}</b> as the reference. No security question — accepting through your bank is all that's needed. Once it clears, your order ships within 24 hours. Don't see it within a few minutes? Check your spam folder or reply here with your order number.</p>`;
    await send(order.customer.email, `Your payment request is on its way · ${order.orderNo}`, wrap(body));
    return;
  }

  await send(order.customer.email, `Order received · ${order.orderNo}`, wrap(
    `<p style="margin:0 0 16px">Hi${first},</p>
     <p style="margin:0 0 6px">Thank you for your order <b>${order.orderNo}</b>. Here's what you ordered:</p>
     ${label('Your Order')}
     ${itemsBox}
     <p style="margin:24px 0 0;font-size:13px;line-height:1.7">Complete your crypto payment using the secure checkout link. Once the payment confirms, your order is prepared and ships within 24 hours.</p>`));
}

export async function emailPaid(order) {
  const first = order.customer.firstName ? ' ' + order.customer.firstName : '';
  const itemsBox = itemsTable(order);
  const body = `
    <p style="margin:0 0 16px">Hi${first},</p>
    <p style="margin:0 0 6px">Thank you — your payment for <b>${order.orderNo}</b> has been received and your order is confirmed. Here's what you ordered:</p>
    ${label('Your Order')}
    ${itemsBox}
    ${accent(INK, 'Payment Received', 'Your order is confirmed and now being prepared.')}
    ${label('What Happens Next')}
    ${steps([
      'Your order is packed and <b>ships within 24 hours</b> from within Canada.',
      'Everything ships discreetly, in plain packaging, with no product details on the outside.',
      'As soon as it ships, we\'ll email you a <b>tracking number</b> to follow it to your door.',
      'Delivery is Canada-wide and typically arrives within a few business days.'
    ])}
    <p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:${MUTED}">Track anytime with order <b style="color:${INK}">${order.orderNo}</b> at papayapeps.com/track. Every order ships with its Certificate of Analysis. Questions? Reply here with your order number and a real person will help.</p>`;
  await send(order.customer.email, `Payment received — your order is on its way · ${order.orderNo}`, wrap(body));
}

// Generic transport for the reorder-lifecycle engine (lifecycle.js).
export async function sendLifecycle(to, subject, html) {
  await send(to, subject, wrap(html));
}

export async function emailShipped(order) {
  const t = order.tracking || {};
  const first = order.customer.firstName ? ' ' + order.customer.firstName : '';
  await send(order.customer.email, `Your order shipped · ${order.orderNo}`, wrap(
    `<p style="margin:0 0 16px">Hi${first},</p>
     <p style="margin:0 0 6px">Good news — <b>${order.orderNo}</b> is on its way.</p>
     ${label('Tracking')}
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${INK};border-bottom:1px solid ${INK}">
       <tr><td style="padding:14px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:${MUTED};width:120px">Carrier</td><td style="padding:14px 4px;font-size:13px;font-weight:700;text-align:right">${t.carrier || '—'}</td></tr>
       <tr><td style="border-top:1px solid #ececec;padding:14px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:${MUTED}">Tracking</td><td style="border-top:1px solid #ececec;padding:14px 4px;font-size:13px;font-weight:700;text-align:right">${t.number || '—'}</td></tr>
     </table>`));
}
