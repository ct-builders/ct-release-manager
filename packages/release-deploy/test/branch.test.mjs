/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * branch.test.mjs — unit tests for the compound-key encoding + canonicalization that
 * keeps production clean. Run: `node --test` from packages/release-deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMain, encodeKey, encodeSku, encodeCode, encodeSlug, encodeLocalized,
  canonicalKey, canonicalSku, canonicalCode, canonicalSlug,
  canonicalizeBundle, assertClean, KEY_DELIM, SLUG_DELIM,
} from '../lib/branch.mjs';

const B = 'winter-promo';

test('main is never suffixed (identity transform)', () => {
  for (const id of ['main', undefined, '', null]) {
    assert.equal(isMain(id), true);
    assert.equal(encodeKey('oil-filter', id), 'oil-filter');
    assert.equal(encodeSlug('oil-filter', id), 'oil-filter');
  }
});

test('encode/canonical round-trips for key, sku, code, slug', () => {
  assert.equal(encodeKey('oil-filter', B), `oil-filter${KEY_DELIM}${B}`);
  assert.equal(encodeSku('OILF-STD', B), `OILF-STD${KEY_DELIM}${B}`);
  assert.equal(encodeCode('SAVE10', B), `SAVE10${KEY_DELIM}${B}`);
  assert.equal(encodeSlug('oil-filter', B), `oil-filter${SLUG_DELIM}${B}`);
  for (const [enc, can] of [[encodeKey, canonicalKey], [encodeSku, canonicalSku], [encodeCode, canonicalCode], [encodeSlug, canonicalSlug]]) {
    assert.equal(can(enc('air-filters', B), B), 'air-filters');
  }
});

test('canonical is idempotent and safe on already-clean / foreign values', () => {
  assert.equal(canonicalKey('oil-filter', B), 'oil-filter');       // clean → unchanged
  assert.equal(canonicalKey('oil-filter__b__other', B), 'oil-filter__b__other'); // different branch → untouched
  assert.equal(canonicalSlug('a-b-c', B), 'a-b-c');                // "-b-" substring, not the suffix → untouched
});

test('encodeLocalized suffixes every locale', () => {
  const slug = { 'en-US': 'oil-filter', 'es-MX': 'filtro-aceite' };
  assert.deepEqual(encodeLocalized(slug, B), { 'en-US': `oil-filter${SLUG_DELIM}${B}`, 'es-MX': `filtro-aceite${SLUG_DELIM}${B}` });
});

// a representative branch-suffixed bundle (products + category + all discount types)
function branchBundle() {
  return {
    bundleKey: 'r1', sourceProject: 'your-stage-project',
    discountGroups: [{ resourceType: 'discount-group', key: `promos${KEY_DELIM}${B}`, name: { 'en-US': 'Promos' } }],
    categories: [{
      resourceType: 'category', key: `air-filters${KEY_DELIM}${B}`,
      slug: { 'en-US': `air-filters${SLUG_DELIM}${B}` },
      parent: { typeId: 'category', key: `filters${KEY_DELIM}${B}` },
    }],
    products: [{
      resourceType: 'product', key: `oil-filter${KEY_DELIM}${B}`,
      productType: { typeId: 'product-type', key: 'auto-part' }, // shared → untouched
      slug: { 'en-US': `oil-filter${SLUG_DELIM}${B}`, 'es-MX': `filtro${SLUG_DELIM}${B}` },
      categories: [{ typeId: 'category', key: `air-filters${KEY_DELIM}${B}` }],
      masterVariant: {
        sku: `OILF-STD${KEY_DELIM}${B}`,
        prices: [{ key: `USD${KEY_DELIM}${B}`, value: { currencyCode: 'USD', centAmount: 999 } }],
        attributes: [{ name: 'branch', value: B }, { name: 'canonicalSku', value: 'OILF-STD' }, { name: 'material', value: 'paper' }],
      },
      variants: [{ sku: `OILF-XL${KEY_DELIM}${B}`, prices: [], attributes: [{ name: 'isHead', value: true }] }],
      publish: true,
    }],
    productDiscounts: [{ resourceType: 'product-discount', key: `pd1${KEY_DELIM}${B}`, referenceMap: { 'uuid-1': { typeId: 'product', key: `oil-filter${KEY_DELIM}${B}` } } }],
    cartDiscounts: [{ resourceType: 'cart-discount', key: `cd1${KEY_DELIM}${B}`, discountGroup: { typeId: 'discount-group', key: `promos${KEY_DELIM}${B}` }, referenceMap: { 'uuid-2': { typeId: 'category', key: `air-filters${KEY_DELIM}${B}` }, 'uuid-3': { typeId: 'channel', key: 'web' } } }],
    discountCodes: [{ resourceType: 'discount-code', key: `dc1${KEY_DELIM}${B}`, code: `SAVE10${KEY_DELIM}${B}`, cartDiscounts: [{ typeId: 'cart-discount', key: `cd1${KEY_DELIM}${B}` }], referenceMap: {} }],
  };
}

test('canonicalizeBundle strips every identity field and branch attributes', () => {
  const clean = canonicalizeBundle(branchBundle(), B);

  assert.equal(clean.discountGroups[0].key, 'promos');
  const cat = clean.categories[0];
  assert.equal(cat.key, 'air-filters');
  assert.equal(cat.slug['en-US'], 'air-filters');
  assert.equal(cat.parent.key, 'filters');

  const p = clean.products[0];
  assert.equal(p.key, 'oil-filter');
  assert.deepEqual(p.slug, { 'en-US': 'oil-filter', 'es-MX': 'filtro' });
  assert.equal(p.productType.key, 'auto-part'); // shared type untouched
  assert.equal(p.categories[0].key, 'air-filters');
  assert.equal(p.masterVariant.sku, 'OILF-STD');
  assert.equal(p.masterVariant.prices[0].key, 'USD');
  // branch bookkeeping attributes gone; real attribute kept
  assert.deepEqual(p.masterVariant.attributes, [{ name: 'material', value: 'paper' }]);
  assert.equal(p.variants[0].sku, 'OILF-XL');
  assert.deepEqual(p.variants[0].attributes, []);

  assert.equal(clean.productDiscounts[0].key, 'pd1');
  assert.equal(clean.productDiscounts[0].referenceMap['uuid-1'].key, 'oil-filter');
  assert.equal(clean.cartDiscounts[0].key, 'cd1');
  assert.equal(clean.cartDiscounts[0].discountGroup.key, 'promos');
  assert.equal(clean.cartDiscounts[0].referenceMap['uuid-2'].key, 'air-filters'); // branched ref
  assert.equal(clean.cartDiscounts[0].referenceMap['uuid-3'].key, 'web');          // shared ref untouched
  assert.equal(clean.discountCodes[0].key, 'dc1');
  assert.equal(clean.discountCodes[0].code, 'SAVE10');
  assert.equal(clean.discountCodes[0].cartDiscounts[0].key, 'cd1');
});

test('canonicalizeBundle does not mutate the input', () => {
  const original = branchBundle();
  const snapshot = JSON.stringify(original);
  canonicalizeBundle(original, B);
  assert.equal(JSON.stringify(original), snapshot);
});

test('assertClean passes on a canonicalized bundle', () => {
  assert.equal(assertClean(canonicalizeBundle(branchBundle(), B), B), true);
});

test('assertClean throws when a branch suffix leaks through', () => {
  assert.throws(() => assertClean(branchBundle(), B), /branch sentinel/);
});

test('canonicalizeBundle is a no-op for main', () => {
  const b = { products: [{ key: 'oil-filter', slug: { 'en-US': 'oil-filter' }, masterVariant: { sku: 'OILF' }, variants: [] }] };
  assert.equal(canonicalizeBundle(b, 'main'), b); // same reference
});
