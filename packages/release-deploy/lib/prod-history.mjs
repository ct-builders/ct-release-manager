/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * prod-history.mjs — PRODUCTION baseline versioning.
 *
 * The branch/version feature (branch-ops.mjs) versions AUTHORING assets. This module
 * versions PRODUCTION: before every deploy we snapshot the current live content of
 * each asset the deploy touches, so a deploy is reversible (undeploy.mjs) and the
 * "delete case" has a place to record what was removed.
 *
 * Storage: snapshots are immutable JSON in the existing `release-asset-history`
 * CustomObject container, under a reserved branch `__prod__`, kept in the STAGE
 * (authoring) project — so PRODUCTION stays clean (no version rows leak into live).
 *   history key = <resourceType>~<key>__<__prod__>__v<n>
 *
 * A snapshot of an asset that does NOT currently exist in prod is a TOMBSTONE
 * ({ deleted: true }). That's what lets undeploy know an asset was created by a
 * deploy (baseline = "was absent" → roll back = delete).
 */
import * as reg from './registry.mjs';
import { serializeProduct, serializeCategory, serializeCartDiscount, serializeProductDiscount, serializeDiscountCode, serializeDiscountGroup } from './serialize.mjs';
import { contentHash } from './util.mjs';

export const PROD_BRANCH = '__prod__';

// resourceType → { endpoint, serialize } — the deployable asset kinds.
const ASSET = {
  product: { endpoint: 'products', serialize: serializeProduct },
  category: { endpoint: 'categories', serialize: serializeCategory },
  'cart-discount': { endpoint: 'cart-discounts', serialize: serializeCartDiscount },
  'product-discount': { endpoint: 'product-discounts', serialize: serializeProductDiscount },
  'discount-code': { endpoint: 'discount-codes', serialize: serializeDiscountCode },
  'discount-group': { endpoint: 'discount-groups', serialize: serializeDiscountGroup },
};
export const RESOURCE_TYPES = Object.keys(ASSET);
export const endpointFor = (resourceType) => ASSET[resourceType]?.endpoint;

// A CustomObject-key-safe logical id for a production asset. '~' is in the CT key
// charset ([-_~.a-zA-Z0-9]) and never appears in our keys, so splitting on the FIRST
// '~' cleanly recovers (resourceType, key) even for hyphenated types like
// "cart-discount". Distinct from the branch feature's bare-key logicalIds (which
// live under real branch ids, never `__prod__`), so the two never collide.
export const prodLogicalId = (resourceType, key) => `${resourceType}~${key}`;
export function parseLogicalId(logicalId) {
  const i = logicalId.indexOf('~');
  return { resourceType: logicalId.slice(0, i), key: logicalId.slice(i + 1) };
}

/** Serialize the CURRENT production content of one asset (canonical), or null if absent. */
export async function readProdAsset(live, resourceType, key) {
  const a = ASSET[resourceType];
  if (!a) throw new Error(`unknown resourceType "${resourceType}"`);
  const raw = await live.byKey(a.endpoint, key);
  if (!raw) return null;
  return a.serialize(live, raw);
}

/** Highest recorded __prod__ version number for an asset (0 if none yet). */
export async function latestProdVersion(stage, resourceType, key) {
  const versions = await reg.listVersions(stage, prodLogicalId(resourceType, key), PROD_BRANCH);
  return versions.length ? versions[0].version : 0; // listVersions is newest-first
}

/**
 * Snapshot the current prod content of an asset as its next __prod__ version.
 * Absent asset → a tombstone ({ deleted:true }). Returns { resourceType, key,
 * version, deleted, hash }.
 */
export async function snapshotProd(stage, live, resourceType, key) {
  const content = await readProdAsset(live, resourceType, key);
  const deleted = content == null;
  const version = (await latestProdVersion(stage, resourceType, key)) + 1;
  const value = deleted ? { deleted: true } : content;
  await reg.putVersion(stage, { logicalId: prodLogicalId(resourceType, key), branchId: PROD_BRANCH, version, content: value });
  return { resourceType, key, version, deleted, hash: deleted ? null : contentHash(content) };
}

export async function getProdVersion(stage, resourceType, key, version) {
  return reg.getVersion(stage, prodLogicalId(resourceType, key), PROD_BRANCH, version);
}
export async function listProdVersions(stage, resourceType, key) {
  return reg.listVersions(stage, prodLogicalId(resourceType, key), PROD_BRANCH);
}

// The asset kinds a bundle carries, in (type → bundle array field) order. Used to
// enumerate every asset a deploy will touch so we can baseline each one.
export const BUNDLE_FIELDS = [
  ['discount-group', 'discountGroups'],
  ['category', 'categories'],
  ['product', 'products'],
  ['product-discount', 'productDiscounts'],
  ['cart-discount', 'cartDiscounts'],
  ['discount-code', 'discountCodes'],
];

/** [{resourceType, key}] for every asset a bundle would upsert. */
export function bundleAssets(bundle) {
  const out = [];
  for (const [resourceType, field] of BUNDLE_FIELDS) {
    for (const item of bundle[field] || []) if (item?.key) out.push({ resourceType, key: item.key });
  }
  return out;
}

/**
 * Snapshot the pre-deploy prod content of every asset a deploy will touch (the
 * bundle's upserts + the explicit deletions) into __prod__ history. Returns a map
 * { <logicalId>: { version, deleted } } for the deploy audit, so undeploy knows the
 * exact version to restore per asset.
 */
export async function captureBaselines(stage, live, bundle, deletions = []) {
  const assets = [...bundleAssets(bundle), ...deletions.map((d) => ({ resourceType: d.resourceType, key: d.key }))];
  const baselines = {};
  for (const { resourceType, key } of assets) {
    const snap = await snapshotProd(stage, live, resourceType, key);
    baselines[prodLogicalId(resourceType, key)] = { version: snap.version, deleted: snap.deleted };
  }
  return baselines;
}
