/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import { formatMoney } from "./money";
import type { LocalizedString } from "./types";
import { FACET_ATTRIBUTE, hasFacetAttribute } from "./config";
import { LOCALE } from "./config";
import {
  parseCartDiscount,
  parseProductDiscount,
  type CartModel,
  type CodeDetail,
  type ProductModel,
  type RawTarget,
  type RawValue,
} from "./discount-model";

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0] ?? "") : "");

export type DiscountKind = "cart-discount" | "product-discount" | "discount-code";
export const DISCOUNT_TABS: { key: DiscountKind; label: string }[] = [
  { key: "cart-discount", label: "Cart discounts" },
  { key: "product-discount", label: "Product discounts" },
  { key: "discount-code", label: "Discount codes" },
];
const EP: Record<DiscountKind, string> = { "cart-discount": "cart-discounts", "product-discount": "product-discounts", "discount-code": "discount-codes" };

type RawDiscount = {
  id: string;
  key?: string;
  version?: number;
  code?: string;
  name?: LocalizedString;
  description?: LocalizedString;
  isActive?: boolean;
  sortOrder?: string;
  value?: RawValue;
  target?: RawTarget;
  cartPredicate?: string;
  predicate?: string;
  cartDiscounts?: { id: string; typeId?: string; obj?: { key?: string; name?: LocalizedString } }[];
  validFrom?: string;
  validUntil?: string;
  stackingMode?: string;
  requiresDiscountCode?: boolean;
  maxApplications?: number;
  maxApplicationsPerCustomer?: number;
  groups?: string[];
  discountGroup?: { id: string; obj?: { key?: string } };
};

function summarizeValue(v?: RawValue): string {
  if (!v) return "";
  if (v.type === "relative") return `${(v.permyriad ?? 0) / 100}% off`;
  if (v.type === "absolute") return v.money?.length ? `${formatMoney(v.money[0].centAmount, v.money[0].currencyCode, v.money[0].fractionDigits)} off` : "amount off";
  if (v.type === "giftLineItem") return "gift item";
  if (v.type === "external") return "external";
  return v.type;
}

/** Short, human "what does it do" line for the list, from value + target. */
function summarizeReward(v?: RawValue, t?: RawTarget): string {
  const val = summarizeValue(v);
  if (!t) return val;
  if (t.type === "shipping") return v?.type === "relative" && (v.permyriad ?? 0) >= 10000 ? "Free shipping" : `${val} shipping`;
  if (t.type === "totalPrice") return `${val} order`;
  if (t.type === "lineItems") return `${val} on selected items`;
  if (t.type === "multiBuyLineItems") return `Buy ${t.triggerQuantity}, get ${t.discountedQuantity} at ${val}`;
  return val;
}

export type DiscountRow = { id: string; key?: string; code?: string; name: string; summary: string; isActive: boolean };

export async function listDiscounts(kind: DiscountKind, q?: string): Promise<DiscountRow[]> {
  const r = await ct.get<Paged<RawDiscount>>(`/${EP[kind]}?limit=200`).catch(() => ({ results: [] as RawDiscount[] } as Paged<RawDiscount>));
  let rows: DiscountRow[] = r.results.map((d) => ({
    id: d.id,
    key: d.key,
    code: d.code,
    name: loc(d.name) || d.code || d.key || d.id,
    summary: kind === "discount-code" ? `${d.cartDiscounts?.length ?? 0} cart discount(s)` : kind === "cart-discount" ? summarizeReward(d.value, d.target) : summarizeValue(d.value),
    isActive: !!d.isActive,
  }));
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter((d) => d.name.toLowerCase().includes(s) || (d.key ?? "").toLowerCase().includes(s) || (d.code ?? "").toLowerCase().includes(s));
  }
  return rows;
}

export type DiscountEdit = {
  kind: DiscountKind;
  version: number;
  key?: string;
  code?: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: string;
  validFrom: string; // ISO or ""
  validUntil: string; // ISO or ""
  stackingMode: string; // cart discount: "Stacking" | "StopAfterThisDiscount"
  requiresDiscountCode: boolean; // cart discount
  cart?: CartModel; // cart-discount visual model
  product?: ProductModel; // product-discount visual model
  codeDetail?: CodeDetail; // discount-code fields
};

/**
 * Does the encoded working-copy HEAD for this discount kind physically exist on a branch?
 *
 * Mirrors product-edit's workingCopyExists. The branch registry is NOT a reliable
 * source of truth for "is this forked": it can retain an ORPHANED asset entry (e.g.
 * version 0) for a fork whose working copy was never actually created — fork
 * registration succeeded but the working-copy resource creation failed/rolled back.
 * Trusting `branch.assets` alone then points getDiscountEdit at a non-existent HEAD and
 * renders "Discount not found" even though the live discount exists. The physical HEAD
 * is the truth: we probe the kind-specific endpoint (cart-discount → /cart-discounts,
 * product-discount → /product-discounts, discount-code → /discount-codes) by the encoded
 * key. Returns false only on a definitive 404; a non-404 (transient) error resolves to
 * `true` on purpose, so a flaky CT call never silently drops the editor onto the LIVE
 * discount (editing a missing HEAD then surfaces as a visible "not found", which is safe).
 */
export async function discountWorkingCopyExists(headKey: string, kind: DiscountKind): Promise<boolean> {
  try {
    await ct.get(`/${EP[kind]}/key=${ct.enc(headKey)}`);
    return true;
  } catch (e) {
    return (e as { status?: number }).status !== 404;
  }
}

export async function getDiscountEdit(displayKey: string, kind: DiscountKind): Promise<DiscountEdit | null> {
  try {
    const q = kind === "discount-code" ? "?expand=cartDiscounts[*]" : kind === "cart-discount" ? "?expand=discountGroup" : "";
    const d = await ct.get<RawDiscount>(`/${EP[kind]}/key=${ct.enc(displayKey)}${q}`);
    const cart = kind === "cart-discount" ? parseCartDiscount(d.value, d.target, d.cartPredicate ?? "") : undefined;
    if (cart) cart.discountGroupKey = d.discountGroup?.obj?.key ?? "";
    return {
      kind,
      version: d.version ?? 0,
      key: d.key,
      code: d.code,
      name: loc(d.name),
      description: loc(d.description),
      isActive: !!d.isActive,
      sortOrder: d.sortOrder ?? "",
      validFrom: d.validFrom ?? "",
      validUntil: d.validUntil ?? "",
      stackingMode: d.stackingMode ?? "Stacking",
      requiresDiscountCode: !!d.requiresDiscountCode,
      cart,
      product: kind === "product-discount" ? parseProductDiscount(d.value, d.predicate ?? "") : undefined,
      codeDetail:
        kind === "discount-code"
          ? {
              maxApplications: d.maxApplications == null ? "" : String(d.maxApplications),
              maxApplicationsPerCustomer: d.maxApplicationsPerCustomer == null ? "" : String(d.maxApplicationsPerCustomer),
              groups: d.groups ?? [],
              cartPredicate: d.cartPredicate ?? "",
              cartDiscountKeys: (d.cartDiscounts ?? []).map((r) => r.obj?.key).filter((k): k is string => !!k),
            }
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Cart discounts eligible to be linked from a discount code (keyed), with their code requirement. */
export type CartDiscountRef = { key: string; name: string; requiresDiscountCode: boolean };
export async function listCartDiscountRefs(): Promise<CartDiscountRef[]> {
  const r = await ct.get<Paged<RawDiscount>>(`/cart-discounts?limit=200`).catch(() => ({ results: [] as RawDiscount[] } as Paged<RawDiscount>));
  return r.results
    .filter((d) => d.key)
    .map((d) => ({ key: d.key as string, name: loc(d.name) || (d.key as string), requiresDiscountCode: !!d.requiresDiscountCode }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct brand values across the catalog, for the product-discount brand picker. */
export async function listFacetValues(): Promise<string[]> {
  if (!hasFacetAttribute) return [];
  type RawProduct = { masterData?: { current?: Variant; staged?: Variant } };
  type Variant = { masterVariant?: { attributes?: { name: string; value: unknown }[] } };
  const r = await ct.get<Paged<RawProduct>>(`/products?limit=400`).catch(() => ({ results: [] as RawProduct[] } as Paged<RawProduct>));
  const values = new Set<string>();
  for (const p of r.results) {
    const mv = (p.masterData?.current ?? p.masterData?.staged)?.masterVariant;
    const v = mv?.attributes?.find((a) => a.name === FACET_ATTRIBUTE.name)?.value;
    if (typeof v === "string" && v.trim()) values.add(v.trim());
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
