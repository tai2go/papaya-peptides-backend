# Changelog

## 2026-07-02 — Reorder lifecycle engine (ships DARK)
- `lifecycle.js`: supply-model + daily job. Sequences: refrigeration tip, reorder
  reminder (leads the run-out date), follow-up, win-back at 60/90 days.
  Per-customer consent, dedupe (a step never sends twice), 4-msgs/30-days cap,
  HMAC unsubscribe. **Flags:** `LIFECYCLE_ENABLED` (default false),
  `LIFECYCLE_DRY_RUN` (default true — logs intended sends, sends nothing),
  `LIFECYCLE_SUPPLY_DAYS` (default 30; per-product override: `supplyDays` in products.js).
- One-click reorder: `?reorder=ORDERNO` rebuilds that order's kit in the cart
  (`GET /api/orders/:orderNo/kit` exposes item ids/qtys only — no PII).
- Admin: `GET /api/admin/lifecycle/upcoming|sends|metrics`, `POST /api/admin/lifecycle/tick`.
- Cancelling an order (admin status → cancelled) now claws back the affiliate
  commission via `POST AGENT_URL/webhooks/order-cancelled`.
- Tests: `node --test tests/` (9 passing).

## Enable sequence (QA checklist)
1. Deploy with flags at defaults → boot log shows "lifecycle disabled". ✔ no behavior change.
2. Set `LIFECYCLE_ENABLED=true` (dry-run still on) → after ~1 min, log lists
   "DRY-RUN would send …" lines. Check `/api/admin/lifecycle/upcoming` matches expectations.
3. Send yourself a test: place a test order, backdate nothing, wait for the tick or
   `POST /api/admin/lifecycle/tick`; confirm dedupe (second tick sends nothing new).
4. Click the one-click link in a dry-run-logged URL manually: cart rebuilds, checkout loads.
5. Click unsubscribe link: `/api/admin/lifecycle/sends` shows `consent:false`; next tick skips.
6. Only then set `LIFECYCLE_DRY_RUN=false`.
7. Verify a real reorder fires `[affiliate] … kind=reorder` in logs (lifetime commission).
