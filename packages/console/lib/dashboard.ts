/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { prodCt, type Paged } from "./ct";
import type { LocalizedString } from "./types";
import { LOCALE, CURRENCY, FX_RATES } from "./config";

/**
 * Merchandising dashboard — AGGREGATE sales analytics from the PRODUCTION project
 * (via prodCt), sliceable by time range and channel (B2B/B2C). No individual
 * orders or customer data. The trend is REAL, bucketed by completedAt.
 *
 * Orders in several currencies are summed into the configured reporting CURRENCY
 * with the indicative FX_RATES, and every total is labelled as approximate.
 */

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0]) : undefined);
const toReporting = (cents: number, currency: string) => (cents / 100) * (FX_RATES[currency] ?? 1);
const DAY = 86400000;

export type Range = "today" | "7d" | "30d" | "all" | "custom";
export type Channel = "all" | "b2b" | "b2c";

type Money = { currencyCode: string; centAmount: number };
type DiscountRef = { typeId?: string; id?: string };
type DiscountedPrice = { includedDiscounts?: { discount?: DiscountRef }[] };
type LineItem = {
  productId?: string;
  name?: LocalizedString;
  quantity: number;
  totalPrice: Money;
  price?: { discounted?: { discount?: DiscountRef } };
  discountedPricePerQuantity?: { discountedPrice?: DiscountedPrice }[];
};
type Order = {
  completedAt?: string;
  createdAt?: string;
  totalPrice: Money;
  businessUnit?: unknown;
  discountCodes?: { discountCode?: { id?: string } }[];
  lineItems?: LineItem[];
  shippingInfo?: { discountedPrice?: DiscountedPrice };
  discountOnTotalPrice?: DiscountedPrice;
};
type Discount = { id: string; key?: string; name?: LocalizedString; isActive?: boolean };
type Code = { id: string; code: string; name?: LocalizedString; isActive?: boolean };
type Product = { id: string; masterData?: { current?: { categories?: { id: string }[] } } };
type Category = { id: string; name?: LocalizedString };

export type TrendPoint = { label: string; sales: number };
export type DashboardData = {
  range: Range;
  channel: Channel;
  /** in the reporting CURRENCY, approximate across currencies */
  totalSales: number;
  orders: number;
  /** average order value, in the reporting CURRENCY */
  aov: number;
  salesTrendPct: number;
  activePromotions: number;
  trend: TrendPoint[];
  topProducts: { name: string; units: number; revenue: number }[];
  topCategories: { name: string; revenue: number }[];
  topPromotions: { label: string; type: string; orders: number; revenue: number }[];
  activeDiscounts: { name: string; type: string }[];
};

function resolveRange(range: Range, from?: string, to?: string): { fromMs: number; toMs: number } {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return { fromMs: startOfToday.getTime(), toMs: now };
    case "7d":
      return { fromMs: now - 7 * DAY, toMs: now };
    case "30d":
      return { fromMs: now - 30 * DAY, toMs: now };
    case "custom": {
      const f = from ? Date.parse(from) : NaN;
      const t = to ? Date.parse(to) + DAY - 1 : now;
      if (!Number.isNaN(f)) return { fromMs: f, toMs: Number.isNaN(t) ? now : t };
      return { fromMs: now - 90 * DAY, toMs: now };
    }
    case "all":
    default:
      return { fromMs: now - 730 * DAY, toMs: now };
  }
}

function bucketize(orders: { at: number; amount: number }[], fromMs: number, toMs: number): { trend: TrendPoint[]; pct: number } {
  const span = Math.max(DAY, toMs - fromMs);
  const n = span <= 2 * DAY ? 12 : span <= 45 * DAY ? Math.min(30, Math.ceil(span / DAY)) : 14;
  const step = span / n;
  const buckets = Array.from({ length: n }, () => 0);
  for (const o of orders) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor((o.at - fromMs) / step)));
    buckets[idx] += o.amount;
  }
  const hourly = span <= 2 * DAY;
  const trend = buckets.map((sales, i) => {
    const start = new Date(fromMs + i * step);
    const label = hourly
      ? start.toLocaleTimeString(LOCALE, { hour: "numeric" })
      : start.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
    return { label, sales };
  });
  const half = Math.floor(n / 2);
  const prior = buckets.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = buckets.slice(half).reduce((a, b) => a + b, 0);
  const pct = prior > 0 ? ((recent - prior) / prior) * 100 : recent > 0 ? 100 : 0;
  return { trend, pct };
}

export async function getDashboard(opts: { range?: Range; channel?: Channel; from?: string; to?: string } = {}): Promise<DashboardData> {
  const range = opts.range ?? "30d";
  const channel = opts.channel ?? "all";
  const { fromMs, toMs } = resolveRange(range, opts.from, opts.to);

  // server-side filter: orders whose effective date is in range, optional channel.
  // Effective date = completedAt when set, else createdAt — so orders not yet marked
  // complete (e.g. real storefront carts, which never receive a completedAt) are still
  // counted, and recent promotion-bearing orders show up in the analytics.
  const fromISO = new Date(fromMs).toISOString();
  const toISO = new Date(toMs).toISOString();
  const inRange = (f: string) => `${f} >= "${fromISO}" and ${f} <= "${toISO}"`;
  const clauses = [`((${inRange("completedAt")}) or (completedAt is not defined and ${inRange("createdAt")}))`];
  if (channel === "b2b") clauses.push("businessUnit is defined");
  if (channel === "b2c") clauses.push("businessUnit is not defined");
  const where = encodeURIComponent(clauses.join(" and "));

  const [ordersRes, cart, product, codes] = await Promise.all([
    prodCt.get<Paged<Order>>(`/orders?where=${where}&limit=500&sort=completedAt desc`).catch(() => empty<Order>()),
    prodCt.get<Paged<Discount>>("/cart-discounts?limit=100").catch(() => empty<Discount>()),
    prodCt.get<Paged<Discount>>("/product-discounts?limit=100").catch(() => empty<Discount>()),
    prodCt.get<Paged<Code>>("/discount-codes?limit=100").catch(() => empty<Code>()),
  ]);
  const orders = ordersRes.results;

  let totalSales = 0;
  const forTrend: { at: number; amount: number }[] = [];
  const prod = new Map<string, { name: string; units: number; revenue: number }>();
  // orders + revenue attributed to each promotion, keyed by resource id (cart-discount id,
  // product-discount id, or discount-code id). Each order counts once per promotion it used.
  const promoUse = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const amount = toReporting(o.totalPrice?.centAmount ?? 0, o.totalPrice?.currencyCode ?? CURRENCY);
    totalSales += amount;
    if (o.completedAt) forTrend.push({ at: Date.parse(o.completedAt), amount });
    for (const li of o.lineItems ?? []) {
      if (!li.productId) continue;
      const rev = toReporting(li.totalPrice?.centAmount ?? 0, li.totalPrice?.currencyCode ?? CURRENCY);
      const p = prod.get(li.productId) ?? { name: loc(li.name) || li.productId, units: 0, revenue: 0 };
      p.units += li.quantity ?? 0;
      p.revenue += rev;
      prod.set(li.productId, p);
    }
    // Every promotion resource that touched this order (deduped): product discounts on line
    // prices, cart discounts on line items / shipping / order total, and applied discount codes.
    const touched = new Set<string>();
    const addIncluded = (dp?: DiscountedPrice) => {
      for (const inc of dp?.includedDiscounts ?? []) if (inc.discount?.id) touched.add(inc.discount.id);
    };
    addIncluded(o.discountOnTotalPrice);
    addIncluded(o.shippingInfo?.discountedPrice);
    for (const li of o.lineItems ?? []) {
      if (li.price?.discounted?.discount?.id) touched.add(li.price.discounted.discount.id);
      for (const dq of li.discountedPricePerQuantity ?? []) addIncluded(dq.discountedPrice);
    }
    for (const dc of o.discountCodes ?? []) if (dc.discountCode?.id) touched.add(dc.discountCode.id);
    for (const id of touched) {
      const prev = promoUse.get(id) ?? { orders: 0, revenue: 0 };
      promoUse.set(id, { orders: prev.orders + 1, revenue: prev.revenue + amount });
    }
  }

  const count = orders.length;
  const { trend, pct } = bucketize(forTrend, fromMs, toMs);
  const topProducts = [...prod.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const topCategories = await computeTopCategories(prod);

  const cartActive = cart.results.filter((d) => d.isActive).length;
  const productActive = product.results.filter((d) => d.isActive).length;
  const codeActive = codes.results.filter((c) => c.isActive).length;
  // List active promotions across all three types. Revenue impact = summed total of the orders
  // that applied each promotion, matched by resource id from the orders' discount attribution.
  const rowFor = (id: string, label: string, type: string) => {
    const u = promoUse.get(id) ?? { orders: 0, revenue: 0 };
    return { label, type, orders: u.orders, revenue: u.revenue };
  };
  const codeRows = codes.results.filter((c) => c.isActive).map((c) => rowFor(c.id, c.code || loc(c.name) || "code", "Code"));
  const cartRows = cart.results.filter((d) => d.isActive).map((d) => rowFor(d.id, loc(d.name) || "Cart discount", "Cart"));
  const productRows = product.results.filter((d) => d.isActive).map((d) => rowFor(d.id, loc(d.name) || "Product discount", "Product"));
  const topPromotions = [...codeRows, ...cartRows, ...productRows]
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.label.localeCompare(b.label))
    .slice(0, 12);
  const activeDiscounts = [
    ...cart.results.filter((d) => d.isActive).map((d) => ({ name: loc(d.name) || "Cart discount", type: "Cart" })),
    ...product.results.filter((d) => d.isActive).map((d) => ({ name: loc(d.name) || "Product discount", type: "Product" })),
  ].slice(0, 8);

  return {
    range,
    channel,
    totalSales,
    orders: count,
    aov: count ? totalSales / count : 0,
    salesTrendPct: pct,
    activePromotions: cartActive + productActive + codeActive,
    trend,
    topProducts,
    topCategories,
    topPromotions,
    activeDiscounts,
  };
}

async function computeTopCategories(
  prod: Map<string, { name: string; units: number; revenue: number }>
): Promise<{ name: string; revenue: number }[]> {
  const ids = [...prod.keys()].slice(0, 400);
  if (!ids.length) return [];
  try {
    const pred = `id in (${ids.map((i) => JSON.stringify(i)).join(",")})`;
    const products = await prodCt.get<Paged<Product>>(`/products?where=${encodeURIComponent(pred)}&limit=500`);
    const primaryCat = new Map<string, string>();
    const catIds = new Set<string>();
    for (const p of products.results) {
      const first = p.masterData?.current?.categories?.[0]?.id;
      if (first) {
        primaryCat.set(p.id, first);
        catIds.add(first);
      }
    }
    if (!catIds.size) return [];
    const cpred = `id in (${[...catIds].map((i) => JSON.stringify(i)).join(",")})`;
    const cats = await prodCt.get<Paged<Category>>(`/categories?where=${encodeURIComponent(cpred)}&limit=500`);
    const catName = new Map(cats.results.map((c) => [c.id, loc(c.name) || c.id]));
    const revByCat = new Map<string, number>();
    for (const [productId, p] of prod) {
      const cid = primaryCat.get(productId);
      if (!cid) continue;
      revByCat.set(cid, (revByCat.get(cid) ?? 0) + p.revenue);
    }
    return [...revByCat.entries()]
      .map(([cid, revenue]) => ({ name: catName.get(cid) || cid, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function empty<T>(): Paged<T> {
  return { limit: 0, offset: 0, count: 0, total: 0, results: [] };
}
