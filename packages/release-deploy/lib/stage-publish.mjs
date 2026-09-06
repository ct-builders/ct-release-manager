/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * stage-publish.mjs — publish a release's products on the STAGE project.
 *
 * Authors edit products as staged changes ("modified"). To review a release on
 * the staging storefront, its products must be published (staged → current) so
 * the storefront's published projection shows them. This runs the commercetools
 * `publish` action on every product in the release that has staged changes /
 * isn't published yet. Promotions (cart/product discounts, codes) are active on
 * stage without a publish step, so they already apply.
 *
 * Idempotent: products with no staged changes are skipped (already-published).
 */
export async function publishReleaseProducts(client, productKeys = []) {
  const summary = { total: productKeys.length, published: 0, alreadyPublished: 0, notFound: 0, error: 0 };
  const details = [];
  for (const key of productKeys) {
    const p = await client.byKey('products', key);
    if (!p) { summary.notFound++; details.push({ key, result: 'not-found' }); continue; }
    const md = p.masterData || {};
    if (md.published && !md.hasStagedChanges) { summary.alreadyPublished++; details.push({ key, result: 'already-published' }); continue; }
    const r = await client.post(`/products/key=${encodeURIComponent(key)}`, { version: p.version, actions: [{ action: 'publish' }] });
    if (r.ok) { summary.published++; details.push({ key, result: 'published' }); }
    else { summary.error++; details.push({ key, result: 'error', error: JSON.stringify(r.body).slice(0, 200) }); }
  }
  return { summary, details };
}
