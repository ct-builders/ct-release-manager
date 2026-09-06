/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * key-audit.mjs — scan a commercetools project for resources missing a `key`
 * (and embedded Prices missing a `key`). Cross-project deploys match by key, so
 * anything without one cannot be ported. Shared by the CLI, service, and MC app.
 * (Mirror of the engine in reference-deployment-config; kept here so the service is self-contained.)
 */
export const KEYED_RESOURCES = [
  { type: 'cart-discounts', path: '/cart-discounts', group: 'promotion', label: byName },
  { type: 'product-discounts', path: '/product-discounts', group: 'promotion', label: byName },
  { type: 'discount-codes', path: '/discount-codes', group: 'promotion', label: (o) => o.code || byName(o), note: '`code` is a natural cross-project key even when `key` is unset' },
  { type: 'discount-groups', path: '/discount-groups', group: 'promotion', label: byName, required: true },
  { type: 'products', path: '/products', group: 'product', label: (o) => byName(o.masterData?.current) || o.key || o.id },
  { type: 'standalone-prices', path: '/standalone-prices', group: 'product', label: (o) => `${o.sku} ${money(o.value)}` },
  { type: 'categories', path: '/categories', group: 'reference', label: byName },
  { type: 'customer-groups', path: '/customer-groups', group: 'reference', label: (o) => o.name || o.id },
  { type: 'channels', path: '/channels', group: 'reference', label: (o) => byName(o) || o.id },
  { type: 'stores', path: '/stores', group: 'reference', label: byName, required: true },
  { type: 'product-selections', path: '/product-selections', group: 'reference', label: byName },
  { type: 'product-types', path: '/product-types', group: 'reference', label: (o) => o.name || o.id, required: true },
  { type: 'types', path: '/types', group: 'reference', label: (o) => o.name || o.id, required: true },
  { type: 'tax-categories', path: '/tax-categories', group: 'reference', label: (o) => o.name || o.id },
  { type: 'shipping-methods', path: '/shipping-methods', group: 'reference', label: (o) => o.name || o.id },
  { type: 'states', path: '/states', group: 'reference', label: (o) => o.key || o.id, required: true },
  { type: 'zones', path: '/zones', group: 'reference', label: (o) => o.name || o.id },
];

const LANGS = ['en-US', 'en', 'es-MX', 'pt-BR'];
function byName(o) {
  const n = o?.name;
  if (!n) return undefined;
  if (typeof n === 'string') return n;
  for (const l of LANGS) if (n[l]) return n[l];
  return Object.values(n)[0];
}
function money(v) {
  if (!v) return '';
  const amt = (v.centAmount ?? 0) / 10 ** (v.fractionDigits ?? 2);
  return `${amt.toFixed(v.fractionDigits ?? 2)} ${v.currencyCode || ''}`.trim();
}

async function eachPage(client, path, onPage, pageSize = 500) {
  let offset = 0, total = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await client.get(`${path}${sep}limit=${pageSize}&offset=${offset}&withTotal=false`);
    if (!body || !Array.isArray(body.results)) return { ok: false, total, error: body?.message || `unexpected response for ${path}` };
    onPage(body.results);
    total += body.results.length;
    if (body.results.length < pageSize) break;
    offset += pageSize;
    if (offset > 20000) break;
  }
  return { ok: true, total };
}

async function auditResource(client, spec, sampleLimit) {
  const res = { type: spec.type, group: spec.group, path: spec.path, required: !!spec.required, total: 0, withKey: 0, missingKey: 0, samples: [] };
  if (spec.note) res.note = spec.note;
  const r = await eachPage(client, spec.path, (results) => {
    for (const o of results) {
      res.total += 1;
      if (o.key) res.withKey += 1;
      else { res.missingKey += 1; if (res.samples.length < sampleLimit) res.samples.push({ id: o.id, label: spec.label(o) }); }
    }
  });
  if (!r.ok) { res.unavailable = true; res.error = r.error; }
  return res;
}

async function auditEmbeddedPrices(client, sampleLimit) {
  const res = { productsScanned: 0, variantsScanned: 0, totalPrices: 0, pricesMissingKey: 0, productsWithGaps: 0, samples: [] };
  const r = await eachPage(client, '/products', (results) => {
    for (const p of results) {
      res.productsScanned += 1;
      const current = p.masterData?.current;
      if (!current) continue;
      const variants = [current.masterVariant, ...(current.variants || [])].filter(Boolean);
      let gap = false;
      for (const v of variants) {
        res.variantsScanned += 1;
        for (const price of v.prices || []) {
          res.totalPrices += 1;
          if (!price.key) {
            res.pricesMissingKey += 1; gap = true;
            if (res.samples.length < sampleLimit) res.samples.push({ product: byName(current) || p.key || p.id, sku: v.sku, priceId: price.id, value: money(price.value) });
          }
        }
      }
      if (gap) res.productsWithGaps += 1;
    }
  }, 200);
  if (!r.ok) { res.unavailable = true; res.error = r.error; }
  return res;
}

export async function auditProject(client, opts = {}) {
  const { types, sampleLimit = 25, includePrices = true } = opts;
  const specs = types ? KEYED_RESOURCES.filter((s) => types.includes(s.type)) : KEYED_RESOURCES;
  const resources = [];
  for (const spec of specs) resources.push(await auditResource(client, spec, sampleLimit));
  const embeddedPrices = includePrices ? await auditEmbeddedPrices(client, sampleLimit) : null;
  const totalMissing = resources.reduce((n, r) => n + (r.missingKey || 0), 0) + (embeddedPrices?.pricesMissingKey || 0);
  const typesWithGaps = resources.filter((r) => r.missingKey > 0).map((r) => r.type);
  if (embeddedPrices?.pricesMissingKey > 0) typesWithGaps.push('embedded-prices');
  return { project: client.pk, resources, embeddedPrices, summary: { totalMissing, typesWithGaps, clean: totalMissing === 0 } };
}
