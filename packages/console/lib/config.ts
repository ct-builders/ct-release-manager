/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Deployment configuration — everything that differs between one company's
 * install of this console and another's: the name in the chrome, the catalog
 * conventions (locale, currencies, which product attributes get first-class
 * treatment), the storefront links, and the demo-login panel.
 *
 * Client-safe. Every value is a literal `process.env.NEXT_PUBLIC_*` read with a
 * working default, so a fresh clone runs with none of these set and configuring
 * a tenant means setting env vars rather than editing components.
 *
 * Two constraints worth knowing:
 *  - `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
 *    a change takes effect on the next build, not the next restart. The reads
 *    below are literal member expressions because a dynamic lookup
 *    (`process.env[name]`) is not inlined at all.
 *  - Nothing secret belongs here. Credentials live in `lib/env.ts`, which is
 *    server-only.
 */

// ---------------------------------------------------------------------------
// parsers
// ---------------------------------------------------------------------------

/** Comma-separated list → trimmed, de-duplicated array. Blank falls back. */
function list(raw: string | undefined, fallback: string[]): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : fallback;
}

/** `USD=1,EUR=1.08` → `{ USD: 1, EUR: 1.08 }`. Blank or unparseable falls back. */
function rates(raw: string | undefined, fallback: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (raw ?? "").split(",")) {
    const [code, value] = pair.split("=").map((s) => s?.trim());
    const n = Number(value);
    if (code && Number.isFinite(n) && n > 0) out[code.toUpperCase()] = n;
  }
  return Object.keys(out).length ? out : fallback;
}

/** JSON array → parsed value, or the fallback if absent/malformed. */
function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

const clean = (raw: string | undefined) => (raw ?? "").trim().replace(/\/$/, "");

// ---------------------------------------------------------------------------
// branding
// ---------------------------------------------------------------------------

/** Name in the sidebar, the login card, and the browser tab. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Release Manager";

/** One line under the app name on the login card. */
export const APP_TAGLINE = process.env.NEXT_PUBLIC_APP_TAGLINE?.trim() || "Plan and publish store updates";

/** `<meta name="description">`. */
export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
  "Stage catalog and promotion changes into a reviewable release, then ship them to production as one atomic deploy.";

/**
 * Logo shown on the login card. Any path under `public/`, or an absolute URL.
 * Set to an empty string to show the app name alone.
 */
export const APP_LOGO = process.env.NEXT_PUBLIC_APP_LOGO ?? "/commercetools-logo.svg";

/** Alt text for the logo — the organization whose mark it is. */
export const APP_LOGO_ALT = process.env.NEXT_PUBLIC_APP_LOGO_ALT?.trim() || "commercetools";

// ---------------------------------------------------------------------------
// catalog conventions
// ---------------------------------------------------------------------------

/**
 * The locale this console authors in. Used to read and write commercetools
 * LocalizedStrings (product name, slug, description, category name) and to
 * format numbers, dates and money for display.
 *
 * This console is deliberately single-locale: it edits one locale of a
 * LocalizedString and leaves the others untouched.
 */
export const LOCALE = process.env.NEXT_PUBLIC_LOCALE?.trim() || "en-US";

/** Currency offered first when adding a price, and the reporting currency on the dashboard. */
export const CURRENCY = (process.env.NEXT_PUBLIC_CURRENCY?.trim() || "USD").toUpperCase();

/** Currencies offered in price and discount editors. */
export const CURRENCIES = list(process.env.NEXT_PUBLIC_CURRENCIES, ["USD", "EUR", "GBP", "CAD", "MXN", "BRL"]);

/** Countries offered in price rows and discount predicates. */
export const COUNTRIES = list(process.env.NEXT_PUBLIC_COUNTRIES, ["US", "CA", "MX", "BR", "GB", "DE", "FR", "ES"]);

/** Primary market — the country assumed when one is needed and none is chosen. */
export const COUNTRY = process.env.NEXT_PUBLIC_COUNTRY?.trim() || COUNTRIES[0];

/**
 * Rates used to express multi-currency order totals in one reporting currency on
 * the dashboard, as a multiplier into `CURRENCY`. Indicative only — this is a
 * merchandising trend view, not a finance report, and the dashboard labels its
 * totals as approximate. Any currency absent here is counted at 1:1.
 */
export const FX_RATES = rates(process.env.NEXT_PUBLIC_FX_RATES, {
  USD: 1,
  MXN: 0.058,
  BRL: 0.18,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
});

// ---------------------------------------------------------------------------
// featured product attributes
// ---------------------------------------------------------------------------

export type ProductAttributeConfig = {
  /** commercetools attribute name on the product type. Empty disables the attribute everywhere. */
  name: string;
  /** Field label in the create wizard and the editor. */
  label: string;
  /** Column header — short enough for a table. */
  shortLabel: string;
  /** Example value shown as input placeholder. */
  placeholder: string;
};

/**
 * Two product attributes get first-class treatment across the console. Both are
 * optional: set the `*_ATTRIBUTE` env var to an empty string and the column,
 * filter, wizard field and CSV column all disappear.
 *
 * FACET is the low-cardinality attribute the catalog groups by — a filter
 * dropdown on the product list, a suggestion list in the discount predicate
 * builder, a column. Distinct values are read from the catalog, so nothing needs
 * declaring up front.
 *
 * CODE is the high-cardinality secondary identifier shown next to the name — a
 * monospaced column, a wizard field, a CSV column.
 */
export const FACET_ATTRIBUTE: ProductAttributeConfig = {
  name: (process.env.NEXT_PUBLIC_FACET_ATTRIBUTE ?? "brand").trim(),
  label: process.env.NEXT_PUBLIC_FACET_ATTRIBUTE_LABEL?.trim() || "Brand",
  shortLabel: process.env.NEXT_PUBLIC_FACET_ATTRIBUTE_LABEL?.trim() || "Brand",
  placeholder: process.env.NEXT_PUBLIC_FACET_ATTRIBUTE_PLACEHOLDER?.trim() || "e.g. Acme",
};

export const CODE_ATTRIBUTE: ProductAttributeConfig = {
  name: (process.env.NEXT_PUBLIC_CODE_ATTRIBUTE ?? "partNumber").trim(),
  label: process.env.NEXT_PUBLIC_CODE_ATTRIBUTE_LABEL?.trim() || "Part number",
  shortLabel: process.env.NEXT_PUBLIC_CODE_ATTRIBUTE_SHORT_LABEL?.trim() || "Part #",
  placeholder: process.env.NEXT_PUBLIC_CODE_ATTRIBUTE_PLACEHOLDER?.trim() || "e.g. BP-1234",
};

/** True when the attribute is configured and should be rendered. */
export const hasFacetAttribute = !!FACET_ATTRIBUTE.name;
export const hasCodeAttribute = !!CODE_ATTRIBUTE.name;

/** Lower-cased plural for prose like "All brands". */
export const facetPlural = `${FACET_ATTRIBUTE.label.toLowerCase()}s`;

/** Example product name in the create wizard — the one place a sample catalog leaks in. */
export const PRODUCT_NAME_PLACEHOLDER =
  process.env.NEXT_PUBLIC_PRODUCT_NAME_PLACEHOLDER?.trim() || "e.g. Front Brake Pads";

// ---------------------------------------------------------------------------
// storefront links
// ---------------------------------------------------------------------------

export type StorefrontLinks = {
  /** Staging storefronts — where a release's in-progress content can be viewed before shipping. */
  stagingB2C: string;
  stagingB2B: string;
  /** Live storefronts — what a deploy changes. */
  productionB2C: string;
  productionB2B: string;
};

/**
 * Storefronts this console publishes to. Every one is optional and empty by
 * default: an unset link is simply not rendered, so a fresh install shows no
 * "Sites" group in the sidebar and no staging-preview buttons on a release,
 * rather than four dead links.
 */
export const STOREFRONTS: StorefrontLinks = {
  stagingB2C: clean(process.env.NEXT_PUBLIC_STAGING_STOREFRONT_B2C),
  stagingB2B: clean(process.env.NEXT_PUBLIC_STAGING_STOREFRONT_B2B),
  productionB2C: clean(process.env.NEXT_PUBLIC_PRODUCTION_STOREFRONT_B2C),
  productionB2B: clean(process.env.NEXT_PUBLIC_PRODUCTION_STOREFRONT_B2B),
};

/** The sidebar "Sites" group, in display order, with unconfigured links dropped. */
export const STOREFRONT_LINKS: { label: string; url: string }[] = [
  { label: "Staging · B2C", url: STOREFRONTS.stagingB2C },
  { label: "Staging · B2B", url: STOREFRONTS.stagingB2B },
  { label: "Production · B2C", url: STOREFRONTS.productionB2C },
  { label: "Production · B2B", url: STOREFRONTS.productionB2B },
].filter((l) => !!l.url);

// ---------------------------------------------------------------------------
// demo login
// ---------------------------------------------------------------------------

export type DemoUser = { email: string; label: string; role: string };

const DEFAULT_DEMO_USERS: DemoUser[] = [
  { email: "admin@example.com", label: "Avery (Admin)", role: "admin" },
  { email: "author@example.com", label: "Alex (Author)", role: "author" },
  { email: "reviewer@example.com", label: "Riley (Reviewer)", role: "reviewer" },
  { email: "publisher@example.com", label: "Pat (Publisher)", role: "publisher" },
];

/**
 * One-click sign-in as a seeded persona, for demonstrating the review and
 * approval gates without four sets of real credentials. Set
 * `NEXT_PUBLIC_DEMO_LOGIN=false` for any install where people sign in as
 * themselves — the buttons and the shared password disappear and the login page
 * is email and password only.
 */
export const DEMO_LOGIN = process.env.NEXT_PUBLIC_DEMO_LOGIN !== "false";

/**
 * Shared password for the personas above.
 *
 * `NEXT_PUBLIC_`, so it is compiled into the client bundle and readable by anyone
 * who loads the page — it is a convenience for a walkthrough install, not a
 * credential. Any install where sign-ins matter sets `NEXT_PUBLIC_DEMO_LOGIN=false`,
 * which removes the personas and this password from the page entirely.
 */
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD?.trim() || "123";

/**
 * Personas offered on the login page and created by `tools/seed-auth-customers.mjs`
 * and `tools/seed-acl-users.mjs`. Override with a JSON array of
 * `{ email, label, role }`, roles drawn from author | reviewer | publisher | admin.
 */
export const DEMO_USERS: DemoUser[] = json(process.env.NEXT_PUBLIC_DEMO_USERS, DEFAULT_DEMO_USERS);

/** The persona behind "Use demo credentials" — the first admin, else the first persona. */
export const DEMO_ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL?.trim() ||
  DEMO_USERS.find((u) => u.role === "admin")?.email ||
  DEMO_USERS[0]?.email ||
  "";
