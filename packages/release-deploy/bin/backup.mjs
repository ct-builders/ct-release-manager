#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * backup.mjs — full export of a commercetools project's entities + configuration.
 *
 * Pages every queryable resource endpoint and the project settings into
 * timestamped JSON files, plus a manifest with per-entity counts. Endpoints that
 * error (feature off, missing scope) are recorded as skipped, not fatal.
 *
 *   node bin/backup.mjs [--project live] [--out <dir>]
 *
 * Default output dir: ../../backups/<project>-<UTC timestamp>/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ctClient } from '../lib/ct.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const c = (k, s) => `${C[k]}${s}${C.reset}`;
const flag = (n, fb) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; };

// Every queryable collection worth capturing. `pageSize` smaller for heavy ones.
const ENTITIES = [
  { name: 'product-types', path: '/product-types' },
  { name: 'types', path: '/types' },
  { name: 'categories', path: '/categories' },
  { name: 'channels', path: '/channels' },
  { name: 'stores', path: '/stores' },
  { name: 'customer-groups', path: '/customer-groups' },
  { name: 'tax-categories', path: '/tax-categories' },
  { name: 'zones', path: '/zones' },
  { name: 'shipping-methods', path: '/shipping-methods' },
  { name: 'states', path: '/states' },
  { name: 'attribute-groups', path: '/attribute-groups' },
  { name: 'product-selections', path: '/product-selections' },
  { name: 'products', path: '/products', pageSize: 100, cursor: true },
  { name: 'standalone-prices', path: '/standalone-prices', pageSize: 500, cursor: true },
  { name: 'cart-discounts', path: '/cart-discounts' },
  { name: 'product-discounts', path: '/product-discounts' },
  { name: 'discount-codes', path: '/discount-codes' },
  { name: 'discount-groups', path: '/discount-groups' },
  { name: 'customers', path: '/customers' },
  { name: 'customer-groups', path: '/customer-groups' },
  { name: 'inventory', path: '/inventory', pageSize: 500, cursor: true },
  { name: 'orders', path: '/orders', pageSize: 100, cursor: true },
  { name: 'carts', path: '/carts', pageSize: 100, cursor: true },
  { name: 'quotes', path: '/quotes' },
  { name: 'quote-requests', path: '/quote-requests' },
  { name: 'staged-quotes', path: '/staged-quotes' },
  { name: 'shopping-lists', path: '/shopping-lists' },
  { name: 'reviews', path: '/reviews' },
  { name: 'payments', path: '/payments' },
  { name: 'business-units', path: '/business-units' },
  { name: 'associate-roles', path: '/associate-roles' },
  { name: 'extensions', path: '/extensions' },
  { name: 'subscriptions', path: '/subscriptions' },
  { name: 'custom-objects', path: '/custom-objects', pageSize: 500, cursor: true },
  { name: 'api-clients', path: '/api-clients' },
];

async function main() {
  const which = flag('--project', 'live');
  const client = await ctClient(which);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = flag('--out', path.resolve(HERE, '..', '..', '..', 'backups', `${client.pk}-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n${c('bold', 'commercetools backup')} — project ${c('cyan', client.pk)}`);
  console.log(c('dim', `→ ${outDir}\n`));

  const manifest = { project: client.pk, api: client.api, generatedAt: new Date().toISOString(), entities: {}, config: {}, errors: {} };

  // 1) Project settings (GET /{projectKey})
  try {
    const project = await client.get('');
    fs.writeFileSync(path.join(outDir, 'project.json'), JSON.stringify(project, null, 2));
    manifest.config.project = { languages: project.languages, currencies: project.currencies, countries: project.countries };
    console.log(`  ${'project (settings)'.padEnd(22)} ${c('green', '✓')}`);
  } catch (e) {
    manifest.errors.project = String(e.message || e);
    console.log(`  ${'project (settings)'.padEnd(22)} ${c('red', 'FAILED')}`);
  }

  // 2) Each collection
  const seen = new Set();
  for (const ent of ENTITIES) {
    if (seen.has(ent.name)) continue; // dedupe (customer-groups listed twice defensively)
    seen.add(ent.name);
    try {
      const results = ent.cursor ? await client.allByCursor(ent.path, ent.pageSize || 500) : await client.all(ent.path, ent.pageSize || 500);
      fs.writeFileSync(path.join(outDir, `${ent.name}.json`), JSON.stringify(results, null, 2));
      manifest.entities[ent.name] = results.length;
      console.log(`  ${ent.name.padEnd(22)} ${String(results.length).padStart(6)}  ${c('green', '✓')}`);
    } catch (e) {
      manifest.errors[ent.name] = String(e.message || e).slice(0, 200);
      console.log(`  ${ent.name.padEnd(22)} ${''.padStart(6)}  ${c('yellow', 'skipped')} ${c('dim', '(' + String(e.message || e).slice(0, 60) + ')')}`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const totalEntities = Object.values(manifest.entities).reduce((a, b) => a + b, 0);
  const nErr = Object.keys(manifest.errors).length;
  console.log(`\n${c('green', '✓ backup complete')} — ${Object.keys(manifest.entities).length} collections, ${totalEntities} objects` + (nErr ? c('yellow', `, ${nErr} skipped`) : ''));
  console.log(c('dim', `manifest: ${path.join(outDir, 'manifest.json')}\n`));
}

main().catch((e) => { console.error(c('red', 'backup failed: ') + (e?.stack || e)); process.exit(1); });
