// server.js — Papaya Peptides store backend.
// Serves the storefront, takes orders, creates crypto checkouts, handles e-Transfer,
// verifies payment webhooks, exposes order tracking, and an admin dashboard.
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { PRODUCTS, byId, lineTotal, shippingFor, discountRate, taxFor } from './products.js';
import { createCryptoCharge, verifyCoinbase, verifyNow, PAYMENT_PROVIDER } from './payments.js';
import { emailOrderReceived, emailPaid, emailShipped } from './email.js';

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
  console.log(`[paid] ${no} via ${provider}`);
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

// Create an order. body: { items:[{id,qty}], customer:{...}, method:'crypto'|'etransfer', ruo:true }
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, method, ruo, referral } = req.body || {};
    if (!ruo) return res.status(400).json({ error: 'You must accept the Research Use Only agreement.' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your kit is empty.' });
    if (!customer || !customer.email || !customer.firstName) return res.status(400).json({ error: 'Name and email are required.' });
    if (!['crypto', 'etransfer'].includes(method)) return res.status(400).json({ error: 'Choose a payment method.' });

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

    if (method === 'crypto') {
      const charge = await createCryptoCharge(order, baseUrl);
      order.payment = charge;
      resp.hostedUrl = charge.hostedUrl;     // redirect the customer here to pay
    } else {
      resp.etransfer = {
        email: process.env.ETRANSFER_EMAIL || '',
        name: process.env.ETRANSFER_NAME || '',
        question: process.env.ETRANSFER_QUESTION || '',
        answer: process.env.ETRANSFER_ANSWER || '',
        autodeposit: String(process.env.ETRANSFER_AUTODEPOSIT || 'true') === 'true',
        amount: total, currency: 'CAD', message: order.orderNo
      };
    }

    db.insert(order);
    emailOrderReceived(order).catch(() => {});
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
// Update fulfillment status
app.post('/api/admin/orders/:orderNo/status', adminOnly, (req, res) => {
  const valid = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!valid.includes(req.body.status)) return res.status(400).json({ error: 'bad status' });
  const o = db.update(req.params.orderNo, { status: req.body.status });
  if (o && (req.body.status === 'shipped')) emailShipped(o).catch(() => {});
  o ? res.json(o) : res.status(404).json({ error: 'not found' });
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
// SPA routing: any non-API, non-file path serves the storefront (client router takes over)
app.get(/^\/(?!api\/)[^.]*$/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Papaya Peptides backend running on :${PORT}  (payments: ${PAYMENT_PROVIDER})`));
