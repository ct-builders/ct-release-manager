/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * merge.mjs — FIELD-LEVEL three-way merge for folding a branch's working-copy edits
 * onto the canonical trunk ("merge to main") before a release deploys to production.
 *
 * classifyMerge (branch.mjs) answers the whole-asset question "did both sides change?".
 * This goes finer, per FIELD, so two releases that edited DIFFERENT fields of the same
 * product merge cleanly, and only a field BOTH sides changed to DIFFERENT values is a
 * real conflict a human must resolve.
 *
 *   base   = content at fork (the v0 snapshot / forkedFromHash)
 *   ours   = this branch's HEAD now (the release's edits)
 *   theirs = the canonical trunk now (may already carry another release's merge)
 *
 * Per-field state:
 *   unchanged   ours == base && theirs == base
 *   ours        ours != base && theirs == base           (only we changed it → take ours)
 *   theirs      ours == base && theirs != base           (only trunk changed → keep theirs)
 *   converged   both changed to the SAME value           (take either)
 *   conflict    both changed to DIFFERENT values         (needs a resolution: ours | theirs)
 *
 * All comparisons are canonical (suffix-stripped) serialized assets, so a branch HEAD
 * and the trunk are directly diffable despite their different physical keys.
 */
import { stableStringify } from './util.mjs';

const eq = (a, b) => stableStringify(a ?? null) === stableStringify(b ?? null);

const masterOf = (p) => (p && p.masterVariant) || {};
const sortedCatKeys = (p) => ((p && p.categories) || []).map((c) => c.key).filter(Boolean).sort();

// A field spec knows how to READ its value off a serialized asset (for diffing/report)
// and how to WRITE the winning side's value onto a merged asset (for apply). Keeping
// read + write separate lets `categories` diff on keys while applying full references.
const scalar = (field, label) => ({
  field, label,
  get: (a) => (a ? a[field] : undefined),
  set: (dst, src) => { if (src[field] === undefined) delete dst[field]; else dst[field] = src[field]; },
});

// Products get rich per-field granularity; other resource types fall back to a single
// "content" field (whole serialized asset minus identity) so their conflicts still
// resolve — just at whole-object granularity.
function productFieldSpecs() {
  return [
    scalar('name', 'Name'),
    scalar('slug', 'Slug'),
    scalar('description', 'Description'),
    scalar('metaTitle', 'Meta title'),
    scalar('metaDescription', 'Meta description'),
    scalar('metaKeywords', 'Meta keywords'),
    { field: 'categories', label: 'Categories', get: sortedCatKeys, set: (dst, src) => { dst.categories = structuredClone(src.categories || []); } },
    { field: 'prices', label: 'Prices', get: (p) => masterOf(p).prices || [], set: (dst, src) => { dst.masterVariant = { ...masterOf(dst), prices: structuredClone(masterOf(src).prices || []) }; } },
    { field: 'attributes', label: 'Attributes', get: (p) => masterOf(p).attributes || [], set: (dst, src) => { dst.masterVariant = { ...masterOf(dst), attributes: structuredClone(masterOf(src).attributes || []) }; } },
    { field: 'images', label: 'Images', get: (p) => masterOf(p).images || [], set: (dst, src) => { dst.masterVariant = { ...masterOf(dst), images: structuredClone(masterOf(src).images || []) }; } },
  ];
}
const withoutIdentity = (a) => { const { key, ...rest } = a || {}; return rest; };
function genericFieldSpecs() {
  return [{
    field: 'content', label: 'Content',
    get: withoutIdentity,
    set: (dst, src) => { const k = dst.key; for (const x of Object.keys(dst)) if (x !== 'key') delete dst[x]; Object.assign(dst, withoutIdentity(src)); dst.key = k; },
  }];
}
export function fieldSpecsFor(resourceType) {
  return resourceType === 'product' ? productFieldSpecs() : genericFieldSpecs();
}

/** Classify one field's three values into a merge state. */
export function classifyField(base, ours, theirs) {
  const ourChanged = !eq(ours, base);
  const theirChanged = !eq(theirs, base);
  if (!ourChanged && !theirChanged) return 'unchanged';
  if (ourChanged && !theirChanged) return 'ours';
  if (!ourChanged && theirChanged) return 'theirs';
  return eq(ours, theirs) ? 'converged' : 'conflict';
}

/**
 * Per-field merge report for one asset. base/ours/theirs are canonical serialized
 * assets (or null if absent). When `theirs` is null the asset is brand-new on the
 * branch → a clean whole-asset add (every changed field is "ours").
 */
export function mergeAssetReport({ canonicalKey, resourceType = 'product', base, ours, theirs }) {
  const isAdd = theirs == null;
  const specs = fieldSpecsFor(resourceType);
  const fields = [];
  for (const s of specs) {
    const b = base ? s.get(base) : undefined;
    const o = ours ? s.get(ours) : undefined;
    const t = theirs ? s.get(theirs) : undefined;
    const state = isAdd ? (eq(o, b) ? 'unchanged' : 'ours') : classifyField(b, o, t);
    if (state === 'unchanged') continue;
    fields.push({ field: s.field, label: s.label, state, base: b, ours: o, theirs: t });
  }
  const conflicts = fields.filter((f) => f.state === 'conflict');
  return { canonicalKey, resourceType, isAdd, fields, conflicts, hasChanges: fields.length > 0 };
}

/**
 * Produce the merged asset to write to the trunk. Start from `theirs` (the current
 * trunk) so trunk-only changes and any untracked fields are preserved, then overlay
 * every field whose winner is "ours". Conflicts are decided by `resolutions`
 * ({ [field]: 'ours' | 'theirs' }); a conflict without a resolution keeps theirs.
 */
/**
 * commercetools update actions that fold ONLY the ours-winning fields of a product
 * merge onto the existing trunk product. Unlike a full re-upsert this never re-diffs
 * untouched fields — so a name-only merge emits exactly one `changeName`, and a product
 * whose price carries no key (a common authoring shape) doesn't trip a duplicate-price
 * re-add. Use this for a product UPDATE; a brand-new product still goes through a full
 * create. resolutions decides conflicting fields ({ [field]: 'ours' | 'theirs' }).
 */
export function productUpdateActions({ report, ours, theirs, resolutions = {} }) {
  const winnerOf = (f) => (f.state === 'conflict' ? (resolutions[f.field] === 'ours' ? 'ours' : 'theirs') : f.state);
  const M = (p) => (p && p.masterVariant) || {};
  const actions = [];
  for (const f of report.fields) {
    if (winnerOf(f) !== 'ours') continue; // theirs / converged is already on the trunk
    switch (f.field) {
      case 'name': actions.push({ action: 'changeName', name: ours.name, staged: false }); break;
      case 'slug': actions.push({ action: 'changeSlug', slug: ours.slug, staged: false }); break;
      case 'description': actions.push({ action: 'setDescription', description: ours.description ?? null, staged: false }); break;
      case 'metaTitle': actions.push({ action: 'setMetaTitle', metaTitle: ours.metaTitle ?? null, staged: false }); break;
      case 'metaDescription': actions.push({ action: 'setMetaDescription', metaDescription: ours.metaDescription ?? null, staged: false }); break;
      case 'metaKeywords': actions.push({ action: 'setMetaKeywords', metaKeywords: ours.metaKeywords ?? null, staged: false }); break;
      case 'categories': {
        const want = new Set((ours.categories || []).map((c) => c.key).filter(Boolean));
        const have = new Set((theirs?.categories || []).map((c) => c.key).filter(Boolean));
        for (const k of want) if (!have.has(k)) actions.push({ action: 'addToCategory', category: { typeId: 'category', key: k }, staged: false });
        for (const k of have) if (!want.has(k)) actions.push({ action: 'removeFromCategory', category: { typeId: 'category', key: k }, staged: false });
        break;
      }
      case 'attributes': {
        const sku = M(ours).sku || M(theirs).sku;
        const have = Object.fromEntries((M(theirs).attributes || []).map((a) => [a.name, a.value]));
        for (const at of M(ours).attributes || []) if (stableStringify(at.value) !== stableStringify(have[at.name])) actions.push({ action: 'setAttribute', sku, name: at.name, value: at.value, staged: false });
        break;
      }
      case 'prices': {
        // only keyed prices can be matched across the two copies; keyless authoring prices
        // are left to the deploy path. Add any keyed price the branch introduced.
        const sku = M(ours).sku || M(theirs).sku;
        const have = new Set((M(theirs).prices || []).map((p) => p.key).filter(Boolean));
        for (const wp of M(ours).prices || []) if (wp.key && !have.has(wp.key)) actions.push({ action: 'addPrice', sku, price: { key: wp.key, value: wp.value, country: wp.country, validFrom: wp.validFrom, validUntil: wp.validUntil }, staged: false });
        break;
      }
      // images: rare in a merge; left to the deploy path.
    }
  }
  return actions;
}

export function applyMerge({ resourceType = 'product', ours, theirs, report, resolutions = {} }) {
  if (report.isAdd) return structuredClone(ours); // whole-asset add
  const specs = Object.fromEntries(fieldSpecsFor(resourceType).map((s) => [s.field, s]));
  const merged = structuredClone(theirs);
  for (const f of report.fields) {
    let winner = f.state;
    if (f.state === 'conflict') winner = resolutions[f.field] === 'ours' ? 'ours' : 'theirs';
    if (winner === 'ours') specs[f.field]?.set(merged, ours);
    // 'theirs' / 'converged' → already present in `merged` (a clone of theirs).
  }
  return merged;
}
