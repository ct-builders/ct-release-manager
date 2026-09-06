/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * prod-history.test.mjs — pure-function tests for production-versioning helpers
 * (no CT calls; the CT-touching paths are exercised by e2e-undeploy.test.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prodLogicalId, parseLogicalId, bundleAssets } from '../lib/prod-history.mjs';
import { lastReversible } from '../lib/undeploy.mjs';
import { releaseDeletions, RESOURCE_BY_MEMBER_FIELD } from '../lib/registry.mjs';

test('prodLogicalId ↔ parseLogicalId round-trips (incl. hyphenated types)', () => {
  for (const [rt, key] of [['product', 'oil-filter'], ['cart-discount', 'spring-sale'], ['discount-code', 'SAVE-10']]) {
    assert.deepEqual(parseLogicalId(prodLogicalId(rt, key)), { resourceType: rt, key });
  }
});

const byId = (a, b) => (`${a.resourceType}~${a.key}` < `${b.resourceType}~${b.key}` ? -1 : 1);

test('bundleAssets enumerates every keyed member across all bundle fields', () => {
  const bundle = {
    discountGroups: [{ key: 'g1' }],
    categories: [{ key: 'c1' }, { key: 'c2' }],
    products: [{ key: 'p1' }],
    productDiscounts: [], cartDiscounts: [{ key: 'cd1' }], discountCodes: [{ key: 'dc1' }],
  };
  assert.deepEqual(bundleAssets(bundle).sort(byId), [
    { resourceType: 'cart-discount', key: 'cd1' },
    { resourceType: 'category', key: 'c1' },
    { resourceType: 'category', key: 'c2' },
    { resourceType: 'discount-code', key: 'dc1' },
    { resourceType: 'discount-group', key: 'g1' },
    { resourceType: 'product', key: 'p1' },
  ].sort(byId));
});

test('releaseDeletions maps the deletions set to [{resourceType,key}]', () => {
  const rel = { deletions: { products: ['p1', 'p2'], categories: ['c1'], cartDiscounts: [], discountGroups: ['g1'] } };
  assert.deepEqual(releaseDeletions(rel).sort(byId), [
    { resourceType: 'category', key: 'c1' },
    { resourceType: 'discount-group', key: 'g1' },
    { resourceType: 'product', key: 'p1' },
    { resourceType: 'product', key: 'p2' },
  ].sort(byId));
  assert.equal(RESOURCE_BY_MEMBER_FIELD.productDiscounts, 'product-discount');
});

test('lastReversible finds the newest applied deploy with baselines, skipping undeploys and dry-runs', () => {
  const rel = {
    deployments: [
      { kind: 'undeploy', apply: true, ok: true, baselines: { 'product~x': { version: 2 } } }, // skip: undeploy
      { kind: 'deploy', apply: false, ok: true, baselines: { 'product~x': { version: 1 } } }, // skip: dry-run
      { kind: 'deploy', apply: true, ok: true, baselines: { 'product~x': { version: 1 } } }, // ← this one
      { kind: 'deploy', apply: true, ok: true, baselines: {} }, // skip: empty baselines
    ],
  };
  const found = lastReversible(rel);
  assert.equal(found.baselines['product~x'].version, 1);
  assert.equal(lastReversible({ deployments: [] }), undefined);
});
