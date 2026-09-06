#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * migrate-containers.mjs — move this pipeline's CustomObjects out of their legacy
 * container names and into the current `release-*` ones.
 *
 * Only needed for a deployment that ran an earlier version of this service or of
 * the console. A fresh install writes the current names from the start and has
 * nothing to move.
 *
 *   node bin/migrate-containers.mjs --project stage              # dry run
 *   node bin/migrate-containers.mjs --project stage --apply      # copy across
 *   node bin/migrate-containers.mjs --project stage --apply --delete-old
 *
 * COPY FIRST, DELETE LATER, deliberately in two steps. The copy is safe to run
 * while the old code is still live, because it only adds objects under the new
 * names; nothing reads them yet. So the safe sequence is: copy → deploy the new
 * service and apps → confirm they see the data → come back and delete. Passing
 * --delete-old on the first run collapses that into one irreversible step, which
 * is exactly what you do not want if the deploy then fails.
 *
 * Idempotent. A key that already exists under the new name is left alone rather
 * than overwritten, so re-running after a partial failure resumes instead of
 * clobbering anything the new code has since written.
 */
import { ctClient } from '../lib/ct.mjs';

// Legacy → current. Every container this pipeline has ever owned is listed, so a
// deployment from any older revision migrates in one pass.
//
// `rm-acl` is the odd one out: it is not an older name of this service's own
// store but the console's separate copy of the same access list, from when the
// two shipped as separate repositories and each read its own container. They are
// one roster now, so an existing deployment's console roles have to be brought
// across or the service comes up with an empty ACL — which is fail-open, and
// therefore worse than an error.
const RENAMES = [
  ['az-release', 'release-registry'],
  ['az-branch', 'release-branch'],
  ['az-asset-history', 'release-asset-history'],
  ['az-acl', 'release-acl'],
  ['az-release-config', 'release-config'],
  ['rm-acl', 'release-acl'],
];

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const which = arg('project', 'stage');
const apply = argv.includes('--apply');
const deleteOld = argv.includes('--delete-old');

if (!['stage', 'live'].includes(which)) {
  console.error(`--project must be "stage" or "live" (got ${which})`);
  process.exit(2);
}
if (deleteOld && !apply) {
  console.error('--delete-old requires --apply');
  process.exit(2);
}

const ct = await ctClient(which);
console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — ${which} project ${ct.pk}\n`);

let totalCopied = 0, totalSkipped = 0, totalDeleted = 0, totalFailed = 0;

for (const [from, to] of RENAMES) {
  const objs = await ct.all(`/custom-objects/${from}`).catch(() => []);
  if (!objs.length) continue;

  let copied = 0, skipped = 0, deleted = 0, failed = 0;
  for (const o of objs) {
    // ct.get() parses the response body either way, so a 404 comes back as a
    // TRUTHY error object ({statusCode, message}). Presence has to be decided on
    // `value`, which only a real CustomObject carries — testing the object itself
    // would read every missing key as "already there" and migrate nothing.
    const existing = await ct.get(`/custom-objects/${to}/${encodeURIComponent(o.key)}`);
    const present = existing && existing.value !== undefined;

    if (present) {
      skipped++;
    } else {
      if (!apply) { copied++; continue; }
      // No `version` on the draft: this is a create, and passing a version from the
      // source object would be a concurrency assertion about the TARGET that happens
      // to be a different object entirely.
      const r = await ct.post('/custom-objects', { container: to, key: o.key, value: o.value });
      if (r && r.ok === false) {
        console.log(`    FAILED ${o.key} — ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
        failed++;
        continue;
      }
      copied++;
    }

    // Reached only once the object EXISTS under the new name — whether this run
    // copied it or a previous one did. That distinction is the whole point of the
    // recommended two-step workflow: the second invocation finds everything
    // "already present", so a delete nested inside the copy branch would silently
    // do nothing and leave the legacy container behind forever.
    if (deleteOld) {
      const d = await ct.del(`/custom-objects/${from}/${encodeURIComponent(o.key)}`);
      if (d && d.ok) { deleted++; }
      else {
        console.log(`    present under ${to} but FAILED TO DELETE ${from}/${o.key} — ${d?.status}`);
        failed++;
      }
    }
  }

  const bits = [`${copied} ${apply ? 'copied' : 'to copy'}`];
  if (skipped) bits.push(`${skipped} already present`);
  if (deleted) bits.push(`${deleted} old deleted`);
  if (failed) bits.push(`${failed} FAILED`);
  console.log(`  ${from.padEnd(20)} → ${to.padEnd(24)} ${objs.length} found · ${bits.join(' · ')}`);

  totalCopied += copied; totalSkipped += skipped; totalDeleted += deleted; totalFailed += failed;
}

if (!totalCopied && !totalSkipped) {
  console.log('  no legacy containers found — nothing to migrate\n');
  process.exit(0);
}

console.log(
  `\n  ${totalCopied} ${apply ? 'copied' : 'would copy'}` +
    `${totalSkipped ? `, ${totalSkipped} already present` : ''}` +
    `${totalDeleted ? `, ${totalDeleted} legacy objects deleted` : ''}` +
    `${totalFailed ? `, ${totalFailed} FAILED` : ''}`
);
if (apply && !deleteOld && totalCopied) {
  console.log(
    '  The legacy objects are still there. Deploy the new service and apps, confirm\n' +
      `  they read the data, then: node bin/migrate-containers.mjs --project ${which} --apply --delete-old`
  );
}
console.log('');
process.exit(totalFailed ? 1 : 0);
