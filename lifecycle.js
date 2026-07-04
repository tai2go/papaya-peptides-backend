// lifecycle.js — reorder lifecycle engine. Watches paid orders, works out when each
// customer is due to restock, and sends the right email at the right time.
// SAFETY: ships dark. LIFECYCLE_ENABLED=false skips everything; LIFECYCLE_DRY_RUN=true
// (the default) logs intended sends without sending. Global kill switch = the flag.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHmac } from 'crypto';
import { db } from './db.js';
import { byId } from './products.js';
import { sendLifecycle } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const MSG_FILE = path.join(DATA_DIR, 'messaging.json');

export const CFG = {
  enabled: String(process.env.LIFECYCLE_ENABLED || 'false') === 'true',
  dryRun: String(process.env.LIFECYCLE_DRY_RUN || 'true') !== 'false',
  defaultSupplyDays: Number(process.env.LIFECYCLE_SUPPLY_DAYS || 30), // per-product override: products.js supplyDays
  leadDays: 4,              // reorder reminder this many days BEFORE supply runs out
  fridgeAfterPaidDays: 5,   // refrigeration tip after payment (proxy for delivery)
  followupGraceDays: 3,     // follow-up this many days AFTER supply ran out
  winbackDays: [60, 90],    // win-back touches at these days since last order
  maxPerWindow: 4,          // hard cap: messages per customer per window
  windowDays: 30,
};

const PAID = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

// ---------- messaging store (consent + send history + suppression) ----------
export function loadMessaging() {
  try { return JSON.parse(fs.readFileSync(MSG_FILE, 'utf8')); } catch { return {}; }
}
export function saveMessaging(m) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MSG_FILE, JSON.stringify(m, null, 2)); }
  catch (e) { console.error('[lifecycle] messaging write', e.message); }
}
export function unsubToken(email) {
  return createHmac('sha256', process.env.ADMIN_KEY || 'k')
    .update(String(email).trim().toLowerCase()).digest('hex').slice(0, 20);
}

// ---------- pure decision logic (unit-tested) ----------
export function supplyDaysOf(order, lookup = byId, cfg = CFG) {
  const days = (order.items || []).map(i => (lookup[i.id] && lookup[i.id].supplyDays) || cfg.defaultSupplyDays);
  return days.length ? Math.max(...days) : cfg.defaultSupplyDays;
}

/** Given ALL of one customer's orders, return the steps due right now. */
export function dueSteps(orders, now, cfg = CFG, lookup = byId) {
  const paid = orders.filter(o => PAID.includes(o.status))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!paid.length) return [];
  const last = paid[paid.length - 1];
  const t0 = (last.payment && last.payment.paidAt) || last.createdAt;
  const days = (now - t0) / 86400000;
  const supply = supplyDaysOf(last, lookup, cfg);
  const steps = [];
  if (days >= cfg.fridgeAfterPaidDays && days < supply - cfg.leadDays)
    steps.push({ step: 'fridge', key: `fridge:${last.orderNo}`, orderNo: last.orderNo });
  if (days >= supply - cfg.leadDays && days < supply + cfg.followupGraceDays)
    steps.push({ step: 'reorder', key: `reorder:${last.orderNo}`, orderNo: last.orderNo });
  if (days >= supply + cfg.followupGraceDays && days < cfg.winbackDays[0])
    steps.push({ step: 'followup', key: `followup:${last.orderNo}`, orderNo: last.orderNo });
  for (const wb of cfg.winbackDays)
    if (days >= wb && days < wb + 7)
      steps.push({ step: `winback${wb}`, key: `winback${wb}:${last.orderNo}`, orderNo: last.orderNo });
  return steps;
}

/** Dedupe + consent + rate-cap filter. Pure: returns the steps that may actually send. */
export function sendable(steps, record, now, cfg = CFG) {
  const rec = record || { consent: true, sends: [] };
  if (rec.consent === false) return [];
  const sentKeys = new Set(rec.sends.map(s => s.key));
  const windowStart = now - cfg.windowDays * 86400000;
  let recent = rec.sends.filter(s => s.at >= windowStart).length;
  const out = [];
  for (const s of steps) {
    if (sentKeys.has(s.key) || recent >= cfg.maxPerWindow) continue;
    out.push(s); recent++;
  }
  return out;
}

// ---------- email content ----------
function baseUrl() { return process.env.PUBLIC_URL || 'https://papayapeps.com'; }
function links(email, orderNo) {
  return {
    reorder: `${baseUrl()}/?reorder=${encodeURIComponent(orderNo)}`,
    unsub: `${baseUrl()}/api/lifecycle/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`,
  };
}
const COPY = {
  fridge: (l) => [`Storage reminder for your recent order`,
    `<p>Quick reminder from the lab bench: once reconstituted, vials should be stored refrigerated and used within the window on your COA. Unreconstituted vials keep longest cool, dark and dry.</p>`],
  reorder: (l) => [`Running low? Your kit, one click`,
    `<p>Based on your last order date, your supplies may be running low. Rebuild your exact previous kit in one click:</p><p><a href="${l.reorder}">Reorder my kit →</a></p>`],
  followup: (l) => [`Still stocked?`,
    `<p>Checking in — if your research is continuing, your previous kit is one click away:</p><p><a href="${l.reorder}">Reorder my kit →</a></p>`],
  winback60: (l) => [`It's been a couple of months`,
    `<p>It's been a while since your last order. Everything ships domestic within Canada with a fresh third-party COA, as always:</p><p><a href="${l.reorder}">Rebuild my previous kit →</a></p>`],
  winback90: (l) => [`We kept your kit on file`,
    `<p>Your previous kit is still saved — one click brings it back, shipped Xpresspost within Canada:</p><p><a href="${l.reorder}">Reorder →</a></p>`],
};

// ---------- the daily tick ----------
export function runTick(now = Date.now()) {
  if (!CFG.enabled) return { skipped: 'disabled' };
  const orders = db.all();
  const byCustomer = {};
  for (const o of orders) {
    const e = (o.customer && o.customer.email || '').trim().toLowerCase();
    if (!e) continue;
    (byCustomer[e] = byCustomer[e] || []).push(o);
  }
  const messaging = loadMessaging();
  const report = { evaluated: 0, sent: 0, dryRun: CFG.dryRun, details: [] };
  for (const [email, custOrders] of Object.entries(byCustomer)) {
    report.evaluated++;
    const rec = messaging[email] = messaging[email] || { consent: true, sends: [] };
    const due = sendable(dueSteps(custOrders, now), rec, now);
    for (const s of due) {
      const l = links(email, s.orderNo);
      const [subject, body] = COPY[s.step](l);
      const html = `${body}<p style="font-size:11px;color:#888">Research use only. Not for human or animal consumption.<br><a href="${l.unsub}">Unsubscribe from reminders</a></p>`;
      if (CFG.dryRun) {
        console.log(`[lifecycle DRY-RUN] would send ${s.step} to ${email} (${s.key})`);
      } else {
        sendLifecycle(email, subject, html).catch(() => {});
      }
      rec.sends.push({ step: s.step, key: s.key, at: now, dryRun: CFG.dryRun });
      report.sent++;
      report.details.push({ email, step: s.step, dryRun: CFG.dryRun });
    }
  }
  saveMessaging(messaging);
  console.log(`[lifecycle] tick: ${report.evaluated} customers, ${report.sent} ${CFG.dryRun ? 'dry-run' : 'live'} sends`);
  return report;
}

export function startLifecycle() {
  if (!CFG.enabled) { console.log('[lifecycle] disabled (LIFECYCLE_ENABLED=false)'); return; }
  console.log(`[lifecycle] enabled, dryRun=${CFG.dryRun}`);
  setTimeout(() => runTick(), 60 * 1000);              // once shortly after boot
  setInterval(() => runTick(), 24 * 60 * 60 * 1000);   // then daily
}
