/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * deploy.mjs — validate + upsert a release bundle into a target project.
 *
 * Idempotent, by key: for each resource, create if absent, else diff and emit
 * only the update actions for fields that changed. Deploying a bundle back into
 * the project it came from is a no-op (the live→live self-test).
 *
 * Reference handling:
 *  - stores / discountGroup / productType / categories / taxCategory / state /
 *    code→cartDiscount are passed as key-based ResourceIdentifiers (CT resolves).
 *  - ids embedded in predicate strings are rewritten source-id → target-id via
 *    the bundle's referenceMap (a no-op when predicates are already key-based).
 *  - embedded prices are matched by key; a price's scope is baked into its key,
 *    so a diff only checks money + validity.
 */
import { ENDPOINT_BY_TYPEID, stableStringify } from './util.mjs';
import { captureBaselines, endpointFor } from './prod-history.mjs';

const cleanRef = (r) => (r && r.key ? { typeId: r.typeId, key: r.key } : undefined);
const cleanRefs = (arr) => (arr || []).map(cleanRef).filter(Boolean);
const changed = (a, b) => stableStringify(a ?? null) !== stableStringify(b ?? null);
const dropUndef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const errMsg = (r) => r.body?.message || JSON.stringify(r.body?.errors || r.body).slice(0, 400);

// target id ← key (cached)
async function targetId(target, typeId, key) {
  const ck = `tid:${typeId}:${key}`;
  if (target.__refKeyCache.has(ck)) return target.__refKeyCache.get(ck);
  const ep = ENDPOINT_BY_TYPEID[typeId];
  const o = ep ? await target.byKey(ep, key) : null;
  const id = o?.id || null;
  target.__refKeyCache.set(ck, id);
  return id;
}
// target key ← id (cached) — for diffing existing (id-based) refs against desired (key-based)
async function targetKeyOfId(target, typeId, id) {
  if (!id) return null;
  const ck = `tk:${typeId}:${id}`;
  if (target.__refKeyCache.has(ck)) return target.__refKeyCache.get(ck);
  const ep = ENDPOINT_BY_TYPEID[typeId];
  const o = ep ? await target.get(`/${ep}/${id}`) : null;
  const key = o?.key || null;
  target.__refKeyCache.set(ck, key);
  return key;
}

export async function rewritePredicate(target, predicate, referenceMap) {
  if (!predicate || !referenceMap) return predicate;
  let out = predicate;
  for (const [srcId, e] of Object.entries(referenceMap)) {
    if (!e?.key) continue;
    const tid = await targetId(target, e.typeId, e.key);
    if (tid && tid !== srcId) out = out.split(srcId).join(tid);
  }
  return out;
}

// ---- validate every key-ref against target (missing → deploy would fail) ----
export async function validateAgainstTarget(target, bundle) {
  const missing = [];
  const inBundle = {
    'discount-group': new Set((bundle.discountGroups || []).map((d) => d.key)),
    category: new Set((bundle.categories || []).map((c) => c.key)),
    'cart-discount': new Set((bundle.cartDiscounts || []).map((d) => d.key)),
    product: new Set((bundle.products || []).map((p) => p.key)),
  };
  const check = async (typeId, key, ctx) => {
    if (!key) { missing.push({ ...ctx, typeId, key: null, reason: 'unresolved-in-source' }); return; }
    if (inBundle[typeId]?.has(key)) return; // will be created by this deploy
    const ep = ENDPOINT_BY_TYPEID[typeId];
    const o = ep ? await target.byKey(ep, key) : null;
    if (!o) missing.push({ ...ctx, typeId, key, reason: 'not-in-target' });
  };
  for (const cd of bundle.cartDiscounts || []) {
    for (const s of cd.stores || []) await check('store', s.key, { resource: 'cart-discount', key: cd.key, field: 'store' });
    if (cd.discountGroup) await check('discount-group', cd.discountGroup.key, { resource: 'cart-discount', key: cd.key, field: 'discountGroup' });
    for (const e of Object.values(cd.referenceMap || {})) if (e?.key || e?.unresolved) await check(e.typeId, e.key, { resource: 'cart-discount', key: cd.key, field: 'predicate' });
  }
  for (const pd of bundle.productDiscounts || []) for (const e of Object.values(pd.referenceMap || {})) if (e?.key || e?.unresolved) await check(e.typeId, e.key, { resource: 'product-discount', key: pd.key, field: 'predicate' });
  for (const dc of bundle.discountCodes || []) for (const r of dc.cartDiscounts || []) await check('cart-discount', r.key, { resource: 'discount-code', key: dc.key, field: 'cartDiscount' });
  for (const c of bundle.categories || []) {
    if (c.parent) await check('category', c.parent.key, { resource: 'category', key: c.key, field: 'parent' });
  }
  for (const p of bundle.products || []) {
    if (p.productType) await check('product-type', p.productType.key, { resource: 'product', key: p.key, field: 'productType' });
    for (const c of p.categories || []) await check('category', c.key, { resource: 'product', key: p.key, field: 'category' });
    if (p.taxCategory) await check('tax-category', p.taxCategory.key, { resource: 'product', key: p.key, field: 'taxCategory' });
    if (p.state) await check('state', p.state.key, { resource: 'product', key: p.key, field: 'state' });
  }
  return missing;
}

// ---- generic upsert executor ----
async function upsert(target, endpoint, key, buildDraft, buildActions, dryRun) {
  const existing = await target.byKey(endpoint, key);
  if (!existing) {
    const draft = await buildDraft();
    if (dryRun) return { key, action: 'create' };
    const r = await target.post(`/${endpoint}`, draft);
    return r.ok ? { key, action: 'create', status: r.status } : { key, action: 'error', status: r.status, error: errMsg(r) };
  }
  const actions = await buildActions(existing);
  if (!actions.length) return { key, action: 'noop' };
  if (dryRun) return { key, action: 'update', actions: actions.map((a) => a.action) };
  const r = await target.post(`/${endpoint}/key=${encodeURIComponent(key)}`, { version: existing.version, actions });
  return r.ok ? { key, action: 'update', status: r.status, actions: actions.map((a) => a.action) } : { key, action: 'error', status: r.status, error: errMsg(r), attempted: actions.map((a) => a.action) };
}

// ---- discount group ----
async function upsertDiscountGroup(target, dg, dryRun) {
  return upsert(target, 'discount-groups', dg.key,
    () => dropUndef({ key: dg.key, name: dg.name, description: dg.description, sortOrder: dg.sortOrder, isActive: dg.isActive }),
    (ex) => {
      const a = [];
      if (changed(dg.name, ex.name)) a.push({ action: 'setName', name: dg.name });
      if (changed(dg.description, ex.description)) a.push({ action: 'setDescription', description: dg.description });
      if (dg.sortOrder !== ex.sortOrder) a.push({ action: 'setSortOrder', sortOrder: dg.sortOrder });
      if (dg.isActive !== ex.isActive) a.push({ action: 'setIsActive', isActive: dg.isActive });
      return a;
    }, dryRun);
}

// ---- category ----
async function upsertCategory(target, cat, dryRun) {
  return upsert(target, 'categories', cat.key,
    () => dropUndef({
      key: cat.key, name: cat.name, slug: cat.slug, description: cat.description,
      orderHint: cat.orderHint, externalId: cat.externalId, parent: cleanRef(cat.parent),
      metaTitle: cat.metaTitle, metaDescription: cat.metaDescription, metaKeywords: cat.metaKeywords,
    }),
    async (ex) => {
      const a = [];
      if (changed(cat.name, ex.name)) a.push({ action: 'changeName', name: cat.name });
      if (changed(cat.slug, ex.slug)) a.push({ action: 'changeSlug', slug: cat.slug });
      if (changed(cat.description, ex.description)) a.push(dropUndef({ action: 'setDescription', description: cat.description }));
      if ((cat.orderHint || null) !== (ex.orderHint || null)) a.push({ action: 'changeOrderHint', orderHint: cat.orderHint });
      if ((cat.externalId || null) !== (ex.externalId || null)) a.push(dropUndef({ action: 'setExternalId', externalId: cat.externalId }));
      if (changed(cat.metaTitle, ex.metaTitle)) a.push(dropUndef({ action: 'setMetaTitle', metaTitle: cat.metaTitle }));
      if (changed(cat.metaDescription, ex.metaDescription)) a.push(dropUndef({ action: 'setMetaDescription', metaDescription: cat.metaDescription }));
      if (changed(cat.metaKeywords, ex.metaKeywords)) a.push(dropUndef({ action: 'setMetaKeywords', metaKeywords: cat.metaKeywords }));
      // parent (compare by key; changeParent needs a parent — root/unset isn't handled)
      const wantParent = cat.parent?.key || null;
      const haveParent = ex.parent ? await targetKeyOfId(target, 'category', ex.parent.id) : null;
      if (wantParent && wantParent !== haveParent) a.push({ action: 'changeParent', parent: cleanRef(cat.parent) });
      return a;
    }, dryRun);
}

function buildCartValue(value) {
  if (value?.type === 'giftLineItem') return dropUndef({ ...value, product: cleanRef(value.product), supplyChannel: cleanRef(value.supplyChannel), distributionChannel: cleanRef(value.distributionChannel) });
  return value;
}

// ---- cart discount ----
async function upsertCartDiscount(target, cd, dryRun) {
  const predicate = await rewritePredicate(target, cd.cartPredicate, cd.referenceMap);
  const tgt = cd.target ? { ...cd.target, predicate: await rewritePredicate(target, cd.target.predicate, cd.referenceMap) } : undefined;
  return upsert(target, 'cart-discounts', cd.key,
    () => dropUndef({
      key: cd.key, name: cd.name, description: cd.description, value: buildCartValue(cd.value),
      cartPredicate: predicate, target: tgt, sortOrder: cd.sortOrder, stackingMode: cd.stackingMode,
      requiresDiscountCode: cd.requiresDiscountCode, isActive: cd.isActive, validFrom: cd.validFrom, validUntil: cd.validUntil,
      stores: cleanRefs(cd.stores), discountGroup: cleanRef(cd.discountGroup),
    }),
    async (ex) => {
      const a = [];
      if (changed(buildCartValue(cd.value), ex.value)) a.push({ action: 'changeValue', value: buildCartValue(cd.value) });
      if (predicate !== ex.cartPredicate) a.push({ action: 'changeCartPredicate', cartPredicate: predicate });
      if (tgt && changed(tgt, ex.target)) a.push({ action: 'changeTarget', target: tgt });
      if (changed(cd.name, ex.name)) a.push({ action: 'changeName', name: cd.name });
      if (changed(cd.description, ex.description)) a.push({ action: 'setDescription', description: cd.description });
      if (cd.stackingMode !== ex.stackingMode) a.push({ action: 'changeStackingMode', stackingMode: cd.stackingMode });
      if (cd.requiresDiscountCode !== ex.requiresDiscountCode) a.push({ action: 'changeRequiresDiscountCode', requiresDiscountCode: cd.requiresDiscountCode });
      if (cd.isActive !== ex.isActive) a.push({ action: 'changeIsActive', isActive: cd.isActive });
      if (cd.sortOrder !== ex.sortOrder) a.push({ action: 'changeSortOrder', sortOrder: cd.sortOrder });
      if ((cd.validFrom || null) !== (ex.validFrom || null) || (cd.validUntil || null) !== (ex.validUntil || null)) a.push(dropUndef({ action: 'setValidFromAndUntil', validFrom: cd.validFrom, validUntil: cd.validUntil }));
      const wantStores = (cd.stores || []).map((s) => s.key).filter(Boolean).sort();
      const haveStores = (ex.stores || []).map((s) => s.key).filter(Boolean).sort();
      if (changed(wantStores, haveStores)) a.push({ action: 'setStores', stores: cleanRefs(cd.stores) });
      // discountGroup: compare by key (existing is id-based)
      const wantG = cd.discountGroup?.key || null;
      const haveG = ex.discountGroup ? await targetKeyOfId(target, 'discount-group', ex.discountGroup.id) : null;
      if (wantG !== haveG) a.push(dropUndef({ action: 'setDiscountGroup', discountGroup: cleanRef(cd.discountGroup) }));
      return a;
    }, dryRun);
}

// ---- product discount ----
async function upsertProductDiscount(target, pd, dryRun) {
  const predicate = await rewritePredicate(target, pd.predicate, pd.referenceMap);
  return upsert(target, 'product-discounts', pd.key,
    () => dropUndef({ key: pd.key, name: pd.name, description: pd.description, value: pd.value, predicate, sortOrder: pd.sortOrder, isActive: pd.isActive, validFrom: pd.validFrom, validUntil: pd.validUntil }),
    (ex) => {
      const a = [];
      if (changed(pd.value, ex.value)) a.push({ action: 'changeValue', value: pd.value });
      if (predicate !== ex.predicate) a.push({ action: 'changePredicate', predicate });
      if (changed(pd.name, ex.name)) a.push({ action: 'changeName', name: pd.name });
      if (changed(pd.description, ex.description)) a.push({ action: 'setDescription', description: pd.description });
      if (pd.isActive !== ex.isActive) a.push({ action: 'changeIsActive', isActive: pd.isActive });
      if (pd.sortOrder !== ex.sortOrder) a.push({ action: 'changeSortOrder', sortOrder: pd.sortOrder });
      if ((pd.validFrom || null) !== (ex.validFrom || null) || (pd.validUntil || null) !== (ex.validUntil || null)) a.push(dropUndef({ action: 'setValidFromAndUntil', validFrom: pd.validFrom, validUntil: pd.validUntil }));
      return a;
    }, dryRun);
}

// ---- discount code ----
async function upsertDiscountCode(target, dc, dryRun) {
  const predicate = await rewritePredicate(target, dc.cartPredicate, dc.referenceMap);
  return upsert(target, 'discount-codes', dc.key,
    () => dropUndef({ key: dc.key, code: dc.code, name: dc.name, description: dc.description, cartDiscounts: cleanRefs(dc.cartDiscounts), isActive: dc.isActive, maxApplications: dc.maxApplications, maxApplicationsPerCustomer: dc.maxApplicationsPerCustomer, cartPredicate: predicate, groups: dc.groups, validFrom: dc.validFrom, validUntil: dc.validUntil }),
    async (ex) => {
      const a = [];
      const wantCd = (dc.cartDiscounts || []).map((r) => r.key).filter(Boolean).sort();
      const haveCd = [];
      for (const r of ex.cartDiscounts || []) haveCd.push(r.key || await targetKeyOfId(target, 'cart-discount', r.id));
      if (changed(wantCd, haveCd.filter(Boolean).sort())) a.push({ action: 'changeCartDiscounts', cartDiscounts: cleanRefs(dc.cartDiscounts) });
      if (dc.isActive !== ex.isActive) a.push({ action: 'changeIsActive', isActive: dc.isActive });
      if (changed(dc.name, ex.name)) a.push({ action: 'setName', name: dc.name });
      if (changed(dc.description, ex.description)) a.push({ action: 'setDescription', description: dc.description });
      if ((dc.maxApplications ?? null) !== (ex.maxApplications ?? null)) a.push(dropUndef({ action: 'setMaxApplications', maxApplications: dc.maxApplications }));
      if ((dc.maxApplicationsPerCustomer ?? null) !== (ex.maxApplicationsPerCustomer ?? null)) a.push(dropUndef({ action: 'setMaxApplicationsPerCustomer', maxApplicationsPerCustomer: dc.maxApplicationsPerCustomer }));
      if (changed((dc.groups || []).slice().sort(), (ex.groups || []).slice().sort())) a.push({ action: 'changeGroups', groups: dc.groups || [] });
      if ((predicate || null) !== (ex.cartPredicate || null)) a.push(dropUndef({ action: 'setCartPredicate', cartPredicate: predicate }));
      if ((dc.validFrom || null) !== (ex.validFrom || null) || (dc.validUntil || null) !== (ex.validUntil || null)) a.push(dropUndef({ action: 'setValidFromAndUntil', validFrom: dc.validFrom, validUntil: dc.validUntil }));
      return a;
    }, dryRun);
}

// ---- product ----
function priceDraft(p) {
  return dropUndef({ key: p.key, value: p.value, country: p.country, customerGroup: cleanRef(p.customerGroup), channel: cleanRef(p.channel), validFrom: p.validFrom, validUntil: p.validUntil, tiers: p.tiers });
}
function variantDraft(v) {
  return dropUndef({ sku: v.sku, key: v.key, prices: (v.prices || []).map(priceDraft), attributes: v.attributes || [], images: v.images });
}
const priceSame = (want, have) => !changed(want.value, have.value) && (want.validFrom || null) === (have.validFrom || null) && (want.validUntil || null) === (have.validUntil || null);

async function upsertProduct(target, p, dryRun) {
  return upsert(target, 'products', p.key,
    () => dropUndef({
      key: p.key, productType: cleanRef(p.productType), name: p.name, slug: p.slug, description: p.description,
      metaTitle: p.metaTitle, metaDescription: p.metaDescription, metaKeywords: p.metaKeywords,
      categories: cleanRefs(p.categories), taxCategory: cleanRef(p.taxCategory), state: cleanRef(p.state),
      masterVariant: variantDraft(p.masterVariant), variants: (p.variants || []).map(variantDraft),
      // create matching the source's live/offline state (offline → created unpublished)
      publish: p.published !== false,
    }),
    async (ex) => {
      const a = [];
      const cur = ex.masterData?.current || {};
      if (changed(p.name, cur.name)) a.push({ action: 'changeName', name: p.name, staged: false });
      if (changed(p.slug, cur.slug)) a.push({ action: 'changeSlug', slug: p.slug, staged: false });
      if (changed(p.description, cur.description)) a.push({ action: 'setDescription', description: p.description, staged: false });
      if (changed(p.metaTitle, cur.metaTitle)) a.push(dropUndef({ action: 'setMetaTitle', metaTitle: p.metaTitle, staged: false }));
      if (changed(p.metaDescription, cur.metaDescription)) a.push(dropUndef({ action: 'setMetaDescription', metaDescription: p.metaDescription, staged: false }));
      if (changed(p.metaKeywords, cur.metaKeywords)) a.push(dropUndef({ action: 'setMetaKeywords', metaKeywords: p.metaKeywords, staged: false }));
      // taxCategory (compare by key)
      const wantTax = p.taxCategory?.key || null;
      const haveTax = ex.taxCategory ? await targetKeyOfId(target, 'tax-category', ex.taxCategory.id) : null;
      if (wantTax !== haveTax) a.push(dropUndef({ action: 'setTaxCategory', taxCategory: cleanRef(p.taxCategory) }));
      // categories (by key)
      const wantCats = new Set((p.categories || []).map((c) => c.key).filter(Boolean));
      const haveCats = new Set();
      for (const c of cur.categories || []) { const k = c.key || await targetKeyOfId(target, 'category', c.id); if (k) haveCats.add(k); }
      for (const k of wantCats) if (!haveCats.has(k)) a.push({ action: 'addToCategory', category: { typeId: 'category', key: k }, staged: false });
      for (const k of haveCats) if (!wantCats.has(k)) a.push({ action: 'removeFromCategory', category: { typeId: 'category', key: k }, staged: false });
      // prices + attributes per variant (matched by sku)
      const curVariants = [cur.masterVariant, ...(cur.variants || [])].filter(Boolean);
      const bySku = Object.fromEntries(curVariants.map((v) => [v.sku, v]));
      for (const bv of [p.masterVariant, ...(p.variants || [])]) {
        const cv = bySku[bv.sku];
        if (!cv) continue; // new variant → would need addVariant; skip for v1 (log via note)
        const curByKey = Object.fromEntries((cv.prices || []).filter((x) => x.key).map((x) => [x.key, x]));
        // Fall back to matching by SCOPE (currency/country/customerGroup/channel/validity)
        // for prices without a key — commercetools enforces scope-uniqueness, so a desired
        // price maps to at most one existing price. Without this, a keyless price (a common
        // authoring shape) is re-added on every update → "Duplicate price scope". Keyed
        // catalogs are unaffected (curByKey matches first).
        const scopeSig = (x) => JSON.stringify([x.value?.currencyCode ?? null, x.country ?? null, x.customerGroup?.id ?? x.customerGroup?.key ?? null, x.channel?.id ?? x.channel?.key ?? null, x.validFrom ?? null, x.validUntil ?? null]);
        const curByScope = Object.fromEntries((cv.prices || []).map((x) => [scopeSig(x), x]));
        for (const wp of bv.prices || []) {
          const cp = (wp.key && curByKey[wp.key]) || curByScope[scopeSig(wp)];
          if (!cp) a.push({ action: 'addPrice', sku: bv.sku, price: priceDraft(wp), staged: false });
          else if (!priceSame(wp, cp)) a.push({ action: 'changePrice', priceId: cp.id, price: priceDraft(wp), staged: false });
        }
        // attributes
        const curAttrs = Object.fromEntries((cv.attributes || []).map((at) => [at.name, at.value]));
        for (const at of bv.attributes || []) if (changed(at.value, curAttrs[at.name])) a.push({ action: 'setAttribute', sku: bv.sku, name: at.name, value: at.value, staged: false });
      }
      // Match the target's publish state to the source (live/offline propagation).
      // NOTE: the publish/unpublish action is pushed into `a` — an empty action
      // list is a no-op upstream, so when the ONLY change is the live/offline
      // state this action is what still gets applied.
      const want = p.published !== false;      // desired: should it be published?
      const have = !!ex.masterData?.published; // current target state
      if (!want) {
        // take the product offline in the target to match the source
        if (have) a.push({ action: 'unpublish' });
      } else if ((a.length && (ex.masterData?.hasStagedChanges || a.some((x) => x.staged === false))) || !have) {
        // publish the flushed content changes (original behavior) OR re-publish a
        // product that is currently offline in the target (bring it back live).
        a.push({ action: 'publish' });
      }
      return a;
    }, dryRun);
}

// ---- delete a single resource by key (unpublish products first) ----
export async function deleteResource(target, { resourceType, key }, dryRun) {
  const ep = endpointFor(resourceType);
  if (!ep) return { key, action: 'error', error: `unknown resourceType "${resourceType}"` };
  const existing = await target.byKey(ep, key);
  if (!existing) return { key, action: 'noop' }; // already absent — nothing to remove
  if (dryRun) return { key, action: 'delete' };
  let version = existing.version;
  if (resourceType === 'product' && existing.masterData?.published) {
    const u = await target.post(`/products/key=${encodeURIComponent(key)}`, { version, actions: [{ action: 'unpublish' }] });
    if (u.ok) version = u.body.version;
  }
  const r = await target.del(`/${ep}/key=${encodeURIComponent(key)}?version=${version}`);
  return r.ok ? { key, action: 'delete', status: r.status } : { key, action: 'error', status: r.status, error: errMsg(r) };
}

function summarize(order) {
  const s = { create: 0, update: 0, noop: 0, delete: 0, error: 0 };
  for (const r of order) s[r.action] = (s[r.action] || 0) + 1;
  return s;
}

// Deploy a bundle into `target`. Options:
//   deletions : [{resourceType, key}] to remove from the target (applied after upserts).
//   baseline  : { stage } → before a real apply, snapshot each touched asset's current
//               target content into __prod__ history (prod-history.mjs) and return the
//               map as results.baselines, so the deploy can later be undeployed.
export async function deployBundle(target, bundle, { dryRun = true, deletions = [], baseline = null } = {}) {
  const results = { dryRun, target: target.pk, order: [] };
  if (baseline?.stage && !dryRun) {
    results.baselines = await captureBaselines(baseline.stage, target, bundle, deletions);
  }
  const run = async (type, items, fn) => { for (const it of items || []) results.order.push({ type, ...(await fn(target, it, dryRun)) }); };
  await run('discount-group', bundle.discountGroups, upsertDiscountGroup);
  await run('category', bundle.categories, upsertCategory);
  await run('product', bundle.products, upsertProduct);
  await run('product-discount', bundle.productDiscounts, upsertProductDiscount);
  await run('cart-discount', bundle.cartDiscounts, upsertCartDiscount);
  await run('discount-code', bundle.discountCodes, upsertDiscountCode);
  // deletions apply AFTER upserts — a release may add some assets and remove others.
  for (const d of deletions || []) results.order.push({ type: d.resourceType, ...(await deleteResource(target, d, dryRun)) });
  results.summary = summarize(results.order);
  return results;
}
