# Architecture

The console is a Next.js App Router app (Next 16, React 19, Tailwind v4) that is almost
entirely server components calling commercetools over plain `fetch`. It owns the editing
experience and the read models behind it. It does not own the release mechanics — branch,
fork, merge, deploy and rollback all live in a separate service.

## The pieces

Four surfaces, one service, two commercetools projects.

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
   │                      │  │                      │
   │ catalog · discounts  │  │ catalog · discounts  │
   │ customers — sign-in  │  │ orders               │
   │ release-acl          │  │                      │
   │ release-registry     │  │                      │
   │ release-branch       │  │                      │
   │ release-asset-history│  │                      │
   │ release-config       │  │                      │
   │ rm-user-prefs        │  │                      │
   │ rm-discount-layout   │  │                      │
   └────────────▲─────────┘  └──────────▲───────────┘
                │                       │
                │ read + write          │ read-only
                └─── packages/console ──┘
```

Each commercetools client is defined in [`lib/ct.ts`](../packages/console/lib/ct.ts): `ct` (authoring) and
`prodCt` (production). Credentials come from [`lib/env.ts`](../packages/console/lib/env.ts); see
[configuration](configuration.md#commercetools-projects).

**Why production is separate.** The console holds no write credentials for it, so it cannot
change live data even by mistake — every production write goes through the release-deploy
service, which is the point of the whole design. The dashboard reads it directly, which is
why the console needs the read-only client at all.

**Why console users live in the authoring project.** Because the alternative costs a third
project, a third client to rotate, and six more environment variables, and buys only that a
catalog re-seed leaves the logins alone — which is two script runs to restore. The cost of
sharing is that the same project holds storefront shoppers; the access list settles that by
becoming the roster, rather than separating the data. See
[access control](#access-control).

## The release-deploy service

An HTTP service the console calls through [`lib/service.ts`](../packages/console/lib/service.ts). It holds the
release state machine and every operation that spans projects:

| Endpoint group | Owns |
|---|---|
| `/releases` | Create, list, read, transition, set members, set auto-add config |
| `/releases/:key/validate` | Is every reference the release needs present in production? |
| `/releases/:key/diff` | Dry-run create/update/no-op/error counts, a content hash, and a drift verdict |
| `/releases/:key/merge` | Field-level three-way merge of a release's edits onto the trunk |
| `/releases/:key/deploy` | Apply the release to production, snapshotting a baseline first |
| `/releases/:key/undeploy` | Restore production to that baseline |
| `/branches` | Create a branch, fork a resource onto it |
| `/resources/key-audit` | Which resources lack a `key`, per project |

The bearer token in `RELEASE_SERVICE_TOKEN` is server-side only and never reaches the
browser. The signed-in email is threaded through as the actor on every call, so the service
attributes each lifecycle transition and enforces roles independently of the console.

The console sends `?project=<alias>`, defaulting to `stage` and overridable with
`RELEASE_SERVICE_PROJECT`. That alias is the service's own name for the authoring project,
not the commercetools project key.

**The mapping lives in the service, so it is the service that decides which commercetools
projects get written to.** A given instance is deployed against one authoring and one
production project; this console cannot redirect it by sending a different alias. An alias the
instance does not recognise resolves to its production project rather than failing, which
makes a mis-wired `RELEASE_SERVICE_URL` quietly dangerous rather than merely broken — see
[Pointing at the right service](setup.md#pointing-at-the-right-service).

## Working copies

**A release's edits live on a branch, and the UI never says "branch".** In the interface a
branch is a release's *private working copy*; the word appears only in code.

The encoding, in [`lib/branch.ts`](../packages/console/lib/branch.ts):

| Value | Canonical | On a branch |
|---|---|---|
| key, SKU, discount code | `front-brake-pads` | `front-brake-pads__b__r-spring-sale` |
| slug | `front-brake-pads` | `front-brake-pads-b-r-spring-sale` |

Two different delimiters because a slug may only contain characters that are URL-safe in a
storefront path. Every list and detail view strips the suffix back to the canonical value
before display.

### Fork on first edit

Editing a product, category or discount while a release is active does three things in one
step ([`lib/product-edit.ts`](../packages/console/lib/product-edit.ts),
[`lib/resource-edit.ts`](../packages/console/lib/resource-edit.ts)):

1. Provisions a branch for the release, if it is still on the trunk.
2. Copies the resource onto that branch under the suffixed key.
3. Adds the resource to the release's members.

Production and the trunk stay untouched until the deploy. Subsequent edits go straight to the
working copy.

### Why existence is probed, not trusted

Each branch keeps a registry of its forked assets in a custom object. The service records a
fork by reading that object, adding an entry, and writing it back, with no optimistic
concurrency guard — so two forks onto the same branch can race and drop one entry, leaving a
working copy that physically exists but is unregistered. Its fork is also a no-op once the
copy exists, so it never self-heals.

**The physical resource is the source of truth.** Before editing, the console asks
commercetools whether the suffixed resource exists rather than believing the registry, and a
transient error resolves to "it exists" on purpose: editing a missing working copy surfaces
as a visible not-found, which is safe, where the opposite mistake writes to the live
resource.

The registry still matters for correctness at deploy time, because deploy, merge and close
all iterate it. [`tools/reconcile-branch-registry.mjs`](../packages/console/tools/reconcile-branch-registry.mjs)
re-derives it from the physical resources; see [operations](operations.md#reconcile-the-branch-registry).

## The lifecycle

```
  draft ──────────► ready-for-review ──────────► approved ──────────► published
    ▲                     │                                              │
    │      send back      │                                              │
    └─────────────────────┘                                    rolled-back
                                                                        ▲
                                                          roll back ────┘
```

| Status | The button | Capability | What it does |
|---|---|---|---|
| `draft` | Publish to staging for review | `edit` | Publishes the release's products so the staging storefront serves them, and advances the release to `ready-for-review`. Reports per-resource counts. |
| `ready-for-review` | Approve | `approve` | Advances to `approved`. |
| `ready-for-review` | Send back | `approve` | Returns to `draft`. Refused without a note saying why. |
| `ready-for-review` | Re-publish to staging | `edit` | Pushes further edits to staging without changing status. |
| `approved` | Ship to production | `publish` | Deploys. Disabled while any merge to the trunk is unresolved. |
| `published` | Roll back last deploy | `publish` | Restores production to its pre-deploy baseline and marks the release `rolled-back`. |

Every transition appends to the release's `history[]` with the actor, the timestamp and any
note. `capabilityForStatus()` in [`lib/acl.ts`](../packages/console/lib/acl.ts) is the mapping;
`assertCan()` gates every server action.

An admin can deploy straight to production from any status, skipping review and approval. It
is a separate button, labelled as a fast path, and it still records the transition.

### Members and deletions

A release tracks which resources it touches, in six buckets: products, categories, cart
discounts, product discounts, discount codes, discount groups. Resources join a release
either by being picked explicitly or by being edited while that release is active.

A release can also mark existing resources for **removal** from production on deploy. Those
are held separately from members and shown as struck-through chips.

### Merge before ship

Before a release can ship, its working-copy edits must be folded onto the shared trunk,
because a second release may have changed the same fields in the meantime. The merge is
field-level and three-way: each touched resource reports as mergeable, an add, a conflict, or
already merged, and each conflicting field offers a side-by-side choice between this
release's value and the trunk's. Resolutions go back with the apply call.

Shipping stays blocked while any unresolved merge remains.

### Preview before ship

Two checks, both dry runs:

- **Validation** — every reference the release needs (categories, tax categories, product
  types) already exists in production. A missing one is reported with the resource, key and
  field.
- **Diff** — per-resource create, update, no-op and error counts, plus a **drift** verdict
  comparing the hash of the last shipped state against the current authoring state:
  in-sync, drifted, or never-shipped.

### Rollback

A deploy snapshots what production looked like beforehand, keyed `__prod__`. Rolling back
deletes what the deploy created and reverts what it updated, from those baselines. It
restores the state immediately before the release's most recent deploy, so it undoes one
deploy rather than winding back arbitrarily far.

Every deploy, rollback and dry run is listed on the release with its timestamp, kind, whether
it applied, and its counts.

## Access control

Roles live as custom objects in the authoring project, container `release-acl`, keyed by
base64url of the lowercased email.

| Role | Capabilities |
|---|---|
| `author` | `edit` |
| `reviewer` | `approve` |
| `publisher` | `publish` |
| `admin` | all, plus managing other people's roles |

**The access list is the roster, not just the permission table.** Signing in takes two
checks, in this order ([`app/api/auth/login/route.ts`](../packages/console/app/api/auth/login/route.ts)):

1. **Who are you?** A commercetools **Customer** sign-in against the authoring project
   ([`lib/auth-ct.ts`](../packages/console/lib/auth-ct.ts)). commercetools holds the password; this app never
   stores or hashes one.
2. **May you be here?** A `release-acl` entry must exist. Without one the response is `403`, not
   a session.

The second check is what makes the shared project safe. That project also holds storefront
shoppers, and a shopper is a Customer like any other — so a correct password admits nobody
who is not on the list. The two failures report differently on purpose: a wrong password is
`401`, a missing entry is `403` naming what to ask an administrator for, because a real user
whose access-list email was mistyped would otherwise debug the wrong thing.

**`BOOTSTRAP_ADMIN_EMAIL` is the way into a fresh install.** An empty access list admits
nobody, so that one named account holds admin until a real entry exists. It is server-side
only, never reaches the browser, and the Permissions page prompts whoever uses it to grant
themselves Admin so access stops depending on an environment variable.

The session is a signed JWT (`jose`, HS256) in an httpOnly cookie, 30-day expiry. The
signed-in email is what identifies the actor to the release-deploy service.

## Where each kind of data lives

| Data | Project | Container or resource | Written by |
|---|---|---|---|
| Products, categories, discounts | Authoring | native resources | Console, service |
| Releases | Authoring | `release-registry` | Service |
| Branch registries | Authoring | `release-branch` | Service |
| Per-asset checkpoints | Authoring | `release-asset-history` | Service |
| Service configuration | Authoring | `release-config` | Service |
| Role assignments (the roster) | Authoring | `release-acl` | Console, service |
| Console user accounts | Authoring | `customers` | Console |
| Per-user UI preferences | Authoring | `rm-user-prefs` | Console |
| Discount-editor layout | Authoring | `rm-discount-layout` | Console |
| Products, categories, discounts | Production | native resources | Service |
| Orders behind the dashboard | Production | native resources | Nobody — read-only |

The names are constants in three places that have to agree — the console's
[`lib/containers.ts`](../packages/console/lib/containers.ts), its
[`tools/containers.mjs`](../packages/console/tools/containers.mjs) mirror for the operator
scripts, which run outside the Next.js build and cannot import TypeScript, and the service's
[`lib/registry.mjs`](../packages/release-deploy/lib/registry.mjs) and
[`lib/acl.mjs`](../packages/release-deploy/lib/acl.mjs). Every `release-*` name is a wire
contract rather than a preference: renaming one on one side does not migrate the data under
it, it makes that side read an empty store.

**`release-acl` is one roster with two readers, and that is deliberate.** The console decides
who may sign in and what the UI offers; the service independently decides who may approve and
publish, and who to notify. Splitting them would let a role granted in the console mean
nothing at the endpoint that actually writes to production — and since the service treats an
empty ACL as open access, the failure would present as a locked-down UI in front of an
ungated service.

A project provisioned by an older revision holds the same data under older names. The service
ships [`bin/migrate-containers.mjs`](../packages/release-deploy/bin/migrate-containers.mjs)
to copy it across; run that before pointing this console at the project.

## Active release

The release you are working in is a cookie-backed selection (`rm_release`), surfaced in the
top bar and read by every edit action. Editing without one selected is refused rather than
silently applied to live, and the message says which control to use.

## The predicate builder

Discount predicates are edited visually and stored as commercetools predicate strings. The
round trip is guarded in [`lib/predicate/parse.ts`](../packages/console/lib/predicate/parse.ts): a raw
predicate is only shown in the visual builder when re-serializing it reproduces the original
string exactly. Anything else falls back to a raw text field, so the builder can never
silently rewrite a predicate it did not fully understand.

Field catalogs come from two places. Static base fields for each context (cart, line item,
product, custom line item) are declared in
[`lib/predicate/catalog.ts`](../packages/console/lib/predicate/catalog.ts). Product-type attributes, custom
fields and customer groups are read live from the authoring project in
[`catalog.server.ts`](../packages/console/lib/predicate/catalog.server.ts) and passed to the client as plain
data, so a new attribute becomes filterable without a code change.

## Deployment

The console builds with `next build` and runs on any Node host; the bundled
[netlify.toml](../packages/console/netlify.toml) configures Netlify via
`@netlify/plugin-nextjs`. It ships no authentication of its own beyond the sign-in
described above, so put your own gate in front of it if it faces anything wider than a
trusted network.

Run `npm run predeploy` first. A dev server neither type-checks nor produces the production
bundle, so it will not catch what a deploy catches.
