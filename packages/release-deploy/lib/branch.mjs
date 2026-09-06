/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * branch.mjs — compound-key encoding + canonicalization for branch/version support.
 *
 * WHY: two authors work two releases at once in the AUTHORING project, so the same
 * logical asset needs multiple divergent copies living side by side. commercetools
 * enforces project-wide uniqueness on `key`, `slug`, variant `sku`, category `key`,
 * discount `key`, and DiscountCode `code` — so each branch copy carries a branch
 * suffix on every one of those fields. PRODUCTION must stay clean (one current
 * version, no suffixes), so the deploy pipeline runs exactly one transform:
 * `canonicalizeBundle` strips the branch suffix off every identity field before the
 * bundle is upserted into the target, and `assertClean` hard-fails if anything leaks.
 *
 * Encoding (branches other than `main`; `main`/trunk is NEVER suffixed so it mirrors
 * production 1:1):
 *   key / sku / code : <canonical>__b__<branchId>        (delimiter is CT-key-legal)
 *   slug             : <canonical>-b-<branchId>          (URL-clean, per locale)
 *
 * The delimiter is a physical-uniqueness device only; the authoritative canonical
 * value is also carried in the branch registry, which records each forked asset's
 * logical id. Canonicalization here strips the EXACT `<delim><branchId>` suffix for
 * a known branchId, so it is idempotent and can never mangle a canonical value that
 * merely happens to contain the delimiter substring.
 */

export const KEY_DELIM = '__b__'; // for key / sku / code (matches [A-Za-z0-9_-] key charset)
export const SLUG_DELIM = '-b-'; // for slug values (kept URL/SEO friendly)
export const MAIN_BRANCH = 'main';

// branch bookkeeping attributes that live on authoring product variants and must
// never reach production.
export const BRANCH_ATTRS = ['branch', 'canonicalKey', 'canonicalSku', 'isHead', 'version', 'baseContentHash'];

/** main/trunk (or unset) is never suffixed — its HEADs ARE the canonical resources. */
export function isMain(branchId) {
  return !branchId || branchId === MAIN_BRANCH;
}

// ---- encode (create side: fork / editor) ----
const enc = (canonical, branchId, delim) => (isMain(branchId) ? canonical : `${canonical}${delim}${branchId}`);
export const encodeKey = (canonical, branchId) => enc(canonical, branchId, KEY_DELIM);
export const encodeSku = (canonical, branchId) => enc(canonical, branchId, KEY_DELIM);
export const encodeCode = (canonical, branchId) => enc(canonical, branchId, KEY_DELIM);
export const encodeSlug = (canonical, branchId) => enc(canonical, branchId, SLUG_DELIM);

/** encode every value of a localized string (e.g. slug: {'en-US': 'x', ...}). */
export function encodeLocalized(loc, branchId) {
  if (!loc || typeof loc !== 'object') return loc;
  const out = {};
  for (const [l, v] of Object.entries(loc)) out[l] = typeof v === 'string' ? encodeSlug(v, branchId) : v;
  return out;
}

// ---- decode / canonicalize (deploy side) ----
/** strip the exact trailing `<delim><branchId>` if present; otherwise return unchanged. */
function strip(value, branchId, delim) {
  if (typeof value !== 'string' || isMain(branchId)) return value;
  const suffix = `${delim}${branchId}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
export const canonicalKey = (physical, branchId) => strip(physical, branchId, KEY_DELIM);
export const canonicalSku = (physical, branchId) => strip(physical, branchId, KEY_DELIM);
export const canonicalCode = (physical, branchId) => strip(physical, branchId, KEY_DELIM);
export const canonicalSlug = (physical, branchId) => strip(physical, branchId, SLUG_DELIM);

/** canonicalize every value of a localized string (e.g. slug). */
export function canonicalLocalized(loc, branchId) {
  if (!loc || typeof loc !== 'object') return loc;
  const out = {};
  for (const [l, v] of Object.entries(loc)) out[l] = typeof v === 'string' ? canonicalSlug(v, branchId) : v;
  return out;
}

// typeIds whose `key` is branch-suffixed (referenced inside predicates / relations).
// Reference types like channel / customer-group / tax-category / state / store /
// product-type are shared across branches and are left untouched (strip is a no-op
// anyway, since their keys don't carry the suffix).
const BRANCHED_TYPEIDS = new Set(['product', 'category', 'cart-discount', 'product-discount', 'discount-group', 'discount-code']);
const canonRef = (ref, branchId) =>
  ref && ref.key && BRANCHED_TYPEIDS.has(ref.typeId) ? { ...ref, key: canonicalKey(ref.key, branchId) } : ref;
function canonRefMap(map, branchId) {
  if (!map) return map;
  const out = {};
  for (const [id, e] of Object.entries(map)) out[id] = canonRef(e, branchId);
  return out;
}

function canonPrice(price, branchId) {
  // a price key may be sku-coupled → strip the branch suffix if present (no-op otherwise).
  if (price && typeof price.key === 'string') return { ...price, key: canonicalKey(price.key, branchId) };
  return price;
}
function canonVariant(v, branchId) {
  const out = { ...v };
  out.sku = canonicalSku(v.sku, branchId);
  // variant `key` is ALSO project-unique (like sku) — canonicalize it too.
  if (typeof v.key === 'string') out.key = canonicalKey(v.key, branchId);
  if (Array.isArray(v.prices)) out.prices = v.prices.map((p) => canonPrice(p, branchId));
  // strip branch bookkeeping attributes so production carries none of them.
  if (Array.isArray(v.attributes)) out.attributes = v.attributes.filter((a) => !BRANCH_ATTRS.includes(a.name));
  return out;
}

/** Canonicalize a single serialized product (clean copy). No-op for main. */
export function canonicalizeProduct(product, branchId) {
  if (isMain(branchId)) return product;
  const p = structuredClone(product);
  p.key = canonicalKey(p.key, branchId);
  p.slug = canonicalLocalized(p.slug, branchId);
  p.categories = (p.categories || []).map((r) => canonRef(r, branchId));
  if (p.masterVariant) p.masterVariant = canonVariant(p.masterVariant, branchId);
  p.variants = (p.variants || []).map((v) => canonVariant(v, branchId));
  return p;
}

/** Canonicalize a single serialized category (clean copy). No-op for main. */
export function canonicalizeCategory(category, branchId) {
  if (isMain(branchId)) return category;
  const c = structuredClone(category);
  c.key = canonicalKey(c.key, branchId);
  c.slug = canonicalLocalized(c.slug, branchId);
  if (c.parent) c.parent = canonRef(c.parent, branchId);
  return c;
}

// ---- encode: canonical serialized asset → branch copy (inverse of canonicalize) ----
function encVariant(v, branchId, canonicalProductKey, withAttributes) {
  const out = { ...v, sku: encodeSku(v.sku, branchId) };
  // variant `key` is project-unique — suffix it too so branch copies don't collide.
  if (typeof v.key === 'string') out.key = encodeKey(v.key, branchId);
  const base = (v.attributes || []).filter((a) => !BRANCH_ATTRS.includes(a.name));
  // Optionally stamp searchable branch bookkeeping attributes (Product Search can't
  // filter on custom.fields). Requires these attributes to be defined on the product
  // type; left OFF until the storefront/MC editor need them.
  out.attributes = withAttributes
    ? [...base, { name: 'branch', value: branchId }, { name: 'canonicalKey', value: canonicalProductKey }, { name: 'canonicalSku', value: v.sku }]
    : base;
  return out;
}
/** Encode a canonical serialized product into a branch copy. No-op for main. */
export function encodeProduct(product, branchId, { withAttributes = false } = {}) {
  if (isMain(branchId)) return product;
  const cleanKey = product.key;
  const p = structuredClone(product);
  p.key = encodeKey(cleanKey, branchId);
  p.slug = encodeLocalized(p.slug, branchId);
  if (p.masterVariant) p.masterVariant = encVariant(p.masterVariant, branchId, cleanKey, withAttributes);
  p.variants = (p.variants || []).map((v) => encVariant(v, branchId, cleanKey, withAttributes));
  return p;
}
/** Encode a canonical serialized category into a branch copy. No-op for main. */
export function encodeCategory(category, branchId) {
  if (isMain(branchId)) return category;
  const c = structuredClone(category);
  c.key = encodeKey(c.key, branchId);
  c.slug = encodeLocalized(c.slug, branchId);
  return c;
}

// ---- generic (any resource type) encode / canonicalize ----
/** resourceType → the array key it occupies in a serialized bundle. */
export const BUNDLE_KEY = {
  product: 'products',
  category: 'categories',
  'cart-discount': 'cartDiscounts',
  'product-discount': 'productDiscounts',
  'discount-code': 'discountCodes',
  'discount-group': 'discountGroups',
};

/**
 * Deterministic unique sortOrder (a decimal string in (0,1)) for a branch copy.
 * commercetools enforces project-wide uniqueness on discount `sortOrder`, so a branch
 * copy cannot reuse the canonical's value. Derived from the canonical key + branchId
 * so it's stable across re-forks. NOTE: the branch copy therefore carries a machine
 * sortOrder — deploy-to-production keeps the canonical order via upsert-by-key (the
 * existing prod discount's sortOrder is not overwritten unless it actually changed).
 */
export function branchSortOrder(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let d = String((h % 999999999) + 1).replace(/0+$/, ""); // no trailing zeros (CT rejects them)
  if (!d) d = "1";
  return `0.${d}`; // decimal in (0,1), no trailing zero
}

const DISCOUNT_TYPES = new Set(['cart-discount', 'product-discount', 'discount-group']);

/** Encode a serialized asset of ANY branchable type onto a branch copy. No-op for main. */
export function encodeAsset(asset, branchId, resourceType, opts = {}) {
  if (isMain(branchId)) return asset;
  if (resourceType === 'product') return encodeProduct(asset, branchId, opts);
  if (resourceType === 'category') return encodeCategory(asset, branchId);
  // discounts / discount-group: `key` (+ `code` for discount-code) are project-unique,
  // and discount `sortOrder` must be unique too → give the branch copy its own.
  const a = structuredClone(asset);
  const seed = `${asset.key ?? ''}__${branchId}`;
  if (typeof a.key === 'string') a.key = encodeKey(a.key, branchId);
  if (resourceType === 'discount-code' && typeof a.code === 'string') a.code = encodeCode(a.code, branchId);
  if (DISCOUNT_TYPES.has(resourceType) && typeof a.sortOrder === 'string') a.sortOrder = branchSortOrder(seed);
  return a;
}

/** Canonicalize a serialized asset of ANY branchable type (clean copy). No-op for main. */
export function canonicalizeAsset(asset, branchId, resourceType) {
  if (isMain(branchId)) return asset;
  if (resourceType === 'product') return canonicalizeProduct(asset, branchId);
  if (resourceType === 'category') return canonicalizeCategory(asset, branchId);
  // reuse the bundle canonicalizer for discounts (strips key/code + predicate refs).
  const bk = BUNDLE_KEY[resourceType];
  const out = canonicalizeBundle({ [bk]: [structuredClone(asset)] }, branchId);
  return out[bk][0];
}

/**
 * Three-way merge classification for deploying a branch asset to production.
 * base = content at fork time, branch = branch HEAD now, prod = production now.
 */
export function classifyMerge({ forkedAtHash, branchHeadHash, prodNowHash }) {
  if (forkedAtHash == null) return 'new'; // born on branch → an add, no base to compare
  const branchChanged = branchHeadHash !== forkedAtHash;
  const prodChanged = prodNowHash !== forkedAtHash;
  if (!branchChanged) return prodChanged ? 'stale' : 'unchanged'; // branch didn't touch it
  if (!prodChanged) return 'fast-forward'; // only branch changed → clean deploy
  return branchHeadHash === prodNowHash ? 'converged' : 'conflict'; // both changed
}

/**
 * Return a NEW bundle with every project-unique identity field canonicalized for
 * `branchId`. No-op for `main`. Runs BEFORE predicate rewriting/validate/deploy so
 * the target only ever sees clean canonical identities.
 */
export function canonicalizeBundle(bundle, branchId) {
  if (isMain(branchId)) return bundle;
  const b = structuredClone(bundle);

  b.categories = (b.categories || []).map((c) => canonicalizeCategory(c, branchId));
  b.products = (b.products || []).map((p) => canonicalizeProduct(p, branchId));
  for (const dg of b.discountGroups || []) dg.key = canonicalKey(dg.key, branchId);
  for (const cd of b.cartDiscounts || []) {
    cd.key = canonicalKey(cd.key, branchId);
    cd.referenceMap = canonRefMap(cd.referenceMap, branchId);
    if (cd.discountGroup) cd.discountGroup = canonRef(cd.discountGroup, branchId);
  }
  for (const pd of b.productDiscounts || []) {
    pd.key = canonicalKey(pd.key, branchId);
    pd.referenceMap = canonRefMap(pd.referenceMap, branchId);
  }
  for (const dc of b.discountCodes || []) {
    dc.key = canonicalKey(dc.key, branchId);
    dc.code = canonicalCode(dc.code, branchId);
    dc.referenceMap = canonRefMap(dc.referenceMap, branchId);
    dc.cartDiscounts = (dc.cartDiscounts || []).map((r) => canonRef(r, branchId));
  }
  return b;
}

/**
 * Sentinel guard: throw if any identity field still carries a branch marker. This is
 * the last line of defense keeping production clean — call it on the canonicalized
 * bundle right before deploy.
 */
export function assertClean(bundle, branchId) {
  const bad = [];
  const ckKey = (rt, k, v) => { if (typeof v === 'string' && v.includes(KEY_DELIM)) bad.push(`${rt} ${k}: "${v}" still contains "${KEY_DELIM}"`); };
  const ckSlug = (rt, k, loc) => {
    if (isMain(branchId) || !loc) return;
    const suffix = `${SLUG_DELIM}${branchId}`;
    for (const [l, v] of Object.entries(loc)) if (typeof v === 'string' && v.endsWith(suffix)) bad.push(`${rt} ${k} slug[${l}]: "${v}" still branch-suffixed`);
  };
  for (const c of bundle.categories || []) { ckKey('category', c.key, c.key); ckSlug('category', c.key, c.slug); if (c.parent) ckKey('category.parent', c.key, c.parent.key); }
  for (const p of bundle.products || []) {
    ckKey('product', p.key, p.key); ckSlug('product', p.key, p.slug);
    (p.categories || []).forEach((r) => ckKey('product.category', p.key, r.key));
    for (const v of [p.masterVariant, ...(p.variants || [])].filter(Boolean)) {
      ckKey('variant.sku', p.key, v.sku);
      if (v.key) ckKey('variant.key', p.key, v.key);
      (v.prices || []).forEach((pr) => ckKey('price', p.key, pr.key));
      (v.attributes || []).forEach((a) => { if (BRANCH_ATTRS.includes(a.name)) bad.push(`product ${p.key}: branch attribute "${a.name}" not stripped`); });
    }
  }
  for (const dg of bundle.discountGroups || []) ckKey('discount-group', dg.key, dg.key);
  for (const cd of bundle.cartDiscounts || []) { ckKey('cart-discount', cd.key, cd.key); Object.values(cd.referenceMap || {}).forEach((e) => ckKey('cart-discount.ref', cd.key, e?.key)); }
  for (const pd of bundle.productDiscounts || []) { ckKey('product-discount', pd.key, pd.key); Object.values(pd.referenceMap || {}).forEach((e) => ckKey('product-discount.ref', pd.key, e?.key)); }
  for (const dc of bundle.discountCodes || []) { ckKey('discount-code', dc.key, dc.key); ckKey('discount-code.code', dc.key, dc.code); }
  if (bad.length) throw new Error(`branch sentinel: ${bad.length} identity field(s) leaked into a clean bundle:\n  ${bad.join('\n  ')}`);
  return true;
}
