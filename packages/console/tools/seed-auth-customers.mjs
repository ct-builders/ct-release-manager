#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Create the demo login personas as CUSTOMERS in the AUTHORING project, so that
 * sign-in (which is a commercetools customer sign-in) works for each of them.
 * Idempotent — an existing customer with the same email is left alone.
 *
 * A Customer record only supplies the password. Admission is a separate step —
 * run tools/seed-acl-users.mjs afterwards, or these accounts sign in and get a 403.
 *
 * The persona list and the shared password come from `NEXT_PUBLIC_DEMO_USERS` and
 * `NEXT_PUBLIC_DEMO_PASSWORD` (see lib/config.ts), so the accounts created here are
 * exactly the ones the login page offers.
 *
 *   node tools/seed-auth-customers.mjs
 *   node tools/seed-auth-customers.mjs --env=/path/to/authoring.admin.env
 */
import { loadAdminEnv, adminHeaders, personas, demoPassword } from "./ct-admin.mjs";

const admin = loadAdminEnv("authoring.admin.env");
const PASSWORD = demoPassword();

async function main() {
  const H = await adminHeaders(admin);
  const users = personas();
  if (!users.length) {
    console.log("No personas configured — nothing to seed.");
    return;
  }
  for (const u of users) {
    const where = encodeURIComponent(`lowercaseEmail="${u.email.toLowerCase()}"`);
    const found = await (await fetch(`${admin.apiUrl}/${admin.projectKey}/customers?where=${where}`, { headers: H })).json();
    if (found.results?.length) {
      console.log(`[skip] ${u.email} already exists`);
      continue;
    }
    const r = await fetch(`${admin.apiUrl}/${admin.projectKey}/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email: u.email, password: PASSWORD, firstName: u.firstName, lastName: u.lastName }),
    });
    const j = await r.json();
    console.log(r.ok ? `[ok] created ${u.email}` : `[FAIL ${r.status}] ${u.email}: ${JSON.stringify(j).slice(0, 200)}`);
  }
  console.log(`\nAll personas share the password from NEXT_PUBLIC_DEMO_PASSWORD.`);
  console.log(`Next: node tools/seed-acl-users.mjs — without a role they cannot sign in.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
