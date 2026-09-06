/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * server.mjs — HTTP API for the release deploy pipeline.
 * Runs on GCP Cloud Run (Node, zero build). The MC custom app calls these.
 *
 * Auth: Bearer DEPLOY_SERVICE_TOKEN (skipped in dev if unset). CORS open (Bearer,
 * not cookies). Clients are cached per project with a TTL and refreshed lazily.
 *
 * Routes:
 *   GET  /health
 *   GET  /resources/key-audit?project=live
 *   GET  /releases?project=stage
 *   GET  /releases/:key?project=stage        (+ live drift once bundle known)
 *   POST /releases                           {key,title,description,author,members}
 *   PUT  /releases/:key/members              {members}
 *   POST /releases/:key/status               {to,by,note}
 *   POST /releases/:key/stage-publish        {by}   publish products on stage → ready-for-review
 *   POST /releases/:key/merge                {apply,by,resolutions}  fold branch edits → trunk (field-level 3-way; 409 on unresolved conflict)
 *   POST /releases/:key/validate             {from,to}
 *   POST /releases/:key/diff                 {from,to}
 *   POST /releases/:key/deploy               {from,to,apply,by,immediate}   immediate=admin fast-path (skip review/approve)
 *   POST /products/:key/publish              {published,by,apply}           (admin) take one product online/offline in stage+live
 *   POST /deploy                             {from,to,apply,by,selection}   (ad-hoc, no release)
 *   GET  /acl                                                              (admin)
 *   GET  /acl/me?actor=<email>               caller's roles + capabilities
 *   POST /acl                                {email,roles,by}              (admin)
 *   DELETE /acl/:email                                                     (admin)
 *
 * RBAC: mutating release actions require a capability (edit/approve/publish),
 * checked against the ACL on the STAGE project. Empty ACL = open mode (all allowed).
 */
import http from 'http';
import { pathToFileURL } from 'url';
import { ctClient } from './lib/ct.mjs';
import { auditProject } from './lib/key-audit.mjs';
import { serializeBundle, collectUnresolved } from './lib/serialize.mjs';
import { validateAgainstTarget, deployBundle } from './lib/deploy.mjs';
import * as reg from './lib/registry.mjs';
import * as ops from './lib/branch-ops.mjs';
import { getConfig, setConfig } from './lib/config.mjs';
import { ENDPOINT_BY_TYPEID } from './lib/util.mjs';
import { listAcl, setAcl, removeAcl, resolveActor, assertCan } from './lib/acl.mjs';
import { publishReleaseProducts } from './lib/stage-publish.mjs';
import { undeployRelease } from './lib/undeploy.mjs';

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.DEPLOY_SERVICE_TOKEN || '';

// ---- cached clients (token TTL ~ refresh every 45 min) ----
const clients = new Map();
async function getClient(which) {
  const w = which === 'stage' ? 'stage' : 'live';
  const hit = clients.get(w);
  if (hit && hit.expires > Date.now()) return hit.client;
  const client = await ctClient(w);
  clients.set(w, { client, expires: Date.now() + 45 * 60 * 1000 });
  return client;
}

// cached catalog of selectable release members (key + display name) per project
const catalogCache = new Map();
const pickName = (n) => (n && (n['en-US'] || n['en'] || Object.values(n)[0])) || '';
async function catalogMembers(project) {
  const hit = catalogCache.get(project);
  if (hit && Date.now() - hit.at < 120000) return hit.data;
  const c = await getClient(project);
  const products = (await c.allByCursor('/products', 200)).filter((p) => p.key).map((p) => ({ key: p.key, name: pickName(p.masterData?.current?.name) }));
  const categories = (await c.all('/categories')).filter((d) => d.key).map((d) => ({ key: d.key, name: pickName(d.name) }));
  const cartDiscounts = (await c.all('/cart-discounts')).filter((d) => d.key).map((d) => ({ key: d.key, name: pickName(d.name) }));
  const productDiscounts = (await c.all('/product-discounts')).filter((d) => d.key).map((d) => ({ key: d.key, name: pickName(d.name) }));
  const discountCodes = (await c.all('/discount-codes')).filter((d) => d.key).map((d) => ({ key: d.key, name: pickName(d.name) || d.code, code: d.code }));
  const discountGroups = (await c.all('/discount-groups')).filter((d) => d.key).map((d) => ({ key: d.key, name: pickName(d.name) }));
  const data = { project: c.pk, products, categories, cartDiscounts, productDiscounts, discountCodes, discountGroups };
  catalogCache.set(project, { at: Date.now(), data });
  return data;
}

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
}
function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); });
}

// serialize from a release (or ad-hoc selection); returns {bundle, release}.
// A release targets a branch (release.branchId); its members are canonical keys
// resolved to that branch's HEADs and canonicalized back to clean keys in serialize.
async function bundleFor(from, { releaseKey, selection, branchId }) {
  const src = await getClient(from);
  let release = null, sel = selection, branch = branchId;
  if (releaseKey) {
    release = await reg.getRelease(src, releaseKey);
    if (!release) { const e = new Error(`release "${releaseKey}" not found in ${src.pk}`); e.code = 404; throw e; }
    sel = reg.releaseSelection(release);
    branch = release.branchId || branch;
  }
  const bundle = await serializeBundle(src, sel || {}, { bundleKey: releaseKey || null, branchId: branch });
  bundle.generatedAt = new Date().toISOString();
  return { bundle, release, src };
}
const bundleCounts = (b) => ({ discountGroups: b.discountGroups.length, categories: (b.categories || []).length, products: b.products.length, productDiscounts: b.productDiscounts.length, cartDiscounts: b.cartDiscounts.length, discountCodes: b.discountCodes.length });

// gate a lifecycle transition on the actor's capabilities (ACL on stage).
// publish-to-stage → edit · approve → approve · publish-to-prod → publish · draft = reject(approve) OR send-back(edit)
async function requireForStatus(stage, to, by) {
  const need = to === 'ready-for-review' ? 'edit' : to === 'approved' ? 'approve' : to === 'published' ? 'publish' : null;
  if (need) return assertCan(stage, by, need);
  const actor = await resolveActor(stage, by); // to === 'draft'
  if (!(actor.can.edit || actor.can.approve)) { const e = new Error(`forbidden: "${by || 'unknown'}" cannot move release to draft`); e.code = 403; throw e; }
  return actor;
}

const routes = [];
const route = (method, re, handler) => routes.push({ method, re, handler });

route('GET', /^\/health$/, async (_req, res) => json(res, 200, { ok: true, service: 'release-deploy', ts: new Date().toISOString() }));

route('GET', /^\/resources\/key-audit$/, async (req, res, _m, q) => {
  const client = await getClient(q.project || 'live');
  const report = await auditProject(client, { includePrices: q.prices !== 'false' });
  json(res, 200, report);
});

route('GET', /^\/catalog\/members$/, async (req, res, _m, q) => {
  json(res, 200, await catalogMembers(q.project || 'stage'));
});

// ---- auto-add config ----
route('GET', /^\/config$/, async (req, res, _m, q) => {
  const stage = await getClient(q.project || 'stage');
  json(res, 200, { config: await getConfig(stage) });
});
route('PUT', /^\/config$/, async (req, res) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, { config: await setConfig(stage, { autoAddEnabled: b.autoAddEnabled, currentReleaseKey: b.currentReleaseKey }, b.by) });
});

// ---- Pub/Sub push: CT change notification → auto-add to the current release ----
// Auth: shared token in the query (?token=), since Pub/Sub push can't send our
// Bearer header. Always ack (200) so Pub/Sub doesn't redeliver on handled cases.
route('POST', /^\/events$/, async (req, res, _m, q) => {
  if (TOKEN && q.token !== TOKEN) return json(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  try {
    const raw = body?.message?.data ? Buffer.from(body.message.data, 'base64').toString('utf8') : '';
    const note = raw ? JSON.parse(raw) : {};
    const typeId = note?.resource?.typeId;
    const field = reg.MEMBER_FIELD_BY_RESOURCE[typeId];
    if (!field) return json(res, 200, { ignored: `untracked resource ${typeId || '?'}` });
    if (note.notificationType === 'ResourceDeleted') return json(res, 200, { ignored: 'deletion' });
    const stage = await getClient('stage');
    const cfg = await getConfig(stage);
    if (!cfg.autoAddEnabled || !cfg.currentReleaseKey) return json(res, 200, { ignored: 'auto-add off or no current release' });
    // key: prefer the notification's provided identifiers, else fetch by id
    let key = note.resourceUserProvidedIdentifiers?.key;
    if (!key && note.resource?.id && ENDPOINT_BY_TYPEID[typeId]) { const o = await stage.get(`/${ENDPOINT_BY_TYPEID[typeId]}/${note.resource.id}`); key = o?.key || null; }
    if (!key) return json(res, 200, { ignored: 'no key on resource' });
    const { added, skipped } = await reg.addMembers(stage, cfg.currentReleaseKey, { [field]: [key] });
    console.log(`[events] ${note.notificationType} ${typeId} key=${key} → release ${cfg.currentReleaseKey}: ${skipped ? 'skipped ('+skipped+')' : JSON.stringify(added)}`);
    return json(res, 200, { release: cfg.currentReleaseKey, added, skipped: skipped || null });
  } catch (e) {
    console.error('[events] error', e);
    return json(res, 200, { error: String(e.message || e) }); // ack anyway
  }
});

// ---- branches (release-branch) ----
route('GET', /^\/branches$/, async (req, res, _m, q) => {
  const stage = await getClient(q.project || 'stage');
  json(res, 200, { branches: await reg.listBranches(stage) });
});
route('GET', /^\/branches\/([^/]+)$/, async (req, res, m, q) => {
  const stage = await getClient(q.project || 'stage');
  const br = await reg.getBranch(stage, decodeURIComponent(m[1]));
  if (!br) return json(res, 404, { error: 'not found' });
  json(res, 200, { branch: br });
});
route('POST', /^\/branches$/, async (req, res) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 201, { branch: await reg.createBranch(stage, b) });
});
route('POST', /^\/branches\/([^/]+)\/status$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, { branch: await reg.setBranchStatus(stage, decodeURIComponent(m[1]), b.status) });
});

// ---- branch asset ops (fork / save-version / restore / merge / close) ----
route('POST', /^\/branches\/([^/]+)\/fork$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, { result: await ops.forkAsset(stage, { branchId: decodeURIComponent(m[1]), canonicalKey: b.canonicalKey, resourceType: b.resourceType || 'product', withAttributes: !!b.withAttributes, dryRun: b.dryRun === true }) });
});
route('POST', /^\/branches\/([^/]+)\/assets\/([^/]+)\/save$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, { result: await ops.saveVersion(stage, { branchId: decodeURIComponent(m[1]), canonicalKey: decodeURIComponent(m[2]) }) });
});
route('POST', /^\/branches\/([^/]+)\/assets\/([^/]+)\/restore$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, { result: await ops.restoreVersion(stage, { branchId: decodeURIComponent(m[1]), canonicalKey: decodeURIComponent(m[2]), version: b.version, withAttributes: !!b.withAttributes }) });
});
route('GET', /^\/branches\/([^/]+)\/assets\/([^/]+)\/versions$/, async (req, res, m, q) => {
  const stage = await getClient(q.project || 'stage');
  json(res, 200, { versions: await reg.listVersions(stage, decodeURIComponent(m[2]), decodeURIComponent(m[1])) });
});
route('POST', /^\/branches\/([^/]+)\/merge-report$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.from || 'stage');
  const live = await getClient(b.to || 'live');
  json(res, 200, await ops.mergeReport(stage, live, { branchId: decodeURIComponent(m[1]), canonicalKeys: b.canonicalKeys }));
});
route('POST', /^\/branches\/([^/]+)\/close$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, await ops.closeBranch(stage, { branchId: decodeURIComponent(m[1]), status: b.status || 'abandoned', apply: b.apply === true }));
});

route('GET', /^\/releases$/, async (req, res, _m, q) => {
  const stage = await getClient(q.project || 'stage');
  json(res, 200, { releases: await reg.listReleases(stage) });
});

route('GET', /^\/releases\/([^/]+)$/, async (req, res, m, q) => {
  const stage = await getClient(q.project || 'stage');
  const rel = await reg.getRelease(stage, decodeURIComponent(m[1]));
  if (!rel) return json(res, 404, { error: 'not found' });
  json(res, 200, { release: rel });
});

route('POST', /^\/releases$/, async (req, res) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 201, { release: await reg.createRelease(stage, b) });
});

route('PUT', /^\/releases\/([^/]+)\/members$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  json(res, 200, { release: await reg.updateReleaseMembers(stage, decodeURIComponent(m[1]), b.members || {}, b.deletions) });
});

route('POST', /^\/releases\/([^/]+)\/status$/, async (req, res, m) => {
  const b = await readBody(req);
  const stage = await getClient(b.project || 'stage');
  const actor = await requireForStatus(stage, b.to, b.by);
  // admins may self-approve (approver === author); non-admins stay held to the
  // separation-of-duties gate inside reg.transition.
  json(res, 200, { release: await reg.transition(stage, decodeURIComponent(m[1]), b.to, { by: b.by, note: b.note, allowSelfApprove: actor.can.admin }) });
});

// publish-to-stage: publish the release's products on stage (modified → published)
// so they're testable on the staging storefront, then move to ready-for-review.
// The draft→ready-for-review transition below fires the "submitted" email to
// reviewers (see registry.transition → notify.mjs) — this is the author-submit
// notification, so it's not duplicated here.
route('POST', /^\/releases\/([^/]+)\/stage-publish$/, async (req, res, m) => {
  const b = await readBody(req);
  const key = decodeURIComponent(m[1]);
  const stage = await getClient('stage');
  await assertCan(stage, b.by, 'edit');
  const rel = await reg.getRelease(stage, key);
  if (!rel) return json(res, 404, { error: 'not found' });
  const publish = await publishReleaseProducts(stage, rel.members?.products || []);
  const release = await reg.transition(stage, key, 'ready-for-review', { by: b.by, note: b.note });
  json(res, 200, { publish, release });
});

route('POST', /^\/releases\/([^/]+)\/validate$/, async (req, res, m) => {
  const b = await readBody(req);
  const { bundle } = await bundleFor(b.from || 'stage', { releaseKey: decodeURIComponent(m[1]) });
  const target = await getClient(b.to || 'live');
  const unresolved = collectUnresolved(bundle);
  const missing = await validateAgainstTarget(target, bundle);
  json(res, 200, { counts: bundleCounts(bundle), unresolved, missing, deployable: unresolved.length === 0 && missing.length === 0 });
});

route('POST', /^\/releases\/([^/]+)\/diff$/, async (req, res, m) => {
  const b = await readBody(req);
  const { bundle, release } = await bundleFor(b.from || 'stage', { releaseKey: decodeURIComponent(m[1]) });
  const target = await getClient(b.to || 'live');
  const deletions = release ? reg.releaseDeletions(release) : [];
  const result = await deployBundle(target, bundle, { dryRun: true, deletions });
  const hash = reg.bundleHash(bundle);
  json(res, 200, { counts: bundleCounts(bundle), diff: result.order, summary: result.summary, hash, drift: release ? reg.driftState(release, hash) : null });
});

// MERGE TO MAIN — fold the release's branch working-copy edits onto the canonical
// trunk (stage), with field-level three-way conflict detection. Dry-run (apply:false,
// or omitted) returns the per-asset/-field report so the UI can preview + collect
// resolutions. apply:true writes the merged content onto the trunk (requires 'publish');
// if any conflict is unresolved it returns 409 with the conflict report instead.
//   body: { from?, apply?, by, resolutions?: { "<canonicalKey>:<field>": "ours"|"theirs" } }
route('POST', /^\/releases\/([^/]+)\/merge$/, async (req, res, m) => {
  const b = await readBody(req);
  const key = decodeURIComponent(m[1]);
  const stage = await getClient(b.from || 'stage');
  if (b.apply) await assertCan(stage, b.by, 'publish');
  const release = await reg.getRelease(stage, key);
  if (!release) return json(res, 404, { error: 'not found' });
  const branchId = release.branchId;
  if (!branchId || branchId === 'main') {
    // release targets the trunk directly — its members are already canonical, nothing to fold.
    return json(res, 200, { branchId: branchId || 'main', applied: !!b.apply, assets: [], conflicts: [], unresolved: [], merged: [], note: 'release targets main — nothing to merge' });
  }
  const result = await ops.mergeToMain(stage, { branchId, resolutions: b.resolutions || {}, apply: !!b.apply });
  if (b.apply && result.needsResolution) return json(res, 409, { error: 'merge-conflicts', ...result });
  json(res, 200, result);
});

route('POST', /^\/releases\/([^/]+)\/deploy$/, async (req, res, m) => {
  const b = await readBody(req);
  const key = decodeURIComponent(m[1]);
  // An IMMEDIATE UPDATE (skip review/approval, deploy straight to prod) is
  // admin-only; a normal ship-to-production needs the publish capability.
  if (b.apply) await assertCan(await getClient('stage'), b.by, b.immediate ? 'admin' : 'publish');
  // A deploy always reads the release's CANONICAL (trunk) product data — never its
  // branch working copy (see bundleFor/resolveSelection) — so any edit still sitting
  // unmerged on the release's branch would otherwise be silently dropped: a normal
  // ship requires an explicit prior "Merge to main", but the immediate fast-path skips
  // every other step, so it must fold the branch itself here or it'd ship stale trunk
  // content while still reporting success and marking the release published.
  if (b.immediate && b.apply && key) {
    const stageForMerge = await getClient(b.from || 'stage');
    const releaseForMerge = await reg.getRelease(stageForMerge, key);
    const branchId = releaseForMerge && releaseForMerge.branchId;
    if (branchId && branchId !== 'main') {
      const merge = await ops.mergeToMain(stageForMerge, { branchId, resolutions: b.resolutions || {}, apply: true });
      if (merge.needsResolution) return json(res, 409, { error: 'merge-conflicts', ...merge });
    }
  }
  const { bundle, release, src } = await bundleFor(b.from || 'stage', { releaseKey: key });
  const unresolved = collectUnresolved(bundle);
  if (unresolved.length) return json(res, 409, { error: 'unresolved-references', unresolved });
  const target = await getClient(b.to || 'live');
  const missing = await validateAgainstTarget(target, bundle);
  if (missing.length) return json(res, 409, { error: 'missing-references', missing });
  const apply = !!b.apply;
  const deletions = release ? reg.releaseDeletions(release) : [];
  // baseline the pre-deploy prod state (in the source/authoring project) so this
  // deploy can be rolled back later — see prod-history.mjs / undeploy.mjs.
  const result = await deployBundle(target, bundle, { dryRun: !apply, deletions, baseline: { stage: src } });
  const hash = reg.bundleHash(bundle);
  if (release) await reg.recordDeployment(src, key, { by: b.by, target: target.pk, apply, hash, summary: result.summary, ok: result.summary.error === 0, baselines: result.baselines, immediate: !!b.immediate });
  json(res, 200, { applied: apply, target: target.pk, summary: result.summary, diff: result.order, hash });
});

// undeploy / roll back: restore the release's last deploy from the __prod__ baselines
// (delete what the deploy created, revert what it updated). Requires 'publish'.
route('POST', /^\/releases\/([^/]+)\/undeploy$/, async (req, res, m) => {
  const b = await readBody(req);
  const key = decodeURIComponent(m[1]);
  const stage = await getClient(b.from || 'stage');
  if (b.apply) await assertCan(stage, b.by, 'publish');
  const release = await reg.getRelease(stage, key);
  if (!release) return json(res, 404, { error: 'not found' });
  const target = await getClient(b.to || 'live');
  const result = await undeployRelease(stage, target, release, { dryRun: !b.apply });
  if (b.apply) await reg.recordUndeploy(stage, key, { by: b.by, target: target.pk, apply: true, summary: result.deploy.summary, ok: result.deploy.summary.error === 0, baselines: result.deploy.baselines });
  json(res, 200, { applied: !!b.apply, plan: result.plan, target: target.pk, summary: result.deploy.summary, order: result.deploy.order });
});

// Immediate per-product publish/unpublish, straight to production (admin only).
// Takes a single product online/offline in BOTH the authoring (stage) and live
// projects at once — the "take a product offline quickly" fast-path that skips a
// release entirely. Matched by canonical key. Dry-run unless {apply:true}.
route('POST', /^\/products\/([^/]+)\/publish$/, async (req, res, m) => {
  const b = await readBody(req);
  const key = decodeURIComponent(m[1]);
  const stage = await getClient('stage');
  await assertCan(stage, b.by, 'admin');
  const published = !!b.published;
  const apply = !!b.apply;
  const errMsg = (r) => (r.body && (r.body.message || r.body.error)) || `HTTP ${r.status}`;
  const result = {};
  for (const [label, client] of [['stage', stage], ['live', await getClient('live')]]) {
    const prod = await client.byKey('products', key);
    if (!prod) { result[label] = { found: false }; continue; }
    const isPublished = !!prod.masterData?.published;
    if (isPublished === published) { result[label] = { found: true, changed: false, published }; continue; }
    if (!apply) { result[label] = { found: true, changed: true, dryRun: true, from: isPublished, to: published }; continue; }
    const r = await client.post(`/products/key=${encodeURIComponent(key)}`, {
      version: prod.version, actions: [{ action: published ? 'publish' : 'unpublish' }],
    });
    result[label] = r.ok ? { found: true, changed: true, published } : { found: true, error: errMsg(r), status: r.status };
  }
  const ok = Object.values(result).every((x) => !x.error);
  json(res, ok ? 200 : 502, { key, published, applied: apply, ok, result });
});

route('POST', /^\/deploy$/, async (req, res) => {
  const b = await readBody(req);
  if (b.apply) await assertCan(await getClient('stage'), b.by, 'publish');
  const { bundle, src } = await bundleFor(b.from || 'stage', { selection: b.selection || {}, branchId: b.branchId });
  const unresolved = collectUnresolved(bundle);
  if (unresolved.length) return json(res, 409, { error: 'unresolved-references', unresolved });
  const target = await getClient(b.to || 'live');
  const missing = await validateAgainstTarget(target, bundle);
  if (missing.length) return json(res, 409, { error: 'missing-references', missing });
  const deletions = b.deletions || [];
  const result = await deployBundle(target, bundle, { dryRun: !b.apply, deletions, baseline: b.apply ? { stage: src } : null });
  json(res, 200, { applied: !!b.apply, target: target.pk, summary: result.summary, diff: result.order });
});

// ---- access control (ACL on stage) ----
// caller's own roles + resolved capabilities — readable by any authenticated caller (UI gating)
route('GET', /^\/acl\/me$/, async (req, res, _m, q) => {
  const stage = await getClient('stage');
  json(res, 200, await resolveActor(stage, q.actor || ''));
});
route('GET', /^\/acl$/, async (req, res, _m, q) => {
  const stage = await getClient('stage');
  await assertCan(stage, q.actor || '', 'admin');
  json(res, 200, { acl: await listAcl(stage) }); // valid role names are enumerated client-side
});
route('POST', /^\/acl$/, async (req, res) => {
  const b = await readBody(req);
  const stage = await getClient('stage');
  await assertCan(stage, b.by || '', 'admin');
  json(res, 200, { entry: await setAcl(stage, { email: b.email, roles: b.roles, by: b.by }) });
});
route('DELETE', /^\/acl\/([^/]+)$/, async (req, res, m, q) => {
  const stage = await getClient('stage');
  await assertCan(stage, q.actor || '', 'admin');
  json(res, 200, await removeAcl(stage, decodeURIComponent(m[1])));
});

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://x`);
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  // auth (health + Pub/Sub push are open; /events does its own ?token= check)
  if (path !== '/health' && path !== '/events' && TOKEN) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: 'unauthorized' });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    try { return await r.handler(req, res, m, q); }
    catch (e) { return json(res, e.code || 500, { error: String(e.message || e) }); }
  }
  json(res, 404, { error: 'no route', path });
});
// Start listening. Pass 0 for an ephemeral port (tests read server.address().port).
export function startServer(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      console.log(`release-deploy listening on :${actual}${TOKEN ? '' : ' (DEV: no auth token set)'}`);
      resolve(server);
    });
  });
}
export { server };

// Auto-start only when run directly (`node server.mjs`); stay quiet when imported
// (e.g. by tests, which start it on an ephemeral port and close it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
