# release-deploy

Stage → Live **release deploy** pipeline for a commercetools project pair.
Author promotions and product changes on a **stage** project, QA them on a stage
storefront, then deploy an approved **release** (a group of products + promotions)
into the **live** project — matched **by key**, idempotently.

Runs as a zero-build, zero-dependency Node HTTP service on any container host.
Three front ends drive it over that HTTP contract: the `console` package, and the
`mc-releases` and `mc-branch-editor` Merchant Center custom applications.

## Why key-based

commercetools `id`s are per-project UUIDs. The only reliable way to match a
resource across two projects is a stable `key` identical in both. Everything the
pipeline touches is keyed:

- `bin/... audit` (and `lib/key-audit.mjs`) reports any resource missing a key.
- Reference identifiers (product type, categories, tax category, state, stores,
  customer groups, channels, discount groups, code→cart-discount) are emitted as
  **key-based ResourceIdentifiers**, which CT resolves in the target project.
- Ids embedded inside predicate strings are captured per-discount in a
  `referenceMap` and rewritten source-id → target-id at deploy — a no-op when the
  predicates are already key-based.
- Embedded prices are matched by their `key`; a price's scope (currency / country
  / channel / customer group / validity) is baked into the key.

## Two projects, one config

Set `LIVE_CTP_*` and `STAGE_CTP_*` in this package's `.env` (see `.env.example`), or in
the monorepo root `.env` for credentials shared with the other packages. Any missing
prefixed var falls back to the un-prefixed `CTP_*`.

**That fallback is worth understanding before you deploy anything.** Set only `CTP_*` and
both projects resolve to the *same* project — which is the live→live self-test (serialize
a bundle out, deploy it back, every resource comes back a no-op), and which is also how a
half-configured deployment quietly aims every write at one project instead of failing. So
either set both prefixes, or read the resolved keys back from the service and confirm they
differ.

## CLI

```bash
node bin/cli.mjs audit    [--project live|stage] [--no-prices]
node bin/cli.mjs serialize [--project live] <selection> [--out bundle.json]
node bin/cli.mjs validate  [--from stage] [--to live] <selection|--release k>
node bin/cli.mjs deploy     [--from stage] [--to live] <selection|--release k> [--apply] [--by who]
node bin/cli.mjs rebaseline [--from live] [--to stage] [--apply]   # pull the WHOLE catalog src→tgt
node bin/cli.mjs release    list|show|create|members|status|delete ...
node bin/backup.mjs         [--project live] [--out dir]   # full project export
node bin/notify-check.mjs   <email> [--event submitted|approved|published|rejected]
```

`<selection>` = `--all-promotions` | `--cart-discounts a,b|*` | `--product-discounts *`
| `--discount-codes *` | `--discount-groups *` | `--categories k1,*|*` | `--products k1,k2|*`.

Deploy is **dry-run by default**; pass `--apply` to write. It refuses to deploy
if any reference is unresolved in the source or missing in the target.

**Cross-project ref attributes.** A product attribute of type `reference` to a
`key-value-document` holds a per-project id, so it cannot port by key the way the rest of
a bundle does. Pass `--remap-ref-attrs auto` (on deploy, validate or rebaseline) to build
the source-id → target-id map by matching CustomObject keys, naming the containers to
match with `--ref-containers`, or `--remap-ref-attrs <file.json>` for a prebuilt map. An
id the map does not cover has the attribute dropped rather than guessed at.

**Pass it if your products have one.** Without the flag those attributes are copied
through **verbatim**, carrying the source project's ids — which in the target resolve to
nothing, or to whatever unrelated document happens to hold that id. The deploy succeeds
either way, so this is a silent wrong answer rather than an error. `--strip-ref-attrs` is
the other honest option: drop them all and set them afterwards.

**`rebaseline`** pulls the entire catalog (products + categories + all promotions)
`--from live --to stage` (defaults), auto-remapping ref-attr ids — resetting the stage
authoring baseline to production. Dry-run by default; `--apply` to write.

## Releases

A release groups products + promotions and carries a lifecycle. Two publishes — to the
authoring project for review, then to production:

```
draft ──▶ ready-for-review ──▶ approved ──▶ published ──▶ rolled-back
```

Every legal edge, which is `TRANSITIONS` in [`lib/registry.mjs`](lib/registry.mjs).
Anything else is refused:

| From | May become | On |
|---|---|---|
| `draft` | `ready-for-review` | publish to the authoring project for review |
| `ready-for-review` | `approved` | approve |
| | `draft` | reject, note required |
| `approved` | `published` | a successful deploy to production |
| | `draft` | send back for revisions |
| `published` | `published` | re-deploy |
| | `rolled-back` | undeploy from production |
| | `draft` | start the next revision |
| `rolled-back` | `published` | re-deploy |
| | `draft` | start the next revision |

A transition to the state a release is already in is always allowed, which is what makes
re-deploying a `published` release a normal operation rather than a special case.

Stored as CustomObjects in the authoring project (`release-registry` container).
Approval requires `approver ≠ author`, unless the approver is an admin. Each deploy
records an audit entry and a content hash, so the front ends can flag **drift** when
authoring content changes after a deploy.

## HTTP service

`npm start` (`node server.mjs`) on `PORT` (default 8080). Bearer auth via
`DEPLOY_SERVICE_TOKEN` (skipped if unset). Routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/resources/key-audit?project=` | missing-key report |
| GET | `/releases?project=stage` | list releases |
| GET | `/releases/:key` | one release |
| POST | `/releases` | create |
| PUT | `/releases/:key/members` | set members |
| POST | `/releases/:key/status` | lifecycle transition |
| POST | `/releases/:key/validate` | resolve + check refs vs target |
| POST | `/releases/:key/diff` | dry-run per-resource actions + drift |
| POST | `/releases/:key/deploy` | deploy (`apply:true` to write) + audit |
| POST | `/releases/:key/undeploy` | restore production to the deploy's baseline |
| POST | `/releases/:key/merge` | apply a field-level merge onto the trunk |
| POST | `/releases/:key/stage-publish` | publish the release's products on the authoring project |
| GET | `/catalog/members` | pickable keyed resources for a member picker (cached 120s) |
| GET\|PUT | `/config` | auto-add configuration |
| POST | `/events` | Pub/Sub push of a commercetools change → auto-add |
| GET | `/branches`, `/branches/:id` | list / read a working copy |
| POST | `/branches`, `/branches/:id/status`, `/branches/:id/close` | create / transition / close |
| POST | `/branches/:id/fork` | fork a canonical resource onto a branch |
| POST | `/branches/:id/assets/:asset/save`, `/restore` | checkpoint / restore a version |
| GET | `/branches/:id/assets/:asset/versions` | version list |
| POST | `/branches/:id/merge-report` | classify each asset: mergeable / add / conflict |
| POST | `/products/:key/publish` | publish one product by canonical key, both projects |
| GET\|POST | `/acl`, `GET /acl/me`, `DELETE /acl/:key` | the roster |
| POST | `/deploy` | ad-hoc deploy (no release) |

## Email notifications

Lifecycle transitions send a **best-effort** email to the right people, resolved
from the [`release-acl`](lib/acl.mjs) roles on stage:

| Transition | Event | Recipients |
|---|---|---|
| author submits (`draft → ready-for-review`, incl. publish-to-stage) | `submitted` | everyone who can **approve** (reviewers) |
| reviewer approves (`→ approved`) | `approved` | everyone who can **publish** (publishers) |
| deployed to production (`approved → published`) | `published` | the release **author** |
| reviewer rejects / sends back (`ready-for-review → draft`) | `rejected` | the release **author** |

The hooks live where the state actually changes — `transition()` (submitted /
approved / rejected) and `recordDeployment()` (published) in
[`lib/registry.mjs`](lib/registry.mjs) — so both the `/status` and
`/stage-publish` routes are covered without double-sending. The acting user is
never emailed about their own action.

**Best-effort & non-blocking:** [`notifyTransition()`](lib/notify.mjs) never
throws and is bounded by a timeout, so a mail failure (bad key, provider down,
no config) can never break a lifecycle transition.

Configured entirely by env (see [`.env.example`](.env.example)):

| Var | Purpose |
|---|---|
| `EMAIL_ENABLED` | master switch; `false` disables (default on) |
| `EMAIL_PROVIDER` | `resend` \| `sendgrid` \| `postmark` \| `log` — auto-detected from whichever `*_API_KEY` is set, else `log` |
| `EMAIL_FROM` | sender, e.g. `Release Service <releases@example.com>` |
| `EMAIL_REPLY_TO` | optional reply-to |
| `EMAIL_TIMEOUT_MS` | provider HTTP timeout (default 5000) |
| `EMAIL_RELEASE_LINK_BASE` | optional; emails deep-link to `${base}/${key}` |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` / `POSTMARK_SERVER_TOKEN` | provider key |

With **no provider key set** the service uses the `log` transport — it prints the
intended email to the service log instead of sending, so the workflow runs without a
real email account and you can read the notifications in the service log. Verify a
real provider end-to-end with `node bin/notify-check.mjs you@example.com`.

## Tests

```bash
npm test            # 57 unit tests, no credentials, no network, ~150ms
npm run test:e2e    # writes to two real commercetools projects
```

The unit suite covers branch encoding and canonicalization, the compare-and-swap branch
registry under concurrent writes, field-level merge conflicts, deploy and publish,
production history, the approve gate, and notification recipient resolution.

`test:e2e` refuses to run unless the resolved project key matches `E2E_STAGE_PROJECT`,
which is the only thing between a stray `RUN_E2E=1` and a real catalog. See
[`test/README-e2e.md`](test/README-e2e.md).
