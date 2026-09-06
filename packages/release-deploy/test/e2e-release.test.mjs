/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * e2e-release.test.mjs — end-to-end test of the whole release workflow, exercised
 * against the REAL stage (your-stage-project) and live (your-live-project) projects and
 * the production storefront, matching the way the MC "Release Deployments" app +
 * deploy service drive the pipeline.
 *
 * This is the SERVICE-LEVEL e2e (drives the deploy service's HTTP API directly). For
 * the same workflow driven through the Launch Center console at its PUBLIC URL (a
 * browser/Playwright test), see ../../e2e/release-workflow.spec.mjs.
 *
 * It walks the full lifecycle the way a human would:
 *
 *   Step 1 — AUTHOR:  an author edits the catalog on stage (creates a new
 *            category, an unpublished product, and a product discount) and groups
 *            them into a new release (draft).
 *   Step 2 — REVIEW:  "Publish to stage" publishes the release's products on stage
 *            (draft → ready-for-review) so they can be previewed. We then poll the
 *            commercetools Product Search API on the STAGE project until the new
 *            product is indexed (this is the "preview on the staging site" check —
 *            see the storefront note below — and absorbs product-search INDEXING
 *            LATENCY with a bounded poll).
 *   Step 3 — APPROVE: a reviewer (≠ author) approves with a note, then we assert
 *            the post-approval publish-prompt DECISION: an approver who also holds
 *            publish rights is offered to publish it themselves; one who doesn't is
 *            deferred to a publisher. (The MC app renders this as a modal — see
 *            release-detail.tsx. The reject case is a deliberate TODO, below.)
 *   Step 4 — PUBLISH: a publisher deploys the release stage → live (apply). The
 *            release auto-advances to `published`. We then poll BOTH the live
 *            Product Search API AND the production storefront until the product is
 *            visible there (again absorbing indexing latency) — proving the change
 *            authored on stage is now live on the production site.
 *
 * Teardown deletes every fixture from BOTH projects (and the release object) so the
 * catalog is left clean, even if an assertion fails.
 *
 * ── SAFETY / OPT-IN ──────────────────────────────────────────────────────────
 * This test WRITES real data to stage and live (products/categories/discounts) and
 * deploys to the live project. It is therefore OPT-IN: it only runs when
 * `RUN_E2E=1` is set AND stage+live credentials resolve (see lib/ct.mjs / .env).
 * Without RUN_E2E it self-skips, so the default `node --test` suite stays fast and
 * hermetic. All fixtures use a unique `e2e-<ts>` key prefix and are torn down.
 *
 * ── STOREFRONT ↔ PROJECT NOTE ────────────────────────────────────────────────
 * Today BOTH storefronts (storefront.example.com and
 * stage.storefront.example.com) read the LIVE project (your-live-project); neither
 * reads your-stage-project. So a change authored on stage cannot appear on the staging
 * *storefront* until it is deployed to live. The "preview on staging" assertion in
 * Step 2 therefore checks the STAGE project's Product Search directly (what a
 * correctly-pointed staging storefront would surface). Repointing the staging
 * storefront at your-stage-project is tracked as a follow-up in the pipeline notes.
 *
 * ── FUTURE WORK (intentionally NOT covered here) ─────────────────────────────
 *   • Reject case: reviewer rejects with a note → release returns to draft. The
 *     user asked to add this later; see test/README-e2e.md.
 *   • Email notifications: tie approval/publish transitions into email. Future.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ctClient } from '../lib/ct.mjs';
import { capabilities, setAcl, removeAcl } from '../lib/acl.mjs';

const RUN = process.env.RUN_E2E === '1';
const skip = RUN ? false : 'opt-in: set RUN_E2E=1 (writes to stage+live and deploys to production)';

// storefront that reads the LIVE project (production site the user sees)
const PROD_STOREFRONT = (process.env.PROD_STOREFRONT_URL || 'https://storefront.example.com').replace(/\/$/, '');
// This suite authors on stage and DEPLOYS TO LIVE, so it refuses to run until the
// project it resolved is the one you meant. Default keeps the original rail; point
// E2E_STAGE_PROJECT / E2E_LIVE_PROJECT at another tenant to run it there.
const EXPECT_STAGE = process.env.E2E_STAGE_PROJECT || 'your-stage-project';
const EXPECT_LIVE = process.env.E2E_LIVE_PROJECT || '';
// The fixture product has to fit the tenant's own catalog: a product type that
// exists there, and a locale, currency and country the project allows. Defaults
// keep the original default shape so an unset environment behaves as before.
const PRODUCT_TYPE_KEY = process.env.E2E_PRODUCT_TYPE_KEY || 'auto-part';
const LOCALE = process.env.E2E_LOCALE || 'en-US';
const CURRENCY = process.env.E2E_CURRENCY || 'USD';
const COUNTRY = process.env.E2E_COUNTRY || 'US';
// how long to wait for product-search indexing (stage + live) before failing
const INDEX_TIMEOUT_MS = Number(process.env.INDEX_TIMEOUT_MS || 180_000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 4_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ·', ...a);

// Poll `fn` until it returns a truthy `.done`, or throw after timeoutMs. Absorbs
// the asynchronous indexing lag of the commercetools Product Search API.
async function pollUntil(label, fn, { timeoutMs = INDEX_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS } = {}) {
  const start = Date.now();
  let attempt = 0;
  let last;
  for (;;) {
    attempt++;
    try { last = await fn(); } catch (e) { last = { done: false, error: String(e?.message || e) }; }
    if (last && last.done) {
      log(`${label}: satisfied after ${attempt} attempt(s) / ${Math.round((Date.now() - start) / 1000)}s`);
      return last;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label}: NOT satisfied after ${attempt} attempts / ${Math.round((Date.now() - start) / 1000)}s (last=${JSON.stringify(last).slice(0, 240)})`);
    }
    await sleep(intervalMs);
  }
}

// exact-SKU match count via the commercetools Product Search API (same query shape
// the storefront uses). Product Search indexes the published projection, so a
// count of 1 means the product is published AND indexed in `client`'s project.
async function ctSkuCount(client, sku) {
  const r = await client.post('/products/search', { query: { exact: { field: 'variants.sku', value: sku } }, limit: 20 });
  if (!r.ok) throw new Error(`product search failed on ${client.pk}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.total ?? (r.body.results?.length ?? 0);
}

// exact-SKU match count via the storefront's own search API (the production site).
async function storefrontSkuCount(baseUrl, sku) {
  const url = `${baseUrl}/api/product/search?q=${encodeURIComponent(sku)}&limit=20&_cb=${Date.now()}`;
  const r = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) return { total: 0, status: r.status, products: [] };
  const j = await r.json().catch(() => ({}));
  return { total: j.total ?? 0, status: r.status, products: j.products || [] };
}

// ── teardown helpers (best-effort; never throw) ──────────────────────────────
async function safeDeleteProduct(c, key) {
  try {
    const p = await c.byKey('products', key);
    if (!p) return 'absent';
    let version = p.version;
    if (p.masterData?.published) {
      const u = await c.post(`/products/key=${encodeURIComponent(key)}`, { version, actions: [{ action: 'unpublish' }] });
      if (u.ok) version = u.body.version;
    }
    const d = await c.del(`/products/key=${encodeURIComponent(key)}?version=${version}`);
    return d.ok ? 'deleted' : `del-failed ${d.status}`;
  } catch (e) { return `error ${e.message}`; }
}
async function safeDelete(c, endpoint, key) {
  try {
    const o = await c.byKey(endpoint, key);
    if (!o) return 'absent';
    const d = await c.del(`/${endpoint}/key=${encodeURIComponent(key)}?version=${o.version}`);
    return d.ok ? 'deleted' : `del-failed ${d.status} ${JSON.stringify(d.body).slice(0, 120)}`;
  } catch (e) { return `error ${e.message}`; }
}
async function safeDeleteCO(c, container, key) {
  try {
    const d = await c.del(`/custom-objects/${container}/${encodeURIComponent(key)}`);
    return d.ok || d.status === 404 ? 'deleted' : `fail ${d.status}`;
  } catch (e) { return `error ${e.message}`; }
}

describe('release workflow e2e (author → review → approve → publish → visible on production)', { skip }, () => {
  // shared state across the ordered steps
  const ts = Date.now().toString(36);
  const uniq = {
    releaseKey: `e2e-rel-${ts}`,
    catKey: `e2e-cat-${ts}`,
    catSlug: `e2e-cat-${ts}`,
    prodKey: `e2e-prod-${ts}`,
    variantKey: `e2e-var-${ts}`,
    priceKey: `e2e-price-${ts}`,
    pdKey: `e2e-pd-${ts}`,
    sku: `E2E-SKU-${ts.toUpperCase()}`,
    slug: `e2e-prod-${ts}`,
    name: `E2E Test Part ${ts}`,
  };
  const authorEmail = `e2e-author-${ts}@example.com`;
  const reviewerEmail = `e2e-reviewer-${ts}@example.com`;
  const publisherEmail = `e2e-publisher-${ts}@example.com`;

  let stage, live, server, base, TOKEN;

  const api = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j).slice(0, 300)}`), { status: r.status, body: j });
    return j;
  };

  before(async () => {
    // start the deploy service in-process on an ephemeral port, with auth on, so we
    // exercise the real HTTP + RBAC layer exactly as the MC app does.
    TOKEN = 'e2e-local-token';
    process.env.DEPLOY_SERVICE_TOKEN = TOKEN;
    process.env.PORT = '0';
    const mod = await import('../server.mjs');
    server = await mod.startServer(0);
    base = `http://127.0.0.1:${server.address().port}`;

    stage = await ctClient('stage');
    live = await ctClient('live');
    assert.equal(
      stage.pk,
      EXPECT_STAGE,
      `refusing to run: resolved stage=${stage.pk}, expected ${EXPECT_STAGE}. ` +
        `Set E2E_STAGE_PROJECT=${stage.pk} if that is deliberate.`
    );
    if (EXPECT_LIVE) {
      assert.equal(
        live.pk,
        EXPECT_LIVE,
        `refusing to run: resolved live=${live.pk}, expected ${EXPECT_LIVE}.`
      );
    }

    // Grant the three throwaway actors just the role each step needs. Adding these
    // scoped users does NOT change any existing user's access (the ACL is already
    // enforced); they're removed in teardown. Deliberately give the reviewer only
    // 'reviewer' (approve, NOT publish) so Step 3 exercises the real "approver
    // can't publish → defer to a publisher" branch.
    await setAcl(stage, { email: authorEmail, roles: ['author'], by: 'e2e-setup' });
    await setAcl(stage, { email: reviewerEmail, roles: ['reviewer'], by: 'e2e-setup' });
    await setAcl(stage, { email: publisherEmail, roles: ['publisher'], by: 'e2e-setup' });

    log(`service on ${base} · stage=${stage.pk} · live=${live.pk} · prod storefront=${PROD_STOREFRONT}`);
    log(`actors: author=${authorEmail} reviewer=${reviewerEmail} publisher=${publisherEmail}`);
    log(`fixtures: product ${uniq.prodKey} (sku ${uniq.sku}), category ${uniq.catKey}, discount ${uniq.pdKey}, release ${uniq.releaseKey}`);
    log(`fixture shape: productType=${PRODUCT_TYPE_KEY} locale=${LOCALE} price=${CURRENCY}/${COUNTRY}`);
  });

  after(async () => {
    if (!stage || !live) return;
    log('teardown…');
    log(`  product   stage=${await safeDeleteProduct(stage, uniq.prodKey)}  live=${await safeDeleteProduct(live, uniq.prodKey)}`);
    log(`  discount  stage=${await safeDelete(stage, 'product-discounts', uniq.pdKey)}  live=${await safeDelete(live, 'product-discounts', uniq.pdKey)}`);
    log(`  category  stage=${await safeDelete(stage, 'categories', uniq.catKey)}  live=${await safeDelete(live, 'categories', uniq.catKey)}`);
    log(`  release   stage=${await safeDeleteCO(stage, 'release-registry', uniq.releaseKey)}`);
    for (const email of [authorEmail, reviewerEmail, publisherEmail]) {
      await removeAcl(stage, email).catch(() => {});
    }
    log('  acl       removed 3 e2e test users');
    if (server) {
      server.closeAllConnections?.(); // drop undici keep-alive sockets so close() resolves
      await new Promise((res) => server.close(res));
    }
  });

  // ── STEP 1: AUTHOR ─────────────────────────────────────────────────────────
  it('Step 1 — author creates category + product + discount on stage and groups them into a draft release', async () => {
    // 1a. category (root, no parent → clean cross-project deploy)
    const cat = await stage.post('/categories', {
      key: uniq.catKey,
      name: { [LOCALE]: `E2E Category ${ts}` },
      slug: { [LOCALE]: uniq.catSlug },
    });
    assert.ok(cat.ok, `create category: ${cat.status} ${JSON.stringify(cat.body).slice(0, 200)}`);

    // 1b. product — created UNPUBLISHED (staged only), mirroring an author's draft
    // edit. No attributes are set, so E2E_PRODUCT_TYPE_KEY must name a product type
    // with no REQUIRED attributes. One price in the tenant's currency/country so the
    // storefront's default context prices it.
    const prod = await stage.post('/products', {
      key: uniq.prodKey,
      productType: { typeId: 'product-type', key: PRODUCT_TYPE_KEY },
      name: { [LOCALE]: uniq.name },
      slug: { [LOCALE]: uniq.slug },
      categories: [{ typeId: 'category', key: uniq.catKey }],
      masterVariant: {
        sku: uniq.sku,
        key: uniq.variantKey,
        prices: [{ key: uniq.priceKey, value: { currencyCode: CURRENCY, centAmount: 4999 }, country: COUNTRY }],
        attributes: [],
      },
      // no `publish` → product exists only as a staged draft until Step 2
    });
    assert.ok(prod.ok, `create product: ${prod.status} ${JSON.stringify(prod.body).slice(0, 300)}`);
    assert.equal(prod.body.masterData.published, false, 'product should start unpublished (staged draft)');

    // 1c. product discount targeting the new product by SKU (no references → deploys clean)
    const pd = await stage.post('/product-discounts', {
      key: uniq.pdKey,
      name: { [LOCALE]: `E2E 10% off ${ts}` },
      value: { type: 'relative', permyriad: 1000 },
      predicate: `sku = "${uniq.sku}"`,
      sortOrder: `0.5${String(Date.now()).slice(-6).replace(/0$/, '1')}`,
      isActive: true,
    });
    assert.ok(pd.ok, `create product-discount: ${pd.status} ${JSON.stringify(pd.body).slice(0, 300)}`);

    // 1d. create the release (draft) via the service, grouping all three members
    const { release } = await api('POST', '/releases', {
      key: uniq.releaseKey,
      title: `E2E Release ${ts}`,
      description: 'End-to-end test release: one product, one category, one discount.',
      author: authorEmail,
      members: { products: [uniq.prodKey], categories: [uniq.catKey], productDiscounts: [uniq.pdKey] },
    });
    assert.equal(release.status, 'draft');
    assert.equal(release.author, authorEmail);
    assert.deepEqual(release.members.products, [uniq.prodKey]);
    assert.deepEqual(release.members.categories, [uniq.catKey]);
    assert.deepEqual(release.members.productDiscounts, [uniq.pdKey]);
    log('release created (draft) with product + category + discount members');
  });

  // ── STEP 2: REVIEW (publish to stage + preview) ──────────────────────────────
  it('Step 2 — publish to stage advances to ready-for-review and the product becomes searchable on stage (indexing latency)', { timeout: INDEX_TIMEOUT_MS + 60_000 }, async () => {
    const res = await api('POST', `/releases/${uniq.releaseKey}/stage-publish`, { by: authorEmail });
    assert.equal(res.release.status, 'ready-for-review', 'stage-publish should move draft → ready-for-review');
    assert.equal(res.publish.summary.error, 0, `stage publish errors: ${JSON.stringify(res.publish.summary)}`);
    assert.equal(res.publish.summary.published, 1, 'the one unpublished product should have been published on stage');

    // now published on stage → Product Search will index it. Poll (this is the
    // "preview on the staging site" check; see the storefront note in the header).
    await pollUntil('stage product-search indexed', async () => {
      const n = await ctSkuCount(stage, uniq.sku);
      return { done: n >= 1, count: n };
    });
    // the product must NOT be on live yet (nothing deployed) — sanity check isolation
    assert.equal(await ctSkuCount(live, uniq.sku), 0, 'product must not be on live before publish-to-production');
    log('product is live-previewable on the stage project; absent from production (as expected)');
  });

  // ── STEP 3: APPROVE + publish-prompt decision ────────────────────────────────
  it('Step 3 — a reviewer (≠ author) approves with a note; publish-prompt is offered iff the approver can publish', async () => {
    // approve requires approver ≠ author (enforced by the service regardless of ACL)
    const { release } = await api('POST', `/releases/${uniq.releaseKey}/status`, {
      to: 'approved',
      by: reviewerEmail,
      note: 'Looks good on the staging preview — approving.',
    });
    assert.equal(release.status, 'approved');
    assert.equal(release.approver, reviewerEmail);
    assert.notEqual(release.approver, release.author);
    assert.ok((release.history || []).some((h) => h.to === 'approved' && h.note), 'approval note recorded in history');

    // author cannot self-approve. In enforced mode the author (author role only)
    // is blocked at the RBAC gate (lacks "approve" → 403) before the deeper
    // approver≠author guard is even reached; both are valid rejections. The
    // approver≠author rule itself is asserted on the happy path above.
    await assert.rejects(
      () => api('POST', `/releases/${uniq.releaseKey}/status`, { to: 'approved', by: authorEmail }),
      /approver must differ from author|lacks "approve"|forbidden/,
      'author must not be able to self-approve',
    );

    // The post-approval publish prompt: the MC app shows it iff the approver holds
    // publish rights (release-detail.tsx). This is the decision the modal makes.
    const modalDecision = (can) => (can.publish ? 'offer-self-publish' : 'defer-to-publisher');
    assert.equal(modalDecision(capabilities(['reviewer'])), 'defer-to-publisher', 'reviewer-only approver → a publisher must publish');
    assert.equal(modalDecision(capabilities(['reviewer', 'publisher'])), 'offer-self-publish', 'reviewer+publisher approver → prompt to self-publish');
    assert.equal(modalDecision(capabilities(['admin'])), 'offer-self-publish', 'admin approver → prompt to self-publish');

    // And against the running service: /acl/me tells the UI what the approver can do.
    // This approver is a reviewer WITHOUT publish rights → the prompt is NOT offered;
    // a separate publisher must take it to production (Step 4). This is the real
    // "if they don't have permission, the publisher has to do it" branch.
    const me = await api('GET', `/acl/me?actor=${encodeURIComponent(reviewerEmail)}`);
    log(`approver /acl/me: roles=${JSON.stringify(me.roles)} can.publish=${me.can.publish} → modal decision "${modalDecision(me.can)}"`);
    assert.equal(me.can.approve, true, 'reviewer can approve');
    assert.equal(me.can.publish, false, 'reviewer (no publisher role) cannot publish');
    assert.equal(modalDecision(me.can), 'defer-to-publisher', 'no self-publish prompt → defer to a publisher');

    // Contrast: an approver who ALSO holds publish rights WOULD be offered the prompt.
    const publisherActor = await api('GET', `/acl/me?actor=${encodeURIComponent(publisherEmail)}`);
    // (publisher role → publish only; a real reviewer+publisher would have both.
    // The pure-function asserts above cover the combined-capabilities decision.)
    assert.equal(publisherActor.can.publish, true, 'publisher can publish');
  });

  // ── STEP 4: PUBLISH TO PRODUCTION + visible on production site ────────────────
  it('Step 4 — a publisher deploys stage → live; the change is then visible on the production site (indexing latency)', { timeout: INDEX_TIMEOUT_MS + 90_000 }, async () => {
    // dry-run first (what the "Validate & preview diff" panel shows): all deployable
    const preview = await api('POST', `/releases/${uniq.releaseKey}/deploy`, { from: 'stage', to: 'live', apply: false, by: publisherEmail });
    assert.equal(preview.applied, false);
    assert.equal(preview.summary.error, 0, `dry-run errors: ${JSON.stringify(preview.summary)}`);

    // real deploy (apply). Requires 'publish' capability (open mode → allowed).
    const deployed = await api('POST', `/releases/${uniq.releaseKey}/deploy`, { from: 'stage', to: 'live', apply: true, by: publisherEmail });
    assert.equal(deployed.applied, true);
    assert.equal(deployed.summary.error, 0, `deploy errors: ${JSON.stringify(deployed.summary)}`);
    assert.ok((deployed.summary.create + deployed.summary.update) >= 3, `expected ≥3 members created/updated on live, got ${JSON.stringify(deployed.summary)}`);

    // a successful apply auto-advances approved → published
    const { release } = await api('GET', `/releases/${uniq.releaseKey}`);
    assert.equal(release.status, 'published', 'release should auto-advance to published after a successful deploy');

    // the members now exist on live (by key)
    assert.ok(await live.byKey('categories', uniq.catKey), 'category should exist on live');
    assert.ok(await live.byKey('products', uniq.prodKey), 'product should exist on live');
    assert.ok(await live.byKey('product-discounts', uniq.pdKey), 'discount should exist on live');

    // visible on the production site: poll live Product Search AND the storefront
    // (each absorbs indexing latency independently).
    await pollUntil('live product-search indexed', async () => {
      const n = await ctSkuCount(live, uniq.sku);
      return { done: n >= 1, count: n };
    });
    const sf = await pollUntil('production storefront shows the product', async () => {
      const r = await storefrontSkuCount(PROD_STOREFRONT, uniq.sku);
      return { done: r.total >= 1, total: r.total, status: r.status };
    });
    assert.ok(sf.total >= 1, 'the authored product is visible on the production storefront');
    log(`✅ change authored on stage is now visible on the production site (${PROD_STOREFRONT})`);
  });
});
