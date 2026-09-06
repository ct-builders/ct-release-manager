#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * clone-custom-objects.mjs — clone whole CustomObject containers source→target,
 * preserving container+key, and emit a live-id → target-id map (needed to remap
 * product reference attributes that point at key-value-documents by id).
 *
 *   node bin/clone-custom-objects.mjs --from live --to stage \
 *        --containers vehicle,fitment-list,resiliency-config --apply --map co-id-map.json
 *
 * Custom objects upsert by (container,key), so re-runs are idempotent and the id
 * is stable. Values port as-is (reference-deployment fitment-lists reference vehicles by KEY).
 */
import fs from 'fs';
import { ctClient } from '../lib/ct.mjs';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const c = (k, s) => `${C[k]}${s}${C.reset}`;
const flag = (n, fb) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; };
const APPLY = process.argv.includes('--apply');

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

async function main() {
  const src = await ctClient(flag('--from', 'live'));
  const tgt = await ctClient(flag('--to', 'stage'));
  const containers = (flag('--containers', 'vehicle,fitment-list,resiliency-config')).split(',').map((s) => s.trim()).filter(Boolean);
  const mapPath = flag('--map', 'co-id-map.json');
  const conc = parseInt(flag('--concurrency', '12'), 10);
  console.log(`\n${c('bold', 'clone custom objects')} — ${c('cyan', src.pk)} → ${c('cyan', tgt.pk)} — ${APPLY ? c('yellow', 'APPLY') : c('green', 'dry-run')}`);
  if (src.pk === tgt.pk) console.log(c('yellow', '  (same project)'));

  const idMap = {}; // liveId → targetId
  const totals = { created: 0, error: 0 };
  for (const container of containers) {
    const items = await src.allByCursor(`/custom-objects/${container}`);
    let created = 0, error = 0, done = 0;
    await pool(items, conc, async (o) => {
      if (APPLY) {
        const r = await tgt.post('/custom-objects', { container: o.container, key: o.key, value: o.value });
        if (r.ok) { idMap[o.id] = r.body.id; created++; }
        else { error++; if (error <= 3) console.log(c('red', `    ✗ ${container}/${o.key}: ${r.status} ${(r.body?.message || '').slice(0, 80)}`)); }
      } else { created++; }
      if (++done % 2000 === 0) console.log(c('dim', `    …${done}/${items.length} ${container}`));
    });
    totals.created += created; totals.error += error;
    console.log(`  ${container.padEnd(20)} ${String(items.length).padStart(6)} · ${c('green', created + (APPLY ? ' created' : ' to create'))}${error ? ' · ' + c('red', error + ' error') : ''}`);
  }

  if (APPLY) { fs.writeFileSync(mapPath, JSON.stringify(idMap, null, 0)); console.log(c('dim', `\n  id map (${Object.keys(idMap).length} entries) → ${mapPath}`)); }
  console.log(`\n${totals.error ? c('yellow', '⚠') : c('green', '✓')} ${APPLY ? 'created' : 'would create'} ${totals.created}${totals.error ? `, ${totals.error} errors` : ''}\n`);
}
main().catch((e) => { console.error(c('red', 'failed: ') + (e?.stack || e)); process.exit(1); });
