/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * e2e-undeploy.test.mjs — production versioning, first-class deletions, and undeploy.
 *
 * Opt-in (RUN_E2E=1); writes to the real stage (your-stage-project) + live
 * (your-live-project) projects and self-cleans. Drives the deploy service's real HTTP
 * routes in-process (the actor is an admin, so it has publish). Covers the
 * three cases the production-versioning feature adds:
 *
 *   1. CREATE → undeploy DELETES it. A deploy that creates a product records a
 *      TOMBSTONE baseline (it was absent in prod); undeploy therefore removes it.
 *   2. UPDATE → undeploy REVERTS it. A deploy that changes an existing prod asset
 *      records the prior content as a baseline; undeploy restores it exactly.
 *   3. DELETE via a release → prod deletes it; undeploy RESTORES it. A release can
 *      now carry explicit deletions; the deleted asset's pre-delete content is the
 *      baseline, so undeploy re-creates it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ctClient } from '../lib/ct.mjs';
import * as ph from '../lib/prod-history.mjs';
import * as reg from '../lib/registry.mjs';

const RUN = process.env.RUN_E2E === '1';
// Fail-safe default: an operator who has not named their stage project cannot
// accidentally run this against whatever CTP_* happens to be in the environment.
const EXPECT_STAGE = process.env.E2E_STAGE_PROJECT || 'your-stage-project';
const skip = RUN ? false : 'opt-in: set RUN_E2E=1 (writes to stage+live)';
const publisher = 'admin@example.com'; // admin in the stage ACL → can publish

const nameOf = (p) => p?.masterData?.current?.name?.['en-US'];
const productDraft = (key, sku, name, cents) => ({
  key, productType: { typeId: 'product-type', key: 'auto-part' },
  name: { 'en-US': name }, slug: { 'en-US': key },
  masterVariant: { sku, key: `${key}-mv`, prices: [{ key: `${key}-usd-us`, value: { currencyCode: 'USD', centAmount: cents }, country: 'US' }], attributes: [] },
  publish: true,
});

describe('production versioning: baselines, deletions, undeploy/rollback', { skip }, () => {
  const ts = Date.now().toString(36);
  const K = { p1: `undep1-${ts}`, p2: `undep2-${ts}`, p3: `undep3-${ts}`, r1: `undep-r1-${ts}`, r2: `undep-r2-${ts}`, r3: `undep-r3-${ts}` };
  const author = `e2e-author-${ts}@example.com`; // label only; the actor is the admin below

  let stage, live, server, base, TOKEN;
  const api = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j).slice(0, 300)}`), { status: r.status, body: j });
    return j;
  };

  before(async () => {
    TOKEN = 'e2e-local-token';
    process.env.DEPLOY_SERVICE_TOKEN = TOKEN;
    process.env.PORT = '0';
    const mod = await import('../server.mjs');
    server = await mod.startServer(0);
    base = `http://127.0.0.1:${server.address().port}`;
    stage = await ctClient('stage');
    live = await ctClient('live');
    // Same rail as e2e-release: this suite writes to stage and live, so it refuses
    // to run until the resolved project is the intended one.
    assert.equal(
      stage.pk,
      EXPECT_STAGE,
      `refusing to run: resolved stage=${stage.pk}, expected ${EXPECT_STAGE}. ` +
        `Set E2E_STAGE_PROJECT=${stage.pk} if that is deliberate.`
    );
    console.log(`  · service ${base} · stage=${stage.pk} live=${live.pk} · keys ${JSON.stringify(K)}`);
  });

  after(async () => {
    if (!stage || !live) return;
    const rm = async (c, ep, k) => { try { const o = await c.byKey(ep, k); if (!o) return; let v = o.version; if (o.masterData?.published) { const u = await c.post(`/${ep}/key=${k}`, { version: v, actions: [{ action: 'unpublish' }] }); if (u.ok) v = u.body.version; } await c.del(`/${ep}/key=${k}?version=${v}`); } catch {} };
    for (const k of [K.p1, K.p2, K.p3]) { await rm(stage, 'products', k); await rm(live, 'products', k); await reg.deleteVersions(stage, ph.prodLogicalId('product', k), ph.PROD_BRANCH).catch(() => {}); }
    for (const k of [K.r1, K.r2, K.r3]) { try { await stage.del(`/custom-objects/release-registry/${encodeURIComponent(k)}`); } catch {} }
    console.log('  · teardown complete (products + baselines + releases removed from both projects)');
    if (server) { server.closeAllConnections?.(); await new Promise((res) => server.close(res)); }
  });

  // ── 1. CREATE → undeploy deletes it (tombstone baseline) ─────────────────────
  it('1) a created product is undeployed by DELETING it (tombstone baseline)', async () => {
    // author creates on stage, walks the release to published (full lifecycle)
    const c = await stage.post('/products', productDraft(K.p1, `UNDEP1-${ts}`, `Undeploy Create ${ts}`, 1500));
    assert.ok(c.ok, `create p1: ${JSON.stringify(c.body).slice(0, 200)}`);
    await api('POST', '/releases', { key: K.r1, title: `Undeploy 1 ${ts}`, author, members: { products: [K.p1] } });
    await api('POST', `/releases/${K.r1}/stage-publish`, { by: publisher });
    await api('POST', `/releases/${K.r1}/status`, { to: 'approved', by: publisher, note: 'ok' });
    const dep = await api('POST', `/releases/${K.r1}/deploy`, { to: 'live', apply: true, by: publisher });
    assert.equal(dep.summary.error, 0);
    assert.equal(dep.summary.create, 1, 'p1 created on live');

    // baseline recorded and it's a tombstone (p1 was absent in prod before)
    const rel = (await api('GET', `/releases/${K.r1}`)).release;
    assert.equal(rel.status, 'published', 'auto-advanced to published');
    const lid = ph.prodLogicalId('product', K.p1);
    assert.ok(rel.deployments[0].baselines?.[lid], 'baseline recorded for p1');
    const snap = await ph.getProdVersion(stage, 'product', K.p1, rel.deployments[0].baselines[lid].version);
    assert.equal(snap.content.deleted, true, 'baseline is a tombstone (created by this deploy)');
    assert.ok(await live.byKey('products', K.p1), 'p1 is live before undeploy');

    // undeploy → p1 deleted from prod, release rolled-back
    const un = await api('POST', `/releases/${K.r1}/undeploy`, { to: 'live', apply: true, by: publisher });
    assert.equal(un.summary.error, 0, `undeploy errors: ${JSON.stringify(un.summary)}`);
    assert.equal(un.summary.delete, 1, 'undeploy deletes the created product');
    assert.equal(await live.byKey('products', K.p1), null, 'p1 removed from prod by undeploy');
    assert.equal((await api('GET', `/releases/${K.r1}`)).release.status, 'rolled-back');
  });

  // ── 2. UPDATE → undeploy reverts it (content baseline) ───────────────────────
  it('2) an updated product is undeployed by REVERTING it to the prior content', async () => {
    // p2 already exists in prod as "Original"; stage has the edited "Modified".
    await live.post('/products', productDraft(K.p2, `UNDEP2-${ts}`, `Original ${ts}`, 2000));
    await stage.post('/products', productDraft(K.p2, `UNDEP2-${ts}`, `Modified ${ts}`, 2000));
    await api('POST', '/releases', { key: K.r2, title: `Undeploy 2 ${ts}`, author, members: { products: [K.p2] } });

    const dep = await api('POST', `/releases/${K.r2}/deploy`, { to: 'live', apply: true, by: publisher });
    assert.equal(dep.summary.error, 0);
    assert.equal(dep.summary.update, 1, 'p2 updated on live');
    assert.equal(nameOf(await live.byKey('products', K.p2)), `Modified ${ts}`, 'prod now shows the edit');

    // undeploy → revert to "Original" (still present, just reverted)
    const un = await api('POST', `/releases/${K.r2}/undeploy`, { to: 'live', apply: true, by: publisher });
    assert.equal(un.summary.error, 0, `undeploy errors: ${JSON.stringify(un.summary)}`);
    const after = await live.byKey('products', K.p2);
    assert.ok(after, 'p2 still exists after undeploy (it was an update, not a create)');
    assert.equal(nameOf(after), `Original ${ts}`, 'undeploy reverted the name to the pre-deploy baseline');
  });

  // ── 3. DELETE via a release → prod deletes it; undeploy restores it ───────────
  it('3) a release can DELETE from prod, and undeploy RESTORES the deleted asset', async () => {
    await live.post('/products', productDraft(K.p3, `UNDEP3-${ts}`, `Delete Me ${ts}`, 500));
    await api('POST', '/releases', { key: K.r3, title: `Undeploy 3 ${ts}`, author, members: {} });
    // explicit deletion member (no products to upsert; remove p3 from prod)
    await api('PUT', `/releases/${K.r3}/members`, { members: {}, deletions: { products: [K.p3] } });

    const dep = await api('POST', `/releases/${K.r3}/deploy`, { to: 'live', apply: true, by: publisher });
    assert.equal(dep.summary.error, 0, `deploy errors: ${JSON.stringify(dep.summary)}`);
    assert.equal(dep.summary.delete, 1, 'the release deleted p3 from prod');
    assert.equal(await live.byKey('products', K.p3), null, 'p3 removed from prod by the deploy');

    // undeploy → the deleted product is restored from its baseline
    const un = await api('POST', `/releases/${K.r3}/undeploy`, { to: 'live', apply: true, by: publisher });
    assert.equal(un.summary.error, 0, `undeploy errors: ${JSON.stringify(un.summary)}`);
    const restored = await live.byKey('products', K.p3);
    assert.ok(restored, 'p3 restored on prod by undeploy');
    assert.equal(nameOf(restored), `Delete Me ${ts}`, 'restored with its original content');
  });
});
