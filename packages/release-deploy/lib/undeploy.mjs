/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * undeploy.mjs — roll a release's last deploy back OFF production, using the
 * __prod__ baselines captured at deploy time (prod-history.mjs).
 *
 * For each asset the deploy touched, we restore the baseline version we snapshotted
 * just before applying:
 *   • baseline was a TOMBSTONE ({deleted:true}) → the deploy CREATED the asset → delete it.
 *   • baseline had CONTENT → the deploy UPDATED (or deleted) it → upsert that content back.
 *
 * The whole rollback is expressed as a normal deploy (a restore bundle + a deletion
 * list) and run through deployBundle — so it's the exact same, tested upsert/delete
 * machinery, and it snapshots a fresh baseline first (the rollback is itself a
 * reversible prod change, keeping the version history complete).
 */
import { deployBundle } from './deploy.mjs';
import { getProdVersion, parseLogicalId, BUNDLE_FIELDS } from './prod-history.mjs';

const FIELD_BY_TYPE = Object.fromEntries(BUNDLE_FIELDS.map(([t, f]) => [t, f]));
const emptyBundle = () => ({ discountGroups: [], categories: [], products: [], productDiscounts: [], cartDiscounts: [], discountCodes: [] });

/** The most recent applied+ok deployment that recorded baselines (skip prior undeploys). */
export function lastReversible(release) {
  return (release.deployments || []).find(
    (d) => d.apply && d.ok && d.kind !== 'undeploy' && d.baselines && Object.keys(d.baselines).length
  );
}

export async function undeployRelease(stage, target, release, { dryRun = true } = {}) {
  const last = lastReversible(release);
  if (!last) throw new Error('no applied deployment with recorded baselines to roll back (deploy it first, or it predates production versioning)');

  const restore = emptyBundle();
  const deletions = [];
  const plan = [];
  for (const [logicalId, info] of Object.entries(last.baselines)) {
    const { resourceType, key } = parseLogicalId(logicalId);
    const snap = await getProdVersion(stage, resourceType, key, info.version);
    if (!snap) { plan.push({ resourceType, key, action: 'error', error: `baseline v${info.version} missing` }); continue; }
    if (snap.content?.deleted) {
      deletions.push({ resourceType, key });
      plan.push({ resourceType, key, action: 'delete', reason: 'created-by-this-deploy' });
    } else {
      const field = FIELD_BY_TYPE[resourceType];
      if (!field) { plan.push({ resourceType, key, action: 'error', error: `untracked type "${resourceType}"` }); continue; }
      restore[field].push(snap.content);
      plan.push({ resourceType, key, action: 'restore', toVersion: info.version });
    }
  }

  // Run the rollback as a real deploy (baseline first so the rollback is itself tracked).
  const result = await deployBundle(target, restore, { dryRun, deletions, baseline: { stage } });
  return { fromDeployAt: last.at, plan, deploy: result };
}
