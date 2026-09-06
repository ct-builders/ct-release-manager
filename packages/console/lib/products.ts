/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import { encodeKey, isMain } from "./branch";
import { formatMoney } from "./money";
import type { LocalizedString } from "./types";
import type { SortKey } from "./product-constants";
import { LOCALE, CURRENCY, FACET_ATTRIBUTE, CODE_ATTRIBUTE, hasFacetAttribute, hasCodeAttribute } from "./config";
import { RELEASE_CONTAINER } from "./containers";

/** Product reads from the authoring project — list (query) + text search (Product Search API). */

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0]) : undefined);

type AttrVal = string | number | boolean | { key?: string; label?: string | LocalizedString } | null;
type Variant = {
  sku?: string;
  key?: string;
  images?: { url: string }[];
  prices?: { value: { currencyCode: string; centAmount: number }; channel?: unknown; customerGroup?: unknown }[];
  attributes?: { name: string; value: AttrVal }[];
};
export type ProductProjection = {
  id: string;
  key?: string;
  version?: number;
  name: LocalizedString;
  slug?: LocalizedString;
  description?: LocalizedString;
  masterVariant: Variant;
  variants?: Variant[];
  categories?: { id: string }[];
  /** native publish state = the live/offline signal (present on projections regardless of `staged`) */
  published?: boolean;
};

export type ProductRow = {
  id: string;
  key?: string;
  name: string;
  image?: string;
  /** value of the configured FACET_ATTRIBUTE (`brand` by default) */
  facet?: string;
  /** value of the configured CODE_ATTRIBUTE (`partNumber` by default) */
  code?: string;
  priceLabel?: string;
  /** live/offline status = commercetools native published state */
  published?: boolean;
};

const attrStr = (v: AttrVal): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return typeof v.label === "string" ? v.label : loc(v.label as LocalizedString) ?? v.key;
  return undefined;
};
const attr = (p: ProductProjection, name: string) => attrStr(p.masterVariant?.attributes?.find((a) => a.name === name)?.value ?? null);

function priceLabel(p: ProductProjection): string | undefined {
  const prices = p.masterVariant?.prices ?? [];
  // prefer the reporting currency's unqualified price, else any unqualified one, else the first
  const base =
    prices.find((x) => x.value?.currencyCode === CURRENCY && !x.channel && !x.customerGroup) ||
    prices.find((x) => !x.channel && !x.customerGroup) ||
    prices[0];
  if (!base) return undefined;
  return formatMoney(base.value.centAmount, base.value.currencyCode);
}

export function toRow(p: ProductProjection): ProductRow {
  return {
    id: p.id,
    key: p.key,
    name: loc(p.name) || p.key || p.id,
    image: p.masterVariant?.images?.[0]?.url,
    facet: hasFacetAttribute ? attr(p, FACET_ATTRIBUTE.name) : undefined,
    code: hasCodeAttribute ? attr(p, CODE_ATTRIBUTE.name) : undefined,
    priceLabel: priceLabel(p),
    published: p.published,
  };
}

type SearchResult = { total: number; results: { id: string; productProjection: ProductProjection }[] };

const PP_SORT: Record<SortKey, string> = {
  "name-asc": `name.${LOCALE} asc`,
  "name-desc": `name.${LOCALE} desc`,
  "modified-desc": "lastModifiedAt desc",
  "created-desc": "createdAt desc",
  "created-asc": "createdAt asc",
};
type SearchSort = { field: string; language?: string; order: "asc" | "desc" };
const SEARCH_SORT: Record<SortKey, SearchSort[]> = {
  "name-asc": [{ field: "name", language: LOCALE, order: "asc" }],
  "name-desc": [{ field: "name", language: LOCALE, order: "desc" }],
  "modified-desc": [{ field: "lastModifiedAt", order: "desc" }],
  "created-desc": [{ field: "createdAt", order: "desc" }],
  "created-asc": [{ field: "createdAt", order: "asc" }],
};

export type ProductFilters = {
  q?: string;
  sort?: SortKey;
  category?: string; // category id
  /** value of the configured FACET_ATTRIBUTE to filter by */
  facet?: string;
  published?: "true" | "false"; // live/offline filter (native published state)
  keys?: string[]; // restrict to these product keys ("in this release")
  limit?: number;
  offset?: number;
};

/**
 * Keys of release working-copy products (forks). These are real products in the
 * authoring project (key encoded as `<key>__b__<branch>`) and must NOT appear as
 * their own rows in the catalog — the canonical product represents them.
 *
 * Every working copy corresponds to a (product member, release branch) pair, so we
 * derive the keys from the releases themselves rather than the branch asset registry
 * (which can lag). Unforked members yield keys that simply match no product — harmless.
 * Cached briefly.
 */
type ReleaseObj = { value?: { branchId?: string; members?: { products?: string[] } } };
let wcCache: { at: number; keys: string[] } = { at: 0, keys: [] };
export async function getWorkingCopyProductKeys(): Promise<string[]> {
  if (wcCache.keys.length && Date.now() - wcCache.at < 30_000) return wcCache.keys;
  try {
    const r = await ct.get<Paged<ReleaseObj>>(`/custom-objects/${RELEASE_CONTAINER}?limit=200`);
    const keys = new Set<string>();
    for (const o of r.results) {
      const branchId = o.value?.branchId;
      if (isMain(branchId)) continue;
      for (const pk of o.value?.members?.products ?? []) keys.add(encodeKey(pk, branchId));
    }
    wcCache = { at: Date.now(), keys: [...keys] };
  } catch {
    /* keep stale */
  }
  return wcCache.keys;
}

const isWorkingCopy = (key?: string) => !!key && key.includes("__b__");
const matchesPublished = (p: ProductProjection, want?: "true" | "false") => !want || !!p.published === (want === "true");

export async function listProducts(f: ProductFilters): Promise<{ results: ProductRow[]; total: number }> {
  const term = (f.q ?? "").trim();
  const sort = f.sort ?? "name-asc";
  const limit = f.limit ?? 24;
  const offset = f.offset ?? 0;

  if (term) {
    // Product Search API (full-text) + filters
    const filters: unknown[] = [];
    if (f.category) filters.push({ exact: { field: "categories", value: f.category } });
    if (f.facet && hasFacetAttribute)
      filters.push({ exact: { field: `variants.attributes.${FACET_ATTRIBUTE.name}`, fieldType: "text", value: f.facet } });
    if (f.keys?.length) filters.push({ exact: { field: "key", values: f.keys.slice(0, 100) } });
    const inner: unknown[] = [{ fullText: { field: "name", language: LOCALE, value: term } }];
    if (filters.length) inner.push({ filter: filters });
    const body = {
      query: inner.length > 1 ? { and: inner } : inner[0],
      sort: SEARCH_SORT[sort],
      limit,
      offset,
      productProjectionParameters: { staged: true },
    };
    const r = await ct.post<SearchResult>("/products/search", body);
    // full-text results can include working copies; drop them (rare enough that the count is close).
    // published filter is applied here too (post-filter) since the search index may not expose it.
    const rows = r.results.map((x) => x.productProjection).filter((p) => !isWorkingCopy(p.key) && matchesPublished(p, f.published));
    return { total: r.total - (r.results.length - rows.length), results: rows.map(toRow) };
  }

  // product-projections query (filters via where + sort)
  const clauses: string[] = [];
  if (f.category) clauses.push(`categories(id=${JSON.stringify(f.category)})`);
  if (f.facet && hasFacetAttribute)
    clauses.push(`masterVariant(attributes(name=${JSON.stringify(FACET_ATTRIBUTE.name)} and value=${JSON.stringify(f.facet)}))`);
  if (f.published) clauses.push(`published = ${f.published === "true" ? "true" : "false"}`); // live/offline
  if (f.keys) clauses.push(f.keys.length ? `key in (${f.keys.map((k) => JSON.stringify(k)).join(",")})` : `key = "__none__"`);
  // exclude release working copies so each product shows once (only on the unfiltered list;
  // the "in this release" view already restricts to canonical member keys)
  if (!f.keys) {
    const wc = await getWorkingCopyProductKeys();
    if (wc.length) clauses.push(`not(key in (${wc.slice(0, 400).map((k) => JSON.stringify(k)).join(",")}))`);
  }
  const where = clauses.length ? `&where=${encodeURIComponent(clauses.join(" and "))}` : "";
  const r = await ct.get<Paged<ProductProjection>>(
    `/product-projections?staged=true&limit=${limit}&offset=${offset}&sort=${encodeURIComponent(PP_SORT[sort])}${where}`
  );
  const rows = r.results.filter((p) => !isWorkingCopy(p.key)); // safety net for any fork not covered by the where clause
  return { total: r.total - (r.results.length - rows.length), results: rows.map(toRow) };
}

/**
 * Products in a category, seen through the active release: a product's release
 * working copy (if forked onto `branchId`) takes precedence over its live version,
 * so category memberships added/removed in the release show through. Other releases'
 * working copies are ignored. One row per canonical product.
 */
export async function listCategoryProducts(categoryId: string, branchId?: string): Promise<{ results: ProductRow[]; total: number }> {
  const suffix = isMain(branchId) ? null : `__b__${branchId}`;
  const pred = `categories(id=${JSON.stringify(categoryId)})`;
  const r = await ct.get<Paged<ProductProjection>>(
    `/product-projections?staged=true&limit=200&sort=${encodeURIComponent(`name.${LOCALE} asc`)}&where=${encodeURIComponent(pred)}`
  );
  const byCanonical = new Map<string, { row: ProductRow; fromWorkingCopy: boolean }>();
  for (const p of r.results) {
    const key = p.key ?? "";
    const isWc = key.includes("__b__");
    if (isWc && !(suffix && key.endsWith(suffix))) continue; // a different release's working copy — skip
    const canonical = isWc ? key.slice(0, key.length - suffix!.length) : key || p.id;
    const row = { ...toRow(p), key: canonical || undefined };
    const existing = byCanonical.get(canonical);
    if (isWc) byCanonical.set(canonical, { row, fromWorkingCopy: true }); // release version wins
    else if (!existing) byCanonical.set(canonical, { row, fromWorkingCopy: false });
  }
  const results = [...byCanonical.values()].map((v) => v.row);
  return { results, total: results.length };
}

/**
 * Release working-copy rows for member products, keyed by CANONICAL key. Lets the
 * catalog show the "in release" version's data (name/price/image) on the single
 * canonical row. Best-effort.
 */
export async function getReleaseOverlay(canonicalKeys: string[], branchId?: string): Promise<Record<string, ProductRow>> {
  const out: Record<string, ProductRow> = {};
  const uniq = [...new Set(canonicalKeys)].filter(Boolean);
  if (!uniq.length || isMain(branchId)) return out;
  const headKeys = uniq.map((k) => encodeKey(k, branchId!));
  try {
    const pred = `key in (${headKeys.map((k) => JSON.stringify(k)).join(",")})`;
    const r = await ct.get<Paged<ProductProjection>>(`/product-projections?staged=true&limit=500&where=${encodeURIComponent(pred)}`);
    for (const p of r.results) {
      const canonical = p.key?.split("__b__")[0];
      if (!canonical) continue;
      out[canonical] = { ...toRow(p), key: canonical };
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/** Category options for the filter dropdown. */
export async function getCategoryOptions(): Promise<{ id: string; name: string }[]> {
  try {
    const r = await ct.get<Paged<{ id: string; name: LocalizedString }>>(
      `/categories?limit=300&sort=${encodeURIComponent(`name.${LOCALE} asc`)}`
    );
    return r.results.map((c) => ({ id: c.id, name: loc(c.name) || c.id }));
  } catch {
    return [];
  }
}

/**
 * Distinct values of the configured FACET_ATTRIBUTE, for the filter dropdown.
 * Read from the catalog rather than declared, so a project needs no extra setup.
 * Cached ~10 min (the Product Search facet endpoint 400s on some projects).
 */
let facetCache: { at: number; values: string[] } = { at: 0, values: [] };
export async function getFacetOptions(): Promise<string[]> {
  if (!hasFacetAttribute) return [];
  if (facetCache.values.length && Date.now() - facetCache.at < 600_000) return facetCache.values;
  try {
    const r = await ct.get<Paged<ProductProjection>>(`/product-projections?staged=true&limit=500`);
    const set = new Set<string>();
    for (const p of r.results) {
      const v = attr(p, FACET_ATTRIBUTE.name);
      if (v) set.add(v);
    }
    facetCache = { at: Date.now(), values: [...set].sort() };
  } catch {
    /* keep stale */
  }
  return facetCache.values;
}

export async function getProductByKey(key: string): Promise<ProductProjection | null> {
  try {
    return await ct.get<ProductProjection>(`/product-projections/key=${ct.enc(key)}?staged=true`);
  } catch {
    return null;
  }
}

/**
 * Whether the canonical product is currently online (published) in the authoring
 * project — mirrors what the admin "take offline / bring online" fast-path toggles.
 * Reads the full Product (not a projection) by the CANONICAL key, so it reflects the
 * real product even when the editor is viewing a release working copy. `exists:false`
 * means there is no canonical product to publish (e.g. release-only draft).
 */
export type PublishState = { exists: boolean; published: boolean };
export async function getCanonicalPublishState(canonicalKey: string): Promise<PublishState> {
  try {
    const p = await ct.get<{ masterData?: { published?: boolean } }>(`/products/key=${ct.enc(canonicalKey)}`);
    return { exists: true, published: !!p.masterData?.published };
  } catch {
    return { exists: false, published: false };
  }
}
