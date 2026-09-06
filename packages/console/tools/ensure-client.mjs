#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Mint a least-privilege API client for one of the console's three projects and
 * print the matching `.env` lines on stdout (progress goes to stderr, so the
 * output is safe to append straight to a dotfile).
 *
 * A commercetools API client's secret is returned only at creation, so an existing
 * client of the same name is deleted and recreated — the printed credentials are
 * always fresh, and any deploy still using the old pair must be updated.
 *
 *   node tools/ensure-client.mjs authoring   >> .env.local
 *   node tools/ensure-client.mjs production  >> .env.local
 *
 * Each role reads its own admin credential file from this package, overridable
 * with `--env=<path>` or `$ADMIN_ENV`. The admin client needs `manage_api_clients`
 * in addition to `manage_project`.
 */
import { loadAdminEnv, adminHeaders } from "./ct-admin.mjs";

const ROLES = {
  authoring: {
    adminEnv: "authoring.admin.env",
    clientName: "release-manager-authoring",
    prefix: "CTP",
    // manage_project is the authoring superscope: products, categories, discounts,
    // discount codes, the custom objects holding the branch, release, access-list and
    // preference records, and the Customer sign-in this console authenticates against.
    // Verified: POST /{projectKey}/login answers 400 InvalidCredentials under
    // manage_project alone, so no customer scope needs adding.
    // Deliberately excludes manage_api_clients — the app never mints clients.
    scopes: ["manage_project"],
    comment: "AUTHORING project — catalog, releases, and console user accounts",
  },
  production: {
    adminEnv: "production.admin.env",
    clientName: "release-manager-prod-read",
    prefix: "PROD_CTP",
    // Read-only. The console never writes to production directly; the
    // release-deploy service owns every production write.
    scopes: ["view_orders", "view_products", "view_published_products", "view_categories"],
    comment: "PRODUCTION project — READ-ONLY, source of the dashboard's sales analytics",
  },
};

const roleName = process.argv[2];
const role = ROLES[roleName];
if (!role) {
  console.error(`Usage: node tools/ensure-client.mjs <${Object.keys(ROLES).join("|")}> [--env=<path>]`);
  process.exit(1);
}

const admin = loadAdminEnv(role.adminEnv);

async function main() {
  const H = await adminHeaders(admin);
  const base = `${admin.apiUrl}/${admin.projectKey}/api-clients`;

  const listed = await (await fetch(`${base}?where=${encodeURIComponent(`name="${role.clientName}"`)}`, { headers: H })).json();
  for (const existing of listed.results ?? []) {
    console.error(`[${roleName}] "${role.clientName}" exists (id ${existing.id}) — recreating for a fresh secret.`);
    await fetch(`${base}/${existing.id}`, { method: "DELETE", headers: H });
  }

  const scopes = role.scopes.map((s) => `${s}:${admin.projectKey}`);
  const res = await fetch(base, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: role.clientName, scope: scopes.join(" ") }),
  });
  const client = await res.json();
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(client)}`);
  console.error(`[${roleName}] created "${role.clientName}" (id ${client.id}) with ${scopes.join(" ")}`);

  const p = role.prefix;
  process.stdout.write(
    [
      "",
      `# ${role.comment}`,
      `${p}_PROJECT_KEY=${admin.projectKey}`,
      `${p}_CLIENT_ID=${client.id}`,
      `${p}_CLIENT_SECRET=${client.secret}`,
      `${p}_AUTH_URL=${admin.authUrl}`,
      `${p}_API_URL=${admin.apiUrl}`,
      `${p}_SCOPES=${scopes.join(" ")}`,
      "",
    ].join("\n")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
