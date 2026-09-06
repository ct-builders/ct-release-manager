/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * merge.test.mjs — pure-function tests for the FIELD-LEVEL three-way merge used by
 * "merge to main". (The CT-touching mergeToMain orchestration is exercised end-to-end
 * by the release-manager Playwright suite, consistent with the other live ops.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyField, mergeAssetReport, applyMerge, productUpdateActions } from '../lib/merge.mjs';

const L = (v) => ({ 'en-US': v }); // localized helper

// a canonical serialized product
function prod(overrides = {}) {
  return {
    resourceType: 'product', key: 'oil-filter',
    productType: { typeId: 'product-type', key: 'auto-part' },
    name: L('Oil Filter'), slug: L('oil-filter'), description: L('Filters oil'),
    categories: [{ typeId: 'category', key: 'filters' }],
    masterVariant: { sku: 'OILF', key: 'oilf', attributes: [{ name: 'material', value: 'paper' }], prices: [{ key: 'USD', value: { currencyCode: 'USD', centAmount: 999 } }] },
    variants: [], publish: true, ...overrides,
  };
}

test('classifyField covers the per-field three-way matrix', () => {
  assert.equal(classifyField('a', 'a', 'a'), 'unchanged');
  assert.equal(classifyField('a', 'b', 'a'), 'ours'); // only we changed
  assert.equal(classifyField('a', 'a', 'b'), 'theirs'); // only trunk changed
  assert.equal(classifyField('a', 'b', 'b'), 'converged'); // both → same
  assert.equal(classifyField('a', 'b', 'c'), 'conflict'); // both → different
  // deep equality via stableStringify (key order independent)
  assert.equal(classifyField(L('x'), { 'en-US': 'x' }, L('x')), 'unchanged');
});

test('two releases editing DIFFERENT fields merge cleanly (no conflict)', () => {
  const base = prod();
  const ours = prod({ name: L('Premium Oil Filter') }); // we changed name
  const theirs = prod({ description: L('Now with more filtering') }); // trunk changed description
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base, ours, theirs });
  assert.equal(report.conflicts.length, 0);
  const states = Object.fromEntries(report.fields.map((f) => [f.field, f.state]));
  assert.equal(states.name, 'ours');
  assert.equal(states.description, 'theirs');
  const merged = applyMerge({ ours, theirs, report });
  assert.deepEqual(merged.name, L('Premium Oil Filter')); // our name applied
  assert.deepEqual(merged.description, L('Now with more filtering')); // trunk description kept
});

test('two releases renaming the SAME field → conflict, resolvable both ways', () => {
  const base = prod();
  const ours = prod({ name: L('Release B Name') });
  const theirs = prod({ name: L('Release A Name') }); // trunk already carries release A's merge
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base, ours, theirs });
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].field, 'name');
  assert.deepEqual(report.conflicts[0].ours, L('Release B Name'));
  assert.deepEqual(report.conflicts[0].theirs, L('Release A Name'));

  // resolve → ours
  const mine = applyMerge({ ours, theirs, report, resolutions: { name: 'ours' } });
  assert.deepEqual(mine.name, L('Release B Name'));
  // resolve → theirs
  const trunk = applyMerge({ ours, theirs, report, resolutions: { name: 'theirs' } });
  assert.deepEqual(trunk.name, L('Release A Name'));
});

test('unchanged asset reports no changes', () => {
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base: prod(), ours: prod(), theirs: prod() });
  assert.equal(report.hasChanges, false);
  assert.equal(report.fields.length, 0);
});

test('brand-new asset (no trunk) is a clean add of the whole product', () => {
  const ours = prod({ name: L('Brand New') });
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base: null, ours, theirs: null });
  assert.equal(report.isAdd, true);
  assert.equal(report.conflicts.length, 0);
  const merged = applyMerge({ ours, theirs: null, report });
  assert.deepEqual(merged, ours);
});

test('conflict left unresolved keeps theirs (safe default)', () => {
  const base = prod();
  const ours = prod({ name: L('Ours') });
  const theirs = prod({ name: L('Theirs') });
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base, ours, theirs });
  const merged = applyMerge({ ours, theirs, report, resolutions: {} }); // no resolution supplied
  assert.deepEqual(merged.name, L('Theirs'));
});

test('productUpdateActions: name-only merge emits ONE changeName and never re-adds prices', () => {
  // regression: the trunk product carries a KEYLESS price (a common authoring shape).
  // A full re-upsert would try to addPrice it (duplicate scope); targeted actions must not.
  const base = prod(), ours = prod({ name: L('Renamed') }), theirs = prod();
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base, ours, theirs });
  const actions = productUpdateActions({ report, ours, theirs });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'changeName');
  assert.deepEqual(actions[0].name, L('Renamed'));
  assert.equal(actions.some((a) => a.action === 'addPrice'), false);
});

test('productUpdateActions: a resolved conflict writes ours, keeping-main writes nothing', () => {
  const base = prod(), ours = prod({ name: L('B') }), theirs = prod({ name: L('A') });
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base, ours, theirs });
  assert.equal(productUpdateActions({ report, ours, theirs, resolutions: { name: 'theirs' } }).length, 0);
  const mine = productUpdateActions({ report, ours, theirs, resolutions: { name: 'ours' } });
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].name, L('B'));
});

test('price + attribute edits are independent mergeable fields', () => {
  const base = prod();
  const ours = prod({ masterVariant: { ...base.masterVariant, prices: [{ key: 'USD', value: { currencyCode: 'USD', centAmount: 1299 } }] } });
  const theirs = prod({ masterVariant: { ...base.masterVariant, attributes: [{ name: 'material', value: 'synthetic' }] } });
  const report = mergeAssetReport({ canonicalKey: 'oil-filter', base, ours, theirs });
  assert.equal(report.conflicts.length, 0);
  const merged = applyMerge({ ours, theirs, report });
  assert.equal(merged.masterVariant.prices[0].value.centAmount, 1299); // our price
  assert.equal(merged.masterVariant.attributes[0].value, 'synthetic'); // trunk attribute
});
