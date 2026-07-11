// email.js — optional confirmation emails over SMTP (works with Gmail, Zoho, Resend SMTP, etc.).
// If SMTP isn't configured, emails are skipped (logged) — the store still works fine.
// Styling mirrors the storefront: white canvas, letter-spaced uppercase wordmark, hairline
// rules, muted greys, and the papaya accent used sparingly — so the emails feel seamless
// with papayapeps.com. e-Transfer and crypto share the exact same layout.
import nodemailer from 'nodemailer';
import { TAX_RATES } from './products.js';

let transport = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

const FROM = process.env.MAIL_FROM || 'Papaya Peptides <payments@papayapeps.com>';
const STORE = process.env.STORE_NAME || 'Papaya Peptides';
const IMG_BASE = process.env.PUBLIC_URL || 'https://papayapeps.com';
const CRYPTO_ADDRESS = process.env.CRYPTO_ADDRESS || 'bc1q7ahq49u3v957xn992f7lrxe2k2kxqutgarf2retk8akpems0z5wqe8q0dz';
const CRYPTO_COIN = process.env.CRYPTO_CURRENCY || 'Bitcoin (BTC)';
const CRYPTO_NETWORK = process.env.CRYPTO_NETWORK || '';
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
          <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
            <td style="vertical-align:middle;padding-right:14px"><img src="${IMG_BASE}/email-logo.png" alt="" width="40" height="50" style="width:40px;height:50px;display:block"></td>
            <td style="vertical-align:middle"><div style="font-size:19px;text-transform:uppercase;letter-spacing:3px;font-weight:500">${STORE}</div></td>
          </tr></table>
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${INK}">
      ${rows}
    </table>`;
}

// Price breakdown: subtotal, shipping, HST/GST (province + rate), total.
function summary(order) {
  const prov = (order.customer && order.customer.state || '').toUpperCase();
  // Use the statutory province rate; fall back to deriving it if the province is unknown.
  const rate = (TAX_RATES && TAX_RATES[prov] != null)
    ? TAX_RATES[prov]
    : (order.subtotal > 0 ? Math.round((order.tax / order.subtotal) * 1000) / 10 : 0);
  const taxLabel = 'HST/GST' + (prov ? ' · ' + prov : '') + (rate ? ' · ' + rate + '%' : '');
  const line = (k, v, opts = {}) => `<tr>
      <td style="padding:7px 4px 7px 0;font-size:12px;color:${opts.strong ? INK : MUTED};${opts.top ? `border-top:1px solid ${INK};` : ''}${opts.strong ? 'font-weight:700;' : ''}">${k}</td>
      <td style="padding:7px 0 7px 4px;font-size:${opts.strong ? '13px' : '12px'};text-align:right;color:${INK};${opts.top ? `border-top:1px solid ${INK};` : ''}${opts.strong ? 'font-weight:700;' : ''}">${v}</td>
    </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${INK}">
      ${line('Subtotal', '$' + order.subtotal)}
      ${line('Shipping', order.shipping ? '$' + order.shipping : 'Free')}
      ${line(taxLabel, '$' + order.tax)}
      ${line('Total · incl. tax', '$' + order.total + ' CAD', { strong: true, top: true })}
    </table>`;
}

// Payment method + shipping/billing address (single address collected; billing = shipping).
function details(order) {
  const c = order.customer || {};
  const pay = order.method === 'etransfer' ? 'Interac e-Transfer' : (CRYPTO_COIN || 'Cryptocurrency');
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
  const cityLine = [c.city, (c.state || '').toUpperCase(), c.zip].filter(Boolean).join(', ');
  const addr = [name, c.address, cityLine, c.country].filter(Boolean).join('<br>') || '—';
  const mini = (t) => `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:${MUTED};margin-bottom:6px">${t}</div>`;
  const val = (t) => `<div style="font-size:13px;line-height:1.6;color:${INK}">${t}</div>`;
  return `<div style="margin-top:26px">
      ${mini('Payment Method')}${val(pay)}
      <div style="margin-top:18px">${mini('Shipping Address')}${val(addr)}</div>
      <div style="margin-top:18px">${mini('Billing Address')}${val('Same as shipping')}</div>
    </div>`;
}

// Crypto payment instructions — the parallel of the e-Transfer "send to" details.
function cryptoBox(order) {
  const rows = [
    ['Currency', CRYPTO_COIN, false],
    ...(CRYPTO_NETWORK ? [['Network', CRYPTO_NETWORK, false]] : []),
    ['Amount', 'Equivalent of $' + order.total + ' CAD', false],
    ['Address', CRYPTO_ADDRESS || 'set CRYPTO_ADDRESS', true],
    ['Reference', order.orderNo, false]
  ];
  const html = rows.map((r, idx) => {
    const bt = idx > 0 ? `border-top:1px solid #ececec;` : '';
    const valStyle = r[2]
      ? `font-family:Menlo,Consolas,'Courier New',monospace;font-size:12px;word-break:break-all;text-align:left`
      : `text-align:right`;
    return `<tr>
        <td style="${bt}padding:12px 10px 12px 0;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:${MUTED};width:110px;vertical-align:top">${r[0]}</td>
        <td style="${bt}padding:12px 0 12px 10px;font-size:13px;color:${INK};vertical-align:top;${valStyle}">${r[1]}</td>
      </tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${INK};border-bottom:1px solid ${INK}">${html}</table>`;
}

export async function emailOrderReceived(order) {
  const first = order.customer.firstName ? ' ' + order.customer.firstName : '';
  const orderBlock = `${label('Your Order')}${itemsTable(order)}${summary(order)}${details(order)}`;

  if (order.method === 'etransfer') {
    const body = `
      <p style="margin:0 0 16px">Hi${first},</p>
      <p style="margin:0 0 6px">Thank you for your order. Here's your summary:</p>
      ${orderBlock}
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

  // Crypto — same layout as e-Transfer, but the customer sends to a wallet address.
  const body = `
    <p style="margin:0 0 16px">Hi${first},</p>
    <p style="margin:0 0 6px">Thank you for your order. Here's your summary:</p>
    ${orderBlock}
    ${accent(PAPAYA, 'Payment Requested',
      `To confirm your order, send the equivalent of <b>$${order.total} CAD</b> in <b>${CRYPTO_COIN}</b> to the address below.`)}
    ${label('Send Your Crypto Payment To')}
    ${cryptoBox(order)}
    <p style="margin:12px 0 0;font-size:11px;line-height:1.6;color:${MUTED}">
      <b style="color:${INK}">Important:</b> crypto payments are irreversible. Always double-check the address above before you send — funds sent to a wrong or mistyped address, or on the wrong network, cannot be recovered or refunded. Only send ${CRYPTO_COIN} to this address.
    </p>
    ${label('To Pay, All You Have To Do Is')}
    ${steps([
      `Open your crypto wallet or exchange and choose <b>${CRYPTO_COIN}</b>${CRYPTO_NETWORK ? ` on the <b>${CRYPTO_NETWORK}</b> network` : ''}.`,
      `Send the equivalent of <b>$${order.total} CAD</b> to the address above.`,
      'Double-check the address and network before sending — crypto transfers can\'t be reversed.'
    ])}
    <p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:${MUTED}">Keep order <b style="color:${INK}">${order.orderNo}</b> for your records. Once the payment is confirmed on-chain, your order ships within 24 hours. Questions? Reply here with your order number.</p>`;
  await send(order.customer.email, `Complete your crypto payment · ${order.orderNo}`, wrap(body));
}

export async function emailPaid(order) {
  const first = order.customer.firstName ? ' ' + order.customer.firstName : '';
  const orderBlock = `${label('Your Order')}${itemsTable(order)}${summary(order)}${details(order)}`;
  const body = `
    <p style="margin:0 0 16px">Hi${first},</p>
    <p style="margin:0 0 6px">Thank you — your payment for <b>${order.orderNo}</b> has been received and your order is confirmed. Here's your summary:</p>
    ${orderBlock}
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
