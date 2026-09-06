#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * clone-b2b.mjs — clone the login + B2B layer source→target for full functional
 * parity: associate roles → customers → business units, in dependency order.
 *
 *   node bin/clone-b2b.mjs --from live --to stage [--apply] [--password 123] [--map cust-id-map.json]
 *
 * Customers are re-created with a known password (live hashes can't be exported).
 * Business-unit associates reference customers by id → remapped to the target's
 * new customer ids. Idempotent-ish: skips customers/roles/units whose key (or
 * email/number for customers) already exists in the target. Writes a
 * live-customer-id → target-customer-id map (needed to re-import orders).
 */
import fs from 'fs';
import { ctClient } from '../lib/ct.mjs';
import { keyForId } from '../lib/serialize.mjs';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const c = (k, s) => `${C[k]}${s}${C.reset}`;
const flag = (n, fb) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; };
const APPLY = process.argv.includes('--apply');
const PW = flag('--password', '123');
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const stripAddr = (a) => clean({ ...a, id: undefined });

async function customWithKey(src, custom) {
  if (!custom?.type) return undefined;
  const typeKey = custom.type.key || (custom.type.id ? await keyForId(src, 'type', custom.type.id) : null);
  return typeKey ? { type: { typeId: 'type', key: typeKey }, fields: custom.fields || {} } : undefined;
}
// map default/extra address ids → indices in the addresses array
const addrIndex = (addresses, id) => { const i = (addresses || []).findIndex((a) => a.id === id); return i >= 0 ? i : undefined; };
const addrIndices = (addresses, ids) => (ids || []).map((id) => addrIndex(addresses, id)).filter((i) => i !== undefined);

async function main() {
  const src = await ctClient(flag('--from', 'live'));
  const tgt = await ctClient(flag('--to', 'stage'));
  console.log(`\n${c('bold', 'clone B2B (roles → customers → business units)')} — ${c('cyan', src.pk)} → ${c('cyan', tgt.pk)} — ${APPLY ? c('yellow', 'APPLY') : c('green', 'dry-run')}`);

  const custMap = {}; // liveCustomerId → targetCustomerId
  const rpt = { roles: { n: 0, ok: 0, skip: 0, err: 0 }, customers: { n: 0, ok: 0, skip: 0, err: 0 }, units: { n: 0, ok: 0, skip: 0, err: 0 } };
  const errs = [];

  // 1) associate roles (by key)
  const roles = await src.all('/associate-roles');
  rpt.roles.n = roles.length;
  for (const r of roles) {
    if (await tgt.byKey('associate-roles', r.key)) { rpt.roles.skip++; continue; }
    if (!APPLY) { rpt.roles.ok++; continue; }
    const res = await tgt.post('/associate-roles', clean({ key: r.key, name: r.name, buyerAssignable: r.buyerAssignable, permissions: r.permissions }));
    res.ok ? rpt.roles.ok++ : (rpt.roles.err++, errs.push(`role ${r.key}: ${res.status} ${res.body?.message}`));
  }

  // 2) customers (password reset; build id map by email)
  const customers = await src.all('/customers');
  rpt.customers.n = customers.length;
  for (const cust of customers) {
    // match target by email (customers may lack a key)
    const q = await tgt.get(`/customers?where=${encodeURIComponent(`lowercaseEmail="${cust.email.toLowerCase()}"`)}`);
    const existing = q.results?.[0];
    if (existing) { custMap[cust.id] = existing.id; rpt.customers.skip++; continue; }
    if (!APPLY) { rpt.customers.ok++; continue; }
    const draft = clean({
      key: cust.key, customerNumber: cust.customerNumber, email: cust.email, password: PW,
      firstName: cust.firstName, lastName: cust.lastName, middleName: cust.middleName, title: cust.title,
      salutation: cust.salutation, companyName: cust.companyName, vatId: cust.vatId, dateOfBirth: cust.dateOfBirth,
      externalId: cust.externalId, locale: cust.locale, isEmailVerified: true,
      addresses: (cust.addresses || []).map(stripAddr),
      defaultShippingAddress: addrIndex(cust.addresses, cust.defaultShippingAddressId),
      defaultBillingAddress: addrIndex(cust.addresses, cust.defaultBillingAddressId),
      shippingAddresses: addrIndices(cust.addresses, cust.shippingAddressIds),
      billingAddresses: addrIndices(cust.addresses, cust.billingAddressIds),
      custom: await customWithKey(src, cust.custom),
    });
    const res = await tgt.post('/customers', draft);
    if (res.ok) { custMap[cust.id] = res.body.customer.id; rpt.customers.ok++; }
    else { rpt.customers.err++; errs.push(`customer ${cust.email}: ${res.status} ${res.body?.message || JSON.stringify(res.body?.errors || res.body).slice(0, 140)}`); }
  }

  // 3) business units — Company before Division (parentUnit), remap associates
  const units = await src.all('/business-units');
  rpt.units.n = units.length;
  const ordered = [...units].sort((a, b) => (a.unitType === 'Company' ? -1 : 1) - (b.unitType === 'Company' ? -1 : 1));
  const assocRef = async (a) => clean({
    customer: { typeId: 'customer', id: custMap[a.customer?.id] || a.customer?.id },
    associateRoleAssignments: (a.associateRoleAssignments || []).map((ra) => ({ associateRole: { typeId: 'associate-role', key: ra.associateRole?.key } })),
  });
  for (const u of ordered) {
    if (await tgt.byKey('business-units', u.key)) { rpt.units.skip++; continue; }
    if (!APPLY) { rpt.units.ok++; continue; }
    const draft = clean({
      key: u.key, unitType: u.unitType, name: u.name, contactEmail: u.contactEmail, status: u.status,
      storeMode: u.storeMode, stores: (u.stores || []).map((s) => ({ typeId: 'store', key: s.key })),
      associateMode: u.associateMode,
      associates: await Promise.all((u.associates || []).map(assocRef)),
      addresses: (u.addresses || []).map(stripAddr),
      defaultShippingAddress: addrIndex(u.addresses, u.defaultShipmentAddressId ?? u.defaultShippingAddressId),
      defaultBillingAddress: addrIndex(u.addresses, u.defaultBillingAddressId),
      custom: await customWithKey(src, u.custom),
      parentUnit: u.parentUnit ? { typeId: 'business-unit', key: u.parentUnit.key } : undefined,
    });
    const res = await tgt.post('/business-units', draft);
    res.ok ? rpt.units.ok++ : (rpt.units.err++, errs.push(`unit ${u.key}: ${res.status} ${res.body?.message || JSON.stringify(res.body?.errors || res.body).slice(0, 160)}`));
  }

  for (const [k, v] of Object.entries(rpt)) console.log(`  ${k.padEnd(12)} ${String(v.n).padStart(4)} · ${c('green', v.ok + (APPLY ? '' : ' would'))}${v.skip ? ' · ' + c('dim', v.skip + ' exists') : ''}${v.err ? ' · ' + c('red', v.err + ' err') : ''}`);
  if (errs.length) { console.log(c('red', '\nerrors:')); errs.slice(0, 10).forEach((e) => console.log(c('dim', '  ' + e))); }
  if (APPLY) { const mp = flag('--map', 'cust-id-map.json'); fs.writeFileSync(mp, JSON.stringify(custMap, null, 0)); console.log(c('dim', `\n  customer id map (${Object.keys(custMap).length}) → ${mp}`)); }
  console.log('');
}
main().catch((e) => { console.error(c('red', 'failed: ') + (e?.stack || e)); process.exit(1); });
