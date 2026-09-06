# Release workflow — end-to-end test

`test/e2e-release.test.mjs` exercises the whole release pipeline against the **real**
`your-stage-project` (author) and `your-live-project` (live) projects and the production
storefront, the same way the Merchant Center "Release Deployments" app + deploy
service drive it.

## What it does

| Step | Action | Assertion |
|---|---|---|
| 1 · Author | Create a new category, an **unpublished** product, and a product discount on stage; group them into a draft release. | Release is `draft` with all three members; product starts unpublished. |
| 2 · Review | `Publish to stage` (draft → ready-for-review) publishes the release's products on stage. | Status → `ready-for-review`; product becomes **searchable on the stage project** (polls Product Search, absorbing indexing latency). Not yet on live. |
| 3 · Approve | A reviewer (**≠ author**) approves with a note. | Status → `approved`, approver recorded, note in history, author can't self-approve. Asserts the **post-approval publish-prompt decision**: approver *with* publish rights → prompt to self-publish; *without* → defer to a publisher. |
| 4 · Publish | A publisher deploys stage → live (apply). | Release auto-advances to `published`; members exist on live; product becomes **visible on the production storefront** (polls live Product Search + the storefront, absorbing indexing latency). |

Every fixture uses a unique `e2e-<ts>` key prefix and is **torn down** from both
projects (and the release object) in `after()`, even on failure.

## Running it

It is **opt-in** because it writes to stage + live and deploys to production:

```bash
cd packages/release-deploy
# needs STAGE_CTP_* and LIVE_CTP_* in .env (see .env.example)
npm run test:e2e
# or: RUN_E2E=1 node --test test/e2e-release.test.mjs
```

Without `RUN_E2E=1` the suite self-skips, so `npm test` (pure-function tests) stays
fast and hermetic. Tunables: `INDEX_TIMEOUT_MS` (default 180000), `POLL_INTERVAL_MS`
(4000), `PROD_STOREFRONT_URL` (default `https://storefront.example.com`).

### Running it against another tenant

The suite deploys to live, so it refuses to start until the project it resolved is the
one you meant. `E2E_STAGE_PROJECT` is that expectation, and it defaults to
`your-stage-project`; a mismatch aborts in `before()` and the message names the key it
found. `E2E_LIVE_PROJECT` is the same check for the live side, and is unset by default.

Point all four at the tenant you want, and give it that tenant's storefront — the
Step 4 assertion polls the storefront's own `/api/product/search`, so a wrong URL
fails the run rather than skipping it:

```bash
cd packages/release-deploy
E2E_STAGE_PROJECT=my-stage \
E2E_LIVE_PROJECT=my-live \
E2E_PRODUCT_TYPE_KEY=my-product-type \
PROD_STOREFRONT_URL=https://my-store.example.com \
  npm run test:e2e
```

The fixture product also has to fit the tenant's catalog. `E2E_PRODUCT_TYPE_KEY`
(default `auto-part`) must name a product type that exists there **with no required
attributes**, since the fixture sets none. `E2E_LOCALE` (`en-US`), `E2E_CURRENCY`
(`USD`) and `E2E_COUNTRY` (`US`) must all be allowed by the project, or the create
is rejected. The resolved shape is printed in the setup log.

`STAGE_CTP_*` and `LIVE_CTP_*` in `.env` still decide which projects are actually
reached; the two `E2E_*` vars only assert that they are the intended ones.

## Notes & caveats

- **Storefront ↔ project mismatch.** Both storefronts currently read the LIVE
  project (`your-live-project`); neither reads `your-stage-project`. So Step 2's "preview on
  staging" is checked against the **stage project's Product Search directly** (what a
  correctly-pointed staging storefront would show). Repointing the staging storefront
  at `your-stage-project` is a follow-up.
- **RBAC.** The stage ACL is enforced (an admin exists), so the test seeds three
  scoped throwaway users — `author`, `reviewer` (approve only, **no** publish),
  `publisher` — in setup and removes them in teardown. Adding scoped users doesn't
  change any existing user's access. The `reviewer`-only approver drives the real
  "approver can't publish → a publisher must do it" branch; the combined
  reviewer+publisher branch is covered by the pure `capabilities()` asserts.

## TODO / future work

- [ ] **Reject case:** a reviewer rejects a `ready-for-review` release with a note →
  it returns to `draft`; assert the note is required and recorded. (Deliberately not
  covered yet — planned as the next addition to this suite.)
- [ ] **Email notifications:** tie approval / publish transitions into email so the
  right people are notified (e.g. reviewer on submit, publisher on approve, author on
  publish/reject). Design + wire-up is future work.
