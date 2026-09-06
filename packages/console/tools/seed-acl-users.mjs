#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Give each demo persona its role, as `release-acl` custom objects in the AUTHORING
 * project. Idempotent — re-running overwrites each role assignment with the same
 * value.
 *
 * An entry here is what admits someone to the console, so this is the step that turns
 * a seeded Customer into a usable login. Run tools/seed-auth-customers.mjs first.
 *
 * The persona list comes from `NEXT_PUBLIC_DEMO_USERS` (see lib/config.ts), so the
 * roles seeded here are exactly the ones the login page offers.
 *
 *   node tools/seed-acl-users.mjs
 *   node tools/seed-acl-users.mjs --env=/path/to/authoring.admin.env
 */
import { loadAdminEnv, adminHeaders, personas } from "./ct-admin.mjs";
import { ACL_CONTAINER } from "./containers.mjs";

const admin = loadAdminEnv("authoring.admin.env");
const emailKey = (email) => Buffer.from(email.trim().toLowerCase()).toString("base64url");

async function main() {
  const H = await adminHeaders(admin);
  const users = personas().filter((u) => u.roles.length);
  if (!users.length) {
    console.log("No personas with roles configured — nothing to seed.");
    return;
  }
  for (const u of users) {
    const value = { email: u.email.toLowerCase(), roles: u.roles, updatedAt: new Date().toISOString(), by: "seed" };
    const r = await fetch(`${admin.apiUrl}/${admin.projectKey}/custom-objects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ container: ACL_CONTAINER, key: emailKey(u.email), value }),
    });
    const j = await r.json().catch(() => ({}));
    console.log(
      r.ok
        ? `[ok] ${u.email} → ${u.roles.join(",")} (${ACL_CONTAINER}@${admin.projectKey})`
        : `[FAIL ${r.status}] ${u.email}: ${JSON.stringify(j).slice(0, 200)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
