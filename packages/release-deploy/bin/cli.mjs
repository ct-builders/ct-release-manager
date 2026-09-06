#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * cli.mjs — command-line entry for the deploy pipeline.
 *
 *   audit      [--project live|stage] [--no-prices]
 *   serialize  [--project live] <selection> [--out bundle.json]
 *   validate   [--from live] [--to live] <selection|--release k>
 *   deploy     [--from stage] [--to live] <selection|--release k> [--apply] [--by who]
 *   rebaseline [--from live] [--to stage] [--apply]   pull the WHOLE catalog src→tgt
 *   release    list|show|create|members|status ...   (see below)
 *
 * <selection>: --all-promotions | --cart-discounts a,b|* | --product-discounts * |
 *              --discount-codes * | --discount-groups * | --categories k1,*|* |
 *              --products k1,k2|*
 * --release <key> loads the release's members from the source project's registry.
 *
 * Ref-attribute id remap (for cross-project product clones — e.g. a fitmentList
 * key-value-document reference): --remap-ref-attrs <file.json|auto>. "auto" builds
 * the live-id→target-id map by matching CustomObject keys (needs a target, so
 * deploy/validate/rebaseline only); --ref-containers defaults to fitment-list,vehicle.
 */
import fs from 'fs';
import { ctClient } from '../lib/ct.mjs';
import { auditProject } from '../lib/key-audit.mjs';
import { serializeBundle, collectUnresolved } from '../lib/serialize.mjs';
import { validateAgainstTarget, deployBundle } from '../lib/deploy.mjs';
import * as reg from '../lib/registry.mjs';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const c = (k, s) => `${C[k]}${s}${C.reset}`;
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fb) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb; };
const has = (name) => argv.includes(name);
const list = (v) => (v === '*' ? '*' : v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

function flagSelection() {
  const all = has('--all-promotions');
  return {
    discountGroups: all ? '*' : list(flag('--discount-groups')),
    cartDiscounts: all ? '*' : list(flag('--cart-discounts')),
    productDiscounts: all ? '*' : list(flag('--product-discounts')),
    discountCodes: all ? '*' : list(flag('--discount-codes')),
    categories: list(flag('--categories')), // independent — categories are not "promotions"
    products: list(flag('--products')),
  };
}

// Resolve the selection: either from a named release (registry) or from flags.
async function resolveSelection(sourceClient) {
  const releaseKey = flag('--release');
  if (releaseKey) {
    const rel = await reg.getRelease(sourceClient, releaseKey);
    if (!rel) throw new Error(`release "${releaseKey}" not found in ${sourceClient.pk}`);
    return { selection: reg.releaseSelection(rel), release: rel };
  }
  return { selection: flagSelection(), release: null };
}

// Build a live-id → target-id map for key-value-document reference attributes by
// matching CustomObject keys between the two projects (read-only). Lets a product's
// fitmentList (and any other KVD ref attr) port across projects without dropping.
function refContainers() { return flag('--ref-containers', 'fitment-list,vehicle').split(',').map((s) => s.trim()).filter(Boolean); }
async function autoCoIdMap(src, tgt, containers) {
  const map = {};
  for (const container of containers) {
    const [ls, ss] = await Promise.all([src.allByCursor(`/custom-objects/${container}`, 500), tgt.allByCursor(`/custom-objects/${container}`, 500)]);
    const byKey = new Map(ss.map((o) => [o.key, o.id]));
    for (const o of ls) { const t = byKey.get(o.key); if (t) map[o.id] = t; }
  }
  return map;
}
// Resolve --remap-ref-attrs: a JSON file path, or "auto" (build from src+tgt by key).
async function resolveCoIdMap(src, tgt) {
  const v = flag('--remap-ref-attrs');
  if (!v) return undefined;
  if (v === 'auto') {
    if (!tgt) throw new Error('--remap-ref-attrs auto needs a target (use with deploy/validate/rebaseline)');
    const map = await autoCoIdMap(src, tgt, refContainers());
    console.log(c('dim', `ref-attr id map (auto): ${Object.keys(map).length} entries`));
    return map;
  }
  return JSON.parse(fs.readFileSync(v, 'utf8'));
}

async function buildBundle(sourceClient, selection, release = null, coIdMap = undefined) {
  console.log(c('dim', `serializing from ${sourceClient.pk}…`));
  // a loaded release's branch wins; else an explicit --branch flag; else main
  const branchId = release?.branchId || flag('--branch', null);
  if (branchId && branchId !== 'main') console.log(c('dim', `branch: ${branchId} → canonicalizing to clean keys`));
  const bundle = await serializeBundle(sourceClient, selection, { bundleKey: flag('--release', null), branchId, stripReferenceAttributes: has('--strip-ref-attrs'), coIdMap });
  bundle.generatedAt = new Date().toISOString();
  const counts = { discountGroups: bundle.discountGroups.length, categories: bundle.categories.length, products: bundle.products.length, productDiscounts: bundle.productDiscounts.length, cartDiscounts: bundle.cartDiscounts.length, discountCodes: bundle.discountCodes.length };
  console.log(c('bold', 'BUNDLE') + '  ' + (Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${k}:${c('cyan', v)}`).join('  ') || c('dim', 'empty')));
  return bundle;
}
function reportUnresolved(bundle) {
  const u = collectUnresolved(bundle);
  if (u.length) { console.log(c('yellow', `⚠ ${u.length} unresolved reference(s) in source:`)); u.slice(0, 15).forEach((x) => console.log(c('dim', `  ${x.resourceType} ${x.key} · ${x.kind} · ${x.sourceId}`))); }
  else console.log(c('green', '✓ all source references resolved to keys'));
  return u.length;
}

async function cmdAudit() {
  const client = await ctClient(flag('--project', 'live'));
  const r = await auditProject(client, { includePrices: !has('--no-prices') });
  console.log(`\n${c('bold', 'key audit')} — ${c('cyan', client.pk)}`);
  for (const row of r.resources) {
    const status = row.unavailable ? c('dim', 'unavailable') : row.missingKey ? c(row.required ? 'red' : 'yellow', `${row.missingKey} MISSING`) : c('green', row.total ? '✓' : 'empty');
    console.log(`  ${row.type.padEnd(20)} ${String(row.total).padStart(6)}  ${status}`);
  }
  if (r.embeddedPrices) console.log(`  embedded-prices: ${r.embeddedPrices.totalPrices} prices, ${c(r.embeddedPrices.pricesMissingKey ? 'yellow' : 'green', r.embeddedPrices.pricesMissingKey + ' missing')}`);
  console.log(r.summary.clean ? c('green', '\n✓ CLEAN\n') : c('yellow', `\n⚠ ${r.summary.totalMissing} missing across ${r.summary.typesWithGaps.join(', ')}\n`));
}

async function cmdSerialize() {
  const src = await ctClient(flag('--project', 'live'));
  const { selection, release } = await resolveSelection(src);
  const coIdMap = await resolveCoIdMap(src, null); // serialize has no target → file map only
  const bundle = await buildBundle(src, selection, release, coIdMap);
  reportUnresolved(bundle);
  const out = flag('--out');
  if (out) { fs.writeFileSync(out, JSON.stringify(bundle, null, 2)); console.log(c('dim', `\nwritten to ${out}\n`)); } else console.log('');
}

async function cmdValidate() {
  const src = await ctClient(flag('--from', 'live'));
  const target = await ctClient(flag('--to', 'live'));
  const { selection, release } = await resolveSelection(src);
  const coIdMap = await resolveCoIdMap(src, target);
  const bundle = await buildBundle(src, selection, release, coIdMap);
  reportUnresolved(bundle);
  const missing = await validateAgainstTarget(target, bundle);
  if (missing.length) { console.log(c('red', `\n✗ ${missing.length} reference(s) missing in target ${target.pk}:`)); missing.slice(0, 20).forEach((m) => console.log(c('dim', `  ${m.resource} ${m.key} · ${m.field} → ${m.typeId} "${m.key ?? ''}" (${m.reason})`))); }
  else console.log(c('green', `\n✓ all references present in target ${target.pk} — safe to deploy\n`));
}

async function cmdDeploy() {
  const apply = has('--apply');
  const by = flag('--by', 'cli');
  const src = await ctClient(flag('--from', 'live'));
  const target = await ctClient(flag('--to', 'live'));
  const { selection, release } = await resolveSelection(src);
  const coIdMap = await resolveCoIdMap(src, target);
  const bundle = await buildBundle(src, selection, release, coIdMap);
  if (reportUnresolved(bundle)) { console.log(c('red', '\nrefusing to deploy: unresolved source references\n')); process.exit(2); }
  const missing = await validateAgainstTarget(target, bundle);
  if (missing.length) { console.log(c('red', `\n✗ ${missing.length} refs missing in ${target.pk} — refusing to deploy:`)); missing.slice(0, 20).forEach((m) => console.log(c('dim', `  ${m.resource} ${m.key} · ${m.field} → ${m.typeId} "${m.key ?? ''}"`))); process.exit(2); }
  console.log(c('green', `✓ refs OK`) + c('dim', ` — ${apply ? c('yellow', 'APPLYING') : 'dry-run'} to ${target.pk}`));
  const res = await deployBundle(target, bundle, { dryRun: !apply });
  const s = res.summary;
  console.log(c('bold', '\nDEPLOY') + `  create:${c('cyan', s.create)}  update:${c('cyan', s.update)}  noop:${c('dim', s.noop)}  ${s.error ? c('red', 'error:' + s.error) : c('green', 'error:0')}`);
  for (const r of res.order) {
    if (r.action === 'noop') continue;
    const col = r.action === 'error' ? 'red' : r.action === 'create' ? 'green' : 'yellow';
    console.log(c(col, `  ${r.action.toUpperCase()}`) + ` ${r.type} ${r.key}` + (r.actions ? c('dim', ` [${r.actions.join(',')}]`) : '') + (r.error ? c('red', ` — ${r.error}`) : ''));
  }
  if (!res.order.some((r) => r.action !== 'noop')) console.log(c('green', '  (all resources already in sync — no changes)'));
  // record audit against the release (in the source/stage registry)
  if (release) {
    const hash = reg.bundleHash(bundle);
    await reg.recordDeployment(src, release.key, { by, target: target.pk, apply, hash, summary: s, ok: s.error === 0 });
    console.log(c('dim', `  recorded deployment on release "${release.key}" (hash ${hash})`));
  }
  console.log('');
}

// rebaseline: pull the WHOLE catalog source→target (default live→stage), auto-remapping
// product ref-attr ids. Resets the target's authoring baseline to match the source.
async function cmdRebaseline() {
  const apply = has('--apply');
  const src = await ctClient(flag('--from', 'live'));
  const target = await ctClient(flag('--to', 'stage'));
  console.log(`\n${c('bold', 're-baseline')} — ${c('cyan', src.pk)} → ${c('cyan', target.pk)}  ${apply ? c('yellow', 'APPLY') : c('green', 'dry-run')}`);
  const coIdMap = await autoCoIdMap(src, target, refContainers());
  console.log(c('dim', `ref-attr id map: ${Object.keys(coIdMap).length} entries (${refContainers().join(', ')})`));
  const selection = { products: '*', categories: '*', cartDiscounts: '*', productDiscounts: '*', discountCodes: '*', discountGroups: '*' };
  const bundle = await buildBundle(src, selection, null, coIdMap);
  if (reportUnresolved(bundle)) { console.log(c('red', '\nrefusing: unresolved source references\n')); process.exit(2); }
  const missing = await validateAgainstTarget(target, bundle);
  if (missing.length) { console.log(c('red', `\n✗ ${missing.length} refs missing in ${target.pk} — refusing:`)); missing.slice(0, 20).forEach((m) => console.log(c('dim', `  ${m.resource} ${m.key} · ${m.field}`))); process.exit(2); }
  console.log(c('green', '✓ refs OK') + c('dim', ` — ${apply ? c('yellow', 'APPLYING') : 'dry-run'} to ${target.pk}`));
  const res = await deployBundle(target, bundle, { dryRun: !apply });
  const s = res.summary;
  console.log(c('bold', '\nREBASELINE') + `  create:${c('cyan', s.create)}  update:${c('cyan', s.update)}  noop:${c('dim', s.noop)}  delete:${c('cyan', s.delete || 0)}  ${s.error ? c('red', 'error:' + s.error) : c('green', 'error:0')}`);
  for (const r of res.order) {
    if (r.action === 'noop') continue;
    const col = r.action === 'error' ? 'red' : r.action === 'create' ? 'green' : r.action === 'delete' ? 'red' : 'yellow';
    console.log(c(col, `  ${r.action.toUpperCase()}`) + ` ${r.type} ${r.key}` + (r.error ? c('red', ` — ${r.error}`) : ''));
  }
  if (!res.order.some((r) => r.action !== 'noop')) console.log(c('green', '  (target already matches source — no changes)'));
  console.log('');
}

// ---- release subcommands ----
async function cmdRelease() {
  const sub = argv[1];
  const stage = await ctClient(flag('--project', flag('--from', 'stage')));
  if (sub === 'list') {
    const rels = await reg.listReleases(stage);
    console.log(`\n${c('bold', 'releases')} — ${c('cyan', stage.pk)}`);
    if (!rels.length) console.log(c('dim', '  (none)'));
    for (const r of rels) console.log(`  ${c('cyan', r.key.padEnd(24))} ${statusBadge(r.status)}  ${c('dim', r.title || '')}`);
    console.log('');
  } else if (sub === 'show') {
    const r = await reg.getRelease(stage, argv[2]);
    if (!r) { console.log(c('red', `release "${argv[2]}" not found`)); process.exit(1); }
    console.log(`\n${c('bold', r.title)} ${c('dim', '(' + r.key + ')')}  ${statusBadge(r.status)}`);
    console.log(c('dim', `  author=${r.author} approver=${r.approver ?? '—'}  updated=${r.updatedAt}`));
    const m = r.members;
    for (const [k, v] of Object.entries(m)) if (v?.length) console.log(`  ${k}: ${c('cyan', v.join(', '))}`);
    if (r.deployments?.length) { console.log(c('bold', '  deployments:')); r.deployments.slice(0, 5).forEach((d) => console.log(c('dim', `    ${d.at} ${d.apply ? 'APPLY' : 'dry'} → ${d.target} ${d.ok ? '✓' : '✗'} (create:${d.summary.create} update:${d.summary.update})`))); }
    console.log('');
  } else if (sub === 'create') {
    const r = await reg.createRelease(stage, {
      key: flag('--key'), title: flag('--title'), description: flag('--description'), author: flag('--author', 'cli'),
      branchId: flag('--branch', null), members: flagSelection(),
    });
    console.log(c('green', `✓ created release "${r.key}" (${r.status})`) + (r.branchId !== 'main' ? c('dim', ` on branch ${r.branchId}`) : ''));
  } else if (sub === 'members') {
    const r = await reg.updateReleaseMembers(stage, flag('--key'), flagSelection());
    console.log(c('green', `✓ updated members of "${r.key}"`));
  } else if (sub === 'status') {
    // the CLI talks straight to commercetools as a local operator (it bypasses the
    // service's RBAC layer entirely), so it's inherently an admin context — allow
    // self-approve just like an admin going through the service.
    const r = await reg.transition(stage, flag('--key'), flag('--to'), { by: flag('--by', 'cli'), note: flag('--note'), allowSelfApprove: true });
    console.log(c('green', `✓ "${r.key}" → ${r.status}`) + (r.approver ? c('dim', ` (approver ${r.approver})`) : ''));
  } else if (sub === 'delete') {
    const v = await stage.get(`/custom-objects/${reg.RELEASE_CONTAINER}/${encodeURIComponent(flag('--key'))}`);
    const d = await stage.del(`/custom-objects/${reg.RELEASE_CONTAINER}/${encodeURIComponent(flag('--key'))}?version=${v.version}`);
    console.log(d.ok ? c('green', `✓ deleted release "${flag('--key')}"`) : c('red', `delete failed: ${d.status}`));
  } else {
    console.error('usage: cli.mjs release <list|show|create|members|status|delete> [flags]');
    process.exit(1);
  }
}
function statusBadge(s) {
  const col = { draft: 'dim', 'ready-for-review': 'yellow', approved: 'cyan', published: 'green', 'rolled-back': 'red' }[s] || 'dim';
  return c(col, `[${s}]`);
}

const commands = { audit: cmdAudit, serialize: cmdSerialize, validate: cmdValidate, deploy: cmdDeploy, rebaseline: cmdRebaseline, release: cmdRelease };
(async () => {
  if (!commands[cmd]) { console.error('usage: cli.mjs <audit|serialize|validate|deploy|rebaseline|release> [flags]'); process.exit(1); }
  await commands[cmd]();
})().catch((e) => { console.error(c('red', 'error: ') + (e?.stack || e)); process.exit(1); });
