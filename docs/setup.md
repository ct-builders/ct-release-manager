# Setup

From nothing to a working release pipeline. Budget an hour the first time, most of it
waiting on commercetools project creation.

You need Node 22 (see [`.nvmrc`](../packages/console/.nvmrc)) and a commercetools
organization you can create projects in. Everything else is in this repository.

Two projects get created, two API clients get minted per project, the deploy service runs
against both, and the console runs against the service. In that order — each step needs the
one before it.

**If you are reusing a deploy service somebody else already deployed, read
[Pointing at the right service](#pointing-at-the-right-service) first.** The service holds
its own commercetools credentials and its own alias for each project, so an instance
deployed for someone else's projects acts on *their* data no matter what this console sends
it, and says nothing about it.

Operator commands below run from the package that owns them. `cd` once at the top of each
step rather than per command.

## 1. Create the two commercetools projects

| Project | Holds | Sample data |
|---|---|---|
| Authoring | The catalog you edit, release and branch records, and this console's own users and roles | Yes — pick a sample dataset at creation |
| Production | The live catalog and its orders | Yes, or your real live project |

**Pick the sample dataset in the creation form.** commercetools will not add one afterwards,
and an empty catalog gives you nothing to make a release out of. The form defaults to
*Start from scratch*, which is the wrong choice here.

If you already created it empty, copy your live catalog in instead:

```bash
cd packages/console
node tools/provision-stage.mjs --dry-run
node tools/provision-stage.mjs --verify
```

That is usually the better staging baseline anyway — see
[Provision a staging project](operations.md#provision-a-staging-project). The console
handles an empty project without erroring, every page renders, but the create wizard needs
at least one product type and a release needs something to put in it.

Create both in the **same region**. The console holds one auth host and one API host per
project, and a mismatched region 404s every call.

**Activate the Product Search API on the authoring project.** The console uses it whenever
someone types in the product search box, and new projects have it off. Left off, that request
fails with `404 Project "<key>" does not exist` — the documented `ObjectNotFound` for an
inactive index, which reads like a credentials fault and is not one.

`tools/provision-stage.mjs` does this for you. To do it by hand, use the Merchant Center
under *Settings → Project settings → Storefront Search*, or the API, where **`mode` is not
optional**:

```bash
curl -X POST "$CTP_API_URL/$CTP_PROJECT_KEY" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":<n>,"actions":[
        {"action":"changeProductSearchIndexingEnabled","enabled":true,"mode":"ProductsSearch"}]}'
```

Omit `mode` and the action targets `ProductProjectionsSearch` instead — the deprecated index,
which commercetools refuses to activate on any project created after 31 August 2026:
*"Product Projection Search (and Search Term Suggestions) cannot be activated for Projects
created on or after 2026-09-01."*

**Both search indexes deactivate themselves after 30 consecutive days with no calls.** A
project that sits idle for a month comes back with its product search broken and the same
misleading 404. Re-run the action above to bring it back.

For a first look you can point authoring and production at the same project. Releases then
deploy onto the catalog you are editing, which makes the diff and rollback steps
uninteresting, so separate them before showing anyone.

## 2. Create an admin client per project

Each project needs one client with **both** `manage_project` **and** `manage_api_clients` —
the second is what lets it mint the least-privilege clients the console actually runs on. A
client cannot grant itself a scope it does not have, so add both at creation.

Save each one in `packages/console/`, using the filename the scripts look for:

| File | Project |
|---|---|
| `packages/console/authoring.admin.env` | Authoring |
| `packages/console/production.admin.env` | Production |

Each holds `CTP_PROJECT_KEY`, `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`, `CTP_AUTH_URL`,
`CTP_API_URL` and `CTP_SCOPES`. `*.admin.env` is gitignored.

These files are for the operator scripts only. The running console never sees them.

## 3. Mint the least-privilege clients

```bash
npm run install:all
cd packages/console
cp .env.example .env.local
```

Then one command per project. Each prints `.env` lines on stdout, so append them:

```bash
node tools/ensure-client.mjs authoring  >> .env.local
node tools/ensure-client.mjs production >> .env.local
```

An API client's secret is returned only at creation, so a client of the same name is deleted
and recreated. The credentials you get are always fresh, and any deploy still running on the
old pair stops working — re-run the command and update that deploy's environment.

Scopes per role are listed in [configuration](configuration.md#commercetools-projects).

## 4. Start the deploy service

The service is what writes to production, and the console is useless without it. It needs
credentials for **both** projects, and it takes no build step.

```bash
cd packages/release-deploy
cp .env.example .env
```

Set `STAGE_CTP_*` to the authoring project and `LIVE_CTP_*` to production, using the same
scoped clients from step 3 — or mint the service its own pair, which is better practice
since it needs write access to both. Then pick a token and run it:

```bash
# in .env
DEPLOY_SERVICE_TOKEN=$(openssl rand -base64 32)

npm start          # or: npm run service, from the repo root
curl localhost:8080/health
```

**Set `DEPLOY_SERVICE_TOKEN`.** Leave it unset and the service skips its bearer check
entirely — convenient locally, and it means every endpoint that writes to production is
open to anyone who can reach the URL.

**Set both prefixes.** A missing `STAGE_CTP_*` falls back to the un-prefixed `CTP_*`, which
resolves *both* projects to the same one. That is deliberate — it is the live→live self-test
— but it is also how a half-configured service quietly aims every write at one project
rather than failing. Confirm the two resolved keys differ before you deploy anything:

```bash
curl -s "localhost:8080/catalog/members?project=stage" | head -c 200   # names the project
```

## 5. Fill in the rest of the console's environment

In `packages/console/.env.local`:

```bash
RELEASE_SERVICE_URL=http://localhost:8080     # the service from step 4
RELEASE_SERVICE_TOKEN=                        # the DEPLOY_SERVICE_TOKEN you just set
SESSION_SECRET=                               # openssl rand -base64 48
BOOTSTRAP_ADMIN_EMAIL=you@yourcompany.com
```

`BOOTSTRAP_ADMIN_EMAIL` is the only account that can sign in before the access list has
anyone in it. Leave it blank and step 7 locks you out.

That is everything required. Everything else has a default —
see [configuration](configuration.md).

## 6. Create the sign-in accounts

Signing in takes two things: a commercetools Customer record in the authoring project (the
password), and a `release-acl` entry (the admission). One without the other does not work — a
Customer with no entry gets a `403`, and an entry with no Customer has nothing to sign in
with.

To get four working sign-ins immediately, seed the sample personas and their roles:

```bash
cd packages/console
node tools/seed-auth-customers.mjs
node tools/seed-acl-users.mjs
```

Roles go into `release-acl`, which the service reads too — so a role granted here is the
role it enforces on approve and publish. Granting nobody a role leaves the service
**fail-open**, with every capability available to everyone, so do this rather than skip it.

Both read the persona list from `NEXT_PUBLIC_DEMO_USERS` and are idempotent. Details in
[operations](operations.md#seed-the-demo-personas).

For a real install, create Customers in the authoring project by whatever route you already
use, set `NEXT_PUBLIC_DEMO_LOGIN=false`, and grant each person a role through
`/settings/permissions` once you are signed in as `BOOTSTRAP_ADMIN_EMAIL`.

## 7. Start the console

```bash
npm run dev          # from the repo root
```

Open [http://localhost:3000](http://localhost:3000) and sign in as `BOOTSTRAP_ADMIN_EMAIL`
(that account needs a Customer record too — the seeder in step 6 creates one if it is in your
persona list). Grant yourself **Admin** under Permissions, and your access stops depending on
an environment variable.

## 8. Make a release and ship it

This is the shortest path that exercises the whole mechanism:

1. **Releases → New release.** Give it a key and a title. A working copy is provisioned as
   soon as it exists.
2. **Pick it in the top bar.** Every edit action needs an active release and refuses without
   one.
3. **Products → open one → change the name or a price → Save.** The product forks onto the
   release's private working copy and joins its members. Production is untouched.
4. **Back to the release → Publish to staging for review.** The release advances to
   `ready-for-review`.
5. **Approve.** Needs the reviewer capability, which you have as admin.
6. **Merge to main**, resolving any conflicting field. Shipping stays blocked until this is
   clear.
7. **Preview**, and read the create/update/no-op counts and the missing-reference check.
8. **Ship to production.**
9. **Roll back last deploy**, and confirm production returns to what it was.

If the preview reports missing references, the authoring project has resources production
does not — usually categories or tax categories. Create them in production, or drop them
from the release.

## 9. Configure it for your organization

| Want | Set |
|---|---|
| Your own name in the chrome | `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `NEXT_PUBLIC_APP_LOGO` |
| A non-US locale or currency | `NEXT_PUBLIC_LOCALE`, `NEXT_PUBLIC_CURRENCY`, `NEXT_PUBLIC_FX_RATES` |
| Your catalog's own featured attributes | `NEXT_PUBLIC_FACET_ATTRIBUTE`, `NEXT_PUBLIC_CODE_ATTRIBUTE` |
| Storefront links in the sidebar | the four `NEXT_PUBLIC_*_STOREFRONT_*` variables |
| Real sign-ins only | `NEXT_PUBLIC_DEMO_LOGIN=false` |
| The first account into a new install | `BOOTSTRAP_ADMIN_EMAIL` |

These are `NEXT_PUBLIC_*`, so they are baked in at build time. Set them before you build, and
rebuild after changing one.

## 10. Give the dashboard something to show

The dashboard reads real orders from the production project. On a project with no order
history it renders zeros. Two scripts fill it in:

```bash
cd packages/console
node tools/seed-demo-orders.mjs    # ~160 orders spread over 35 days
node tools/seed-promo-orders.mjs   # orders that trigger the project's active promotions
```

Both write to the **production** project. Read
[operations](operations.md#seed-dashboard-data) before running either against a project whose
orders matter.

## Pointing at the right service

`RELEASE_SERVICE_URL` must be an instance provisioned for *your* authoring and production
projects, and `RELEASE_SERVICE_PROJECT` must be an alias that instance recognises.

**An unrecognised alias does not error.** Measured against a service deployed for a different
pair of projects: `project=stage` and `project=live` resolved to that service's own two
projects, and every other value — including a real commercetools project key it had never
heard of — resolved to its **production** project. An empty value resolved to its staging one.

```
project="stage"              ->  <the service's staging project>
project="live"               ->  <the service's production project>
project="my-real-project"    ->  <the service's production project>   ← silent
project=""                   ->  <the service's staging project>
```

So a console wired to someone else's service will list their releases, show their catalog, and
fork and deploy against their production data, while its own commercetools clients point
somewhere else entirely. Nothing in the response says so.

Two checks before you trust the wiring:

1. `curl "$RELEASE_SERVICE_URL/catalog/members?project=$RELEASE_SERVICE_PROJECT"` and read the
   `project` field in the response. It names the commercetools project the service will act on.
   If that is not your authoring project, stop.
2. Confirm it matches `CTP_PROJECT_KEY`.

## Deploying

```bash
npm run predeploy
```

From the repo root: the service's unit tests, then typecheck and lint across the console and
both Merchant Center apps, then the console's production build. A dev server does none of
that, so this is the gate — there is no CI.

Then deploy each package to its own host:

| Package | How |
|---|---|
| `packages/console` | Any Node host. Netlify by default, via `@netlify/plugin-nextjs`; the root [netlify.toml](../netlify.toml) sets `base = "packages/console"` and the rest comes from [that package's own](../packages/console/netlify.toml). |
| `packages/release-deploy` | Any container host, from source — no build step and no `node_modules`. For example `gcloud run deploy --source packages/release-deploy`. |
| `packages/mc-releases`, `packages/mc-branch-editor` | Separate static sites, one per app, each with its own base directory and `netlify.toml`. Registration steps in each package's `REGISTRATION.md`. |

Set the same environment variables in each host. The console's `NEXT_PUBLIC_*` values are
baked in at build time, so they must be present when the host builds, not only at runtime.

**The service's environment decides which commercetools projects get written.** Check
`STAGE_CTP_PROJECT_KEY` and `LIVE_CTP_PROJECT_KEY` on the deployed service, not just in your
local `.env`.
