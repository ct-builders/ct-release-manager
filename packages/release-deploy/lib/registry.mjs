/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * registry.mjs — "releases" and their lifecycle, stored as CustomObjects in the
 * STAGE project (the authoring source of truth).
 *
 * A RELEASE groups products + promotions that deploy together, atomically, and
 * carries a lifecycle state + audit trail. Container `release-registry`, key = release
 * key. The MC app reads/writes these via the HTTP service.
 *
 * Lifecycle (content-approval workflow) — two publishes: to stage, then to prod:
 *
 *   draft ─publish-to-stage─▶ ready-for-review ─approve─▶ approved ─publish-to-prod─▶ published
 *     ▲                            │                         │                          │
 *     └──reject────────────────────┘                         │                          │
 *     └──send back─────────────────────────────────────────┬─┘                          │
 *     └──start revisions────────────────────────────────────────────────────────────────┘
 *
 * "publish to stage" (draft → ready-for-review) publishes every product in the
 * release on the STAGE project (modified → published) so it can be viewed and
 * tested on the staging storefront with its promotions — see stage-publish.mjs.
 * "publish to production" (approved → published) deploys the release stage → live;
 * a successful apply auto-advances approved → published (see recordDeployment).
 */
import { stableStringify } from './util.mjs';
import { MAIN_BRANCH } from './branch.mjs';
import { notifyTransition } from './notify.mjs';

// These literal strings are a wire contract. Every reader of the same
// commercetools project — this service, both Merchant Center apps, the CLI, the
// console — addresses CustomObjects by container name, so all of them have to
// agree. Changing one does not migrate the data under it; it orphans every
// release, branch and ACL row already stored there. If you need two independent
// pipelines, give them separate projects rather than separate container names.
//
// Migrating an older deployment that still uses the previous `az-*` names:
//   node bin/migrate-containers.mjs --project stage --dry-run
export const RELEASE_CONTAINER = 'release-registry';
// authoring-only containers for branch/version support (never deployed to production)
export const BRANCH_CONTAINER = 'release-branch'; // key = branchId
export const ASSET_HISTORY_CONTAINER = 'release-asset-history'; // key = <logicalId>__<branchId>__v<n>

export const STATUSES = ['draft', 'ready-for-review', 'approved', 'published', 'rolled-back'];
const TRANSITIONS = {
  draft: ['ready-for-review'],
  'ready-for-review': ['approved', 'draft'], // approve → approved · reject → draft
  approved: ['published', 'draft'], // published happens on successful deploy · draft = send back
  published: ['published', 'draft', 'rolled-back'], // re-deploy · start revisions · undeploy from prod
  'rolled-back': ['draft', 'published'], // start next revision · or re-deploy
};
export function canTransition(from, to) {
  return from === to || (TRANSITIONS[from] || []).includes(to);
}

const emptyMembers = () => ({ products: [], categories: [], cartDiscounts: [], productDiscounts: [], discountCodes: [], discountGroups: [] });

// commercetools change-subscription resourceTypeId → release member field
export const MEMBER_FIELD_BY_RESOURCE = {
  product: 'products',
  category: 'categories',
  'cart-discount': 'cartDiscounts',
  'product-discount': 'productDiscounts',
  'discount-code': 'discountCodes',
  'discount-group': 'discountGroups',
};
// inverse: member field → resourceType (for turning the deletions set into delete ops)
export const RESOURCE_BY_MEMBER_FIELD = Object.fromEntries(Object.entries(MEMBER_FIELD_BY_RESOURCE).map(([r, f]) => [f, r]));

function nowIso() {
  return new Date().toISOString();
}

// releases are CustomObjects; value holds everything.
export async function listReleases(stage) {
  const objs = await stage.all(`/custom-objects/${RELEASE_CONTAINER}`).catch(() => []);
  return objs.map((o) => o.value);
}
export async function getRelease(stage, key) {
  const o = await stage.get(`/custom-objects/${RELEASE_CONTAINER}/${encodeURIComponent(key)}`);
  return o && o.value ? o.value : null;
}
async function writeRelease(stage, release) {
  release.updatedAt = nowIso();
  const r = await stage.post('/custom-objects', { container: RELEASE_CONTAINER, key: release.key, value: release });
  if (!r.ok) throw new Error(`write release ${release.key} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.value;
}

export async function createRelease(stage, { key, title, description, author, members, branchId }) {
  const existing = await getRelease(stage, key);
  if (existing) throw new Error(`release "${key}" already exists`);
  return writeRelease(stage, {
    key, title: title || key, description: description || '',
    // a release TARGETS a branch; members stay canonical-key-based and are resolved
    // to the branch's HEADs at serialize time. Defaults to main (= existing behavior).
    branchId: branchId || MAIN_BRANCH,
    members: { ...emptyMembers(), ...(members || {}) },
    // assets this release should REMOVE from the target (same per-type shape as members)
    deletions: emptyMembers(),
    status: 'draft', author: author || 'unknown', approver: null,
    createdAt: nowIso(), updatedAt: nowIso(),
    deployments: [], lastDeployedHash: null, stageTestedHash: null,
  });
}

export async function updateReleaseMembers(stage, key, members, deletions) {
  const rel = await getRelease(stage, key);
  if (!rel) throw new Error(`release "${key}" not found`);
  rel.members = { ...emptyMembers(), ...members };
  if (deletions !== undefined) rel.deletions = { ...emptyMembers(), ...deletions };
  return writeRelease(stage, rel);
}

// the release's deletions as [{resourceType, key}] for the deploy engine.
export function releaseDeletions(rel) {
  const out = [];
  for (const [field, keys] of Object.entries(rel.deletions || {})) {
    const resourceType = RESOURCE_BY_MEMBER_FIELD[field];
    if (!resourceType) continue;
    for (const key of keys || []) if (key) out.push({ resourceType, key });
  }
  return out;
}

export async function transition(stage, key, to, { by, note, allowSelfApprove } = {}) {
  const rel = await getRelease(stage, key);
  if (!rel) throw new Error(`release "${key}" not found`);
  if (!STATUSES.includes(to)) throw new Error(`unknown status "${to}"`);
  if (!canTransition(rel.status, to)) throw new Error(`illegal transition ${rel.status} → ${to}`);
  const from = rel.status;
  const isReject = from === 'ready-for-review' && to === 'draft';
  if (isReject && !(note && String(note).trim())) throw new Error('a reject requires a note explaining why');
  if (to === 'approved') {
    // Separation of duties: the approver must differ from the author — EXCEPT for
    // admins (allowSelfApprove), who may self-approve. This matches the "admin → all"
    // RBAC: an admin can drive a release end-to-end solo, while authors/reviewers are
    // still held to the gate so the author → reviewer approval story stays meaningful.
    if (by && rel.author && by === rel.author && !allowSelfApprove) {
      throw new Error(`approver must differ from author (${rel.author})`);
    }
    rel.approver = by || rel.approver;
  }
  rel.status = to;
  (rel.history ||= []).push({ at: nowIso(), by: by || 'unknown', to, note: note || null });
  const saved = await writeRelease(stage, rel);
  // best-effort email notification — never throws, so a mail failure can't break
  // the transition. Only real state changes notify (no-op self-transitions don't).
  // "published" is intentionally NOT fired here: a real publish is a production
  // deploy, so it's fired from recordDeployment() instead.
  const event = (to === 'ready-for-review' && from === 'draft') ? 'submitted'
    : (to === 'approved' && from !== 'approved') ? 'approved'
    : isReject ? 'rejected'
    : null;
  if (event) await notifyTransition(stage, saved, { event, by, note });
  return saved;
}

// selection object for serializeBundle, derived from a release's members
export function releaseSelection(rel) {
  const m = rel.members || {};
  const nz = (a) => (a && a.length ? a : undefined);
  return { products: nz(m.products), categories: nz(m.categories), cartDiscounts: nz(m.cartDiscounts), productDiscounts: nz(m.productDiscounts), discountCodes: nz(m.discountCodes), discountGroups: nz(m.discountGroups) };
}

// add keys to a release's members (dedup). additions: { products:[k], categories:[k], ... }
// Only draft releases accept auto-adds — a released bundle shouldn't mutate underfoot.
export async function addMembers(stage, key, additions) {
  const rel = await getRelease(stage, key);
  if (!rel) throw new Error(`release "${key}" not found`);
  if (rel.status !== 'draft') return { release: rel, added: {}, skipped: `release is "${rel.status}", not draft` };
  rel.members = { ...emptyMembers(), ...rel.members };
  const added = {};
  for (const [field, keys] of Object.entries(additions || {})) {
    if (!Array.isArray(rel.members[field])) continue;
    const have = new Set(rel.members[field]);
    const fresh = (keys || []).filter((k) => k && !have.has(k));
    if (fresh.length) { rel.members[field].push(...fresh); added[field] = fresh; }
  }
  if (!Object.keys(added).length) return { release: rel, added: {} };
  const saved = await writeRelease(stage, rel);
  return { release: saved, added };
}

export function bundleHash(bundle) {
  // hash only the deployable content, not metadata/timestamps
  const { generatedAt, sourceProject, bundleKey, ...content } = bundle;
  return simpleHash(stableStringify(content));
}
function simpleHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function recordDeployment(stage, key, entry) {
  const rel = await getRelease(stage, key);
  if (!rel) throw new Error(`release "${key}" not found`);
  // `baselines` = { <logicalId>: {version, deleted} } captured pre-apply, so this
  // deployment can be rolled back later (undeploy.mjs). `kind` distinguishes a
  // forward deploy from a rollback in the audit trail.
  const record = { at: nowIso(), kind: 'deploy', by: entry.by || 'unknown', target: entry.target, apply: !!entry.apply, hash: entry.hash, summary: entry.summary, ok: !!entry.ok, baselines: entry.baselines || null, immediate: !!entry.immediate };
  (rel.deployments ||= []).unshift(record); // newest first
  rel.deployments = rel.deployments.slice(0, 50);
  let justPublished = false;
  if (entry.apply && entry.ok) {
    rel.lastDeployedHash = entry.hash;
    // Normally the release only advances to "published" from "approved" (the end of
    // the review workflow). An IMMEDIATE UPDATE (admin fast-path) skips review and
    // approval, so it advances to published from ANY prior status.
    const advance = rel.status === 'approved' || entry.immediate;
    if (advance && rel.status !== 'published') {
      rel.status = 'published';
      justPublished = true;
      const note = entry.immediate ? `immediate update by ${entry.by || 'admin'}` : 'auto on successful deploy';
      (rel.history ||= []).push({ at: nowIso(), by: entry.by || 'system', to: 'published', note });
    }
  }
  const saved = await writeRelease(stage, rel);
  // notify the author that their release went live (best-effort; never throws).
  // Gated on the approved→published advance so a re-deploy of an already-published
  // release doesn't re-email.
  if (justPublished) await notifyTransition(stage, saved, { event: 'published', by: entry.by });
  return saved;
}

// Record a rollback (undeploy) in the audit trail and move the release to rolled-back.
export async function recordUndeploy(stage, key, entry) {
  const rel = await getRelease(stage, key);
  if (!rel) throw new Error(`release "${key}" not found`);
  const record = { at: nowIso(), kind: 'undeploy', by: entry.by || 'unknown', target: entry.target, apply: !!entry.apply, summary: entry.summary, ok: !!entry.ok, baselines: entry.baselines || null };
  (rel.deployments ||= []).unshift(record);
  rel.deployments = rel.deployments.slice(0, 50);
  if (entry.apply && entry.ok && (rel.status === 'published' || rel.status === 'approved')) {
    rel.status = 'rolled-back';
    (rel.history ||= []).push({ at: nowIso(), by: entry.by || 'system', to: 'rolled-back', note: 'undeployed from production' });
  }
  return writeRelease(stage, rel);
}

// drift: has the release's stage content changed since the last live deploy?
export function driftState(rel, currentHash) {
  if (!rel.lastDeployedHash) return 'never-deployed';
  return rel.lastDeployedHash === currentHash ? 'in-sync' : 'drifted';
}

// ---------------------------------------------------------------------------
// Branches (release-branch) — a named line of divergence. `main`/trunk is implicit
// (unsuffixed, mirrors production); explicit branch objects track everything else.
// ---------------------------------------------------------------------------
export const BRANCH_STATUSES = ['open', 'frozen', 'merged', 'abandoned'];

export async function listBranches(stage) {
  const objs = await stage.all(`/custom-objects/${BRANCH_CONTAINER}`).catch(() => []);
  return objs.map((o) => o.value);
}
export async function getBranch(stage, branchId) {
  const o = await stage.get(`/custom-objects/${BRANCH_CONTAINER}/${encodeURIComponent(branchId)}`);
  return o && o.value ? o.value : null;
}
// Read the raw release-branch CustomObject envelope (incl. the optimistic-concurrency
// `version`), or null. mutateBranch pins its write to this version.
async function readBranchObject(stage, branchId) {
  const o = await stage.get(`/custom-objects/${BRANCH_CONTAINER}/${encodeURIComponent(branchId)}`);
  return o && o.value ? o : null;
}
// Blind create/overwrite of a branch object (no concurrency guard). Used only for
// CREATE (createBranch, which pre-checks existence); every mutation of an existing
// branch goes through mutateBranch so it can't clobber a concurrent writer.
async function writeBranch(stage, branch) {
  branch.updatedAt = nowIso();
  const r = await stage.post('/custom-objects', { container: BRANCH_CONTAINER, key: branch.branchId, value: branch });
  if (!r.ok) throw new Error(`write branch ${branch.branchId} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-modify-write a branch CustomObject under OPTIMISTIC CONCURRENCY.
 *
 * A branch's `assets` map is a single CustomObject that many forks mutate. Writing it
 * with a plain last-write-wins upsert let two concurrent forks race — each read the
 * object, added its own asset, and wrote back, so the second write silently dropped
 * the first's entry (leaving a HEAD live but unregistered). This reads the object with
 * its `version`, applies `mutate(branch)` in place, and writes pinned to that version;
 * on a 409 (a concurrent writer bumped it) it re-reads the latest and retries, so no
 * update is lost. `mutate` runs once per attempt and must be safe to re-run.
 */
export async function mutateBranch(stage, branchId, mutate, { retries = 8 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const o = await readBranchObject(stage, branchId);
    if (!o) throw new Error(`branch "${branchId}" not found`);
    const branch = o.value;
    mutate(branch);
    branch.updatedAt = nowIso();
    const r = await stage.post('/custom-objects', { container: BRANCH_CONTAINER, key: branchId, value: branch, version: o.version });
    if (r.ok) return r.body?.value ?? branch;
    if (r.status === 409 && attempt < retries) { await sleep(20 + attempt * 30); continue; }
    throw new Error(`write branch ${branchId} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}
export async function createBranch(stage, { branchId, title, baseBranch, author, forkedFromHash }) {
  if (branchId === MAIN_BRANCH) throw new Error('"main" is implicit and cannot be created as a branch');
  const existing = await getBranch(stage, branchId);
  if (existing) throw new Error(`branch "${branchId}" already exists`);
  return writeBranch(stage, {
    branchId, title: title || branchId, baseBranch: baseBranch || MAIN_BRANCH,
    status: 'open', author: author || 'unknown', forkedFromHash: forkedFromHash || null,
    // logicalId → { headKey, version } for each asset copied-on-write onto this branch
    assets: {}, createdAt: nowIso(), updatedAt: nowIso(),
  });
}
export async function setBranchStatus(stage, branchId, status) {
  if (!BRANCH_STATUSES.includes(status)) throw new Error(`unknown branch status "${status}"`);
  return mutateBranch(stage, branchId, (br) => { br.status = status; });
}
// record/merge a branch's HEAD state for a logical asset (headKey, version,
// forkedFromHash, …). Merges so callers can update just the fields they own, and
// runs under optimistic concurrency so concurrent forks never drop each other.
export async function setBranchAssetHead(stage, branchId, logicalId, entry) {
  return mutateBranch(stage, branchId, (br) => {
    (br.assets ||= {})[logicalId] = { ...(br.assets[logicalId] || {}), ...entry, updatedAt: nowIso() };
  });
}
export async function removeBranchAsset(stage, branchId, logicalId) {
  return mutateBranch(stage, branchId, (br) => { if (br.assets) delete br.assets[logicalId]; });
}
export async function deleteVersions(stage, logicalId, branchId) {
  const versions = await listVersions(stage, logicalId, branchId);
  let deleted = 0;
  for (const v of versions) {
    const r = await stage.del(`/custom-objects/${ASSET_HISTORY_CONTAINER}/${encodeURIComponent(`${logicalId}__${branchId}__v${v.version}`)}`);
    if (r.ok) deleted++;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Version history (release-asset-history) — immutable canonicalized snapshots. HEAD is
// a live CT resource; prior versions live here as JSON so the authoring DB stays
// bounded and production never sees them.
// ---------------------------------------------------------------------------
const historyKey = (logicalId, branchId, version) => `${logicalId}__${branchId}__v${version}`;

export async function putVersion(stage, { logicalId, branchId, version, content }) {
  const key = historyKey(logicalId, branchId, version);
  const value = { logicalId, branchId, version, at: nowIso(), content };
  const r = await stage.post('/custom-objects', { container: ASSET_HISTORY_CONTAINER, key, value });
  if (!r.ok) throw new Error(`write version ${key} failed: ${r.status}`);
  return r.body.value;
}
export async function getVersion(stage, logicalId, branchId, version) {
  const o = await stage.get(`/custom-objects/${ASSET_HISTORY_CONTAINER}/${encodeURIComponent(historyKey(logicalId, branchId, version))}`);
  return o && o.value ? o.value : null;
}
export async function listVersions(stage, logicalId, branchId) {
  const prefix = `${logicalId}__${branchId}__v`;
  const objs = await stage.all(`/custom-objects/${ASSET_HISTORY_CONTAINER}`).catch(() => []);
  return objs
    .map((o) => o.value)
    .filter((v) => v && v.logicalId === logicalId && v.branchId === branchId)
    .sort((a, b) => b.version - a.version); // newest first
}
