/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Shared helpers for the operator scripts in this directory.
 *
 * Each script acts on one commercetools project using an ADMIN client — a client
 * with `manage_project` and, where it mints other clients, `manage_api_clients`.
 * Admin credentials are never committed and never used by the running app; they
 * live in a gitignored `*.admin.env` file beside this package, read at run time.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package's root — `packages/console`, not the monorepo root. Admin
 * credential files and `.env.local` live beside the console they configure. */
export const PACKAGE_ROOT = resolve(HERE, "..");

/** Parse `KEY=value` lines, ignoring comments and blanks. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Locate and load an admin credential file, in order of precedence:
 *   1. `--env=<path>` on the command line
 *   2. `$ADMIN_ENV`
 *   3. `packages/console/<defaultName>`
 *
 * `defaultName` names which project's admin file a script wants, e.g.
 * `"authoring.admin.env"`. Exits with an actionable message when nothing is found,
 * because every one of these scripts is useless without credentials.
 */
export function loadAdminEnv(defaultName) {
  const flag = process.argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);
  const candidates = [flag, process.env.ADMIN_ENV, resolve(PACKAGE_ROOT, defaultName)].filter(Boolean);
  for (const c of candidates) {
    const path = isAbsolute(c) ? c : resolve(process.cwd(), c);
    if (existsSync(path)) {
      const admin = parseEnv(readFileSync(path, "utf8"));
      for (const required of ["CTP_PROJECT_KEY", "CTP_CLIENT_ID", "CTP_CLIENT_SECRET", "CTP_AUTH_URL", "CTP_API_URL"]) {
        if (!admin[required]) {
          console.error(`${path} is missing ${required}.`);
          process.exit(1);
        }
      }
      return {
        ...admin,
        path,
        projectKey: admin.CTP_PROJECT_KEY,
        authUrl: admin.CTP_AUTH_URL.replace(/\/$/, ""),
        apiUrl: admin.CTP_API_URL.replace(/\/$/, ""),
        scopes: admin.CTP_SCOPES ?? "",
      };
    }
  }
  console.error(
    [
      `No admin credentials found. Looked for:`,
      ...candidates.map((c) => `  ${c}`),
      ``,
      `Create packages/console/${defaultName} with CTP_PROJECT_KEY, CTP_CLIENT_ID,`,
      `CTP_CLIENT_SECRET, CTP_AUTH_URL, CTP_API_URL and CTP_SCOPES, or point at one:`,
      `  node ${process.argv[1]?.split("/").pop() ?? "tools/<script>.mjs"} --env=/path/to/admin.env`,
    ].join("\n")
  );
  process.exit(1);
}

/** Client-credentials token for an admin config from `loadAdminEnv`. */
export async function adminToken(admin) {
  const r = await fetch(`${admin.authUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${admin.CTP_CLIENT_ID}:${admin.CTP_CLIENT_SECRET}`).toString("base64"),
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(admin.scopes)}`,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`admin token failed for ${admin.projectKey}: ${JSON.stringify(j)}`);
  return j.access_token;
}

/** `{ Authorization, Content-Type }` headers for an authenticated admin call. */
export async function adminHeaders(admin) {
  return { Authorization: `Bearer ${await adminToken(admin)}`, "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------------
// demo personas — kept in step with lib/config.ts
// ---------------------------------------------------------------------------

/** App env, merged from `.env.local` then `.env`, with `process.env` winning. */
function appEnv() {
  const merged = {};
  for (const name of [".env", ".env.local"]) {
    const path = resolve(PACKAGE_ROOT, name);
    if (existsSync(path)) Object.assign(merged, parseEnv(readFileSync(path, "utf8")));
  }
  return { ...merged, ...process.env };
}

/** Same defaults as `DEFAULT_DEMO_USERS` in lib/config.ts. */
const DEFAULT_PERSONAS = [
  { email: "admin@example.com", firstName: "Avery", lastName: "Admin", roles: ["admin"] },
  { email: "author@example.com", firstName: "Alex", lastName: "Author", roles: ["author"] },
  { email: "reviewer@example.com", firstName: "Riley", lastName: "Reviewer", roles: ["reviewer"] },
  { email: "publisher@example.com", firstName: "Pat", lastName: "Publisher", roles: ["publisher"] },
];

/** Split a persona label like "Alex (Author)" into a first and last name. */
function namesFrom(label, email) {
  const cleaned = (label ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  return { firstName: parts[0] || email.split("@")[0], lastName: "User" };
}

/**
 * The login personas the app offers, read from `NEXT_PUBLIC_DEMO_USERS` so the
 * seeders and the login page can never disagree about who exists.
 */
export function personas() {
  const raw = appEnv().NEXT_PUBLIC_DEMO_USERS;
  if (!raw?.trim()) return DEFAULT_PERSONAS;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("NEXT_PUBLIC_DEMO_USERS is not valid JSON — falling back to the defaults.");
    return DEFAULT_PERSONAS;
  }
  if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_PERSONAS;
  return parsed
    .filter((u) => u?.email)
    .map((u) => ({ email: u.email, ...namesFrom(u.label, u.email), roles: u.role ? [u.role] : [] }));
}

/** Shared password for the personas above. Matches `DEMO_PASSWORD` in lib/config.ts. */
export function demoPassword() {
  return appEnv().NEXT_PUBLIC_DEMO_PASSWORD?.trim() || "123";
}

// ---------------------------------------------------------------------------
// catalog conventions — kept in step with lib/config.ts
// ---------------------------------------------------------------------------

/**
 * Locale, currency, country and featured-attribute name, read from the same
 * `NEXT_PUBLIC_*` vars the app uses, so seeded data matches what the console
 * displays. Defaults mirror lib/config.ts.
 */
export function catalogConfig() {
  const e = appEnv();
  const countries = (e.NEXT_PUBLIC_COUNTRIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    locale: e.NEXT_PUBLIC_LOCALE?.trim() || "en-US",
    currency: (e.NEXT_PUBLIC_CURRENCY?.trim() || "USD").toUpperCase(),
    country: e.NEXT_PUBLIC_COUNTRY?.trim() || countries[0] || "US",
    /** Optional city for seeded shipping addresses; omitted from the address when blank. */
    city: e.SEED_ADDRESS_CITY?.trim() || "",
    facetAttribute: (e.NEXT_PUBLIC_FACET_ATTRIBUTE ?? "brand").trim(),
  };
}

/** Read a LocalizedString in the configured locale, falling back sensibly. */
export function localized(value, locale) {
  if (!value || typeof value !== "object") return undefined;
  return value[locale] ?? value.en ?? Object.values(value)[0];
}
