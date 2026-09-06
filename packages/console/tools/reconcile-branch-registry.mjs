#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Audit (and optionally repair) the branch registry against the working-copy
 * resources that physically exist in the authoring project.
 *
 * WHY THIS EXISTS
 * Each release gets a private branch. The first edit of a resource forks a branch
 * copy: the encoded HEAD (`<canonical>__b__<branchId>`) is created in the authoring
 * project, a v0 snapshot is written to the asset-history container, and an entry is
 * recorded in the branch's own CustomObject
 * (`assets[<canonicalKey>] = { headKey, resourceType, … }`). Container names live in
 * tools/containers.mjs.
 *
 * The release service records that entry with a read-modify-write of the WHOLE branch
 * object and NO optimistic-concurrency guard, so two forks onto the same branch can
 * race and clobber one asset entry — leaving a HEAD live but UNREGISTERED (an
 * "orphan"). The service's fork is also a no-op once the HEAD exists, so it never
 * self-heals. An orphan is not cosmetic: `deploy` / `mergeReport` / `closeBranch` all
 * iterate `assets`, so an unregistered working copy is silently omitted from a release
 * deploy. (The product editor is separately hardened to probe for the physical HEAD —
 * see lib/product-edit.ts `workingCopyExists` — so editing itself no longer risks
 * writing to live; but the registry must still be reconciled for deploy correctness.)
 *
 * This tool is the reconcile: it treats the physical HEAD resources as the source of
 * truth and re-derives the registry to match.
 *
 *   node tools/reconcile-branch-registry.mjs           # READ-ONLY audit (default)
 *   node tools/reconcile-branch-registry.mjs --apply    # backfill missing asset entries
 *
 * Creds: process.env first, then CTP_* from this package's .env.local — the same
 * authoring client the app runs on, no admin file needed. Read-only unless --apply.
 */
import { readFileSync, existsSync } from "node:fs";
import { BRANCH_CONTAINER, ASSET_HISTORY_CONTAINER } from "./containers.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

// ---- creds: process.env, then packages/console/.env.local (CTP_* = authoring) ----
const ENV_LOCAL = resolve(__dirname, "../.env.local");
if (existsSync(ENV_LOCAL)) {
  for (const line of readFileSync(ENV_LOCAL, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const pk = process.env.CTP_PROJECT_KEY;
const clientId = process.env.CTP_CLIENT_ID;
const secret = process.env.CTP_CLIENT_SECRET;
const authUrl = (process.env.CTP_AUTH_URL || "").replace(/\/$/, "");
const apiUrl = (process.env.CTP_API_URL || "").replace(/\/$/, "");
if (!pk || !clientId || !secret || !authUrl || !apiUrl) {
  console.error("Missing CTP_* creds — set them in the environment or in packages/console/.env.local.");
  process.exit(2);
}

const KEY_DELIM = "__b__";
// resourceType -> query endpoint; the order also fixes the probe priority.
const ENDPOINT = {
  product: "products",
  category: "categories",
  "cart-discount": "cart-discounts",
  "product-discount": "product-discounts",
  "discount-code": "discount-codes",
  "discount-group": "discount-groups",
};
const HISTORY_CONTAINER = ASSET_HISTORY_CONTAINER;

const tokRes = await fetch(`${authUrl}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64") },
  body: `grant_type=client_credentials&scope=manage_project:${pk}`,
});
const tok = await tokRes.json();
if (!tok.access_token) { console.error("auth failed:", JSON.stringify(tok)); process.exit(2); }
const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };
const enc = encodeURIComponent;
const get = (p) => fetch(`${apiUrl}/${pk}${p}`, { headers: H }).then((r) => r.json());
async function all(path) {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await get(`${path}${sep}limit=200&offset=${offset}&withTotal=false`);
    if (!body || !Array.isArray(body.results)) throw new Error(`bad response for ${path}: ${JSON.stringify(body).slice(0, 200)}`);
    out.push(...body.results);
    if (body.results.length < 200) break;
  }
  return out;
}

// ---- gather actual state ----
const branchObjs = await all(`/custom-objects/${BRANCH_CONTAINER}`);
const branches = branchObjs.map((o) => o.value);
const history = (await all(`/custom-objects/${HISTORY_CONTAINER}`)).map((o) => o.value);
const latestVersion = (logicalId, branchId) =>
  history.filter((v) => v && v.logicalId === logicalId && v.branchId === branchId).reduce((mx, v) => Math.max(mx, v.version ?? 0), -1);

// every branch-encoded resource that physically exists, keyed by encoded headKey
const encodedResources = new Map(); // headKey -> { resourceType, canonicalKey, branchId }
for (const [resourceType, endpoint] of Object.entries(ENDPOINT)) {
  let items = [];
  try { items = await all(`/${endpoint}`); } catch { continue; }
  for (const it of items) {
    const k = typeof it.key === "string" ? it.key : null;
    if (!k || !k.includes(KEY_DELIM)) continue;
    const idx = k.indexOf(KEY_DELIM);
    encodedResources.set(k, { resourceType, canonicalKey: k.slice(0, idx), branchId: k.slice(idx + KEY_DELIM.length) });
  }
}

// registry: which headKeys are recorded
const registeredHeadKeys = new Set();
for (const b of branches) for (const a of Object.values(b.assets || {})) if (a.headKey) registeredHeadKeys.add(a.headKey);
const existingKeys = new Set(encodedResources.keys());

// orphans: physical HEAD exists but not in any branch's assets
const orphans = [];
for (const [headKey, meta] of encodedResources) {
  const br = branches.find((b) => b.branchId === meta.branchId);
  const entry = br?.assets?.[meta.canonicalKey];
  if (!entry || entry.headKey !== headKey) orphans.push({ headKey, ...meta, branchExists: !!br });
}
// dangling: registry points at a HEAD that no longer exists (any resource type)
const dangling = [];
for (const b of branches) for (const [logicalId, a] of Object.entries(b.assets || {})) {
  if (a.headKey && !existingKeys.has(a.headKey)) dangling.push({ branchId: b.branchId, logicalId, headKey: a.headKey });
}

// ---- report ----
console.log(`\n=== branch-registry reconcile · project ${pk} · ${APPLY ? "APPLY" : "audit (read-only)"} ===`);
console.log(`branches: ${branches.length} · branch-encoded resources: ${encodedResources.size} · registered headKeys: ${registeredHeadKeys.size}`);
console.log(`\norphans (physical HEAD exists, NOT registered): ${orphans.length}`);
for (const o of orphans) console.log(`  - ${o.headKey}  [${o.resourceType}]  branch=${o.branchId}${o.branchExists ? "" : "  *** branch object MISSING ***"}`);
console.log(`\ndangling (registered, HEAD resource missing): ${dangling.length}`);
for (const d of dangling) console.log(`  - branch=${d.branchId} ${d.logicalId} -> ${d.headKey}`);

if (!APPLY) {
  console.log(`\n${orphans.length === 0 && dangling.length === 0 ? "✅ registry is in sync — nothing to reconcile." : "Run with --apply to backfill orphan asset entries (dangling entries are reported only; deletion is left to an operator)."}`);
  process.exit(0);
}

// ---- --apply: backfill orphan asset entries ----
if (!orphans.length) { console.log("\n✅ no orphans to backfill."); process.exit(0); }
const applicable = orphans.filter((o) => o.branchExists);
const skipped = orphans.filter((o) => !o.branchExists);
for (const s of skipped) console.log(`\n⚠ skip ${s.headKey}: branch object "${s.branchId}" does not exist (create the branch first).`);

// group by branch so each branch object is written once (avoids the very race this fixes)
const byBranch = new Map();
for (const o of applicable) { if (!byBranch.has(o.branchId)) byBranch.set(o.branchId, []); byBranch.get(o.branchId).push(o); }

let repaired = 0;
for (const [branchId, items] of byBranch) {
  const co = await get(`/custom-objects/${BRANCH_CONTAINER}/${enc(branchId)}`);
  const branch = co?.value;
  if (!branch) { console.log(`\n⚠ branch "${branchId}" vanished mid-run — skipping.`); continue; }
  branch.assets ||= {};
  for (const o of items) {
    const v = latestVersion(o.canonicalKey, branchId);
    branch.assets[o.canonicalKey] = {
      headKey: o.headKey,
      version: v >= 0 ? v : 0,
      // forkedFromHash is unknown for a recovered orphan; null => deploy treats it as a
      // new (born-on-branch) asset, which is the safe conservative classification.
      forkedFromHash: null,
      resourceType: o.resourceType,
      updatedAt: new Date().toISOString(),
      reconciledBy: "reconcile-branch-registry",
    };
    console.log(`\n+ backfill ${branchId}.assets["${o.canonicalKey}"] -> headKey=${o.headKey} [${o.resourceType}] v=${v >= 0 ? v : 0}`);
    repaired++;
  }
  branch.updatedAt = new Date().toISOString();
  // pass the CustomObject version for optimistic concurrency on THIS write.
  const body = { container: BRANCH_CONTAINER, key: branchId, value: branch, ...(co.version ? { version: co.version } : {}) };
  const r = await fetch(`${apiUrl}/${pk}/custom-objects`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (r.status >= 300) { console.log(`  ✗ write failed for branch ${branchId}: ${r.status} ${(await r.text()).slice(0, 200)}`); process.exitCode = 1; }
  else console.log(`  ✓ wrote branch ${branchId} (${items.length} entr${items.length === 1 ? "y" : "ies"})`);
}
console.log(`\n✅ reconciled ${repaired} orphan(s)${skipped.length ? `, skipped ${skipped.length}` : ""}.`);
