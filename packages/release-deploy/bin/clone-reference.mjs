#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * clone-reference.mjs — seed a target project's REFERENCE LAYER from a source
 * project, by key, in dependency order. This is the prerequisite for deploying
 * products + promotions: the stage project needs the same product types,
 * categories, channels, stores, tax categories, states, etc. (key-identical)
 * before a release can validate against it.
 *
 *   node bin/clone-reference.mjs --from live --to stage [--apply]
 *
 * Create-if-absent by key (never overwrites). Dry-run unless --apply. Products
 * and standalone prices are NOT cloned here — deploy the catalog with the normal
 * pipeline (`deploy --products '*'`) once the reference layer exists.
 *
 * NOTE: verified live→live (everything already present → all "exists"). The
 * create path runs for real only against a fresh stage project — validate there.
 */
import { ctClient } from '../lib/ct.mjs';
import { keyForId } from '../lib/serialize.mjs';
import { stripVolatile } from '../lib/util.mjs';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const c = (k, s) => `${C[k]}${s}${C.reset}`;
const flag = (n, fb) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; };
const APPLY = process.argv.includes('--apply');
const keyRef = async (src, typeId, ref) => (ref ? { typeId, key: ref.key || (await keyForId(src, typeId, ref.id)) } : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
// convert a CustomFields object's type reference from (live) id → key so it resolves in the target
const customWithKey = async (src, custom) => {
  if (!custom?.type) return undefined;
  const typeKey = custom.type.key || (custom.type.id ? await keyForId(src, 'type', custom.type.id) : null);
  if (!typeKey) return undefined;
  return { type: { typeId: 'type', key: typeKey }, fields: custom.fields || {} };
};

// each: endpoint, fetch list, toDraft(src, obj) → draft. Ordered by dependency.
const STEPS = [
  { type: 'types', ep: 'types', draft: (s, o) => clean({ key: o.key, name: o.name, description: o.description, resourceTypeIds: o.resourceTypeIds, fieldDefinitions: o.fieldDefinitions }) },
  { type: 'product-types', ep: 'product-types', draft: (s, o) => clean({ key: o.key, name: o.name, description: o.description, attributes: o.attributes }) },
  { type: 'tax-categories', ep: 'tax-categories', draft: (s, o) => clean({ key: o.key, name: o.name, description: o.description, rates: (o.rates || []).map((r) => clean({ name: r.name, amount: r.amount, includedInPrice: r.includedInPrice, country: r.country, state: r.state, subRates: r.subRates })) }) },
  { type: 'zones', ep: 'zones', draft: (s, o) => clean({ key: o.key, name: o.name, description: o.description, locations: o.locations }) },
  { type: 'customer-groups', ep: 'customer-groups', draft: (s, o) => clean({ key: o.key, groupName: o.name, custom: o.custom }) },
  {
    type: 'channels', ep: 'channels',
    draft: async (s, o) => clean({ key: o.key, roles: o.roles, name: o.name, description: o.description, address: o.address, geoLocation: o.geoLocation, custom: await customWithKey(s, o.custom) }),
  },
  {
    type: 'shipping-methods', ep: 'shipping-methods',
    draft: async (s, o) => clean({
      key: o.key, name: o.name, localizedName: o.localizedName, description: o.description, localizedDescription: o.localizedDescription,
      taxCategory: await keyRef(s, 'tax-category', o.taxCategory), isDefault: o.isDefault, predicate: o.predicate,
      zoneRates: await Promise.all((o.zoneRates || []).map(async (zr) => ({ zone: await keyRef(s, 'zone', zr.zone), shippingRates: zr.shippingRates }))),
    }),
  },
  {
    type: 'categories', ep: 'categories', orderByAncestors: true,
    draft: async (s, o) => clean({ key: o.key, name: o.name, slug: o.slug, description: o.description, parent: await keyRef(s, 'category', o.parent), orderHint: o.orderHint, metaTitle: o.metaTitle, metaDescription: o.metaDescription, metaKeywords: o.metaKeywords, custom: await customWithKey(s, o.custom), assets: o.assets }),
  },
  { type: 'product-selections', ep: 'product-selections', draft: (s, o) => clean({ key: o.key, name: o.name, mode: o.mode }) },
  {
    type: 'stores', ep: 'stores',
    draft: async (s, o) => clean({
      key: o.key, name: o.name, languages: o.languages, countries: o.countries,
      distributionChannels: await Promise.all((o.distributionChannels || []).map((ch) => keyRef(s, 'channel', ch))),
      supplyChannels: await Promise.all((o.supplyChannels || []).map((ch) => keyRef(s, 'channel', ch))),
      productSelections: await Promise.all((o.productSelections || []).map(async (ps) => clean({ productSelection: await keyRef(s, 'product-selection', ps.productSelection), active: ps.active }))),
      custom: await customWithKey(s, o.custom),
    }),
  },
];

async function cloneStep(src, target, step, report) {
  let items = await src.all(`/${step.ep}`);
  if (step.orderByAncestors) items = items.slice().sort((a, b) => (a.ancestors?.length || 0) - (b.ancestors?.length || 0));
  const r = { type: step.type, total: items.length, created: 0, exists: 0, error: 0, errors: [] };
  for (const o of items) {
    if (!o.key) { r.error++; r.errors.push(`${step.type} ${o.id} has no key`); continue; }
    const existing = await target.byKey(step.ep, o.key);
    if (existing) { r.exists++; continue; }
    if (!APPLY) { r.created++; continue; } // would create
    const draft = await step.draft(src, o);
    const res = await target.post(`/${step.ep}`, draft);
    if (res.ok) r.created++;
    else { r.error++; r.errors.push(`${o.key}: ${res.status} ${res.body?.message || JSON.stringify(res.body?.errors || res.body).slice(0, 160)}`); }
  }
  report.push(r);
  const verb = APPLY ? 'created' : 'to create';
  console.log(`  ${step.type.padEnd(20)} ${String(r.total).padStart(5)} total · ${c('green', r.created + ' ' + verb)} · ${c('dim', r.exists + ' exists')}${r.error ? ' · ' + c('red', r.error + ' error') : ''}`);
  r.errors.slice(0, 4).forEach((e) => console.log(c('dim', `      ${e}`)));
}

// states need a two-phase pass: create all, then wire transitions by key.
async function cloneStates(src, target, report) {
  const states = await src.all('/states');
  const r = { type: 'states', total: states.length, created: 0, exists: 0, error: 0, errors: [], transitions: 0 };
  for (const st of states) {
    if (!st.key) { r.error++; continue; }
    const existing = await target.byKey('states', st.key);
    if (existing) { r.exists++; continue; }
    if (!APPLY) { r.created++; continue; }
    const res = await target.post('/states', clean({ key: st.key, type: st.type, name: st.name, description: st.description, initial: st.initial, roles: st.roles }));
    if (res.ok) r.created++; else { r.error++; r.errors.push(`${st.key}: ${res.status} ${res.body?.message || ''}`); }
  }
  // phase 2: transitions (key refs)
  if (APPLY) {
    for (const st of states) {
      if (!st.transitions?.length) continue;
      const cur = await target.byKey('states', st.key);
      if (!cur) continue;
      const transitions = [];
      for (const t of st.transitions) { const k = t.key || (await keyForId(src, 'state', t.id)); if (k) transitions.push({ typeId: 'state', key: k }); }
      const res = await target.post(`/states/key=${encodeURIComponent(st.key)}`, { version: cur.version, actions: [{ action: 'setTransitions', transitions }] });
      if (res.ok) r.transitions++; else r.errors.push(`${st.key} transitions: ${res.status}`);
    }
  }
  report.push(r);
  console.log(`  ${'states'.padEnd(20)} ${String(r.total).padStart(5)} total · ${c('green', r.created + (APPLY ? ' created' : ' to create'))} · ${c('dim', r.exists + ' exists')}${r.transitions ? ' · ' + r.transitions + ' transitions' : ''}${r.error ? ' · ' + c('red', r.error + ' error') : ''}`);
}

async function main() {
  const src = await ctClient(flag('--from', 'live'));
  const target = await ctClient(flag('--to', 'stage'));
  console.log(`\n${c('bold', 'clone reference layer')} — ${c('cyan', src.pk)} → ${c('cyan', target.pk)} — ${APPLY ? c('yellow', 'APPLY') : c('green', 'dry-run')}`);
  if (src.pk === target.pk) console.log(c('yellow', '  (same project — every resource will report "exists")'));
  const report = [];
  // order: types → product-types → tax → zones → customer-groups → channels → shipping → categories → product-selections → stores, then states
  for (const step of STEPS) {
    if (step.type === 'stores') await cloneStates(src, target, report); // states before stores isn't required, but keep states last-ish
    await cloneStep(src, target, step, report);
  }
  const tot = report.reduce((a, r) => ({ created: a.created + r.created, exists: a.exists + r.exists, error: a.error + r.error }), { created: 0, exists: 0, error: 0 });
  console.log(`\n${tot.error ? c('yellow', '⚠') : c('green', '✓')} ${APPLY ? 'created' : 'would create'} ${tot.created}, ${tot.exists} already present${tot.error ? `, ${tot.error} errors` : ''}`);
  console.log(c('dim', `next: deploy the catalog with  node bin/cli.mjs deploy --from ${src.pk === target.pk ? 'live' : 'live'} --to stage --products '*' --apply\n`));
}
main().catch((e) => { console.error(c('red', 'clone failed: ') + (e?.stack || e)); process.exit(1); });
