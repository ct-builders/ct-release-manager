# release-deploy

Stage → Live **release deploy** pipeline for a commercetools project pair.
Author promotions and product changes on a **stage** project, QA them on a stage
storefront, then deploy an approved **release** (a group of products + promotions)
into the **live** project — matched **by key**, idempotently.

Runs as a zero-build Node HTTP service (GCP Cloud Run today; commercetools
Connect later). The Merchant Center "Release Deployments" custom app
(`mc-releases`) drives it.

## Why key-based

commercetools `id`s are per-project UUIDs. The only reliable way to match a
resource across two projects is a stable `key` identical in both. Everything the
pipeline touches is keyed:

- `bin/... audit` (and `lib/key-audit.mjs`) reports any resource missing a key.
- Reference identifiers (product type, categories, tax category, state, stores,
  customer groups, channels, discount groups, code→cart-discount) are emitted as
  **key-based ResourceIdentifiers**, which CT resolves in the target project.
- Ids embedded inside predicate strings are captured per-discount in a
  `referenceMap` and rewritten source-id → target-id at deploy (a no-op when
  predicates are already key-based, as they are in your-live-project).
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

**Cross-project ref attributes.** Products carry a `fitmentList` key-value-document
reference whose id is per-project. Pass `--remap-ref-attrs auto` (deploy/validate) to
build the live-id→target-id map by matching CustomObject keys (`--ref-containers`
defaults to `fitment-list,vehicle`), or `--remap-ref-attrs <file.json>` for a prebuilt map.

**`rebaseline`** pulls the entire catalog (products + categories + all promotions)
`--from live --to stage` (defaults), auto-remapping ref-attr ids — resetting the stage
authoring baseline to production. Dry-run by default; `--apply` to write.

## Releases

A release groups products + promotions and carries a lifecycle:

```
draft → testing → approved → deployed
              ↑        ↑          │
              └────────┴──── rolled-back
```

Stored as CustomObjects in the **stage** project (`release-registry` container).
Approval requires `approver ≠ author`. Each deploy records an audit entry and a
content hash; the app flags **drift** when stage content changes after a deploy.

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

## Status

- ✅ key audit + backfill (live is 100% keyed)
- ✅ serializer + reference resolver (verified against live)
- ✅ deploy engine — create / noop / update / delete (verified live-safe)
- ✅ release grouping + lifecycle + audit
- ✅ HTTP service
- ✅ email notifications on lifecycle transitions (best-effort, provider by env)
- ⏳ `your-stage-project` project + reference-data clone (needs org-level provisioning)
- ⏳ `mc-releases` Merchant Center app
