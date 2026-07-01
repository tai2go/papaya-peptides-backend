// payments.js — crypto payments via a hosted checkout provider.
// Supported: Coinbase Commerce (default) or NOWPayments. Pick one with PAYMENT_PROVIDER in your .env.
// You create the account + get the API key yourself; you paste it into .env. No card data ever touches this server.
import crypto from 'crypto';

const PROVIDER = (process.env.PAYMENT_PROVIDER || 'coinbase').toLowerCase();
const CURRENCY = (process.env.CURRENCY || 'CAD').toUpperCase();

// Create a hosted crypto checkout for an order. Returns { provider, chargeId, hostedUrl }.
export async function createCryptoCharge(order, baseUrl) {
  if (PROVIDER === 'nowpayments') return createNow(order, baseUrl);
  return createCoinbase(order, baseUrl);
}

async function createCoinbase(order, baseUrl) {
  const key = process.env.COINBASE_API_KEY;
  if (!key) throw new Error('COINBASE_API_KEY not set');
  const res = await fetch('https://api.commerce.coinbase.com/charges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC-Api-Key': key, 'X-CC-Version': '2018-03-22' },
    body: JSON.stringify({
      name: 'Papaya Peptides Order ' + order.orderNo,
      description: order.items.map(i => `${i.qty}x ${i.name}`).join(', ').slice(0, 200),
      pricing_type: 'fixed_price',
      local_price: { amount: order.total.toFixed(2), currency: CURRENCY },
      metadata: { orderNo: order.orderNo },
      redirect_url: `${baseUrl}/?paid=${order.orderNo}`,
      cancel_url: `${baseUrl}/?cancelled=${order.orderNo}`
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Coinbase error: ' + JSON.stringify(data));
  return { provider: 'coinbase', chargeId: data.data.id, hostedUrl: data.data.hosted_url };
}

async function createNow(order, baseUrl) {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) throw new Error('NOWPAYMENTS_API_KEY not set');
  const res = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      price_amount: order.total,
      price_currency: CURRENCY.toLowerCase(),
      order_id: order.orderNo,
      order_description: 'Papaya Peptides ' + order.orderNo,
      ipn_callback_url: `${baseUrl}/api/webhooks/nowpayments`,
      success_url: `${baseUrl}/?paid=${order.orderNo}`,
      cancel_url: `${baseUrl}/?cancelled=${order.orderNo}`
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('NOWPayments error: ' + JSON.stringify(data));
  return { provider: 'nowpayments', chargeId: String(data.id), hostedUrl: data.invoice_url };
}

// ---- Webhook signature verification (so a faker can't mark orders "paid") ----

export function verifyCoinbase(rawBody, signature) {
  const secret = process.env.COINBASE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const h = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(signature)); } catch { return false; }
}

export function verifyNow(rawBody, signature) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature) return false;
  // NOWPayments signs the HMAC-SHA512 of the JSON with keys sorted alphabetically.
  let obj; try { obj = JSON.parse(rawBody); } catch { return false; }
  const sorted = JSON.stringify(sortKeys(obj));
  const h = crypto.createHmac('sha512', secret).update(sorted).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(signature)); } catch { return false; }
}
function sortKeys(o) {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === 'object') return Object.keys(o).sort().reduce((a, k) => (a[k] = sortKeys(o[k]), a), {});
  return o;
}

export const PAYMENT_PROVIDER = PROVIDER;
