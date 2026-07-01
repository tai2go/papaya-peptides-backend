// db.js — tiny JSON-file order store. No database to install; perfect for a beginner / low volume.
// Upgrade path: swap these functions for a real DB (Postgres) later — the rest of the app won't change.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'orders.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
}
function readAll() {
  ensure();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}
function writeAll(list) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export const db = {
  all() { return readAll().sort((a, b) => b.createdAt - a.createdAt); },
  get(orderNo) { return readAll().find(o => o.orderNo === orderNo) || null; },
  getByCharge(chargeId) { return readAll().find(o => o.payment && o.payment.chargeId === chargeId) || null; },
  insert(order) { const list = readAll(); list.push(order); writeAll(list); return order; },
  update(orderNo, patch) {
    const list = readAll();
    const i = list.findIndex(o => o.orderNo === orderNo);
    if (i === -1) return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    writeAll(list);
    return list[i];
  }
};
