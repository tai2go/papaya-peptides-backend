# Papaya Peptides — Store Backend (beginner guide)

This is the "engine" behind your store. It serves your website, takes orders, takes
**crypto** payments (automatic) and **Interac e‑Transfer** (you confirm by hand), gives
customers **order tracking**, and gives you an **admin dashboard** to manage everything.

You don't need to understand the code. Follow the steps below in order. Total time ~30–45 min.

---

## ⚠️ Read this first (the honest part)

- **Mainstream payment companies (Stripe, PayPal, Square, Shopify Payments, and Squarespace's
  built‑in checkout) prohibit research peptides** and will freeze your money. That's why this
  uses **crypto + e‑Transfer**. Don't try to bolt on Stripe — it ends in a shutdown.
- **You** must create the payment accounts (they need your ID/business info). I can't do that for you.
- This handles real money and customer info. Keep your `ADMIN_KEY` and API keys secret.
- Have your **business registration, terms, privacy policy, and age/RUO gating** sorted before
  going live. This is a real store, not a demo.

---

## What you'll end up with

- Your website live at your domain (e.g. `papayapeps.com`).
- `/admin` — your private dashboard (orders, mark e‑Transfers paid, set tracking).
- Customers pay by crypto (auto‑confirmed) or e‑Transfer (you confirm), and can track orders.

---

## Step 1 — Put the code on GitHub (free)

1. Make a free account at **github.com**.
2. Create a new **private** repository called `papaya-peptides-backend`.
3. Upload **everything in this `backend` folder** to it (drag‑and‑drop works on github.com →
   "Add file" → "Upload files"). **Do not upload** the `node_modules` folder or any `.env` file.

> Your storefront is already bundled inside at `public/index.html`, so the whole site ships together.

## Step 2 — Deploy to Render (free tier)

1. Make a free account at **render.com** and connect your GitHub.
2. Click **New → Web Service** and pick your `papaya-peptides-backend` repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free
4. Before the first deploy, open the **Environment** tab and add the variables from
   `.env.example` (see Step 3–5 for the values). At minimum set `ADMIN_KEY` and `PUBLIC_URL`.
5. Click **Create Web Service**. After a minute you'll get a URL like
   `https://papaya-peptides-backend.onrender.com`. Visit it — your store should load.

> Note: Render's free tier "sleeps" after inactivity (first visit takes ~30s to wake). A $7/mo
> plan keeps it always‑on — worth it once you're taking orders.

## Step 3 — Turn on crypto payments (Coinbase Commerce)

1. Sign up at **commerce.coinbase.com**.
2. **Settings → Security → API keys →** create one. Copy it into Render as `COINBASE_API_KEY`.
3. **Settings → Webhooks →** add an endpoint:
   `https://YOUR-RENDER-URL/api/webhooks/coinbase`
   Copy the **"Shared Secret"** it shows into Render as `COINBASE_WEBHOOK_SECRET`.
4. Make sure `PAYMENT_PROVIDER=coinbase` and `PUBLIC_URL=https://YOUR-RENDER-URL`.

That's it — crypto orders now create a hosted checkout and mark themselves **paid** automatically
when the customer pays.

*(Prefer NOWPayments instead? Set `PAYMENT_PROVIDER=nowpayments`, fill `NOWPAYMENTS_API_KEY` and
`NOWPAYMENTS_IPN_SECRET`, and use the webhook URL `…/api/webhooks/nowpayments`.)*

## Step 4 — Set up e‑Transfer (manual)

1. In Render env vars set:
   - `ETRANSFER_EMAIL` = the email customers send the Interac e‑Transfer to
   - `ETRANSFER_NAME` = the name on that account
2. Turn on **auto‑deposit** in your bank for that email so you don't approve each transfer.
3. When money arrives, open `/admin`, find the order, click **"Mark e‑Transfer paid."** Done.

## Step 5 — Confirmation emails (optional)

Leave blank to skip. To enable, set the `SMTP_*` vars (works with Zoho Mail, Gmail app password,
Resend SMTP, etc.) and `MAIL_FROM`. Customers then get "order received / payment confirmed / shipped" emails.

## Step 6 — Point your Squarespace domain at it

You **keep your domain on Squarespace** — you don't move it to GoDaddy.

1. In **Render → your service → Settings → Custom Domains**, add `www.papayapeps.com`
   (and `papayapeps.com`). Render shows you the DNS records to create.
2. In **Squarespace → Settings → Domains → papayapeps.com → DNS Settings**, add the records
   Render gave you (a CNAME for `www`, and the root/apex record per Render's instructions).
3. Wait for it to verify (minutes to a couple hours). SSL is automatic.

> If you'd rather keep your Squarespace marketing site and only use this for the store, point a
> subdomain like `shop.papayapeps.com` at Render instead.

## Step 7 — Use your store

- **Admin:** `https://your-domain/admin` → enter your `ADMIN_KEY`. You'll see every order, can
  mark e‑Transfers paid, update status (processing → shipped → delivered), and add carrier + tracking #.
- **Customers:** shop → checkout → pick Crypto or e‑Transfer → pay → track with their order number.

---

## Running it on your own computer first (optional test)

```
cp .env.example .env      # then edit .env with your values
npm install
npm start                 # open http://localhost:3000
```

## Costs

- GitHub: free · Render: free (or ~$7/mo always‑on)
- Coinbase Commerce: free, takes ~1% · NOWPayments: ~0.5% · e‑Transfer: free
- Domain: you already have it on Squarespace

## Where data lives / upgrading

Orders are stored in `data/orders.json`. That's perfect to start. When you're doing real volume,
move to a hosted database (Postgres) — only `db.js` changes; nothing else.

## Security checklist

- Use a long random `ADMIN_KEY`. Never share it or commit a `.env`.
- Keep API keys only in Render's Environment tab.
- Use the always‑on Render plan once live so webhooks aren't missed while asleep.
