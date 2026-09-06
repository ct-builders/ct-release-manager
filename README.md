# Release Manager

Ship catalog and promotion changes to a live commercetools store as a reviewable, atomic,
revertible **release**.

Merchandisers edit products, categories and discounts inside a named release. Every edit
lands on a private working copy, never on live data. When the release is approved, one
deploy applies the whole bundle to production, and one rollback takes it back out.

This is not a storefront. It is the internal tool between "someone decided to change the
catalog" and "the change is live".

> **[MIT](LICENSE), freely available, `AS IS` and unsupported.** Reference code from the
> [`ct-builders`](https://github.com/ct-builders) org — not a commercetools product, and
> commercetools Support cannot help with it. Read [SUPPORT.md](SUPPORT.md) before you build
> on it, particularly the section on pointing it at a production project, which is what it
> is for.

## What a release gives you

- **A batch with a name.** Twelve price changes, a new category and two promotions ship
  together or not at all, instead of trickling into production one save at a time.
- **Review before live.** `draft → ready-for-review → approved → published`, each
  transition gated on a role and recorded with who, when, and any note.
- **Editing that cannot touch production.** The first edit of a product inside a release
  forks a private copy. Production stays untouched until the deploy runs.
- **A diff you can read before you commit to it.** Per-resource create/update/no-op counts,
  plus a check that every reference the release needs already exists in production.
- **A field-level merge.** Two releases that edited different fields of the same product
  merge cleanly; only a field both changed to different values asks a human.
- **One-step rollback.** A deploy snapshots what production looked like beforehand, so
  rolling back deletes what it created and reverts what it updated.

The full inventory is in [FEATURES.md](FEATURES.md).

## Packages

| Package | What it is | Runs on |
|---|---|---|
| [`packages/console`](packages/console) | The authoring console: products, categories, discounts, releases, dashboard, permissions | Next.js 16 · any Node host (Netlify by default) |
| [`packages/release-deploy`](packages/release-deploy) | The release state machine and every production write — branch, fork, merge, diff, deploy, rollback — as an HTTP service plus a CLI | Zero-dependency Node ESM · any container host |
| [`packages/mc-releases`](packages/mc-releases) | "Release Deployments": the same release workflow inside Merchant Center | Merchant Center Custom Application |
| [`packages/mc-branch-editor`](packages/mc-branch-editor) | Branch-scoped product authoring inside Merchant Center | Merchant Center Custom Application |

**Two front ends, one service.** The console and the Merchant Center apps are alternatives,
not layers — pick whichever suits the team. Neither reimplements the release mechanics;
both call `release-deploy`, which is the only component holding write credentials for the
production project.

Each package keeps its own `package.json`, lockfile and deploy configuration. There is no
workspace hoisting, deliberately: it is what lets the dependency-free service and the two
appkit apps be built, tested and deployed independently.

## How it fits together

```
  packages/console              packages/mc-releases
  the authoring console         packages/mc-branch-editor
  (Next.js)                     Merchant Center custom apps
         │                             │
         └──────────────┬──────────────┘
                        │ HTTP + bearer token
         ┌──────────────▼──────────────┐
         │ packages/release-deploy     │
         │ the release state machine,  │
         │ and every production write  │
         └──────┬───────────────┬──────┘
   read + write │               │ read + write
   ┌────────────▼─────────┐  ┌──▼───────────────────┐
   │ AUTHORING project    │  │ PRODUCTION project   │
   └──────────────────────┘  └──────────────────────┘
```

Two commercetools projects, and which one gets written is the whole design. The
**authoring** project holds the catalog being edited, the release data and the access list.
The **production** project is written only by the service; the console reads it read-only,
for the dashboard's sales figures, and holds no write credentials for it at all.

[docs/architecture.md](docs/architecture.md) covers working copies, merge, deploy, rollback
and where each kind of data lives.

## Quick start

You need two commercetools projects and a running deploy service. Starting from nothing,
follow [docs/setup.md](docs/setup.md) instead — it provisions both projects, their API
clients, the service and the seed data in order.

```bash
npm run install:all

cp packages/release-deploy/.env.example packages/release-deploy/.env
cp packages/console/.env.example packages/console/.env.local
$EDITOR packages/release-deploy/.env packages/console/.env.local

npm run service                      # the deploy service on :8080
npm run dev                          # the console on :3000, in a second terminal
```

Point the console's `RELEASE_SERVICE_URL` at the service, and fill in the block its
`.env.example` marks `REQUIRED`. The service needs credentials for **both** projects
(`STAGE_CTP_*` and `LIVE_CTP_*`); the console needs write credentials for the authoring
project and read-only ones for production.

Open [http://localhost:3000](http://localhost:3000) and sign in as `BOOTSTRAP_ADMIN_EMAIL`.
That one account holds admin until the access list has real entries in it; grant yourself
Admin under **Permissions** and it stops depending on an environment variable.

## Making it yours

Nothing about a particular company or catalog is compiled in. The name in the chrome, the
locale and currency, which product attributes get columns of their own, and which
storefronts the sidebar links to are all environment variables read through
[`packages/console/lib/config.ts`](packages/console/lib/config.ts), with working defaults.

Two settings do most of the work:

- **`NEXT_PUBLIC_FACET_ATTRIBUTE`** (default `brand`) — the low-cardinality product
  attribute the catalog filters and groups by. Its distinct values are read from the
  catalog, so nothing needs declaring up front.
- **`NEXT_PUBLIC_CODE_ATTRIBUTE`** (default `partNumber`) — the secondary identifier shown
  next to the product name and carried in CSV import and export.

Set either to an empty string and its column, filter, wizard field and CSV column all
disappear. Every variable is listed in [docs/configuration.md](docs/configuration.md).

## Development

Run from the repo root. Every script delegates into a package, so there is nothing to
install at the root.

| Command | What it does |
|---|---|
| `npm run install:all` | Install the three packages that have dependencies. |
| `npm run dev` | The console's dev server on port 3000. |
| `npm run service` | The deploy service on port 8080. No build step. |
| `npm test` | The service's unit tests. No credentials, no network, ~150ms. |
| `npm run typecheck` | The console and both Merchant Center apps. |
| `npm run lint` | The console and both Merchant Center apps. |
| `npm run build` | Production build of the console. |
| `npm run predeploy` | All of the above, in order. **Run this before every deploy.** |
| `npm run test:e2e` | The service's end-to-end suite. Writes to two real projects — see below. |
| `npm run service:cli -- …` | Any deploy-service CLI command. |
| `npm run service:audit` | Which resources lack a `key`, and so cannot ship. |

**`npm run predeploy` is the whole gate.** There is no CI in this repository; that is
deliberate, not an omission. It runs in well under a minute and covers everything a change
to the console or the service can break locally.

**The end-to-end suite is deliberately outside it.** `npm run test:e2e` talks to two real
commercetools projects, creates and deletes data in both, and takes minutes rather than
milliseconds. Run it when you have changed the deploy path, against projects you are
willing to have written to. It refuses to run unless the resolved project key matches
`E2E_STAGE_PROJECT` — see
[`packages/release-deploy/test/README-e2e.md`](packages/release-deploy/test/README-e2e.md).

`npm run lint` reports 17 warnings and no errors in the console. Most are unused-variable
findings. The editors also reset local form state from a prop when the resource they are
editing changes, which React 19 flags: fixing it means keying the editor or deriving the
form rather than storing it, so the rule is set to `warn` in
[`packages/console/eslint.config.mjs`](packages/console/eslint.config.mjs) and a genuinely
new error still fails `predeploy`.

Read the bundled guide under `node_modules/next/dist/docs/` before writing code against a
Next.js API. This version's conventions differ from earlier ones, and the bundled docs match
the installed version.

## Documentation

| Document | Covers |
|---|---|
| [docs/setup.md](docs/setup.md) | Provisioning from nothing: two projects, API clients, the service, seed data, first release. |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, its default, and what changes when you set it. |
| [docs/architecture.md](docs/architecture.md) | Working copies, merge, deploy and rollback, access control, and where each kind of data lives. |
| [docs/operations.md](docs/operations.md) | The operator scripts. |
| [FEATURES.md](FEATURES.md) | Feature-by-feature inventory of what is implemented. |
| [`packages/release-deploy/README.md`](packages/release-deploy/README.md) | The service's HTTP contract, CLI, and email notifications. |
| [`packages/mc-releases/REGISTRATION.md`](packages/mc-releases/REGISTRATION.md) | Registering the Merchant Center custom applications. |
| [SUPPORT.md](SUPPORT.md) | What "unsupported" means, and the checklist before production. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | The SPDX header requirement and how to run the checks. |
