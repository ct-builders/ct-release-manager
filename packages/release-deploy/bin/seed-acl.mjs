#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * seed-acl.mjs — grant the bootstrap admin so someone can manage the Permissions
 * panel. Idempotent (upserts the CustomObject). Until at least one user is
 * granted a role, the service runs in "open mode" (everyone has full access), so
 * run this once to turn enforcement on with a known admin.
 *
 *   node bin/seed-acl.mjs                                  # grant default admin
 *   node bin/seed-acl.mjs someone@example.com admin author # grant custom roles
 *
 * Writes to the STAGE project (container release-acl).
 */
import { ctClient } from '../lib/ct.mjs';
import { setAcl, ROLES } from '../lib/acl.mjs';

const DEFAULT_ADMIN = 'admin@example.com';

const [, , emailArg, ...roleArgs] = process.argv;
const email = emailArg || DEFAULT_ADMIN;
const roles = roleArgs.length ? roleArgs : ['admin'];

const bad = roles.filter((r) => !ROLES.includes(r));
if (bad.length) { console.error(`unknown role(s): ${bad.join(', ')} — valid: ${ROLES.join(', ')}`); process.exit(1); }

const stage = await ctClient('stage');
const saved = await setAcl(stage, { email, roles, by: 'seed-acl' });
console.log(`✓ granted ${saved.email} → [${saved.roles.join(', ')}] (stage/${stage.pk})`);
