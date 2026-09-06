/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * serialize.mjs — build a portable "release bundle" from a source project.
 *
 * Everything that can be a reference is emitted BY KEY (product type, categories,
 * tax category, state, stores, customer groups, channels, discount groups, the
 * cart discounts a code points at). commercetools resource drafts accept
 * key-based ResourceIdentifiers, so those port directly.
 *
 * The hard case is ids embedded INSIDE predicate strings (e.g.
 * `categories.id = "…uuid…"`) and giftLineItem values. For each discount we scan
 * every predicate for uuids, resolve each uuid to {typeId, key} in the source
 * project, and store that as `referenceMap`. The deploy step rewrites the uuids
 * to the target project's ids using this map. Anything that can't be resolved is
 * flagged `unresolved` so `validate` can fail loudly before a deploy.
 */
import { ENDPOINT_BY_TYPEID, UUID_RE, stripVolatile, pickName } from './util.mjs';
import { canonicalizeBundle, assertClean, isMain } from './branch.mjs';

// ---- id → key resolution (cached per client) ----
export async function keyForId(client, typeId, id) {
  const ck = `${typeId}:${id}`;
  if (client.__refKeyCache.has(ck)) return client.__refKeyCache.get(ck);
  const ep = ENDPOINT_BY_TYPEID[typeId];
  let key = null;
  if (ep) {
    const r = await client.get(`/${ep}/${id}`);
    if (r && r.key) key = r.key;
  }
  client.__refKeyCache.set(ck, key);
  return key;
}
const PROBE = ['category', 'product', 'customer-group', 'channel', 'product-type', 'state', 'tax-category', 'store'];
async function keyForUnknownId(client, id) {
  const ck = `?:${id}`;
  if (client.__refKeyCache.has(ck)) return client.__refKeyCache.get(ck);
  let found = null;
  for (const t of PROBE) {
    const key = await keyForId(client, t, id);
    if (key) { found = { typeId: t, key }; break; }
  }
  client.__refKeyCache.set(ck, found);
  return found;
}

// map every uuid appearing in `predicates` (+ platform `references`) to {typeId,key}
export async function buildReferenceMap(client, predicates, references = []) {
  const hint = {};
  (references || []).forEach((r) => { if (r && r.id) hint[r.id] = r.typeId; });
  const ids = new Set();
  for (const p of predicates) {
    if (!p) continue;
    (String(p).match(UUID_RE) || []).forEach((u) => ids.add(u));
  }
  (references || []).forEach((r) => { if (r && r.id) ids.add(r.id); });
  const map = {};
  for (const id of ids) {
    let entry = null;
    if (hint[id]) { const key = await keyForId(client, hint[id], id); if (key) entry = { typeId: hint[id], key }; }
    if (!entry) entry = await keyForUnknownId(client, id);
    map[id] = entry || { typeId: 'unknown', key: null, unresolved: true };
  }
  return map;
}

async function keyRef(client, typeId, ref) {
  if (!ref) return undefined;
  const key = ref.key || (ref.id ? await keyForId(client, typeId, ref.id) : null);
  return key ? { typeId, key } : { typeId, key: null, unresolved: true, id: ref.id };
}

// ---- per-resource serializers ----
export async function serializeDiscountGroup(client, dg) {
  return { resourceType: 'discount-group', key: dg.key, name: dg.name, description: dg.description, sortOrder: dg.sortOrder, isActive: dg.isActive };
}

export async function serializeCategory(client, cat) {
  return {
    resourceType: 'category', key: cat.key, name: cat.name, slug: cat.slug, description: cat.description,
    orderHint: cat.orderHint, externalId: cat.externalId,
    parent: cat.parent ? await keyRef(client, 'category', cat.parent) : undefined,
    metaTitle: cat.metaTitle, metaDescription: cat.metaDescription, metaKeywords: cat.metaKeywords,
  };
}

async function serializeGiftLineItemValue(client, value) {
  const out = { ...value };
  if (value.product) out.product = await keyRef(client, 'product', value.product);
  if (value.supplyChannel) out.supplyChannel = await keyRef(client, 'channel', value.supplyChannel);
  if (value.distributionChannel) out.distributionChannel = await keyRef(client, 'channel', value.distributionChannel);
  return out;
}

export async function serializeCartDiscount(client, cd) {
  const predicates = [cd.cartPredicate, cd.target?.predicate];
  const referenceMap = await buildReferenceMap(client, predicates, cd.references);
  const stores = await Promise.all((cd.stores || []).map((s) => keyRef(client, 'store', s)));
  const discountGroup = cd.discountGroup ? await keyRef(client, 'discount-group', cd.discountGroup) : undefined;
  const value = cd.value?.type === 'giftLineItem' ? await serializeGiftLineItemValue(client, cd.value) : cd.value;
  return {
    resourceType: 'cart-discount', key: cd.key, name: cd.name, description: cd.description,
    value, cartPredicate: cd.cartPredicate, target: cd.target, sortOrder: cd.sortOrder,
    stackingMode: cd.stackingMode, requiresDiscountCode: cd.requiresDiscountCode, isActive: cd.isActive,
    validFrom: cd.validFrom, validUntil: cd.validUntil, stores, discountGroup, referenceMap,
  };
}

export async function serializeProductDiscount(client, pd) {
  const referenceMap = await buildReferenceMap(client, [pd.predicate], pd.references);
  return {
    resourceType: 'product-discount', key: pd.key, name: pd.name, description: pd.description,
    value: pd.value, predicate: pd.predicate, sortOrder: pd.sortOrder, isActive: pd.isActive,
    validFrom: pd.validFrom, validUntil: pd.validUntil, referenceMap,
  };
}

export async function serializeDiscountCode(client, dc) {
  const referenceMap = await buildReferenceMap(client, [dc.cartPredicate], dc.references);
  const cartDiscounts = await Promise.all((dc.cartDiscounts || []).map((r) => keyRef(client, 'cart-discount', r)));
  return {
    resourceType: 'discount-code', key: dc.key, code: dc.code, name: dc.name, description: dc.description,
    cartDiscounts, isActive: dc.isActive, maxApplications: dc.maxApplications,
    maxApplicationsPerCustomer: dc.maxApplicationsPerCustomer, cartPredicate: dc.cartPredicate,
    groups: dc.groups, validFrom: dc.validFrom, validUntil: dc.validUntil, referenceMap,
  };
}

async function serializePrice(client, p) {
  const out = { key: p.key, value: p.value };
  if (p.country) out.country = p.country;
  if (p.validFrom) out.validFrom = p.validFrom;
  if (p.validUntil) out.validUntil = p.validUntil;
  if (p.tiers) out.tiers = p.tiers;
  if (p.customerGroup) out.customerGroup = await keyRef(client, 'customer-group', p.customerGroup);
  if (p.channel) out.channel = await keyRef(client, 'channel', p.channel);
  return out;
}
// a value is a reference (or set of references) → carries per-project ids that
// don't port. `stripReferenceAttributes` drops these (e.g. a product's
// key-value-document / product reference attributes) for cross-project clones.
const isRef = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.typeId === 'string' && ('id' in v || 'key' in v);
const isRefValue = (v) => isRef(v) || (Array.isArray(v) && v.length > 0 && v.every(isRef));
// remap a key-value-document reference's id source→target via coIdMap; leave
// other reference types untouched. Returns null if a KVD id isn't in the map.
const remapKvd = (ref, map) => (ref.typeId === 'key-value-document' ? (map[ref.id] ? { ...ref, id: map[ref.id] } : null) : ref);
function remapRefAttr(a, map) {
  const v = a.value;
  if (isRef(v)) { const r = remapKvd(v, map); return r ? { ...a, value: r } : null; }
  if (Array.isArray(v) && v.length > 0 && v.every(isRef)) {
    const mapped = v.map((x) => remapKvd(x, map)).filter(Boolean);
    return mapped.length ? { ...a, value: mapped } : null;
  }
  return a;
}

async function serializeVariant(client, v, opts = {}) {
  let attributes = v.attributes || [];
  if (opts.coIdMap) attributes = attributes.map((a) => remapRefAttr(a, opts.coIdMap)).filter(Boolean);
  else if (opts.stripReferenceAttributes) attributes = attributes.filter((a) => !isRefValue(a.value));
  const out = { sku: v.sku, key: v.key, attributes };
  if (v.images) out.images = v.images;
  out.prices = await Promise.all((v.prices || []).map((p) => serializePrice(client, p)));
  return out;
}
export async function serializeProduct(client, p, opts = {}) {
  // Prefer the published (current) projection, but fall back to staged so an
  // UNPUBLISHED product still serializes (an offline product carries its state
  // forward instead of throwing "no current projection").
  const md = p.masterData;
  const c = md?.current || md?.staged;
  if (!c) throw new Error(`product ${p.key || p.id} has no projection`);
  // `published` is the live/offline signal. Deploy (deploy.mjs upsertProduct)
  // publishes or unpublishes the target product to match this, so taking a
  // product offline propagates stage → prod. Default true (published).
  const published = md?.published !== false;
  const categories = await Promise.all((c.categories || []).map((r) => keyRef(client, 'category', r)));
  return {
    resourceType: 'product', key: p.key,
    productType: await keyRef(client, 'product-type', p.productType),
    name: c.name, slug: c.slug, description: c.description,
    metaTitle: c.metaTitle, metaDescription: c.metaDescription, metaKeywords: c.metaKeywords,
    categories,
    taxCategory: p.taxCategory ? await keyRef(client, 'tax-category', p.taxCategory) : undefined,
    state: p.state ? await keyRef(client, 'state', p.state) : undefined,
    masterVariant: await serializeVariant(client, c.masterVariant, opts),
    variants: await Promise.all((c.variants || []).map((v) => serializeVariant(client, v, opts))),
    published,
    publish: published,
  };
}

// ---- top-level ----
// selection: { products, cartDiscounts, productDiscounts, discountCodes, discountGroups }
// each value is an array of keys, or the string '*' (all — products excluded from '*').
async function resolveSelection(client, sel, endpoint, keyField = 'key') {
  if (!sel) return [];
  if (sel === '*' || (Array.isArray(sel) && sel.includes('*'))) return client.all(`/${endpoint}`);
  const keys = Array.isArray(sel) ? sel : [sel];
  const out = [];
  for (const k of keys) {
    const o = await client.byKey(endpoint, k);
    if (!o) throw new Error(`${endpoint} key "${k}" not found in ${client.pk}`);
    out.push(o);
  }
  return out;
}

export async function serializeBundle(client, selection, meta = {}) {
  const prodOpts = { stripReferenceAttributes: !!meta.stripReferenceAttributes, coIdMap: meta.coIdMap };
  const dgs = await resolveSelection(client, selection.discountGroups, 'discount-groups');
  const cats = await resolveSelection(client, selection.categories, 'categories');
  const cds = await resolveSelection(client, selection.cartDiscounts, 'cart-discounts');
  const pds = await resolveSelection(client, selection.productDiscounts, 'product-discounts');
  const dcs = await resolveSelection(client, selection.discountCodes, 'discount-codes');
  const prods = selection.products ? await resolveSelection(client, selection.products, 'products') : [];

  const bundle = {
    bundleKey: meta.bundleKey || null,
    sourceProject: client.pk,
    // deploy order matters: groups → categories → products → cart/product discounts → codes
    discountGroups: await Promise.all(dgs.map((o) => serializeDiscountGroup(client, o))),
    categories: await Promise.all(cats.map((o) => serializeCategory(client, o))),
    products: await Promise.all(prods.map((o) => serializeProduct(client, o, prodOpts))),
    productDiscounts: await Promise.all(pds.map((o) => serializeProductDiscount(client, o))),
    cartDiscounts: await Promise.all(cds.map((o) => serializeCartDiscount(client, o))),
    discountCodes: await Promise.all(dcs.map((o) => serializeDiscountCode(client, o))),
  };

  // Branch → production: strip every branch suffix off the identity fields so the
  // bundle upserts by CLEAN canonical key and production never accumulates branch
  // rows. No-op for `main`. Sentinel guard fails loudly if anything leaks. Runs
  // BEFORE downstream predicate-rewriting/validate/deploy, and before hashing, so a
  // branch's canonicalized content is directly comparable to production content.
  if (!isMain(meta.branchId)) {
    const clean = canonicalizeBundle(bundle, meta.branchId);
    assertClean(clean, meta.branchId);
    return clean;
  }
  return bundle;
}

// collect every unresolved reference across a bundle (for validate)
export function collectUnresolved(bundle) {
  const problems = [];
  const scanMap = (rt, key, map) => {
    for (const [id, e] of Object.entries(map || {})) if (e?.unresolved || !e?.key) problems.push({ resourceType: rt, key, kind: 'predicate-ref', sourceId: id });
  };
  const scanRef = (rt, key, field, ref) => { if (ref && (ref.unresolved || ref.key == null)) problems.push({ resourceType: rt, key, kind: field, sourceId: ref.id }); };
  for (const cd of bundle.cartDiscounts || []) {
    scanMap('cart-discount', cd.key, cd.referenceMap);
    (cd.stores || []).forEach((s) => scanRef('cart-discount', cd.key, 'store', s));
    scanRef('cart-discount', cd.key, 'discountGroup', cd.discountGroup);
  }
  for (const pd of bundle.productDiscounts || []) scanMap('product-discount', pd.key, pd.referenceMap);
  for (const dc of bundle.discountCodes || []) {
    scanMap('discount-code', dc.key, dc.referenceMap);
    (dc.cartDiscounts || []).forEach((r) => scanRef('discount-code', dc.key, 'cartDiscount', r));
  }
  for (const c of bundle.categories || []) scanRef('category', c.key, 'parent', c.parent);
  for (const p of bundle.products || []) {
    scanRef('product', p.key, 'productType', p.productType);
    (p.categories || []).forEach((r) => scanRef('product', p.key, 'category', r));
    scanRef('product', p.key, 'taxCategory', p.taxCategory);
    scanRef('product', p.key, 'state', p.state);
  }
  return problems;
}
