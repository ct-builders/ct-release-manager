#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Seed promotion-BEARING orders into the PRODUCTION project so the dashboard's
 * Promotions table shows real Orders and Revenue impact.
 *
 * Where tools/seed-demo-orders.mjs uses the Order Import API — which bypasses
 * discount calculation entirely — this script drives the real cart flow: create a
 * cart, add line items, optionally add a discount code and a shipping method, then
 * create an order from it. commercetools applies the project's active cart
 * discounts, product discounts and discount codes along the way and records their
 * attribution on the resulting order (discountOnTotalPrice,
 * discountedPricePerQuantity, price.discounted, shippingInfo.discountedPrice,
 * discountCodes). That attribution is exactly what the dashboard reads.
 *
 * Scenarios are DERIVED FROM THE PROJECT, not hand-written: the categories that
 * actually hold products, at a spread of quantities and cart values, plus the
 * priciest products (to clear absolute thresholds), plus one cart per active
 * discount code and one per featured-attribute value. A promotion nothing happens
 * to trigger simply reports zero orders in the coverage summary at the end.
 *
 * Cart-flow orders never receive a completedAt (no API sets it outside Order
 * Import), so the dashboard counts them by their createdAt — they read as recent.
 *
 * Idempotent: order numbers are prefixed `SEED-PROMO-` and skipped if present.
 *
 *   node tools/seed-promo-orders.mjs              # create the promo orders
 *   node tools/seed-promo-orders.mjs --reset      # delete SEED-PROMO-* first, then seed
 *   node tools/seed-promo-orders.mjs --reset-only # only delete SEED-PROMO-*
 *   node tools/seed-promo-orders.mjs --env=/path/to/production.admin.env
 */
import { loadAdminEnv, adminToken, catalogConfig, localized } from "./ct-admin.mjs";

const RESET = process.argv.includes("--reset") || process.argv.includes("--reset-only");
const RESET_ONLY = process.argv.includes("--reset-only");
const PREFIX = "SEED-PROMO-";

const admin = loadAdminEnv("production.admin.env");
const API = `${admin.apiUrl}/${admin.projectKey}`;
const { locale: LOCALE, currency: CURRENCY, country: COUNTRY, city: CITY, facetAttribute: FACET_ATTR } = catalogConfig();
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260714);
const pick = (a) => a[Math.floor(rnd() * a.length)];

let TOKEN = null;
async function token() {
  return (TOKEN ??= await adminToken(admin));
}
async function api(method, path, body) {
  const t = await token();
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

// Every promotion resource an order applied (same logic as lib/dashboard.ts).
function touchedPromoIds(o) {
  const ids = new Set();
  const addInc = (dp) => { for (const inc of dp?.includedDiscounts ?? []) if (inc.discount?.id) ids.add(inc.discount.id); };
  addInc(o.discountOnTotalPrice);
  addInc(o.shippingInfo?.discountedPrice);
  for (const li of o.lineItems ?? []) {
    if (li.price?.discounted?.discount?.id) ids.add(li.price.discounted.discount.id);
    for (const dq of li.discountedPricePerQuantity ?? []) addInc(dq.discountedPrice);
  }
  for (const dc of o.discountCodes ?? []) if (dc.discountCode?.id) ids.add(dc.discountCode.id);
  return ids;
}

async function main() {
  if (RESET) {
    let deleted = 0;
    for (let off = 0; ; ) {
      const o = (await api("GET", `/orders?limit=100&offset=${off}&sort=id asc`)).body;
      for (const x of (o.results || []).filter((x) => (x.orderNumber || "").startsWith(PREFIX))) {
        const r = await api("DELETE", `/orders/${x.id}?version=${x.version}`);
        if (r.ok) deleted++;
      }
      if (!o.results || o.results.length < 100) break;
      off += 100;
    }
    console.log(`reset: deleted ${deleted} ${PREFIX}* orders`);
    if (RESET_ONLY) return;
  }

  // ---- catalog: category key -> products, featured-attribute value -> products ----
  const catKey = {};
  for (let off = 0; ; off += 200) {
    const c = (await api("GET", `/categories?limit=200&offset=${off}`)).body;
    for (const x of c.results || []) catKey[x.id] = x.key;
    if (!c.results || c.results.length < 200) break;
  }
  const byCategory = {};
  const byFacet = {};
  const allProducts = [];
  for (let off = 0; ; off += 100) {
    const p = (await api("GET", `/product-projections?staged=false&limit=100&offset=${off}`)).body;
    for (const pr of p.results || []) {
      const v = pr.masterVariant;
      const base = (v.prices || []).find((x) => x.value.currencyCode === CURRENCY && !x.channel && !x.customerGroup);
      if (!base) continue;
      const rec = {
        productId: pr.id,
        variantId: v.id,
        sku: v.sku,
        cent: base.value.centAmount,
        name: localized(pr.name, LOCALE) || v.sku,
      };
      allProducts.push(rec);
      for (const cref of pr.categories || []) {
        const k = catKey[cref.id];
        if (k) (byCategory[k] ||= []).push(rec);
      }
      const raw = (v.attributes || []).find((a) => a.name === FACET_ATTR)?.value;
      const value = raw && typeof raw === "object" ? localized(raw.label, LOCALE) || raw.label || raw.key : raw;
      if (typeof value === "string" && value.trim()) (byFacet[value.trim()] ||= []).push(rec);
    }
    if (!p.results || p.results.length < 100) break;
  }
  console.log(
    `catalog: ${allProducts.length} products priced in ${CURRENCY}, ` +
      `${Object.keys(byCategory).length} categories, ${Object.keys(byFacet).length} ${FACET_ATTR} values`
  );
  if (!allProducts.length) {
    console.error(`No products carry an unqualified ${CURRENCY} price — set NEXT_PUBLIC_CURRENCY to one the catalog prices in.`);
    process.exit(1);
  }

  // ---- a B2C customer (no business unit) ----
  const custs = (await api("GET", `/customers?limit=100&sort=createdAt asc`)).body.results || [];
  const buCustIds = new Set();
  for (const b of (await api("GET", `/business-units?limit=100`)).body.results || [])
    for (const a of b.associates || []) if (a.customer?.id) buCustIds.add(a.customer.id);
  const b2c = custs.filter((c) => !buCustIds.has(c.id));
  const customerPool = b2c.length ? b2c : custs;

  // ---- a shipping method that quotes in the reporting currency (enables
  //      shipping-target discounts and lets order-from-cart complete) ----
  const ships = ((await api("GET", `/shipping-methods?limit=50`)).body.results || []).filter((m) => m.active !== false);
  const shipMethod =
    ships.find((m) => JSON.stringify(m.zoneRates || []).includes(CURRENCY)) || ships.find((m) => m.isDefault) || ships[0];
  if (!shipMethod) console.log(`no active shipping method — carts will be created without one`);

  // helper: n products from a pool (cycles when the pool is smaller than n)
  const take = (pool, n) => (pool?.length ? Array.from({ length: n }, (_, i) => pool[i % pool.length]) : null);
  const fromCategory = (key, n) => take(byCategory[key], n);
  const fromFacet = (value, n) => take(byFacet[value], n);

  // ---- scenarios, derived from this project ----
  // Each entry is { note, items: [{ category | facet | product, qty }], code?, reps? }.
  // A shipping method is set on every cart below, so shipping-target and free-shipping
  // rules get their chance without a per-scenario flag.
  // The aim is breadth rather than precision: vary category, quantity and cart value
  // enough that predicate- and threshold-based promotions get a chance to fire, and
  // give every active discount code a cart of its own.
  const activeCodes = ((await api("GET", "/discount-codes?limit=100")).body.results || [])
    .filter((c) => c.isActive)
    .map((c) => c.code)
    .filter(Boolean);

  // the categories holding the most products, so a cart is likely to be buildable
  const topCategories = Object.entries(byCategory)
    .filter(([, arr]) => arr.length)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([key]) => key);

  // the priciest products, for carts that clear absolute-value thresholds
  const priciest = [...allProducts].sort((a, b) => b.cent - a.cent).slice(0, 5);
  const cheapest = [...allProducts].sort((a, b) => a.cent - b.cent).slice(0, 5);

  const S = [];
  // 1. per category, three quantities — covers "N or more of X" and per-category value rules
  for (const key of topCategories) for (const qty of [1, 2, 4]) S.push({ note: `${key} x${qty}`, items: [{ category: key, qty }], reps: 2 });
  // 2. high-value carts — covers absolute cart-total thresholds
  for (const [i, prod] of priciest.entries())
    for (const qty of [1, 3]) S.push({ note: `high value #${i + 1} x${qty}`, items: [{ product: prod, qty }], reps: 1 });
  // 3. bulk carts of cheap items — covers quantity thresholds and multi-buy / BOGO rules
  for (const [i, prod] of cheapest.entries()) S.push({ note: `bulk #${i + 1} x6`, items: [{ product: prod, qty: 6 }], reps: 1 });
  // 4. one cart per featured-attribute value — covers attribute-scoped product discounts
  for (const value of Object.keys(byFacet).slice(0, 6)) S.push({ note: `${FACET_ATTR} ${value}`, items: [{ facet: value, qty: 2 }], reps: 1 });
  // 5. one cart per active discount code, generously sized so minimum-spend codes qualify
  for (const code of activeCodes)
    S.push({ note: `code ${code}`, items: [{ product: priciest[0] ?? allProducts[0], qty: 2 }], code, reps: 2 });
  // 6. one small and one large cart — free-shipping rules usually turn on cart value
  S.push({ note: "small cart", items: [{ product: cheapest[0] ?? allProducts[0], qty: 1 }], reps: 2 });
  S.push({ note: "large cart", items: [{ product: priciest[0] ?? allProducts[0], qty: 2 }], reps: 2 });

  console.log(`scenarios: ${S.length} (${activeCodes.length} active discount codes)`);

  // ---- next available order number ----
  let seq = 0;
  for (let off = 0; ; off += 100) {
    const where = encodeURIComponent(`orderNumber >= "${PREFIX}0000" and orderNumber < "${PREFIX}9999"`);
    const o = (await api("GET", `/orders?where=${where}&limit=100&offset=${off}&sort=orderNumber desc`)).body;
    for (const x of o.results || []) {
      const m = (x.orderNumber || "").match(new RegExp(`^${PREFIX}(\\d+)$`));
      if (m) seq = Math.max(seq, Number(m[1]));
    }
    if (!o.results || o.results.length < 100) break;
  }

  const addr = { country: COUNTRY, ...(CITY ? { city: CITY } : {}), firstName: "Demo", lastName: "Shopper" };
  const coverage = new Map(); // promoId -> orders count
  let created = 0, failed = 0, skippedItems = 0;

  for (const sc of S) {
    // resolve products for this scenario
    const lineItems = [];
    let missing = false;
    for (const it of sc.items) {
      const prods = it.product ? [it.product] : it.facet ? fromFacet(it.facet, 1) : fromCategory(it.category, 1);
      if (!prods) { missing = true; break; }
      lineItems.push({ productId: prods[0].productId, variantId: prods[0].variantId, quantity: it.qty });
    }
    if (missing) { console.log(`  skip "${sc.note}" — no products for ${JSON.stringify(sc.items)}`); skippedItems++; continue; }

    for (let r = 0; r < (sc.reps || 1); r++) {
      const orderNumber = `${PREFIX}${String(++seq).padStart(4, "0")}`;
      const cust = pick(customerPool);
      // 1) cart
      const cartRes = await api("POST", "/carts", {
        currency: CURRENCY, country: COUNTRY, customerId: cust.id, customerEmail: cust.email,
        shippingAddress: { ...addr, firstName: cust.firstName || addr.firstName, lastName: cust.lastName || addr.lastName },
        billingAddress: addr, lineItems,
      });
      if (!cartRes.ok) { failed++; if (failed <= 6) console.log(`  cart FAIL "${sc.note}": ${cartRes.status} ${JSON.stringify(cartRes.body.errors || cartRes.body).slice(0, 180)}`); continue; }
      let cart = cartRes.body;
      const upd = async (actions) => {
        const res = await api("POST", `/carts/${cart.id}`, { version: cart.version, actions });
        if (res.ok) cart = res.body;
        return res;
      };
      // 2) shipping method on every cart (best-effort): lets order-from-cart complete and
      //    enables shipping-target discounts to attribute.
      if (shipMethod) await upd([{ action: "setShippingMethod", shippingMethod: { typeId: "shipping-method", id: shipMethod.id } }]);
      // 3) discount code
      if (sc.code) {
        const res = await upd([{ action: "addDiscountCode", code: sc.code }]);
        if (!res.ok && failed <= 6) console.log(`  code ${sc.code} on "${sc.note}": ${res.status} ${JSON.stringify(res.body.errors || res.body).slice(0, 140)}`);
      }
      // 4) order from cart
      const ordRes = await api("POST", "/orders", { cart: { typeId: "cart", id: cart.id }, version: cart.version, orderNumber });
      if (!ordRes.ok) { failed++; if (failed <= 6) console.log(`  order FAIL "${sc.note}" ${orderNumber}: ${ordRes.status} ${JSON.stringify(ordRes.body.errors || ordRes.body).slice(0, 180)}`); await api("DELETE", `/carts/${cart.id}?version=${cart.version}`); continue; }
      let ord = ordRes.body;
      // 5) mark complete + paid (realism; dashboard counts it by createdAt regardless)
      const comp = await api("POST", `/orders/${ord.id}`, { version: ord.version, actions: [{ action: "changeOrderState", orderState: "Complete" }, { action: "changePaymentState", paymentState: "Paid" }] });
      if (comp.ok) ord = comp.body;
      created++;
      for (const id of touchedPromoIds(ord)) coverage.set(id, (coverage.get(id) || 0) + 1);
    }
  }

  // ---- coverage report ----
  const nameById = new Map();
  for (const path of ["/cart-discounts?limit=100", "/product-discounts?limit=100"]) {
    for (const d of (await api("GET", path)).body.results || []) nameById.set(d.id, localized(d.name, LOCALE) || d.key || d.id);
  }
  for (const c of (await api("GET", "/discount-codes?limit=100")).body.results || []) nameById.set(c.id, `code ${c.code}`);

  console.log(`\nDONE. created ${created} promo orders, failed ${failed}, scenarios skipped ${skippedItems}.`);
  console.log(`promotions attributed: ${coverage.size}`);
  for (const [id, n] of [...coverage.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)} orders  ${nameById.get(id) || id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
