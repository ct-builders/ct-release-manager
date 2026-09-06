# Support

**There is no support for this software.**

It is published under the [MIT License](./LICENSE) so you can freely use, modify, and
redistribute it. That is the entire arrangement. Please read this before you build
something load-bearing on top of it.

## What this means concretely

| | |
|---|---|
| **Warranty** | None. `AS IS`, per the MIT License |
| **Service level** | None. No uptime, response-time, or fix-time commitment of any kind |
| **commercetools Support** | Cannot help with this code. Do not open a support ticket about it — it is not part of any commercetools product or subscription |
| **Issues and pull requests** | Read on a best-effort basis when someone has time. Many will go unanswered. That is not rudeness, it is the stated arrangement |
| **Security fixes** | No commitment to investigate or patch, and no embargo process. Please still report what you find — just do not wait on a fix |
| **Breaking changes** | Possible at any time, without notice, deprecation period, or migration guide |
| **Maintenance** | Not guaranteed to continue. This repository may be archived without warning |

## Not a commercetools product

This code was written by people who work at commercetools, and the copyright is held by
commercetools GmbH and the contributors to the `ct-builders` org. That is the extent of the
relationship. Publishing it here is not an endorsement, a support commitment, or a statement
that this is how commercetools recommends you build.

For the platform itself — which *is* supported — use the official channels:

- [commercetools documentation](https://docs.commercetools.com)
- [commercetools support portal](https://support.commercetools.com)

## If you are going to production with this

You own it. Read that heading again with this in mind: **the deploy service writes to your
production project.** That is its whole job. So before you ship:

- **Set `DEPLOY_SERVICE_TOKEN`.** Leave it unset and the service skips its Bearer check
  entirely — convenient for local development, and it means every endpoint that writes to
  production is open to anyone who can reach the URL. Check it is set on the deployed
  service, not just in your `.env`.
- **Verify which projects you are wired to.** `STAGE_CTP_*` and `LIVE_CTP_*` decide what
  gets written where, and a missing prefixed variable falls back to the un-prefixed `CTP_*`.
  Two consequences worth internalising: with `STAGE_*` unset, stage and live resolve to the
  *same* project, and an unrecognised `?project=` alias resolves to **live** rather than
  failing. Both fail quietly. Read the resolved key back from the service before you trust
  a deploy.
- **Scope your API clients.** The service needs broad write access on both projects, since
  it serializes from one and upserts into the other. It does not need `manage_api_clients`
  or `manage_project_settings` — do not hand it a full admin client because that was the
  quickest way to get past a 403.
- **Know how far back a rollback goes.** A deploy snapshots what it replaced, so a rollback
  restores the state immediately before *that* deploy. It is one step, not an arbitrary
  point in history.
- **Do not rename the CustomObject containers.** `release-registry`, `release-branch`,
  `release-asset-history`, `release-acl` and `release-config` are a wire contract shared
  with every other reader of the same project. Renaming one does not migrate the data
  under it, it orphans it. If you are upgrading a deployment that still uses the older
  `az-*` names, run `bin/migrate-containers.mjs` — it copies each object across and
  leaves the originals in place until you tell it to remove them.
- **Set `SESSION_SECRET` and `BOOTSTRAP_ADMIN_EMAIL` on the console, and grant a real
  admin.** The bootstrap admin is how a fresh install gets in, and it stays privileged
  until the access list has an entry — so it is a standing credential until somebody
  grants themselves Admin under **Permissions**. Do that on day one.
- **The access list is the roster, not a permission table.** The console's authoring
  project also holds storefront shoppers, and a shopper is a commercetools Customer like
  any other. A correct password admits nobody without an access-list entry — which means
  an empty access list plus a set `BOOTSTRAP_ADMIN_EMAIL` is exactly one way in, and
  removing that variable without granting anyone a role locks everyone out.
- **The service and the console share one access list (`release-acl`).** The service treats
  an empty one as fail-open — every capability granted to everyone — so a console that
  looks locked down can sit in front of a service that is not. Check the service's own ACL
  is populated, not just the console's Permissions page.
- **Put the console behind your own authentication if it faces anything but a trusted
  network.** Its sign-in is a commercetools Customer sign-in with a signed-cookie session;
  there is no MFA, no rate limiting on the login route, and no lockout.
- **Add your own observability, rate limiting, and audit logging.** There is none here
  beyond the per-release audit trail.
- **Pin and audit dependencies.** The service has none by design; the console and the two
  Merchant Center apps have plenty, and they are not being updated for you.

## Getting help anyway

Your best options, in order:

1. Read the code. It is commented with the reasoning, not just the mechanics. In
   `packages/release-deploy`: `lib/registry.mjs` for the release lifecycle,
   `lib/branch.mjs` for how a working copy stays isolated from the trunk, `lib/merge.mjs`
   for conflict resolution, `lib/deploy.mjs` for the upsert-by-key. In `packages/console`:
   `lib/product-edit.ts` for fork-on-first-edit and `lib/predicate/parse.ts` for the
   round-trip guard on discount predicates. `docs/architecture.md` ties them together.
2. Read the tests. `packages/release-deploy/test/` covers the branch registry under
   concurrent writes, field-level merge conflicts, the approval gate, and the
   deploy/rollback round trip. They run in about a second with `npm test`.
3. Read `FEATURES.md`. It is a code-derived inventory of what is actually implemented,
   which is a faster answer to "does this do X" than reading four packages.
4. Open an issue — someone may well answer, just do not depend on it.
5. Fork it. That is what the MIT License is for, and it is the only option with a
   guaranteed outcome.
