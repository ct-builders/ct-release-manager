/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * branch-registry-cas.test.mjs — the release-branch registry must not drift under
 * concurrency. Two guarantees:
 *   1. mutateBranch/setBranchAssetHead use optimistic concurrency: concurrent forks
 *      onto the same branch never lose each other's asset entries (the original bug).
 *   2. forkAsset self-heals — when a HEAD already exists but its registry entry is
 *      missing (an orphan from a lost write), fork re-records it instead of skipping.
 *
 * Uses an in-memory CustomObject store with real version semantics (a version-pinned
 * write against a stale version returns 409, exactly like commercetools).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as reg from '../lib/registry.mjs';
import { forkAsset } from '../lib/branch-ops.mjs';

// Minimal commercetools-like client: /custom-objects with optimistic concurrency.
function makeStage() {
  const store = new Map(); // `${container}/${key}` -> { version, value }
  const resources = new Set(); // `${endpoint}/${key}` that "exist"
  const counters = { get: 0, post: 0, conflict: 0 };
  const parseCo = (p) => {
    const m = p.match(/^\/custom-objects\/([^/?]+)(?:\/(.+))?$/);
    return m ? { container: m[1], key: m[2] ? decodeURIComponent(m[2]) : null } : null;
  };
  const stage = {
    async get(p) {
      counters.get++;
      await Promise.resolve(); // yield so concurrent callers interleave reads
      const co = parseCo(p);
      if (co && co.key) {
        const rec = store.get(`${co.container}/${co.key}`);
        return rec ? { id: `${co.container}/${co.key}`, version: rec.version, container: co.container, key: co.key, value: rec.value } : {};
      }
      return {};
    },
    async post(p, body) {
      counters.post++;
      await Promise.resolve();
      if (p !== '/custom-objects') return { ok: true, status: 200, body: {} };
      const k = `${body.container}/${body.key}`;
      const rec = store.get(k);
      const curVer = rec?.version ?? 0;
      if (body.version != null && body.version !== curVer) {
        counters.conflict++;
        return { ok: false, status: 409, body: { statusCode: 409, message: `version mismatch (have ${curVer}, sent ${body.version})` } };
      }
      const nextVer = curVer + 1;
      store.set(k, { version: nextVer, value: structuredClone(body.value) });
      return { ok: true, status: rec ? 200 : 201, body: { id: k, version: nextVer, value: structuredClone(body.value) } };
    },
    async del() { return { ok: true, status: 200, body: {} }; },
    async byKey(endpoint, key) {
      return resources.has(`${endpoint}/${key}`) ? { key, version: 1, masterData: { published: false } } : null;
    },
    async all(p) {
      const co = parseCo(p);
      if (!co) return [];
      return [...store.entries()].filter(([k]) => k.startsWith(`${co.container}/`)).map(([, v]) => ({ value: v.value }));
    },
  };
  return { stage, store, resources, counters };
}

const seedBranch = async ({ stage }, branchId, assets = {}) => {
  await reg.createBranch(stage, { branchId, title: branchId });
  for (const [logicalId, entry] of Object.entries(assets)) await reg.setBranchAssetHead(stage, branchId, logicalId, entry);
};

test('concurrent setBranchAssetHead writes never lose an entry (optimistic concurrency)', async () => {
  const s = makeStage();
  await seedBranch(s, 'r-x');

  // fire many asset writes onto the SAME branch at once — the pre-fix code would let
  // later writes clobber earlier ones since each read v0 and blindly overwrote.
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  await Promise.all(ids.map((id) => reg.setBranchAssetHead(s.stage, 'r-x', id, { headKey: `${id}__b__r-x`, version: 0, resourceType: 'product' })));

  const branch = await reg.getBranch(s.stage, 'r-x');
  assert.equal(Object.keys(branch.assets).length, ids.length, 'every concurrent asset entry survived');
  for (const id of ids) assert.equal(branch.assets[id].headKey, `${id}__b__r-x`);
  assert.ok(s.counters.conflict > 0, 'the race actually happened (≥1 CAS 409 was retried)');
});

test('mutateBranch retries on 409 until it wins', async () => {
  const s = makeStage();
  await seedBranch(s, 'r-y');
  // bump the version underneath a single in-flight mutation to force a 409 + retry.
  const realGet = s.stage.get.bind(s.stage);
  let bumped = false;
  s.stage.get = async (p) => {
    const o = await realGet(p);
    if (!bumped && p.includes('/release-branch/r-y')) {
      bumped = true;
      await reg.setBranchAssetHead(s.stage, 'r-y', 'interloper', { headKey: 'interloper__b__r-y', resourceType: 'product' });
    }
    return o;
  };
  await reg.setBranchAssetHead(s.stage, 'r-y', 'mine', { headKey: 'mine__b__r-y', resourceType: 'product' });
  const branch = await reg.getBranch(s.stage, 'r-y');
  assert.ok(branch.assets.mine, 'my write landed after retry');
  assert.ok(branch.assets.interloper, "the concurrent writer's entry was preserved");
});

test('forkAsset reconciles an orphan HEAD (exists but unregistered) idempotently', async () => {
  const s = makeStage();
  await seedBranch(s, 'r-z');
  // an orphan: the working-copy HEAD exists, but the registry has no entry for it.
  s.resources.add('products/widget__b__r-z');
  await reg.putVersion(s.stage, { logicalId: 'widget', branchId: 'r-z', version: 0, content: { key: 'widget' } });

  const before = await reg.getBranch(s.stage, 'r-z');
  assert.equal(before.assets.widget, undefined, 'precondition: orphan is unregistered');

  const r1 = await forkAsset(s.stage, { branchId: 'r-z', canonicalKey: 'widget', resourceType: 'product' });
  assert.equal(r1.action, 'exists');
  assert.equal(r1.reconciled, true, 'fork healed the missing entry');

  const after = await reg.getBranch(s.stage, 'r-z');
  assert.equal(after.assets.widget.headKey, 'widget__b__r-z');
  assert.equal(after.assets.widget.resourceType, 'product');
  assert.equal(after.assets.widget.version, 0);

  // second fork is a no-op: already registered → nothing rewritten.
  const r2 = await forkAsset(s.stage, { branchId: 'r-z', canonicalKey: 'widget', resourceType: 'product' });
  assert.equal(r2.reconciled, false, 'already-registered fork does not rewrite');
});

test('forkAsset leaves a correctly-registered HEAD untouched', async () => {
  const s = makeStage();
  await seedBranch(s, 'r-w', { gizmo: { headKey: 'gizmo__b__r-w', version: 0, resourceType: 'product' } });
  s.resources.add('products/gizmo__b__r-w');
  const r = await forkAsset(s.stage, { branchId: 'r-w', canonicalKey: 'gizmo', resourceType: 'product' });
  assert.equal(r.action, 'exists');
  assert.equal(r.reconciled, false);
});
