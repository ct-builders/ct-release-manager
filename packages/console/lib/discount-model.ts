/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Client-safe (NO server-only): translates between commercetools cart/product
// discount internals (value + target + predicate) and the models the visual
// editors work with. Both the server (to build the initial model) and the
// client editors (to serialize + diff on save) import this.
//
// The cart model mirrors the Merchant Center structure — a value + an
// "applies to" target + a cart-condition predicate — plus one-click presets
// that pre-fill common scenarios. Anything not modeled falls back to raw JSON.

import { CURRENCY, CURRENCIES as CONFIGURED_CURRENCIES, FACET_ATTRIBUTE } from "./config";

export type Money = { type?: string; currencyCode: string; centAmount: number; fractionDigits?: number };
export type PatternComponentRaw = { type?: string; predicate?: string; minCount?: number; maxCount?: number };
export type RawValue =
  | {
      type: string;
      permyriad?: number;
      money?: Money[];
      applicationMode?: string;
      product?: { typeId?: string; id?: string; key?: string };
      variantId?: number;
      supplyChannel?: { typeId?: string; id?: string; key?: string };
      distributionChannel?: { typeId?: string; id?: string; key?: string };
    }
  | null
  | undefined;
export type RawTarget =
  | {
      type: string;
      predicate?: string;
      triggerQuantity?: number;
      discountedQuantity?: number;
      maxOccurrence?: number;
      selectionMode?: string;
      triggerPattern?: PatternComponentRaw[];
      targetPattern?: PatternComponentRaw[];
    }
  | null
  | undefined;

export const CURRENCIES = CONFIGURED_CURRENCIES;
export const SELECTION_MODES = ["Cheapest", "MostExpensive"] as const;
export const APPLICATION_MODES = ["ProportionateDistribution", "EvenDistribution", "IndividualApplication"] as const;

const money2 = (s: string) => Number(s || 0).toFixed(2);
const cents = (s: string) => Math.round(Number(s || 0) * 100);
const catField = (includeSub: boolean) => (includeSub ? "categoriesWithAncestors" : "categories");
const catPred = (key: string, includeSub: boolean) => `${catField(includeSub)}.key contains "${key}"`;

const RE_CAT = /(categoriesWithAncestors|categories)\.key\s+contains\s+"([^"]+)"/;
/** `attributes.<facet> = "value"` — the one product-attribute clause the simple builder round-trips. */
const facetPath = `attributes.${FACET_ATTRIBUTE.name}`;
const facetPred = (value: string) => `${facetPath} = ${JSON.stringify(value)}`;
const RE_FACET = new RegExp(`${facetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*"([^"]+)"`);

// ---------------------------------------------------------------- cart discounts
export type CartValueType = "relative" | "absolute" | "fixed" | "giftLineItem";
export type CartTargetType =
  | "totalPrice"
  | "lineItems"
  | "customLineItems"
  | "shipping"
  | "multiBuyLineItems"
  | "multiBuyCustomLineItems"
  | "pattern";
export type SelectionMode = (typeof SELECTION_MODES)[number];
export type ApplicationMode = (typeof APPLICATION_MODES)[number];

export type MoneyRow = { currencyCode: string; amount: string };
export type PatternComp = { predicate: string; minCount: string; maxCount: string }; // maxCount "" = unbounded

export type CartModel = {
  valueType: CartValueType;
  percent: string; // relative
  money: MoneyRow[]; // absolute / fixed (one row per currency)
  applicationMode: ApplicationMode; // absolute / fixed distribution
  // gift line item
  giftProduct: string; // product key
  giftVariantId: string;
  giftSupplyChannel: string; // channel key (optional)
  giftDistributionChannel: string; // channel key (optional)

  targetType: CartTargetType;
  targetPredicate: string; // lineItems / customLineItems / multiBuy predicate
  triggerQuantity: string;
  discountedQuantity: string;
  maxOccurrence: string; // "" = unlimited
  selectionMode: SelectionMode;
  // pattern (Buy & Get / bundles)
  patternCustom: boolean; // CountOnCustomLineItemUnits vs CountOnLineItemUnits
  triggerPattern: PatternComp[];
  targetPattern: PatternComp[];

  cartPredicate: string; // cart condition (edited via the predicate builder)

  discountGroupKey: string; // native discount group this belongs to ("" = none)

  advancedValue: boolean; // value we can't model → raw JSON
  rawValue: string;
};

export function emptyCartModel(): CartModel {
  return {
    valueType: "relative",
    percent: "10",
    money: [{ currencyCode: CURRENCY, amount: "5.00" }],
    applicationMode: "ProportionateDistribution",
    giftProduct: "",
    giftVariantId: "1",
    giftSupplyChannel: "",
    giftDistributionChannel: "",
    targetType: "totalPrice",
    targetPredicate: "1 = 1",
    triggerQuantity: "2",
    discountedQuantity: "1",
    maxOccurrence: "",
    selectionMode: "Cheapest",
    patternCustom: false,
    triggerPattern: [],
    targetPattern: [{ predicate: "1 = 1", minCount: "1", maxCount: "1" }],
    cartPredicate: "1 = 1",
    discountGroupKey: "",
    advancedValue: false,
    rawValue: "",
  };
}

/** Targets that a cart discount can belong to a discount group with. */
export function groupEligible(m: CartModel): boolean {
  return (
    m.valueType !== "giftLineItem" &&
    ["lineItems", "customLineItems", "multiBuyLineItems", "multiBuyCustomLineItems", "pattern"].includes(m.targetType)
  );
}

const moneyRows = (money?: Money[]): MoneyRow[] =>
  (money ?? []).map((m) => ({ currencyCode: m.currencyCode, amount: (m.centAmount / 100).toFixed(m.fractionDigits ?? 2) }));

const patternComps = (list?: PatternComponentRaw[]): PatternComp[] =>
  (list ?? []).map((c) => ({ predicate: c.predicate ?? "1 = 1", minCount: String(c.minCount ?? 1), maxCount: c.maxCount == null ? "" : String(c.maxCount) }));

export function parseCartDiscount(value: RawValue, target: RawTarget, cartPredicate: string): CartModel {
  const m = emptyCartModel();
  m.cartPredicate = cartPredicate ?? "1 = 1";

  // ---- value ----
  switch (value?.type) {
    case "relative":
      m.valueType = "relative";
      m.percent = String((value.permyriad ?? 0) / 100);
      break;
    case "absolute":
    case "fixed":
      m.valueType = value.type;
      m.money = moneyRows(value.money).length ? moneyRows(value.money) : m.money;
      if (value.applicationMode && (APPLICATION_MODES as readonly string[]).includes(value.applicationMode)) m.applicationMode = value.applicationMode as ApplicationMode;
      break;
    case "giftLineItem":
      m.valueType = "giftLineItem";
      m.giftProduct = value.product?.key ?? value.product?.id ?? "";
      m.giftVariantId = String(value.variantId ?? 1);
      m.giftSupplyChannel = value.supplyChannel?.key ?? value.supplyChannel?.id ?? "";
      m.giftDistributionChannel = value.distributionChannel?.key ?? value.distributionChannel?.id ?? "";
      break;
    default:
      if (value?.type) {
        m.advancedValue = true;
        m.rawValue = JSON.stringify(value, null, 2);
      }
  }

  // ---- target (absent for gift) ----
  const t = target?.type as CartTargetType | undefined;
  if (t) {
    m.targetType = t;
    if (target?.predicate != null) m.targetPredicate = target.predicate;
    if (t === "multiBuyLineItems" || t === "multiBuyCustomLineItems") {
      m.triggerQuantity = String(target?.triggerQuantity ?? 2);
      m.discountedQuantity = String(target?.discountedQuantity ?? 1);
      m.maxOccurrence = target?.maxOccurrence == null ? "" : String(target.maxOccurrence);
      m.selectionMode = (target?.selectionMode as SelectionMode) ?? "Cheapest";
    }
    if (t === "pattern") {
      m.triggerPattern = patternComps(target?.triggerPattern);
      m.targetPattern = patternComps(target?.targetPattern);
      m.patternCustom = (target?.targetPattern ?? target?.triggerPattern ?? []).some((c) => c.type === "CountOnCustomLineItemUnits");
      m.maxOccurrence = target?.maxOccurrence == null ? "" : String(target.maxOccurrence);
      m.selectionMode = (target?.selectionMode as SelectionMode) ?? "Cheapest";
    }
  }
  return m;
}

const moneyDraft = (rows: MoneyRow[]) =>
  rows
    .filter((r) => r.currencyCode)
    .map((r) => ({ type: "centPrecision", currencyCode: r.currencyCode, centAmount: cents(r.amount), fractionDigits: 2 }));

export function serializeCartValue(m: CartModel): Record<string, unknown> {
  if (m.advancedValue) {
    try {
      return JSON.parse(m.rawValue);
    } catch {
      return {};
    }
  }
  switch (m.valueType) {
    case "relative":
      return { type: "relative", permyriad: Math.round(Number(m.percent || 0) * 100) };
    case "absolute":
      return { type: "absolute", money: moneyDraft(m.money), applicationMode: m.applicationMode };
    case "fixed":
      return { type: "fixed", money: moneyDraft(m.money), applicationMode: m.applicationMode };
    case "giftLineItem":
      return {
        type: "giftLineItem",
        product: { typeId: "product", key: m.giftProduct },
        variantId: Math.max(1, parseInt(m.giftVariantId || "1", 10)),
        ...(m.giftSupplyChannel ? { supplyChannel: { typeId: "channel", key: m.giftSupplyChannel } } : {}),
        ...(m.giftDistributionChannel ? { distributionChannel: { typeId: "channel", key: m.giftDistributionChannel } } : {}),
      };
  }
}

const patternDraft = (comps: PatternComp[], custom: boolean) =>
  comps
    .filter((c) => c.predicate.trim())
    .map((c) => ({
      type: custom ? "CountOnCustomLineItemUnits" : "CountOnLineItemUnits",
      predicate: c.predicate,
      minCount: Math.max(1, parseInt(c.minCount || "1", 10)),
      ...(c.maxCount.trim() ? { maxCount: Math.max(1, parseInt(c.maxCount, 10)) } : {}),
    }));

/** Target draft, or null when the value is a gift line item (no target). */
export function serializeCartTarget(m: CartModel): Record<string, unknown> | null {
  if (m.valueType === "giftLineItem") return null;
  const qty = (s: string, d: number) => Math.max(1, parseInt(s || String(d), 10));
  switch (m.targetType) {
    case "totalPrice":
      return { type: "totalPrice" };
    case "shipping":
      return { type: "shipping" };
    case "lineItems":
      return { type: "lineItems", predicate: m.targetPredicate || "1 = 1" };
    case "customLineItems":
      return { type: "customLineItems", predicate: m.targetPredicate || "1 = 1" };
    case "multiBuyLineItems":
    case "multiBuyCustomLineItems":
      return {
        type: m.targetType,
        predicate: m.targetPredicate || "1 = 1",
        triggerQuantity: qty(m.triggerQuantity, 2),
        discountedQuantity: qty(m.discountedQuantity, 1),
        ...(m.maxOccurrence.trim() ? { maxOccurrence: qty(m.maxOccurrence, 1) } : {}),
        selectionMode: m.selectionMode,
      };
    case "pattern":
      return {
        type: "pattern",
        triggerPattern: patternDraft(m.triggerPattern, m.patternCustom),
        targetPattern: patternDraft(m.targetPattern, m.patternCustom),
        ...(m.maxOccurrence.trim() ? { maxOccurrence: qty(m.maxOccurrence, 1) } : {}),
        selectionMode: m.selectionMode,
      };
  }
}

// Which targets each value type can pair with (mirrors MC's constraints).
export function allowedTargets(v: CartValueType): CartTargetType[] {
  if (v === "giftLineItem") return [];
  if (v === "fixed") return ["lineItems", "customLineItems", "pattern"];
  // relative / absolute — multi-buy is relative-only
  const base: CartTargetType[] = ["totalPrice", "lineItems", "customLineItems", "shipping", "pattern"];
  if (v === "relative") base.splice(4, 0, "multiBuyLineItems", "multiBuyCustomLineItems");
  return base;
}

export const TARGET_LABELS: Record<CartTargetType, string> = {
  totalPrice: "Entire order total",
  lineItems: "Matching line items",
  customLineItems: "Matching custom line items",
  shipping: "Shipping cost",
  multiBuyLineItems: "Multi-buy (Buy X, get Y)",
  multiBuyCustomLineItems: "Multi-buy custom line items",
  pattern: "Pattern / bundle (Buy & Get)",
};
export const VALUE_LABELS: Record<CartValueType, string> = {
  relative: "Percentage off",
  absolute: "Fixed amount off",
  fixed: "Fixed price",
  giftLineItem: "Free gift",
};

// One-click scenario presets that pre-fill the builder.
export type CartPreset = { id: string; label: string; hint: string; apply: () => Partial<CartModel> };
export const CART_PRESETS: CartPreset[] = [
  { id: "pct-order", label: "% off whole order", hint: "10% off the cart total", apply: () => ({ valueType: "relative", percent: "10", targetType: "totalPrice", cartPredicate: "1 = 1" }) },
  { id: "amt-order", label: "Amount off order over a threshold", hint: `5 off carts of 50+ ${CURRENCY}`, apply: () => ({ valueType: "absolute", money: [{ currencyCode: CURRENCY, amount: "5.00" }], targetType: "totalPrice", cartPredicate: `totalPrice >= "50.00 ${CURRENCY}"` }) },
  { id: "free-ship", label: "Free shipping", hint: "100% off shipping", apply: () => ({ valueType: "relative", percent: "100", targetType: "shipping", cartPredicate: "1 = 1" }) },
  { id: "pct-items", label: "% off matching items", hint: "% off items in a category", apply: () => ({ valueType: "relative", percent: "15", targetType: "lineItems", targetPredicate: "1 = 1", cartPredicate: "1 = 1" }) },
  { id: "bogo", label: "Buy X, get Y", hint: "Multi-buy / BOGO", apply: () => ({ valueType: "relative", percent: "100", targetType: "multiBuyLineItems", targetPredicate: "1 = 1", triggerQuantity: "2", discountedQuantity: "1", selectionMode: "Cheapest", cartPredicate: "1 = 1" }) },
  { id: "gift", label: "Free gift", hint: "Add a gift line item", apply: () => ({ valueType: "giftLineItem", cartPredicate: "1 = 1" }) },
];

// ------------------------------------------------------------- product discounts
export type ProductValueType = "relative" | "absolute" | "external";
export type ProductModel = {
  valueType: ProductValueType;
  percent: string;
  amount: string;
  currency: string;
  categoryKey: string;
  includeSub: boolean;
  /** value of the configured FACET_ATTRIBUTE this discount is scoped to */
  facet: string;
  advanced: boolean;
  rawPredicate: string;
};

export function emptyProductModel(): ProductModel {
  return { valueType: "relative", percent: "10", amount: "5.00", currency: CURRENCY, categoryKey: "", includeSub: false, facet: "", advanced: false, rawPredicate: "" };
}

export function parseProductDiscount(value: RawValue, predicate: string): ProductModel {
  const m = emptyProductModel();
  if (value?.type === "relative") { m.valueType = "relative"; m.percent = String((value.permyriad ?? 0) / 100); }
  else if (value?.type === "absolute" && value.money?.length) {
    m.valueType = "absolute";
    m.amount = (value.money[0].centAmount / 100).toFixed(2);
    m.currency = value.money[0].currencyCode;
  } else if (value?.type === "external") { m.valueType = "external"; }
  else if (value?.type) m.advanced = true; // unknown

  m.rawPredicate = predicate ?? "";
  const p = (predicate ?? "").trim();
  if (p === "" || p === "1 = 1") return m; // any product

  // Split top-level " and " clauses; each must be a category or featured-attribute clause.
  const clauses = p.split(/\s+and\s+/i);
  let ok = clauses.length > 0;
  for (const c of clauses) {
    const cm = c.match(RE_CAT);
    const bm = c.match(RE_FACET);
    if (cm && c.trim() === catPred(cm[2], cm[1] === "categoriesWithAncestors")) { m.categoryKey = cm[2]; m.includeSub = cm[1] === "categoriesWithAncestors"; }
    else if (bm && c.trim() === facetPred(bm[1])) { m.facet = bm[1]; }
    else { ok = false; break; }
  }
  if (!ok) m.advanced = true;
  return m;
}

export function serializeProductValue(m: ProductModel): Record<string, unknown> {
  if (m.valueType === "external") return { type: "external" };
  if (m.valueType === "absolute")
    return { type: "absolute", money: [{ type: "centPrecision", currencyCode: m.currency || CURRENCY, centAmount: cents(m.amount), fractionDigits: 2 }] };
  return { type: "relative", permyriad: Math.round(Number(m.percent || 0) * 100) };
}

export function serializeProductPredicate(m: ProductModel): string {
  const parts: string[] = [];
  if (m.categoryKey) parts.push(catPred(m.categoryKey, m.includeSub));
  if (m.facet.trim()) parts.push(facetPred(m.facet.trim()));
  return parts.length ? parts.join(" and ") : "1 = 1";
}

// --------------------------------------------------------------- discount codes
export type CodeDetail = {
  maxApplications: string; // "" = unlimited
  maxApplicationsPerCustomer: string; // "" = unlimited
  groups: string[];
  cartPredicate: string; // extra cart condition on top of the referenced cart discounts
  cartDiscountKeys: string[]; // cart discounts this code activates
};

export function emptyCodeDetail(): CodeDetail {
  return { maxApplications: "", maxApplicationsPerCustomer: "", groups: [], cartPredicate: "", cartDiscountKeys: [] };
}
