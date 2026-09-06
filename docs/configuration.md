# Configuration

**The console's** settings, which is what this page covers. Every one is an environment
variable: locally they go in `packages/console/.env.local`, and on a deploy in the host's
environment. [`packages/console/.env.example`](../packages/console/.env.example) is the
copyable template.

The deploy service is configured separately, out of
[`packages/release-deploy/.env`](../packages/release-deploy/.env.example) — its two projects'
credentials, its bearer token, and its email provider. Those are documented in
[its own README](../packages/release-deploy/README.md), and they are the ones that decide
which commercetools project gets written.

Configuration splits in two by where it is read:

- **Server-only**, read through [`lib/env.ts`](../packages/console/lib/env.ts). Credentials live here and
  never reach the browser. A missing required value throws at request time, not build time,
  so a build succeeds without them.
- **Public**, read through [`lib/config.ts`](../packages/console/lib/config.ts). Prefixed `NEXT_PUBLIC_`,
  baked into the client bundle at build time, so a change takes effect on the next build
  rather than the next restart. Nothing secret belongs here.

## Required

Nothing below has a default. The console will not serve a page without all of it.

### commercetools projects

Two projects, two sets of credentials, same shape. [Mint each client](operations.md#mint-an-api-client)
with `node tools/ensure-client.mjs <role>`.

| Prefix | Project | Scopes the console needs |
|---|---|---|
| `CTP_` | Authoring | `manage_project` — products, categories, discounts, discount codes, the custom objects holding the branch, release, access-list and preference records, and the Customer sign-in this console authenticates against |
| `PROD_CTP_` | Production | `view_orders`, `view_products`, `view_published_products`, `view_categories` — read-only |

Each prefix takes the same six variables:

| Variable | Value |
|---|---|
| `<PREFIX>PROJECT_KEY` | commercetools project key |
| `<PREFIX>CLIENT_ID` | API client id |
| `<PREFIX>CLIENT_SECRET` | API client secret |
| `<PREFIX>AUTH_URL` | e.g. `https://auth.us-central1.gcp.commercetools.com` |
| `<PREFIX>API_URL` | e.g. `https://api.us-central1.gcp.commercetools.com` |
| `<PREFIX>SCOPES` | Space-separated scopes, each suffixed `:<projectKey>` |

The auth and API hosts are region-specific and must match the project's region, or every
call 404s.

### The release-deploy service

| Variable | Value |
|---|---|
| `RELEASE_SERVICE_URL` | Base URL of a service instance deployed for *your* two projects. See [architecture](architecture.md#the-release-deploy-service). |
| `RELEASE_SERVICE_TOKEN` | Bearer token, sent on every call. Optional, and omitted when blank. |

**The service decides which commercetools projects it acts on, not this console.** Point
`RELEASE_SERVICE_URL` at an instance someone else deployed and you get their releases and
their catalog, and an unrecognised `RELEASE_SERVICE_PROJECT` resolves to *their production
project* without saying so. Verify the wiring before trusting it — see
[Pointing at the right service](setup.md#pointing-at-the-right-service).

### Session signing and the first account

| Variable | Value |
|---|---|
| `SESSION_SECRET` | HS256 signing key for the session cookie. Any long random string: `openssl rand -base64 48`. Changing it signs everyone out. |
| `BOOTSTRAP_ADMIN_EMAIL` | The one account that holds admin before the access list has entries. Server-side only, so it never reaches the browser. |

**Set `BOOTSTRAP_ADMIN_EMAIL` or nobody can get into a fresh install.** Sign-in requires an
access-list entry, and a new project has none. This one named account is the way in; grant
yourself Admin under `/settings/permissions` and it stops mattering.

## Branding

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | `Release Manager` | Sidebar, login card, browser tab. |
| `NEXT_PUBLIC_APP_TAGLINE` | `Plan and publish store updates` | One line under the name on the login card. |
| `NEXT_PUBLIC_APP_DESCRIPTION` | A one-sentence summary | `<meta name="description">`. |
| `NEXT_PUBLIC_APP_LOGO` | `/commercetools-logo.svg` | Logo on the login card. A path under `public/`, or an absolute URL. Empty shows the name alone. |
| `NEXT_PUBLIC_APP_LOGO_ALT` | `commercetools` | Alt text for that logo. |

## Catalog conventions

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_LOCALE` | `en-US` | Which locale of every commercetools LocalizedString the console reads and writes, and how numbers, dates and money are formatted. |
| `NEXT_PUBLIC_CURRENCY` | `USD` | Currency offered first when adding a price, and the dashboard's reporting currency. |
| `NEXT_PUBLIC_CURRENCIES` | `USD,EUR,GBP,CAD,MXN,BRL` | Currencies offered in price and discount editors. |
| `NEXT_PUBLIC_COUNTRIES` | `US,CA,MX,BR,GB,DE,FR,ES` | Countries offered in price rows and discount predicates. |
| `NEXT_PUBLIC_COUNTRY` | first of `NEXT_PUBLIC_COUNTRIES` | Primary market, used where a country is needed and none is chosen. |
| `NEXT_PUBLIC_FX_RATES` | `USD=1,EUR=1.08,GBP=1.27,CAD=0.73,MXN=0.058,BRL=0.18` | Multipliers into `NEXT_PUBLIC_CURRENCY`, for summing multi-currency orders on the dashboard. |
| `NEW_PRODUCT_TYPE_KEY` | blank | Product type assigned to products created by the wizard. Blank resolves to the project's first product type. |

**The console authors one locale.** It edits that locale of a LocalizedString and leaves the
others untouched, which keeps the editors simple at the cost of not being a translation tool.
Run a separate console per authoring locale if you need more than one.

**Change `NEXT_PUBLIC_CURRENCY` and set `NEXT_PUBLIC_FX_RATES` with it.** The rates are
multipliers *into* the reporting currency, so leaving them at the defaults while switching
the reporting currency to EUR counts every USD order at 1:1. The dashboard labels its totals
as approximate because these rates are indicative: it is a merchandising trend view, not a
finance report.

**Set `NEW_PRODUCT_TYPE_KEY` explicitly on a catalog with more than one product type.** The
fallback picks whichever the project returns first, which is arbitrary.

## Featured product attributes

Two product attributes get first-class treatment across the console. A **facet** is the
low-cardinality attribute the catalog groups by: a filter dropdown on the product list, a
suggestion list in the discount predicate builder, a column. A **code** is the
high-cardinality secondary identifier shown next to the name: a monospaced column, a wizard
field, a CSV column.

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_FACET_ATTRIBUTE` | `brand` | commercetools attribute name. Empty disables the facet everywhere. |
| `NEXT_PUBLIC_FACET_ATTRIBUTE_LABEL` | `Brand` | Column header and field label. |
| `NEXT_PUBLIC_FACET_ATTRIBUTE_PLACEHOLDER` | `e.g. Acme` | Input placeholder. |
| `NEXT_PUBLIC_CODE_ATTRIBUTE` | `partNumber` | commercetools attribute name. Empty disables the code everywhere. |
| `NEXT_PUBLIC_CODE_ATTRIBUTE_LABEL` | `Part number` | Field label in the wizard and editor. |
| `NEXT_PUBLIC_CODE_ATTRIBUTE_SHORT_LABEL` | `Part #` | Column header. |
| `NEXT_PUBLIC_CODE_ATTRIBUTE_PLACEHOLDER` | `e.g. BP-1234` | Input placeholder. |
| `NEXT_PUBLIC_PRODUCT_NAME_PLACEHOLDER` | `e.g. Front Brake Pads` | Example product name in the create wizard. |

Three things follow from the attribute name:

- The product-list filter travels in the URL under it, so a link reads `/products?brand=Acme`.
- The CSV export writes it as a column header, and the import matches it case-insensitively,
  so an export round-trips through the importer.
- Facet values come from the catalog, not from configuration. The console scans up to 500
  products and caches the distinct values for ten minutes.

Every product attribute remains editable on the Attributes tab regardless. These two settings
only control which get promoted into columns, filters and the create wizard.

## Storefronts

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_STAGING_STOREFRONT_B2C` | Staging B2C storefront. |
| `NEXT_PUBLIC_STAGING_STOREFRONT_B2B` | Staging B2B storefront. |
| `NEXT_PUBLIC_PRODUCTION_STOREFRONT_B2C` | Live B2C storefront. |
| `NEXT_PUBLIC_PRODUCTION_STOREFRONT_B2B` | Live B2B storefront. |

All four are empty by default, and an unset link is not rendered: no "Sites" group in the
sidebar, no staging-preview button on a release. Set one staging URL and the preview button
appears without a B2C/B2B toggle; set both and the toggle appears.

The staging URLs are where a release's in-progress content can be viewed before it ships, so
they should point at a storefront reading the **authoring** project.

## Demo login

One-click sign-in as a seeded persona, for demonstrating the review and approval gates
without four sets of real credentials.

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_DEMO_LOGIN` | `true` | `false` removes the persona buttons and the shared password. The login page becomes email and password only. |
| `NEXT_PUBLIC_DEMO_PASSWORD` | `123` | Shared password for the personas. |
| `NEXT_PUBLIC_DEMO_USERS` | four `@example.com` personas | JSON array of `{ email, label, role }`, roles from `author`, `reviewer`, `publisher`, `admin`. |
| `NEXT_PUBLIC_DEMO_ADMIN_EMAIL` | first admin persona | The account behind "Use demo credentials". |

**Set `NEXT_PUBLIC_DEMO_LOGIN=false` on any install where people sign in as themselves.**
The shared password is visible to the browser and identical for every persona, which is the
point when you are showing the workflow to a room and unacceptable when real merchandisers
are using it.

The seeders read the same two variables, so the accounts they create are exactly the ones the
login page offers. See [operations.md](operations.md#seed-the-demo-personas).

## Other

| Variable | Default | Effect |
|---|---|---|
| `RELEASE_SERVICE_PROJECT` | `stage` | The service's own alias for the authoring project, sent as `?project=`. An alias the service does not recognise silently resolves to its production project, so check it against [Pointing at the right service](setup.md#pointing-at-the-right-service). |
| `SEED_ADDRESS_CITY` | blank | City used in seeded order addresses. Omitted from the address when blank. |

## Checking what took effect

`NEXT_PUBLIC_*` values are inlined at build time, so a stale value survives a restart. To
confirm a change landed:

1. Rebuild: `npm run build`.
2. Load `/login` and check the app name and tagline.
3. Load `/products` and check the facet filter and the two attribute columns.

Server-only values are read per request, so those take effect on restart alone.
