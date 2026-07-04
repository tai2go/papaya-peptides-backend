// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert';
import { dueSteps, sendable, supplyDaysOf } from '../lifecycle.js';

const DAY = 86400000;
const CFG = { enabled: true, dryRun: true, defaultSupplyDays: 30, leadDays: 4, fridgeAfterPaidDays: 5, followupGraceDays: 3, winbackDays: [60, 90], maxPerWindow: 4, windowDays: 30 };
const LOOKUP = { 'bpc-157': { supplyDays: 30 }, 'tb-500': { supplyDays: 45 } };
const order = (daysAgo, status = 'paid', items = [{ id: 'bpc-157', qty: 1 }]) =>
  ({ orderNo: 'PP-1', status, createdAt: Date.now() - daysAgo * DAY, items, payment: {} });

test('supply days = max across items, falls back to default', () => {
  assert.equal(supplyDaysOf(order(0, 'paid', [{ id: 'bpc-157' }, { id: 'tb-500' }]), LOOKUP, CFG), 45);
  assert.equal(supplyDaysOf(order(0, 'paid', [{ id: 'unknown' }]), LOOKUP, CFG), 30);
});

test('fridge tip fires after payment, before reorder window', () => {
  const steps = dueSteps([order(6)], Date.now(), CFG, LOOKUP);
  assert.deepEqual(steps.map(s => s.step), ['fridge']);
});

test('reorder reminder fires in the lead window', () => {
  const steps = dueSteps([order(27)], Date.now(), CFG, LOOKUP);
  assert.deepEqual(steps.map(s => s.step), ['reorder']);
});

test('followup after supply lapses, winbacks at 60/90', () => {
  assert.deepEqual(dueSteps([order(35)], Date.now(), CFG, LOOKUP).map(s => s.step), ['followup']);
  assert.deepEqual(dueSteps([order(61)], Date.now(), CFG, LOOKUP).map(s => s.step), ['winback60']);
  assert.deepEqual(dueSteps([order(92)], Date.now(), CFG, LOOKUP).map(s => s.step), ['winback90']);
});

test('a newer order resets the clock (no reminder for old order)', () => {
  const steps = dueSteps([order(70), order(2)], Date.now(), CFG, LOOKUP);
  assert.equal(steps.length, 0);
});

test('unpaid orders are ignored', () => {
  assert.equal(dueSteps([order(27, 'pending_payment')], Date.now(), CFG, LOOKUP).length, 0);
});

test('dedupe: a sent step never sends twice', () => {
  const now = Date.now();
  const steps = dueSteps([order(27)], now, CFG, LOOKUP);
  const rec = { consent: true, sends: [{ step: 'reorder', key: 'reorder:PP-1', at: now - DAY }] };
  assert.equal(sendable(steps, rec, now, CFG).length, 0);
});

test('opt-out suppresses everything', () => {
  const now = Date.now();
  const steps = dueSteps([order(27)], now, CFG, LOOKUP);
  assert.equal(sendable(steps, { consent: false, sends: [] }, now, CFG).length, 0);
});

test('rate cap enforced per window', () => {
  const now = Date.now();
  const rec = { consent: true, sends: [1, 2, 3, 4].map(i => ({ step: 'x', key: 'k' + i, at: now - i * DAY })) };
  assert.equal(sendable([{ step: 'reorder', key: 'new' }], rec, now, CFG).length, 0);
});
