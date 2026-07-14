// server.js — Papaya Peptides store backend.
// Serves the storefront, takes orders, creates crypto checkouts, handles e-Transfer,
// verifies payment webhooks, exposes order tracking, and an admin dashboard.
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { startLifecycle, runTick, loadMessaging, saveMessaging, unsubToken, CFG as LIFECYCLE_CFG, dueSteps, sendable } from './lifecycle.js';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { PRODUCTS, byId, lineTotal, shippingFor, discountRate, taxFor } from './products.js';
import { createCryptoCharge, verifyCoinbase, verifyNow, PAYMENT_PROVIDER } from './payments.js';
import { emailOrderReceived, emailPaid, emailShipped, emailStoreNewOrder, emailStorePaid } from './email.js';
import { startInboxWatcher } from './inbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme-admin-key';

app.set('trust proxy', 1);

// CORS (lets the storefront live on a different domain if you ever want that)
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// IMPORTANT: webhook routes need the RAW body to verify signatures — register them BEFORE express.json().
app.post('/api/webhooks/coinbase', express.raw({ type: '*/*' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyCoinbase(raw, req.get('X-CC-Webhook-Signature'))) return res.status(401).send('bad signature');
  let evt; try { evt = JSON.parse(raw).event; } catch { return res.status(400).send('bad json'); }
  const type = evt?.type;
  const orderNo = evt?.data?.metadata?.orderNo;
  if (orderNo && (type === 'charge:confirmed' || type === 'charge:resolved')) markPaid(orderNo, 'coinbase');
  res.sendStatus(200);
});

app.post('/api/webhooks/nowpayments', express.raw({ type: '*/*' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyNow(raw, req.get('x-nowpayments-sig'))) return res.status(401).send('bad signature');
  let data; try { data = JSON.parse(raw); } catch { return res.status(400).send('bad json'); }
  if (['finished', 'confirmed'].includes(data.payment_status)) markPaid(data.order_id, 'nowpayments');
  res.sendStatus(200);
});

app.use(express.json());

// ---------------- helpers ----------------
function orderNo() { return 'PP-' + Math.floor(100000 + Math.random() * 900000); }
function refCode() { return 'PP-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }
const DATA_DIR = path.join(__dirname, 'data');
function leadPath(n) { return path.join(DATA_DIR, n + '.json'); }
function readLeads(n) { try { return JSON.parse(fs.readFileSync(leadPath(n), 'utf8')); } catch (e) { return []; } }
function writeLeads(n, arr) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(leadPath(n), JSON.stringify(arr, null, 2)); } catch (e) { console.error('lead write', e.message); } }

async function markPaid(no, provider) {
  const o = db.get(no);
  if (!o || o.status === 'paid' || o.status === 'processing' || o.status === 'shipped' || o.status === 'delivered') return;
  db.update(no, { status: 'paid', payment: { ...(o.payment || {}), provider, paidAt: Date.now() } });
  try { await emailPaid(db.get(no)); } catch {}
  emailStorePaid(db.get(no)).catch(() => {});
  notifyAffiliateAgent(db.get(no)).catch(() => {});
  console.log(`[paid] ${no} via ${provider}`);
}

// Report EVERY paid order to the affiliate agent. Orders with a referral code
// credit that affiliate's first-order rate; orders without one still carry a
// privacy-safe customer hash so the agent can credit lifetime reorder commission
// to whichever affiliate originally referred that customer.
// Fire-and-forget: a down agent never blocks payment processing.
async function notifyAffiliateAgent(o) {
  if (!process.env.AGENT_URL || !process.env.AGENT_WEBHOOK_SECRET) return;
  if (!o) return;
  try {
    const customerHash = createHash('sha256')
      .update(String(o.customer?.email || '').trim().toLowerCase())
      .digest('hex').slice(0, 32);
    const r = await fetch(`${process.env.AGENT_URL}/webhooks/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.AGENT_WEBHOOK_SECRET,
        order_id: o.orderNo,
        total_usd: o.total,          // store charges CAD; agent ledger is CAD throughout
        code: o.referral || '',
        customer_hash: customerHash
      })
    });
    const out = await r.json();
    console.log(`[affiliate] ${o.orderNo} referral=${o.referral || '-'} attributed=${out.attributed} kind=${out.kind || '-'}`);
  } catch (e) { console.error('[affiliate webhook]', e.message); }
}

function publicOrder(o) {
  // What we safely expose on the public tracking endpoint (no personal info).
  const stageByStatus = { paid: 0, processing: 1, shipped: 2, out_for_delivery: 3, delivered: 4 };
  return {
    orderNo: o.orderNo, status: o.status,
    stage: (o.status === 'pending_payment' || o.status === 'etransfer_pending') ? -1 : (stageByStatus[o.status] ?? 0),
    total: o.total, currency: o.currency,
    tracking: o.tracking ? { carrier: o.tracking.carrier, number: o.tracking.number } : null,
    createdAt: o.createdAt
  };
}

function adminOnly(req, res, next) {
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ---------------- public API ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, provider: PAYMENT_PROVIDER }));
app.get('/api/products', (req, res) => res.json(PRODUCTS));
app.get('/api/config', (req, res) => res.json({
  provider: PAYMENT_PROVIDER,
  etransfer: { email: process.env.ETRANSFER_EMAIL || '', name: process.env.ETRANSFER_NAME || '', question: process.env.ETRANSFER_QUESTION || '', answer: process.env.ETRANSFER_ANSWER || '', autodeposit: String(process.env.ETRANSFER_AUTODEPOSIT || 'true') === 'true' },
  freeShippingOver: 150
}));

// Create an order. body: { items:[{id,qty}], customer:{...}, method:'etransfer', ruo:true }
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, method, ruo, referral } = req.body || {};
    if (!ruo) return res.status(400).json({ error: 'You must accept the Research Use Only agreement.' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your kit is empty.' });
    if (!customer || !customer.email || !customer.firstName) return res.status(400).json({ error: 'Name and email are required.' });
    if (method !== 'etransfer') return res.status(400).json({ error: 'We only accept Interac e-Transfer.' });

    // Re-price everything on the server from our own catalogue (never trust the browser's prices).
    const line = [];
    for (const it of items) {
      const p = byId[it.id];
      const qty = Math.max(1, Math.min(99, parseInt(it.qty) || 1));
      if (!p) return res.status(400).json({ error: 'Unknown product: ' + it.id });
      line.push({ id: p.id, name: p.name, vial: p.vial, price: p.price, qty, discount: discountRate(qty, p), lineTotal: lineTotal(p, qty) });
    }
    const subtotal = line.reduce((s, l) => s + l.lineTotal, 0);
    const shipping = shippingFor(subtotal);
    const province = (customer && customer.state) || '';
    const tax = taxFor(subtotal, province);
    const total = subtotal + shipping + tax;

    const order = {
      orderNo: orderNo(), createdAt: Date.now(), updatedAt: Date.now(),
      status: 'pending_payment', method, currency: 'CAD',
      items: line, subtotal, shipping, tax, total, referral: (referral || ''),
      customer: {
        email: String(customer.email).trim(), phone: customer.phone || '',
        firstName: customer.firstName || '', lastName: customer.lastName || '',
        lab: customer.lab || '', address: customer.address || '', city: customer.city || '',
        zip: customer.zip || '', state: customer.state || '', country: customer.country || ''
      },
      payment: {}, tracking: null, ruoConfirmed: true
    };

    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    let resp = { orderNo: order.orderNo, total, method };

    resp.etransfer = {
      email: process.env.ETRANSFER_EMAIL || '',
      name: process.env.ETRANSFER_NAME || '',
      question: process.env.ETRANSFER_QUESTION || '',
      answer: process.env.ETRANSFER_ANSWER || '',
      autodeposit: String(process.env.ETRANSFER_AUTODEPOSIT || 'true') === 'true',
      amount: total, currency: 'CAD', message: order.orderNo
    };

    db.insert(order);
    emailOrderReceived(order).catch(() => {});
    emailStoreNewOrder(order).catch(() => {});
    res.json(resp);
  } catch (e) {
    console.error('[order error]', e.message);
    res.status(500).json({ error: 'Could not create order. ' + e.message });
  }
});

// ---------------- Referrals / Affiliates / Contact ----------------
app.post('/api/refer', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  const refs = readLeads('referrals');
  let rec = refs.find(r => r.email === email);
  if (!rec) { rec = { email, code: refCode(), createdAt: Date.now() }; refs.push(rec); writeLeads('referrals', refs); }
  res.json({ code: rec.code });
});
app.post('/api/affiliates/apply', (req, res) => {
  const { name, email, url } = req.body || {};
  if (!name || !/.+@.+\..+/.test(String(email || ''))) return res.status(400).json({ error: 'Name and a valid email are required.' });
  const a = readLeads('affiliates');
  a.push({ name: String(name), email: String(email), url: String(url || ''), status: 'new', createdAt: Date.now() });
  writeLeads('affiliates', a);
  res.json({ ok: true });
});
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body || {};
  if (!/.+@.+\..+/.test(String(email || '')) || !String(message || '').trim()) return res.status(400).json({ error: 'Email and message are required.' });
  const c = readLeads('contacts');
  c.push({ name: String(name || ''), email: String(email), message: String(message), createdAt: Date.now() });
  writeLeads('contacts', c);
  res.json({ ok: true });
});

// One-click reorder support: expose ONLY the item ids/qtys of an order (no PII).
app.get('/api/orders/:orderNo/kit', (req, res) => {
  const o = db.get(req.params.orderNo.toUpperCase());
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json({ items: o.items.map(i => ({ id: i.id, qty: i.qty })) });
});

// Lifecycle unsubscribe (HMAC-verified; one click from any reminder email)
app.get('/api/lifecycle/unsubscribe', (req, res) => {
  const { e, t } = req.query;
  if (!e || unsubToken(String(e)) !== t) return res.status(400).send('Invalid link');
  const m = loadMessaging();
  const key = String(e).trim().toLowerCase();
  m[key] = m[key] || { consent: true, sends: [] };
  m[key].consent = false;
  saveMessaging(m);
  res.send('<div style="font-family:sans-serif;padding:40px">You are unsubscribed from restock reminders. Order emails (receipts, tracking) still arrive normally.</div>');
});

// Public tracking
app.get('/api/track/:orderNo', (req, res) => {
  const o = db.get(req.params.orderNo.toUpperCase());
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json(publicOrder(o));
});

// Customer tells us they've sent the e-Transfer (moves order to "awaiting confirmation")
app.post('/api/orders/:orderNo/etransfer-sent', (req, res) => {
  const o = db.get(req.params.orderNo.toUpperCase());
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.method === 'etransfer' && o.status === 'pending_payment') db.update(o.orderNo, { status: 'etransfer_pending' });
  res.json({ ok: true });
});

// ---------------- admin API ----------------
app.get('/api/admin/orders', adminOnly, (req, res) => res.json(db.all()));
app.get('/api/admin/referrals', adminOnly, (req, res) => res.json(readLeads('referrals')));
app.get('/api/admin/affiliates', adminOnly, (req, res) => res.json(readLeads('affiliates')));
app.get('/api/admin/contacts', adminOnly, (req, res) => res.json(readLeads('contacts')));
app.get('/api/admin/orders/:orderNo', adminOnly, (req, res) => {
  const o = db.get(req.params.orderNo); o ? res.json(o) : res.status(404).json({ error: 'not found' });
});
// Manually confirm an Interac e-Transfer payment
app.post('/api/admin/orders/:orderNo/mark-paid', adminOnly, async (req, res) => {
  await markPaid(req.params.orderNo, 'etransfer-manual');
  res.json(db.get(req.params.orderNo) || { error: 'not found' });
});
// Orders the inbox watcher flagged as "payment likely received" and awaiting your confirmation
app.get('/api/admin/payments/detected', adminOnly, (req, res) => {
  const done = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
  res.json(db.all().filter(o => o.paymentDetected && !done.includes(o.status)));
});
// Dismiss a false-positive detection (clears the flag without marking paid)
app.post('/api/admin/orders/:orderNo/dismiss-detection', adminOnly, (req, res) => {
  const o = db.update(req.params.orderNo, { paymentDetected: null });
  o ? res.json(o) : res.status(404).json({ error: 'not found' });
});
// Update fulfillment status
app.post('/api/admin/orders/:orderNo/status', adminOnly, (req, res) => {
  const valid = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!valid.includes(req.body.status)) return res.status(400).json({ error: 'bad status' });
  const o = db.update(req.params.orderNo, { status: req.body.status });
  if (o && (req.body.status === 'shipped')) emailShipped(o).catch(() => {});
  if (o && req.body.status === 'cancelled') notifyAgentCancellation(o.orderNo).catch(() => {});
  o ? res.json(o) : res.status(404).json({ error: 'not found' });
});

// Claw back the affiliate commission when an order is cancelled/refunded.
async function notifyAgentCancellation(orderNo) {
  if (!process.env.AGENT_URL || !process.env.AGENT_WEBHOOK_SECRET) return;
  try {
    await fetch(`${process.env.AGENT_URL}/webhooks/order-cancelled`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.AGENT_WEBHOOK_SECRET, order_id: orderNo })
    });
  } catch (e) { console.error('[affiliate reversal]', e.message); }
}

// ---------------- lifecycle admin ----------------
app.get('/api/admin/lifecycle/upcoming', adminOnly, (req, res) => {
  const now = Date.now();
  const byCustomer = {};
  for (const o of db.all()) {
    const e = (o.customer && o.customer.email || '').trim().toLowerCase();
    if (e) (byCustomer[e] = byCustomer[e] || []).push(o);
  }
  const messaging = loadMessaging();
  const out = [];
  for (const [email, orders] of Object.entries(byCustomer)) {
    const due = sendable(dueSteps(orders, now), messaging[email], now);
    for (const s of due) out.push({ email, ...s });
  }
  res.json({ enabled: LIFECYCLE_CFG.enabled, dryRun: LIFECYCLE_CFG.dryRun, due: out });
});
app.get('/api/admin/lifecycle/sends', adminOnly, (req, res) => res.json(loadMessaging()));
app.post('/api/admin/lifecycle/tick', adminOnly, (req, res) => res.json(runTick()));
app.get('/api/admin/lifecycle/metrics', adminOnly, (req, res) => {
  // conversion: reorder-type sends that were followed by a new paid order from the same
  // customer within 45 days
  const messaging = loadMessaging();
  const orders = db.all();
  let sent = 0, converted = 0, revenue = 0;
  for (const [email, rec] of Object.entries(messaging)) {
    for (const s of (rec.sends || [])) {
      if (!['reorder', 'followup', 'winback60', 'winback90'].includes(s.step) || s.dryRun) continue;
      sent++;
      const later = orders.find(o => (o.customer && o.customer.email || '').trim().toLowerCase() === email
        && o.createdAt > s.at && o.createdAt < s.at + 45 * 86400000
        && ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'].includes(o.status));
      if (later) { converted++; revenue += later.total || 0; }
    }
  }
  res.json({ sent, converted, revenueCAD: Math.round(revenue * 100) / 100 });
});
// Add tracking info
app.post('/api/admin/orders/:orderNo/tracking', adminOnly, (req, res) => {
  const { carrier, number } = req.body || {};
  const cur = db.get(req.params.orderNo);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const o = db.update(req.params.orderNo, { tracking: { carrier: carrier || '', number: number || '', updatedAt: Date.now() } });
  res.json(o);
});

// ---------------- static: storefront + admin ----------------
// storefront + admin are self-contained HTML served from the project root
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
// link-preview / social card image (og:image) — served so iMessage/social show the logo card
app.get('/og-image.png', (req, res) => res.sendFile(path.join(__dirname, 'og-image.png')));
// wordmark logo used in the header of order emails
app.get('/email-logo.png', (req, res) => res.sendFile(path.join(__dirname, 'email-logo.png')));
// product thumbnails used in order emails (hosted so email clients can load them)
app.use('/product-img', express.static(path.join(__dirname, 'product-img'), { maxAge: '7d' }));
// third-party Certificate of Analysis reports (linked from the Lab Results page)
app.use('/coa', express.static(path.join(__dirname, 'coa'), { maxAge: '7d' }));
// SPA routing: any non-API, non-file path serves the storefront (client router takes over)
app.get(/^\/(?!api\/)[^.]*$/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`Papaya Peptides backend running on :${PORT}  (payments: ${PAYMENT_PROVIDER})`);
  startLifecycle();   // no-op unless LIFECYCLE_ENABLED=true; dry-run until LIFECYCLE_DRY_RUN=false
  startInboxWatcher(); // no-op unless IMAP_HOST/IMAP_USER/IMAP_PASS are set
});
