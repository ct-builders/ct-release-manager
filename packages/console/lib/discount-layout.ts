/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, CtError, type Paged } from "./ct";
import { formatMoney } from "./money";
import type { LocalizedString } from "./types";
import type { RawValue, RawTarget } from "./discount-model";
import type { DiscountGroup, LayoutData, OrderableDiscount, OrderableKind } from "./discount-layout-types";
import { LOCALE } from "./config";
import { DISCOUNT_LAYOUT_CONTAINER } from "./containers";

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0] ?? "") : "");

const CONTAINER = DISCOUNT_LAYOUT_CONTAINER;
const EP: Record<OrderableKind, string> = { "cart-discount": "cart-discounts", "product-discount": "product-discounts" };
const UNGROUPED = { id: "ungrouped", name: "Ungrouped" };

type RawDiscount = { id: string; key?: string; version: number; name?: LocalizedString; isActive?: boolean; sortOrder?: string; value?: RawValue; target?: RawTarget };

function summarize(kind: OrderableKind, v?: RawValue, t?: RawTarget): string {
  const val = v?.type === "relative" ? `${(v.permyriad ?? 0) / 100}% off`
    : v?.type === "absolute" && v.money?.length ? `${formatMoney(v.money[0].centAmount, v.money[0].currencyCode, v.money[0].fractionDigits)} off`
    : v?.type ?? "";
  if (kind === "product-discount" || !t) return val;
  if (t.type === "shipping") return v?.type === "relative" && (v.permyriad ?? 0) >= 10000 ? "Free shipping" : `${val} shipping`;
  if (t.type === "totalPrice") return `${val} order`;
  if (t.type === "lineItems") return `${val} on selected items`;
  if (t.type === "multiBuyLineItems") return `Buy ${t.triggerQuantity}, get ${t.discountedQuantity} at ${val}`;
  return val;
}

async function fetchDiscounts(kind: OrderableKind): Promise<RawDiscount[]> {
  const r = await ct.get<Paged<RawDiscount>>(`/${EP[kind]}?limit=200`).catch(() => ({ results: [] as RawDiscount[] } as Paged<RawDiscount>));
  return r.results.filter((d) => d.key); // only keyed discounts can be ordered/referenced by key
}

type LayoutCo = { groups: DiscountGroup[]; updatedAt?: string; by?: string };

async function readLayoutCo(kind: OrderableKind): Promise<LayoutCo | null> {
  try {
    const o = await ct.get<{ value: LayoutCo }>(`/custom-objects/${CONTAINER}/${ct.enc(kind)}`);
    return o.value;
  } catch {
    return null;
  }
}

/** Reconcile a saved layout with the live discount set: every current discount lands
 *  in exactly one group; unknown/stale keys are dropped; new ones go to "Ungrouped". */
function reconcile(saved: DiscountGroup[], keys: string[]): DiscountGroup[] {
  const known = new Set(keys);
  const seen = new Set<string>();
  const groups: DiscountGroup[] = saved.map((g) => ({
    id: g.id,
    name: g.name,
    items: (g.items || []).filter((k) => known.has(k) && !seen.has(k) && (seen.add(k), true)),
  }));
  const leftover = keys.filter((k) => !seen.has(k));
  if (leftover.length) {
    const ung = groups.find((g) => g.id === UNGROUPED.id);
    if (ung) ung.items.push(...leftover);
    else groups.push({ ...UNGROUPED, items: leftover });
  }
  return groups.length ? groups : [{ ...UNGROUPED, items: keys }];
}

export async function loadLayoutData(kind: OrderableKind): Promise<LayoutData> {
  const [co, discounts] = await Promise.all([readLayoutCo(kind), fetchDiscounts(kind)]);
  const items: OrderableDiscount[] = discounts.map((d) => ({
    key: d.key as string,
    name: loc(d.name) || (d.key as string),
    summary: summarize(kind, d.value, d.target),
    isActive: !!d.isActive,
  }));
  const groups = reconcile(co?.groups ?? [], items.map((d) => d.key));
  return { kind, groups, discounts: items, updatedAt: co?.updatedAt, by: co?.by };
}

/** Deterministic, unique, valid (0<x<1, no trailing zero), descending sort orders.
 *  index 0 (top) gets the highest value = applied first. */
export function computeSortOrders(flatKeys: string[]): Map<string, string> {
  const n = flatKeys.length;
  const w = String(n).length;
  const m = new Map<string, string>();
  flatKeys.forEach((k, i) => m.set(k, `0.${String(n - i).padStart(w, "0")}5`));
  return m;
}

function isDuplicateSortOrder(e: unknown): boolean {
  if (!(e instanceof CtError)) return false;
  const errs = (e.body as { errors?: { code?: string; field?: string }[] })?.errors ?? [];
  return errs.some((x) => x.code === "DuplicateField" && (x.field === "sortOrder" || !x.field)) || (e.status === 400 && String(e.message).toLowerCase().includes("sortorder"));
}
const perturb = (so: string, bump: number) => so.slice(0, -1) + String(5 + bump); // keep the slot, change trailing non-zero digit

/** Write changeSortOrder to every discount whose order changed. Multi-pass to dodge
 *  transient uniqueness collisions while the set is being renumbered. */
async function writeSortOrders(kind: OrderableKind, targets: Map<string, string>): Promise<number> {
  const fresh = await fetchDiscounts(kind);
  const state = new Map(fresh.map((d) => [d.key as string, { version: d.version, sortOrder: d.sortOrder ?? "" }]));
  let remaining = [...targets.entries()].filter(([k, so]) => state.get(k) && state.get(k)!.sortOrder !== so);
  let changed = 0;

  for (let pass = 0; pass < 5 && remaining.length; pass++) {
    const next: [string, string][] = [];
    for (const [key, so] of remaining) {
      const st = state.get(key)!;
      const value = pass >= 3 ? perturb(so, pass - 2) : so; // late passes: nudge to break a stubborn collision
      try {
        const res = await ct.post<{ version: number }>(`/${EP[kind]}/key=${ct.enc(key)}`, { version: st.version, actions: [{ action: "changeSortOrder", sortOrder: value }] });
        st.version = res.version;
        st.sortOrder = value;
        changed++;
      } catch (e) {
        if (isDuplicateSortOrder(e)) { next.push([key, so]); continue; }
        if (e instanceof CtError && e.status === 409) {
          const cur = await ct.get<RawDiscount>(`/${EP[kind]}/key=${ct.enc(key)}`).catch(() => null);
          if (cur) st.version = cur.version;
          next.push([key, so]);
          continue;
        }
        throw e;
      }
    }
    remaining = next;
  }
  if (remaining.length) throw new Error(`Could not assign a unique priority to ${remaining.length} discount(s). Try again.`);
  return changed;
}

/** Persist the group layout (custom object in release-manager) and push the derived
 *  priorities (sortOrder) to the discounts in the authoring project. */
export async function saveDiscountLayout(kind: OrderableKind, groups: DiscountGroup[], by: string): Promise<{ groups: number; reordered: number }> {
  const discounts = await fetchDiscounts(kind);
  const known = new Set(discounts.map((d) => d.key as string));
  // sanitize incoming groups: valid names, dedup known keys, preserve order
  const seen = new Set<string>();
  const clean: DiscountGroup[] = (groups || []).map((g, i) => ({
    id: String(g.id || `g${i}`),
    name: String(g.name || "Group").slice(0, 60),
    items: (g.items || []).filter((k) => known.has(k) && !seen.has(k) && (seen.add(k), true)),
  }));
  // any discount not placed → Ungrouped
  const leftover = discounts.map((d) => d.key as string).filter((k) => !seen.has(k));
  if (leftover.length) {
    const ung = clean.find((g) => g.id === UNGROUPED.id);
    if (ung) ung.items.push(...leftover);
    else clean.push({ ...UNGROUPED, items: leftover });
  }

  const value: LayoutCo = { groups: clean, updatedAt: new Date().toISOString(), by };
  await ct.post(`/custom-objects`, { container: CONTAINER, key: kind, value });

  const flat = clean.flatMap((g) => g.items);
  const reordered = await writeSortOrders(kind, computeSortOrders(flat));
  return { groups: clean.length, reordered };
}
