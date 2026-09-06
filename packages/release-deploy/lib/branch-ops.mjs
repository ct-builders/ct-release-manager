/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * branch-ops.mjs — branch service operations (authoring project only).
 *
 * The HEAD of each (asset × branch) is a live resource in the authoring project with
 * a compound key (<canonical>__b__<branchId>). Prior versions live as immutable
 * canonicalized-JSON snapshots in the release-asset-history CustomObject container, so the
 * authoring DB stays bounded and production never sees branch/version data.
 *
 *   fork      copy a canonical asset onto a branch (copy-on-first-edit) + v0 snapshot
 *   save      snapshot the current HEAD as the next version
 *   restore   overwrite the HEAD with a past snapshot, then snapshot the result
 *   merge     three-way classification (base/branch/prod) for a deploy pre-check
 *   close     tear down a branch's HEADs + history (authoring GC)
 *
 * Generic over resourceType: product | category | cart-discount | product-discount |
 * discount-code. The resourceType is stored on each branch asset entry so save/
 * restore/merge/close can act on the right endpoint without being told again.
 */
import { serializeProduct, serializeCategory, serializeCartDiscount, serializeProductDiscount, serializeDiscountCode } from './serialize.mjs';
import { deployBundle } from './deploy.mjs';
import { encodeAsset, canonicalizeAsset, BUNDLE_KEY, encodeKey, isMain, classifyMerge } from './branch.mjs';
import { contentHash } from './util.mjs';
import { mergeAssetReport, applyMerge, productUpdateActions } from './merge.mjs';
import * as reg from './registry.mjs';

const RES = {
  product: { endpoint: 'products', serialize: serializeProduct },
  category: { endpoint: 'categories', serialize: serializeCategory },
  'cart-discount': { endpoint: 'cart-discounts', serialize: serializeCartDiscount },
  'product-discount': { endpoint: 'product-discounts', serialize: serializeProductDiscount },
  'discount-code': { endpoint: 'discount-codes', serialize: serializeDiscountCode },
};
const resOf = (resourceType) => {
  const r = RES[resourceType];
  if (!r) throw new Error(`unsupported resourceType "${resourceType}"`);
  return r;
};

const emptyBundle = () => ({ discountGroups: [], categories: [], products: [], productDiscounts: [], cartDiscounts: [], discountCodes: [] });
const oneBundle = (resourceType, asset) => ({ ...emptyBundle(), [BUNDLE_KEY[resourceType]]: [asset] });
const physicalKey = (canonicalKey, branchId) => (isMain(branchId) ? canonicalKey : encodeKey(canonicalKey, branchId));

// read a resource by (physical) key → its canonical serialized content + content hash.
async function readCanonical(client, resourceType, physKey, branchId) {
  const res = resOf(resourceType);
  const obj = await client.byKey(res.endpoint, physKey);
  if (!obj) return null;
  const serialized = await res.serialize(client, obj);
  const canonical = canonicalizeAsset(serialized, branchId, resourceType);
  return { obj, canonical, hash: contentHash(canonical) };
}

const firstError = (deployRes) => (deployRes.order || []).find((r) => r.action === 'error');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Apply update actions to an existing trunk resource (version-pinned, publish, 409-retry).
// Mirrors the console's own edit path; used to fold ONLY a merge's changed fields onto
// the trunk without re-diffing untouched ones.
async function applyActionsToTrunk(client, endpoint, key, actions) {
  for (let attempt = 0; ; attempt++) {
    const cur = await client.byKey(endpoint, key);
    if (!cur) return { error: `trunk "${key}" not found in ${client.pk}` };
    const body = { version: cur.version, actions: endpoint === 'products' ? [...actions, { action: 'publish' }] : actions };
    const r = await client.post(`/${endpoint}/key=${encodeURIComponent(key)}`, body);
    if (r.ok) return { ok: true, actions: actions.map((x) => x.action) };
    if (r.status === 409 && attempt < 3) { await sleep(300); continue; }
    return { error: r.body?.message || JSON.stringify(r.body).slice(0, 300) };
  }
}

/**
 * Fork a canonical asset onto a branch (copy-on-first-edit). Reads the base branch's
 * current content, creates a branch HEAD with a compound identity, records the fork
 * hash + resourceType, and writes the v0 baseline snapshot. Idempotent.
 */
export async function forkAsset(stage, { branchId, canonicalKey, resourceType = 'product', withAttributes = false, dryRun = false }) {
  if (isMain(branchId)) throw new Error('cannot fork onto main (main IS the canonical trunk)');
  const res = resOf(resourceType);
  const branch = await reg.getBranch(stage, branchId);
  if (!branch) throw new Error(`branch "${branchId}" not found`);
  const baseBranch = branch.baseBranch || 'main';

  const headKey = physicalKey(canonicalKey, branchId);
  if (await stage.byKey(res.endpoint, headKey)) {
    // HEAD already exists — but RECONCILE the registry first. A prior fork's registry
    // write can be lost to a concurrent branch update, leaving this HEAD live yet
    // unregistered; then deploy/merge/close (which iterate branch.assets) silently skip
    // it. Re-record the entry when it's missing/mismatched (idempotent; setBranchAssetHead
    // is CAS-guarded). The common case — already correctly registered — writes nothing.
    const entry = branch.assets?.[canonicalKey];
    const registered = entry && entry.headKey === headKey;
    if (!registered) {
      const versions = await reg.listVersions(stage, canonicalKey, branchId);
      const version = entry?.version ?? versions[0]?.version ?? 0;
      await reg.setBranchAssetHead(stage, branchId, canonicalKey, { headKey, version, resourceType });
    }
    return { canonicalKey, headKey, resourceType, action: 'exists', reconciled: !registered };
  }

  const base = await readCanonical(stage, resourceType, physicalKey(canonicalKey, baseBranch), baseBranch);
  if (!base) throw new Error(`base ${resourceType} "${canonicalKey}" not found on branch "${baseBranch}"`);

  const encoded = encodeAsset(base.canonical, branchId, resourceType, { withAttributes });
  if (dryRun) return { canonicalKey, headKey, resourceType, action: 'create', forkedAtHash: base.hash };

  const deployRes = await deployBundle(stage, oneBundle(resourceType, encoded), { dryRun: false });
  const err = firstError(deployRes);
  if (err) throw new Error(`fork create failed for ${headKey}: ${err.error}`);

  await reg.putVersion(stage, { logicalId: canonicalKey, branchId, version: 0, content: base.canonical });
  await reg.setBranchAssetHead(stage, branchId, canonicalKey, { headKey, version: 0, forkedFromHash: base.hash, resourceType });
  return { canonicalKey, headKey, resourceType, action: 'create', forkedAtHash: base.hash, version: 0 };
}

/** Snapshot the current branch HEAD as the next version. */
export async function saveVersion(stage, { branchId, canonicalKey }) {
  const branch = await reg.getBranch(stage, branchId);
  if (!branch) throw new Error(`branch "${branchId}" not found`);
  const entry = branch.assets?.[canonicalKey];
  if (!entry) throw new Error(`"${canonicalKey}" is not forked on branch "${branchId}" (fork it first)`);
  const resourceType = entry.resourceType || 'product';

  const head = await readCanonical(stage, resourceType, entry.headKey, branchId);
  if (!head) throw new Error(`HEAD "${entry.headKey}" not found`);
  const version = (entry.version || 0) + 1;
  await reg.putVersion(stage, { logicalId: canonicalKey, branchId, version, content: head.canonical });
  await reg.setBranchAssetHead(stage, branchId, canonicalKey, { version });
  return { canonicalKey, branchId, version, hash: head.hash };
}

/** Overwrite the branch HEAD with a past snapshot, then snapshot the restored state. */
export async function restoreVersion(stage, { branchId, canonicalKey, version, withAttributes = false }) {
  const branch = await reg.getBranch(stage, branchId);
  const entry = branch?.assets?.[canonicalKey];
  const resourceType = entry?.resourceType || 'product';
  const snap = await reg.getVersion(stage, canonicalKey, branchId, version);
  if (!snap) throw new Error(`version v${version} of "${canonicalKey}" on "${branchId}" not found`);
  const encoded = encodeAsset(snap.content, branchId, resourceType, { withAttributes });
  const deployRes = await deployBundle(stage, oneBundle(resourceType, encoded), { dryRun: false });
  const err = firstError(deployRes);
  if (err) throw new Error(`restore failed for ${canonicalKey}: ${err.error}`);
  const saved = await saveVersion(stage, { branchId, canonicalKey });
  return { canonicalKey, restoredFrom: version, newVersion: saved.version };
}

/**
 * Three-way merge report for deploying a branch's assets to production. For each
 * asset: base = content at fork, branch = HEAD now, prod = production now.
 */
export async function mergeReport(stage, live, { branchId, canonicalKeys }) {
  const branch = await reg.getBranch(stage, branchId);
  if (!branch) throw new Error(`branch "${branchId}" not found`);
  const assets = [];
  for (const canonicalKey of canonicalKeys || Object.keys(branch.assets || {})) {
    const entry = branch.assets?.[canonicalKey] || {};
    const resourceType = entry.resourceType || 'product';
    const headKey = entry.headKey || physicalKey(canonicalKey, branchId);
    const branchHead = await readCanonical(stage, resourceType, headKey, branchId);
    const prodNow = await readCanonical(live, resourceType, canonicalKey, 'main');
    const state = classifyMerge({ forkedAtHash: entry.forkedFromHash ?? null, branchHeadHash: branchHead?.hash ?? null, prodNowHash: prodNow?.hash ?? null });
    assets.push({ canonicalKey, resourceType, state, forkedAtHash: entry.forkedFromHash ?? null, branchHeadHash: branchHead?.hash ?? null, prodNowHash: prodNow?.hash ?? null });
  }
  return { branchId, assets, conflicts: assets.filter((a) => a.state === 'conflict') };
}

/**
 * MERGE TO MAIN — fold a branch's working-copy edits onto the canonical trunk (stage),
 * with FIELD-LEVEL three-way conflict detection + resolution. This is the step that
 * makes a release's edits real: edits live on suffixed HEADs, but deploy serializes
 * canonical member keys from the trunk — so without this, a release's edits never reach
 * production. After a clean/resolved merge, the trunk carries the edits and the existing
 * deploy path ships them.
 *
 * For each forked asset: base = v0 snapshot (fork baseline), ours = HEAD now, theirs =
 * canonical trunk now (may already carry another release's merge). Fields both sides
 * changed differently are conflicts; `resolutions["<canonicalKey>:<field>"]` = 'ours' |
 * 'theirs' decides each. Returns without writing when `apply` is false or any conflict
 * is unresolved (needsResolution); otherwise upserts the merged content onto the trunk.
 */
export async function mergeToMain(stage, { branchId, canonicalKeys, resolutions = {}, apply = false } = {}) {
  const branch = await reg.getBranch(stage, branchId);
  if (!branch) throw new Error(`branch "${branchId}" not found`);
  const keys = canonicalKeys && canonicalKeys.length ? canonicalKeys : Object.keys(branch.assets || {});

  const work = [];
  for (const canonicalKey of keys) {
    const entry = branch.assets?.[canonicalKey];
    if (!entry) continue; // not forked on this branch → trunk already canonical, nothing to merge
    const resourceType = entry.resourceType || 'product';
    const headKey = entry.headKey || physicalKey(canonicalKey, branchId);
    const ours = await readCanonical(stage, resourceType, headKey, branchId);
    if (!ours) { work.push({ canonicalKey, resourceType, error: 'head-missing' }); continue; }
    const theirs = await readCanonical(stage, resourceType, canonicalKey, 'main');
    const baseSnap = entry.forkedFromHash != null ? await reg.getVersion(stage, canonicalKey, branchId, 0) : null;
    const report = mergeAssetReport({ canonicalKey, resourceType, base: baseSnap?.content ?? null, ours: ours.canonical, theirs: theirs?.canonical ?? null });
    // "already merged" = this exact HEAD content was folded onto the trunk before
    // (recorded as mergedFromHead). This is robust to a resolve-to-"theirs", where the
    // HEAD still differs from the trunk yet the merge is genuinely done — so the report
    // doesn't keep re-flagging a resolved conflict. Re-editing the HEAD clears it.
    const alreadyMerged = !!entry.merged && entry.mergedFromHead != null && entry.mergedFromHead === ours.hash;
    const conflicts = alreadyMerged ? [] : report.conflicts;
    const state = alreadyMerged ? 'merged' : !report.hasChanges ? 'unchanged' : conflicts.length ? 'conflict' : report.isAdd ? 'add' : 'mergeable';
    work.push({ canonicalKey, resourceType, state, isAdd: report.isAdd, alreadyMerged, fields: report.fields, conflicts, _r: report, _ours: ours.canonical, _oursHash: ours.hash, _theirs: theirs?.canonical ?? null });
  }

  // a conflict field is "unresolved" until a resolution names ours/theirs for it.
  const resOf = (canonicalKey, field) => resolutions[`${canonicalKey}:${field}`];
  const unresolved = [];
  const conflicts = [];
  for (const a of work) {
    for (const c of a.conflicts || []) {
      const entry = { canonicalKey: a.canonicalKey, resourceType: a.resourceType, field: c.field, label: c.label, base: c.base, ours: c.ours, theirs: c.theirs };
      conflicts.push(entry);
      const r = resOf(a.canonicalKey, c.field);
      if (r !== 'ours' && r !== 'theirs') unresolved.push(entry);
    }
  }
  const publicAssets = work.map(({ _r, _ours, _oursHash, _theirs, ...pub }) => pub);

  if (!apply || unresolved.length) {
    return { branchId, applied: false, needsResolution: unresolved.length > 0, assets: publicAssets, conflicts, unresolved };
  }

  // apply: fold each changed asset's resolution onto the trunk (main, canonical).
  const merged = [];
  for (const a of work) {
    if (a.error) { merged.push({ canonicalKey: a.canonicalKey, action: 'error', error: a.error }); continue; }
    if (a.alreadyMerged) { merged.push({ canonicalKey: a.canonicalKey, action: 'already-merged' }); continue; }
    if (!a._r.hasChanges) { merged.push({ canonicalKey: a.canonicalKey, action: 'noop' }); continue; }
    const perField = {};
    for (const c of a.conflicts || []) perField[c.field] = resOf(a.canonicalKey, c.field);

    let outcome;
    if (a.resourceType === 'product' && !a._r.isAdd) {
      // surgical update: only the ours-winning fields, applied to the existing trunk.
      const actions = productUpdateActions({ report: a._r, ours: a._ours, theirs: a._theirs, resolutions: perField });
      outcome = actions.length ? await applyActionsToTrunk(stage, 'products', a.canonicalKey, actions) : { ok: true, actions: [] };
    } else {
      // brand-new asset, or a non-product: upsert the whole resolved asset (create-safe).
      const resolved = applyMerge({ resourceType: a.resourceType, ours: a._ours, theirs: a._theirs, report: a._r, resolutions: perField });
      const dep = await deployBundle(stage, oneBundle(a.resourceType, resolved), { dryRun: false });
      const err = firstError(dep);
      outcome = err ? { error: err.error } : { ok: true, actions: dep.order.flatMap((o) => o.actions || []) };
    }
    if (outcome.error) { merged.push({ canonicalKey: a.canonicalKey, action: 'error', error: outcome.error }); continue; }
    await reg.setBranchAssetHead(stage, branchId, a.canonicalKey, { merged: true, mergedAt: new Date().toISOString(), mergedFromHead: a._oursHash, mergedHash: a._oursHash });
    merged.push({ canonicalKey: a.canonicalKey, action: a.isAdd ? 'added' : 'merged', actions: outcome.actions });
  }
  return { branchId, applied: true, assets: publicAssets, conflicts, unresolved: [], merged };
}

/** Tear down a branch's HEAD resources + history snapshots (authoring GC). */
export async function closeBranch(stage, { branchId, status = 'abandoned', apply = false }) {
  const branch = await reg.getBranch(stage, branchId);
  if (!branch) throw new Error(`branch "${branchId}" not found`);
  const removed = [];
  for (const [canonicalKey, entry] of Object.entries(branch.assets || {})) {
    const resourceType = entry.resourceType || 'product';
    const res = resOf(resourceType);
    const headKey = entry.headKey || physicalKey(canonicalKey, branchId);
    if (!apply) { removed.push({ canonicalKey, resourceType, headKey, action: 'would-delete' }); continue; }
    let deleted = false;
    const obj = await stage.byKey(res.endpoint, headKey);
    if (obj) {
      if (res.endpoint === 'products' && obj.masterData?.published) {
        await stage.post(`/products/key=${encodeURIComponent(headKey)}`, { version: obj.version, actions: [{ action: 'unpublish' }] });
      }
      const fresh = await stage.byKey(res.endpoint, headKey);
      const r = await stage.del(`/${res.endpoint}/key=${encodeURIComponent(headKey)}?version=${fresh?.version ?? obj.version}`);
      deleted = r.ok;
    }
    const versionsDeleted = await reg.deleteVersions(stage, canonicalKey, branchId);
    await reg.removeBranchAsset(stage, branchId, canonicalKey);
    removed.push({ canonicalKey, resourceType, headKey, deleted, versionsDeleted });
  }
  const updated = apply ? await reg.setBranchStatus(stage, branchId, status) : branch;
  return { branchId, status: updated.status, removed, applied: apply };
}
