#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * baseline-production.mjs — one-time bootstrap: snapshot every keyed PRODUCTION
 * asset as its __prod__ v1 baseline (prod-history.mjs). This gives every asset a
 * rollback floor even if no release has touched it yet — "baseline everything in
 * production and file it as the version." Idempotent: assets that already have a
 * __prod__ version are skipped, so it's safe to re-run.
 *
 * Snapshots are written to the STAGE (authoring) project, so production stays clean.
 *
 * Usage:
 *   node bin/baseline-production.mjs --apply                     # baseline all types
 *   node bin/baseline-production.mjs --types product,category --limit 50 --apply
 *   node bin/baseline-production.mjs                             # dry-run (counts only)
 * Flags: --types <csv>  --limit <n per type>  --to <live>  --history <stage>  --apply
 */
import { ctClient } from '../lib/ct.mjs';
import { RESOURCE_TYPES, endpointFor, snapshotProd, latestProdVersion } from '../lib/prod-history.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const apply = args.includes('--apply');
const types = opt('types', RESOURCE_TYPES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const limit = opt('limit') ? parseInt(opt('limit'), 10) : Infinity;

const live = await ctClient(opt('to', 'live'));
const stage = await ctClient(opt('history', 'stage'));
console.log(`Baseline production → live=${live.pk}  history=${stage.pk}  types=[${types.join(',')}]  limit=${limit === Infinity ? 'all' : limit}  ${apply ? 'APPLY' : '(dry-run — pass --apply to write)'}`);

let scanned = 0, snapped = 0, skipped = 0, errors = 0;
for (const rt of types) {
  const ep = endpointFor(rt);
  if (!ep) { console.log(`  ! unknown type "${rt}"`); continue; }
  const all = rt === 'product' ? await live.allByCursor(`/${ep}`, 200) : await live.all(`/${ep}`);
  let n = 0;
  for (const o of all) {
    if (!o.key || n >= limit) continue;
    n++; scanned++;
    try {
      if ((await latestProdVersion(stage, rt, o.key)) > 0) { skipped++; continue; }
      if (apply) await snapshotProd(stage, live, rt, o.key);
      snapped++;
    } catch (e) { errors++; console.log(`    ✗ ${rt} ${o.key}: ${e.message}`); }
  }
  console.log(`  ${rt}: scanned ${n} keyed`);
}
console.log(`Done. ${apply ? 'snapshotted' : 'would snapshot'} ${snapped}, skipped ${skipped} already-versioned, ${errors} error(s), of ${scanned} scanned.`);
