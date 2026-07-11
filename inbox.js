// inbox.js — optional Interac e-Transfer deposit detector.
//
// What it does: on a timer, it logs into the mailbox that RECEIVES your Interac
// deposit notifications, reads new "you received a deposit" emails, pulls out the
// amount and the order number, and — when it can match one to a pending order —
// FLAGS that order as "payment likely received" for you to confirm in /admin.
//
// It NEVER marks an order paid on its own. A human taps "Confirm" in the admin,
// which is what actually sends the customer their payment-confirmation email.
//
// If IMAP isn't configured (no IMAP_HOST/IMAP_USER/IMAP_PASS), this does nothing.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SEEN_FILE = path.join(DATA_DIR, 'imap_seen.json');
const UNMATCHED_FILE = path.join(DATA_DIR, 'imap_unmatched.json');

const CFG = {
  host: process.env.IMAP_HOST || '',
  port: Number(process.env.IMAP_PORT || 993),
  secure: String(process.env.IMAP_SECURE || 'true') === 'true',
  user: process.env.IMAP_USER || '',
  pass: process.env.IMAP_PASS || '',
  mailbox: process.env.IMAP_MAILBOX || 'INBOX',
  pollMs: Math.max(30000, Number(process.env.IMAP_POLL_MS || 120000)),
  sinceDays: Math.max(1, Number(process.env.IMAP_SINCE_DAYS || 7))
};

export function inboxConfigured() { return !!(CFG.host && CFG.user && CFG.pass); }

// ---- tiny JSON helpers (best-effort, never throw) ----
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error('[inbox] write', e.message); }
}

// ---- parsing ----
// Grab a dollar amount like $1,234.56 / 1234.56 / $87 from the text.
function parseAmount(text) {
  const t = String(text || '');
  const matches = [...t.matchAll(/\$?\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/g)]
    .map(m => Number(m[1].replace(/,/g, '')))
    .filter(n => n > 0 && n < 100000);
  return matches;
}
// Order numbers look like PP-620417.
function parseOrderNo(text) {
  const m = String(text || '').match(/PP-\d{4,}/i);
  return m ? m[0].toUpperCase() : '';
}
function looksLikeInteracDeposit(from, subject, body) {
  const f = String(from).toLowerCase();
  const s = String(subject).toLowerCase();
  const b = String(body).toLowerCase();
  const fromInterac = f.includes('interac') || f.includes('payments.interac') || /notify@/.test(f);
  const mentionsInterac = /interac|e-?transfer|e-?tfr/.test(s + ' ' + b);
  const isDeposit = /(deposit|received|accepted|has been|sent you)/.test(s + ' ' + b);
  return (fromInterac || mentionsInterac) && isDeposit;
}

// Candidate orders = e-transfer orders still awaiting payment, not already flagged.
function candidateOrders() {
  return db.all().filter(o =>
    o.method === 'etransfer' &&
    (o.status === 'pending_payment' || o.status === 'etransfer_pending') &&
    !o.paymentDetected);
}

// Try to match a parsed deposit to exactly one pending order.
function matchOrder(ref, amounts) {
  const cands = candidateOrders();
  if (ref) {
    const byRef = cands.find(o => o.orderNo.toUpperCase() === ref);
    if (byRef) return { order: byRef, confidence: 'high', reason: 'order number in email' };
  }
  // Match by exact total — only if exactly one pending order has that total.
  for (const amt of amounts) {
    const hits = cands.filter(o => Number(o.total) === amt);
    if (hits.length === 1) return { order: hits[0], confidence: 'medium', reason: 'exact amount match' };
  }
  return null;
}

async function pollOnce() {
  if (!inboxConfigured()) return;
  const seen = new Set(readJson(SEEN_FILE, []));
  const client = new ImapFlow({
    host: CFG.host, port: CFG.port, secure: CFG.secure,
    auth: { user: CFG.user, pass: CFG.pass }, logger: false
  });
  await client.connect();
  const lock = await client.getMailboxLock(CFG.mailbox);
  let flagged = 0, scanned = 0;
  try {
    const since = new Date(Date.now() - CFG.sinceDays * 86400000);
    let uids = [];
    try { uids = await client.search({ since }, { uid: true }); } catch { uids = []; }
    for (const uid of uids) {
      let msg;
      try { msg = await client.fetchOne(uid, { source: true }, { uid: true }); } catch { continue; }
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const mid = parsed.messageId || `uid:${uid}`;
      if (seen.has(mid)) continue;
      seen.add(mid);
      scanned++;
      const from = (parsed.from && parsed.from.text) || '';
      const subject = parsed.subject || '';
      const body = (parsed.text || '') + ' ' + (parsed.html || '');
      if (!looksLikeInteracDeposit(from, subject, body)) continue;
      const ref = parseOrderNo(subject + ' ' + body);
      const amounts = parseAmount(subject + ' ' + body);
      const match = matchOrder(ref, amounts);
      if (match) {
        db.update(match.order.orderNo, {
          paymentDetected: {
            amount: Number(match.order.total),
            ref: ref || null,
            confidence: match.confidence,
            reason: match.reason,
            subject: subject.slice(0, 160),
            from: from.slice(0, 120),
            detectedAt: Date.now(),
            via: 'imap'
          }
        });
        flagged++;
        console.log(`[inbox] flagged ${match.order.orderNo} (${match.confidence}) — ${match.reason}`);
      } else {
        // Real-looking deposit we couldn't tie to an order — record it so nothing is silently lost.
        const un = readJson(UNMATCHED_FILE, []);
        un.push({ subject: subject.slice(0, 160), from: from.slice(0, 120), amounts, ref: ref || null, at: Date.now() });
        writeJson(UNMATCHED_FILE, un.slice(-100));
        console.log(`[inbox] unmatched deposit — subject: ${subject.slice(0, 80)}`);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
    // keep the seen set bounded
    writeJson(SEEN_FILE, [...seen].slice(-800));
    if (scanned) console.log(`[inbox] scanned ${scanned} new msg(s), flagged ${flagged}`);
  }
}

export function startInboxWatcher() {
  if (!inboxConfigured()) {
    console.log('[inbox] IMAP not configured — payment auto-detect is OFF (set IMAP_HOST/IMAP_USER/IMAP_PASS to enable).');
    return;
  }
  console.log(`[inbox] watching ${CFG.user} every ${Math.round(CFG.pollMs / 1000)}s`);
  const run = () => pollOnce().catch(e => console.error('[inbox]', e.message));
  setTimeout(run, 8000);           // first pass shortly after boot
  setInterval(run, CFG.pollMs);    // then on a timer
}
