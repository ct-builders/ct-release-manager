/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * deploy-publish.test.mjs — the live/offline (native publish/unpublish) feature.
 *
 * Three pure/hermetic guarantees (no real CT; the CT-touching paths are exercised
 * by e2e-release.test.mjs):
 *   1. serializeProduct carries the product's published state (and falls back to the
 *      staged projection so an UNPUBLISHED product still serializes).
 *   2. deployBundle propagates that state: it emits `publish` / `unpublish` on the
 *      target product so taking a product offline on stage removes it from prod.
 *   3. recordDeployment stamps a release "published" on an IMMEDIATE update from any
 *      status (the admin fast-path), while a normal deploy only advances "approved".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeProduct } from '../lib/serialize.mjs';
import { deployBundle } from '../lib/deploy.mjs';
import * as reg from '../lib/registry.mjs';

// ---- 1. serialize carries publish state --------------------------------------
function rawProduct({ published, hasCurrent = true }) {
  const projection = {
    name: { 'en-US': 'Oil Filter' }, slug: { 'en-US': 'oil-filter' },
    categories: [], masterVariant: { sku: 'OILF', attributes: [], prices: [] }, variants: [],
  };
  const masterData = { published, hasStagedChanges: false };
  if (hasCurrent) masterData.current = projection; else masterData.staged = projection;
  return { key: 'oil-filter', productType: { key: 'auto-part' }, masterData };
}

test('serializeProduct: published product → published:true, publish:true', async () => {
  const out = await serializeProduct({}, rawProduct({ published: true }));
  assert.equal(out.published, true);
  assert.equal(out.publish, true);
});

test('serializeProduct: unpublished product → published:false', async () => {
  const out = await serializeProduct({}, rawProduct({ published: false }));
  assert.equal(out.published, false);
  assert.equal(out.publish, false);
});

test('serializeProduct: unpublished with only a staged projection still serializes', async () => {
  // an offline product may have no `current` — must fall back to `staged`, not throw
  const out = await serializeProduct({}, rawProduct({ published: false, hasCurrent: false }));
  assert.equal(out.published, false);
  assert.equal(out.name['en-US'], 'Oil Filter');
});

// ---- 2. deploy propagates publish/unpublish ----------------------------------
// A target client whose product already matches `serialized` in content, so the
// ONLY possible action is the publish-state change. dryRun → upsert returns the
// action NAMES it would apply.
function targetWith({ published }) {
  const existing = {
    version: 1,
    masterData: {
      published, hasStagedChanges: false,
      current: { name: { 'en-US': 'Oil Filter' }, slug: { 'en-US': 'oil-filter' }, categories: [], masterVariant: { sku: 'OILF', attributes: [], prices: [] }, variants: [] },
    },
  };
  return { pk: 'live-test', byKey: async () => existing, post: async () => ({ ok: true, status: 200, body: { version: 2 } }) };
}
const productBundle = (published) => ({
  products: [{ resourceType: 'product', key: 'oil-filter', productType: { typeId: 'product-type', key: 'auto-part' }, name: { 'en-US': 'Oil Filter' }, slug: { 'en-US': 'oil-filter' }, categories: [], masterVariant: { sku: 'OILF', attributes: [], prices: [] }, variants: [], published }],
});
const productResult = (r) => r.order.find((o) => o.type === 'product');

test('deploy: source offline + target live → unpublish', async () => {
  const r = await deployBundle(targetWith({ published: true }), productBundle(false), { dryRun: true });
  assert.deepEqual(productResult(r).actions, ['unpublish']);
});

test('deploy: source live + target offline → publish (re-publish)', async () => {
  const r = await deployBundle(targetWith({ published: false }), productBundle(true), { dryRun: true });
  assert.deepEqual(productResult(r).actions, ['publish']);
});

test('deploy: source live + target live, no content diff → noop (no publish churn)', async () => {
  const r = await deployBundle(targetWith({ published: true }), productBundle(true), { dryRun: true });
  assert.equal(productResult(r).action, 'noop');
});

test('deploy: source offline + target offline → noop', async () => {
  const r = await deployBundle(targetWith({ published: false }), productBundle(false), { dryRun: true });
  assert.equal(productResult(r).action, 'noop');
});

// ---- 3. recordDeployment: immediate update stamps published from any status ----
// Minimal in-memory stage (custom-objects only) for getRelease/writeRelease/all.
function makeStage(release) {
  const store = new Map([[`release-registry/${release.key}`, { version: 1, value: release }]]);
  return {
    pk: 'stage-test',
    get: async (p) => { const m = p.match(/^\/custom-objects\/([^/]+)\/(.+)$/); return m ? store.get(`${m[1]}/${decodeURIComponent(m[2])}`) || null : null; },
    post: async (_p, body) => { const cur = store.get(`${body.container}/${body.key}`); const rec = { version: (cur?.version || 0) + 1, value: body.value }; store.set(`${body.container}/${body.key}`, rec); return { ok: true, status: 200, body: rec }; },
    all: async () => [], // empty acl → notify resolves no recipients (open mode)
  };
}
const deployEntry = (extra) => ({ by: 'admin@reference-deployment.test', target: 'live-test', apply: true, ok: true, hash: 'abc', summary: { create: 0, update: 1, noop: 0, error: 0 }, ...extra });

test('recordDeployment: immediate update advances a DRAFT release to published', async () => {
  const stage = makeStage({ key: 'r1', status: 'draft', author: 'author@example.com', history: [], deployments: [] });
  const saved = await reg.recordDeployment(stage, 'r1', deployEntry({ immediate: true }));
  assert.equal(saved.status, 'published');
  assert.equal(saved.deployments[0].immediate, true);
  assert.ok(saved.history.some((h) => h.to === 'published' && /immediate update/.test(h.note || '')));
});

test('recordDeployment: a normal deploy does NOT advance a draft release', async () => {
  const stage = makeStage({ key: 'r2', status: 'draft', author: 'author@example.com', history: [], deployments: [] });
  const saved = await reg.recordDeployment(stage, 'r2', deployEntry());
  assert.equal(saved.status, 'draft'); // only 'approved' auto-advances on a normal deploy
});

test('recordDeployment: a normal deploy still advances an APPROVED release', async () => {
  const stage = makeStage({ key: 'r3', status: 'approved', author: 'author@example.com', history: [], deployments: [] });
  const saved = await reg.recordDeployment(stage, 'r3', deployEntry());
  assert.equal(saved.status, 'published');
});
