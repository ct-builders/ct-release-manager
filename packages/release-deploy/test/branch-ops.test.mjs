/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * branch-ops.test.mjs — pure-function tests for the branch-ops building blocks:
 * encode↔canonicalize round-trip on a product, and three-way merge classification.
 * (The CT-touching orchestration in lib/branch-ops.mjs is exercised via the HTTP
 * endpoints against a live project, consistent with serialize/deploy.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeProduct, canonicalizeProduct, classifyMerge } from '../lib/branch.mjs';

const B = 'winter-promo';

// a canonical serialized product (clean keys, no branch bookkeeping attributes)
function canonicalProduct() {
  return {
    resourceType: 'product', key: 'oil-filter',
    productType: { typeId: 'product-type', key: 'auto-part' },
    name: { 'en-US': 'Oil Filter' },
    slug: { 'en-US': 'oil-filter', 'es-MX': 'filtro-aceite' },
    categories: [{ typeId: 'category', key: 'filters' }],
    masterVariant: { sku: 'OILF-STD', key: 'oilf-std', attributes: [{ name: 'material', value: 'paper' }], prices: [{ key: 'USD', value: { currencyCode: 'USD', centAmount: 999 } }] },
    variants: [{ sku: 'OILF-XL', key: 'oilf-xl', attributes: [], prices: [] }],
    publish: true,
  };
}

test('encode → canonicalize round-trips exactly (no attributes)', () => {
  const p = canonicalProduct();
  const round = canonicalizeProduct(encodeProduct(p, B), B);
  assert.deepEqual(round, p);
});

test('encode → canonicalize round-trips exactly (with searchable attributes)', () => {
  const p = canonicalProduct();
  const round = canonicalizeProduct(encodeProduct(p, B, { withAttributes: true }), B);
  assert.deepEqual(round, p);
});

test('encodeProduct suffixes key/slug/sku and stamps branch attributes when asked', () => {
  const enc = encodeProduct(canonicalProduct(), B, { withAttributes: true });
  assert.equal(enc.key, `oil-filter__b__${B}`);
  assert.equal(enc.slug['en-US'], `oil-filter-b-${B}`);
  assert.equal(enc.masterVariant.sku, `OILF-STD__b__${B}`);
  assert.equal(enc.masterVariant.key, `oilf-std__b__${B}`); // variant key is project-unique too
  const attrs = Object.fromEntries(enc.masterVariant.attributes.map((a) => [a.name, a.value]));
  assert.equal(attrs.branch, B);
  assert.equal(attrs.canonicalKey, 'oil-filter');
  assert.equal(attrs.canonicalSku, 'OILF-STD');
  assert.equal(attrs.material, 'paper'); // real attribute preserved
  // shared references are untouched
  assert.equal(enc.productType.key, 'auto-part');
  assert.equal(enc.categories[0].key, 'filters');
});

test('encodeProduct is a no-op for main', () => {
  const p = canonicalProduct();
  assert.equal(encodeProduct(p, 'main'), p);
});

test('classifyMerge covers the three-way matrix', () => {
  assert.equal(classifyMerge({ forkedAtHash: null, branchHeadHash: 'x', prodNowHash: null }), 'new');
  assert.equal(classifyMerge({ forkedAtHash: 'a', branchHeadHash: 'a', prodNowHash: 'a' }), 'unchanged');
  assert.equal(classifyMerge({ forkedAtHash: 'a', branchHeadHash: 'a', prodNowHash: 'b' }), 'stale');
  assert.equal(classifyMerge({ forkedAtHash: 'a', branchHeadHash: 'b', prodNowHash: 'a' }), 'fast-forward');
  assert.equal(classifyMerge({ forkedAtHash: 'a', branchHeadHash: 'c', prodNowHash: 'c' }), 'converged');
  assert.equal(classifyMerge({ forkedAtHash: 'a', branchHeadHash: 'b', prodNowHash: 'c' }), 'conflict');
});
