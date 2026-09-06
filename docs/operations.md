# Operator scripts

Two sets, split by which package owns the work. All of them are plain Node ESM, run
directly, no build step.

| Where | Owns | Credentials from |
|---|---|---|
| [`packages/console/tools/`](../packages/console/tools) | Provisioning and seeding: mint API clients, fill a staging project, seed logins and dashboard orders | an admin credential file, or the console's `.env.local` |
| [`packages/release-deploy/bin/`](../packages/release-deploy/bin) | The pipeline itself: serialize, validate, deploy, key audit, clone a reference layer, back up a project, migrate containers | the service's own `STAGE_CTP_*` / `LIVE_CTP_*` |

This page covers the console's scripts in detail; the service's are documented in
[its own README](../packages/release-deploy/README.md) and summarised at the
[bottom of this page](#the-services-scripts). Run each from its own package directory.

## How the console's scripts get credentials

Two patterns, depending on what the script does.

**Scripts that mint clients or write to a project you do not have a console client for** read
an admin credential file, resolved in this order:

1. `--env=<path>` on the command line
2. `$ADMIN_ENV`
3. `packages/console/<default name>` — `authoring.admin.env` or `production.admin.env`

A missing file exits with the paths it looked in and what to put in one. `*.admin.env` is
gitignored, and the running console never reads these files.

**Scripts that only need the console's own access** read `CTP_*` from the environment, then
from `packages/console/.env.local`. Only
[`reconcile-branch-registry.mjs`](../packages/console/tools/reconcile-branch-registry.mjs)
works this way.

Shared helpers live in [`ct-admin.mjs`](../packages/console/tools/ct-admin.mjs) and
container names in [`containers.mjs`](../packages/console/tools/containers.mjs).

## Mint an API client

```bash
node tools/ensure-client.mjs authoring  >> .env.local
node tools/ensure-client.mjs production >> .env.local
```

Creates a least-privilege client on that project and prints its `.env` lines on stdout;
progress goes to stderr, so redirecting stdout to a dotfile is safe.

A commercetools API client's secret is returned only at creation, so **an existing client of
the same name is deleted and recreated**. Anything still running on the old pair stops
working. That is the trade-off for never storing a secret: the script can always produce
working credentials, but only by rotating them.

Names and scopes:

| Role | Client name | Scopes |
|---|---|---|
| `authoring` | `release-manager-authoring` | `manage_project` |
| `production` | `release-manager-prod-read` | `view_orders`, `view_products`, `view_published_products`, `view_categories` |

`manage_project` covers the Customer sign-in too: `POST /{projectKey}/login` answers `400
InvalidCredentials` under it, so no customer scope needs adding.

None gets `manage_api_clients`. The console never mints clients.

## Seed the demo personas

```bash
node tools/seed-auth-customers.mjs   # Customer records — the password half
node tools/seed-acl-users.mjs        # release-acl entries — the admission half
```

**Run both, in that order.** A Customer with no `release-acl` entry authenticates and then gets a
`403`, because the access list is what admits someone. Both act on the **authoring** project
and both are idempotent: an existing customer is skipped, and a role assignment is
overwritten with the same value.

Both read `NEXT_PUBLIC_DEMO_USERS` and `NEXT_PUBLIC_DEMO_PASSWORD` from `.env.local`, the same
variables the login page reads, so the accounts they create are exactly the personas offered
on the login page. Change the list in one place and re-run.

A persona's `label` supplies the first and last name: `"Alex (Author)"` becomes first name
`Alex`, last name `Author`, with the parenthesised part dropped.

## Seed dashboard data

The dashboard reads real orders from the **production** project. Both scripts write there.

```bash
node tools/seed-demo-orders.mjs           # ~160 orders across 35 days
node tools/seed-demo-orders.mjs --reset   # delete SEED-* first

node tools/seed-promo-orders.mjs              # promotion-bearing orders
node tools/seed-promo-orders.mjs --reset      # delete SEED-PROMO-* first, then seed
node tools/seed-promo-orders.mjs --reset-only # delete only
```

**`--reset` deletes orders.** It matches on the order-number prefix (`SEED-` and
`SEED-PROMO-`) and touches nothing else, but on a project with real order history, read the
prefix filter before you trust it.

Both scripts take products, customers, business units and shipping methods from the project
itself, and price in `NEXT_PUBLIC_CURRENCY`. Neither will run if no product carries an
unqualified price in that currency — the message names the variable to change.

### Why there are two

They fill different parts of the dashboard, because of one commercetools behaviour:

| | `seed-demo-orders` | `seed-promo-orders` |
|---|---|---|
| Route | Order Import API | Real cart flow |
| Discounts applied | None — Order Import bypasses discount calculation | Yes, by commercetools, with full attribution |
| `completedAt` | Set, spread over 35 days | Not set; the dashboard counts these by `createdAt` |
| Fills | Sales totals, the trend chart, top products and categories | The Promotions table's Orders and Revenue impact |

So the first gives you a believable trend line and the second gives you promotion numbers.
Run both.

### How the promotion scenarios are chosen

`seed-promo-orders` derives its carts from the project rather than from a fixed recipe list:
the ten categories holding the most products at one, two and four units each; the five
priciest products at one and three units; the five cheapest at six units; one cart per
featured-attribute value; one cart per **active** discount code, sized generously so
minimum-spend codes qualify; and one deliberately small and one deliberately large cart, since
free-shipping rules usually turn on cart value. An active shipping method is set on every
cart, so shipping-target rules can attribute.

The aim is breadth, not precision. A promotion whose predicate nothing happens to satisfy
reports zero orders in the coverage summary printed at the end, which tells you to add a cart
for it by hand rather than that the script failed.

## Provision a staging project

```bash
node tools/provision-stage.mjs --dry-run            # report what it would create
node tools/provision-stage.mjs                      # copy production -> authoring
node tools/provision-stage.mjs --verify             # and compare every product after
node tools/provision-stage.mjs --only=products,inventory
```

Copies a live catalog into an empty authoring project: project settings, custom-field
types, tax categories, product types, zones, channels, customer groups, recurrence
policies, states, categories, shipping methods, promotions, stores, products, inventory
and custom objects — in dependency order, rewriting every reference by key.

**This is how you fill a project created "from scratch".** commercetools offers a sample
dataset only in the creation form, and nothing can add one afterwards; your own catalog is
a better staging baseline anyway.

Source is `packages/console/production.admin.env`, target `authoring.admin.env`; override
with `--from=` and `--to=`. It refuses to run when both resolve to the same project.

**Safe to re-run.** Each stage matches existing target rows by key — by `(sku,
supplyChannel)` for inventory, `container/key` for custom objects — and skips them, so an
interrupted run resumes and a finished one reports all-skipped.

Three details the copy has to get right, each of which silently corrupts the target if
missed:

- **Project settings come from the data, not the source project's settings.** A product can
  carry locales the project no longer lists, and creating it in a project that does not
  allow that locale fails. The tool scans every LocalizedString, price and tax rate, then
  widens the target's languages, currencies and countries to the union.
- **An enum attribute reads back as `{key, label}` and is written as the key alone.** Sets
  of enums likewise. The tool drives this off each product type's attribute definitions.
- **A price's uniqueness scope includes `recurrencePolicy`.** Drop it and a subscription
  product's per-interval prices collapse into duplicates, and commercetools rejects the
  create with `DuplicatePriceScope`.

Reference *attributes* are the one thing needing two passes: their values are
`{typeId, id}` rather than a key, so a product pointing at another product is created
first and the reference set afterwards, once every target id exists.

### What it does not copy

| | Why | Instead |
|---|---|---|
| Customers | commercetools cannot export a password, so copies would be accounts nobody can sign into | [`seed-auth-customers.mjs`](#seed-the-demo-personas) then `seed-acl-users.mjs` |
| Orders | they reference customers, and a staging catalog needs no history | [`seed-demo-orders.mjs`](#seed-dashboard-data) |

## Reconcile the branch registry

```bash
node tools/reconcile-branch-registry.mjs           # read-only audit
node tools/reconcile-branch-registry.mjs --apply   # backfill missing entries
```

Read-only unless `--apply` is passed.

Each branch keeps a registry of its forked assets. A concurrency gap in how the
release-deploy service records a fork can leave a working copy that physically exists but is
unregistered, and its fork is a no-op once the copy exists, so it never self-heals. Deploy,
merge and close all iterate the registry, so an unregistered working copy is silently left
out of its release's deploy.

This script treats the physical resources as the source of truth and re-derives the registry
to match. The mechanism is described in
[architecture](architecture.md#why-existence-is-probed-not-trusted).

Run the audit when a release deploys fewer resources than it lists as members.

## The service's scripts

Run from `packages/release-deploy`, on the service's own credentials. Full usage in
[its README](../packages/release-deploy/README.md); every one of them is dry-run by default
and needs `--apply` to write.

| Script | What it does |
|---|---|
| `bin/cli.mjs` | The pipeline by hand: `audit`, `serialize`, `validate`, `deploy`, `rebaseline`, and `release list\|show\|create\|members\|status`. |
| `bin/clone-reference.mjs` | Seed a target project's reference layer — product types, categories, channels, stores, tax categories, states — by key, in dependency order. The prerequisite for a release validating against a fresh project. Create-if-absent, never overwrites. |
| `bin/clone-b2b.mjs` | Clone the login and B2B layer for functional parity: associate roles, then customers, then business units. Re-creates customers with a known password, since commercetools cannot export a hash, and emits an id map. |
| `bin/clone-custom-objects.mjs` | Clone whole CustomObject containers preserving `container/key`, emitting the id map that reference attributes need. |
| `bin/baseline-production.mjs` | Give every keyed production asset a `__prod__` v1 rollback floor, so an asset no release has touched yet can still be rolled back. Idempotent. |
| `bin/backup.mjs` | Full project export — every queryable resource endpoint plus project settings, into timestamped JSON with a per-entity manifest. |
| `bin/migrate-containers.mjs` | Copy CustomObjects from legacy container names to the current `release-*` ones. Copy first, delete later, in two deliberate steps. |
| `bin/seed-acl.mjs` | Grant the bootstrap admin a role, which is what turns ACL enforcement on. Until one exists the service is **fail-open**. |
| `bin/setup-events.mjs` | Create or update the commercetools Subscription feeding auto-add. |
| `bin/notify-check.mjs` | Send one sample notification to verify `EMAIL_*` end to end. |

## Adding a script

Decide which package owns it first: anything that provisions or seeds a project belongs in
`packages/console/tools`, anything that drives the pipeline belongs in
`packages/release-deploy/bin`. A script in the wrong one needs the wrong credentials.

Take credentials from `loadAdminEnv()` rather than a hardcoded path, so it works on someone
else's machine. Take container names from `containers.mjs` rather than literals, so a rename
lands in one place. Take catalog conventions from `catalogConfig()` so seeded data matches
what the console displays. Say in the header comment which project the script writes to, and
whether it is idempotent.
