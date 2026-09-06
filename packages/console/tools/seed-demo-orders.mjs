#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Seed recent, time-spread orders into the PRODUCTION project so the dashboard has
 * something real to show, sliceable by time (today / 7d / 30d) and by channel
 * (B2B vs B2C). Orders are Complete, with completedAt spread over the last ~35
 * days and weighted toward recent so the trend line rises gently. B2B orders
 * carry a businessUnit and store; B2C orders are store-less.
 *
 * Priced in the configured currency, shipped to the configured country. Products,
 * customers and business units all come from the project — nothing about a
 * particular catalog is assumed.
 *
 * These orders bypass discount calculation (the Order Import API applies no
 * promotions), so the dashboard's Promotions table stays empty. Run
 * tools/seed-promo-orders.mjs for that.
 *
 * Idempotent: order numbers are prefixed `SEED-` and skipped if already present.
 *
 *   node tools/seed-demo-orders.mjs           # create up to COUNT recent orders
 *   node tools/seed-demo-orders.mjs --reset   # delete SEED-* orders first
 *   node tools/seed-demo-orders.mjs --env=/path/to/production.admin.env
 */
import { loadAdminEnv, adminToken, catalogConfig } from "./ct-admin.mjs";

const RESET = process.argv.includes("--reset");
const COUNT = 160;
const WINDOW_DAYS = 35;
const DAY = 86400000;
const PREFIX = "SEED-";

const admin = loadAdminEnv("production.admin.env");
const API = `${admin.apiUrl}/${admin.projectKey}`;
const { currency: CURRENCY, country: COUNTRY, city: CITY } = catalogConfig();
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const money = (cent) => ({ type: "centPrecision", currencyCode: CURRENCY, centAmount: cent, fractionDigits: 2 });

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
  }

  // product pool with an unqualified base price in the configured currency
  const POOL = [];
  for (let off = 0; ; off += 100) {
    const p = (await api("GET", `/product-projections?staged=false&limit=100&offset=${off}`)).body;
    for (const pr of p.results || []) {
      const v = pr.masterVariant;
      const base = (v.prices || []).find((x) => x.value.currencyCode === CURRENCY && !x.channel && !x.customerGroup);
      if (base) POOL.push({ productId: pr.id, variantId: v.id, sku: v.sku, name: pr.name, cent: base.value.centAmount });
    }
    if (!p.results || p.results.length < 100) break;
  }
  console.log(`${CURRENCY} product pool:`, POOL.length);
  if (!POOL.length) {
    console.error(`No products carry an unqualified ${CURRENCY} price — set NEXT_PUBLIC_CURRENCY to one the catalog prices in.`);
    process.exit(1);
  }

  // business units (for B2B) + a store each
  const bus = (await api("GET", "/business-units?limit=100")).body.results || [];
  const buList = bus.map((b) => ({ key: b.key, storeKey: (b.stores || []).map((s) => s.key)[0] || null, assoc: (b.associates || []).map((a) => a.customer?.id).filter(Boolean) }));
  // customers
  const customers = [];
  for (let off = 0; ; off += 100) {
    const c = (await api("GET", `/customers?limit=100&offset=${off}&sort=createdAt asc`)).body;
    customers.push(...(c.results || []));
    if (!c.results || c.results.length < 100) break;
  }
  // Active shipping methods actually defined on this project, default first. The
  // first is used as "standard" and the second as "express"; with none defined the
  // orders carry a name-only shippingInfo, which Order Import accepts.
  const shipMethods = ((await api("GET", "/shipping-methods?limit=50")).body.results || [])
    .filter((m) => m.key && m.active !== false)
    .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault))
    .map((m) => ({ key: m.key, name: m.name }));
  const standardShip = shipMethods[0] ?? null;
  const expressShip = shipMethods[1] ?? standardShip;
  console.log("shipping methods:", shipMethods.length ? shipMethods.map((m) => m.key).join(", ") : "none (name-only shippingInfo)");

  const buOfCust = {};
  for (const b of buList) for (const id of b.assoc) buOfCust[id] = b;
  const b2cCustomers = customers.filter((c) => !buOfCust[c.id]);
  console.log("customers:", customers.length, "| B2B business units:", buList.length, "| B2C customers:", b2cCustomers.length);

  const now = Date.now();
  const rnd = mulberry32(20260712);
  let created = 0, skipped = 0, failed = 0, b2b = 0;
  for (let i = 1; i <= COUNT; i++) {
    const orderNumber = `${PREFIX}${String(i).padStart(4, "0")}`;
    const existing = (await api("GET", `/orders?where=${encodeURIComponent(`orderNumber="${orderNumber}"`)}&limit=1`)).body;
    if (existing.total > 0) { skipped++; continue; }

    const wantB2B = rnd() < 0.6 && buList.some((b) => b.storeKey);
    let cust, bu = null;
    if (wantB2B) {
      bu = pick(rnd, buList.filter((b) => b.storeKey));
      const custId = bu.assoc.length ? pick(rnd, bu.assoc) : null;
      cust = customers.find((c) => c.id === custId) || pick(rnd, customers);
    } else {
      cust = b2cCustomers.length ? pick(rnd, b2cCustomers) : pick(rnd, customers);
    }

    const nItems = between(rnd, 1, 4);
    const chosen = new Set();
    const lineItems = [];
    let goods = 0;
    for (let li = 0; li < nItems; li++) {
      let prod, guard = 0;
      do { prod = pick(rnd, POOL); guard++; } while (chosen.has(prod.sku) && guard < 12);
      if (chosen.has(prod.sku)) continue;
      chosen.add(prod.sku);
      const qty = between(rnd, 1, 3);
      goods += prod.cent * qty;
      lineItems.push({ name: prod.name, productId: prod.productId, variant: { id: prod.variantId, sku: prod.sku }, quantity: qty, price: { value: money(prod.cent) } });
    }
    if (!lineItems.length) { continue; }
    const express = rnd() < 0.25;
    const shipCost = express ? 1000 : 500;
    // weighted-recent day offset (r^1.8 skews toward 0 = recent) → upward trend
    const dayOffset = Math.floor(Math.pow(rnd(), 1.8) * WINDOW_DAYS);
    const completedAt = new Date(now - dayOffset * DAY - Math.floor(rnd() * DAY)).toISOString();
    const addr = {
      firstName: cust.firstName || "Demo",
      lastName: cust.lastName || "Shopper",
      country: COUNTRY,
      ...(CITY ? { city: CITY } : {}),
    };
    const draft = {
      orderNumber, customerId: cust.id, customerEmail: cust.email,
      totalPrice: money(goods + shipCost), country: COUNTRY,
      orderState: "Complete", paymentState: "Paid", shipmentState: express ? "Shipped" : "Delivered",
      inventoryMode: "None", origin: "Customer", completedAt,
      lineItems, shippingAddress: addr, billingAddress: addr,
      shippingInfo: (() => {
        const m = express ? expressShip : standardShip;
        return {
          shippingMethodName: m?.name ? m.name : express ? "Express shipping" : "Standard shipping",
          price: money(shipCost),
          shippingRate: { price: money(shipCost) },
          ...(m ? { shippingMethod: { typeId: "shipping-method", key: m.key } } : {}),
        };
      })(),
    };
    if (bu) {
      draft.businessUnit = { typeId: "business-unit", key: bu.key };
      if (bu.storeKey) draft.store = { typeId: "store", key: bu.storeKey };
    }
    const res = await api("POST", "/orders/import", draft);
    if (res.ok) { created++; if (bu) b2b++; }
    else { failed++; if (failed <= 5) console.log(`  ERROR ${orderNumber}: ${res.status} ${JSON.stringify(res.body.errors || res.body).slice(0, 200)}`); }
  }
  console.log(`\nDONE. created ${created} (B2B ${b2b} / B2C ${created - b2b}), skipped ${skipped}, failed ${failed}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
