// products.js — the source of truth for what can be sold and for how much.
// Prices are enforced on the SERVER so a customer can never tamper with them in the browser.
export const PRODUCTS = [
  { id: "cjc-no-dac", name: "CJC-1295 no DAC", cat: "Muscle Growth", vial: "5 mg", price: 55 },
  { id: "ipamorelin", name: "Ipamorelin", cat: "Muscle Growth", vial: "5 mg", price: 80 },
  { id: "cjc-ipa-blend", name: "CJC-1295 no DAC + Ipamorelin", cat: "Muscle Growth", vial: "10 mg (5+5)", price: 80 },
  { id: "tesamorelin", name: "Tesamorelin", cat: "Weight Loss", vial: "10 mg", price: 90 },
  { id: "mots-c", name: "MOTS-C", cat: "Weight Loss", vial: "10 mg", price: 50 },
  { id: "bpc-157", name: "BPC-157", cat: "Recovery", vial: "10 mg", price: 65 },
  { id: "tb-500", name: "TB-500", cat: "Recovery", vial: "10 mg", price: 65 },
  { id: "bpc-tb-blend", name: "BPC-157 / TB-500 Blend", cat: "Recovery", vial: "10 mg (5+5)", price: 75 },
  { id: "kpv", name: "KPV", cat: "Recovery", vial: "10 mg", price: 50 },
  { id: "klow", name: "KLOW Blend", cat: "Anti-Aging", vial: "80 mg", price: 100 },
  { id: "semax", name: "Semax", cat: "Cognitive", vial: "10 mg", price: 50 },
  { id: "selank", name: "Selank", cat: "Cognitive", vial: "10 mg", price: 70 },
  { id: "ghk-cu", name: "GHK-Cu", cat: "Anti-Aging", vial: "50 mg", price: 40 },
  { id: "glow", name: "Glow Blend", cat: "Anti-Aging", vial: "70 mg", price: 120 },
  { id: "epitalon", name: "Epitalon", cat: "Anti-Aging", vial: "10 mg", price: 40 },
  { id: "nad", name: "NAD+", cat: "Anti-Aging", vial: "500 mg", price: 40 },
  { id: "retatrutide", name: "Retatrutide", cat: "Weight Loss", vial: "20 mg", price: 150 },
  { id: "tirzepatide", name: "Tirzepatide", cat: "Weight Loss", vial: "10 mg", price: 110 },
  { id: "semaglutide", name: "Semaglutide", cat: "Weight Loss", vial: "5 mg", price: 80 },
  { id: "sterile-water", name: "Bacteriostatic Water", cat: "Supplies", vial: "10 ml", price: 10 },
  { id: "alcohol-pads", name: "Alcohol Pads", cat: "Supplies", vial: "30 / box", price: 10 },
  { id: "syringes", name: "Injection Syringes", cat: "Supplies", vial: "30 / box", price: 15 }
];

export const byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

// Supplies (water, pads, syringes) are excluded from bundle discounts.
export function isAncillary(p) { return !!p && p.cat === 'Supplies'; }
// Bundle discount, applied per line item (matches the storefront): buy 2 = 10% off, buy 3+ = 20% off.
export function discountRate(qty, p) { return isAncillary(p) ? 0 : (qty >= 3 ? 0.20 : qty >= 2 ? 0.10 : 0); }
export function lineTotal(p, qty) { return Math.round(p.price * qty * (1 - discountRate(qty, p))); }

// Free shipping over $150, otherwise flat $12 (CAD).
export function shippingFor(subtotal) { return subtotal === 0 ? 0 : (subtotal >= 150 ? 0 : 12); }

// Canadian combined sales tax (GST/HST/PST) by province code. We ship within Canada only.
export const TAX_RATES = { ON:13, BC:12, AB:5, QC:14.975, MB:12, SK:11, NS:14, NB:15, NL:15, PE:15, NT:5, YT:5, NU:5 };
export function taxFor(subtotal, province) { const r = TAX_RATES[province] || 0; return Math.round(subtotal * r / 100); }
