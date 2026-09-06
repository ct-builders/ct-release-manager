# Features

Code-derived inventory of what this repo implements. Bullets and key file paths —
the mechanism lives in [`docs/architecture.md`](docs/architecture.md), the environment
in [`docs/configuration.md`](docs/configuration.md).

_Last generated: 2026-09-06 by feature-doc._

## What this repo is

Release management for a commercetools catalog: merchandisers edit products,
categories and discounts inside a named **release**, and one deploy applies the whole
bundle to production while one rollback takes it back out. Editing never touches live
data — every edit lands on a private working copy in the authoring project, which is
merged onto the trunk and reaches production only when a deploy runs.

Four packages, no workspace hoisting. Each keeps its own `package.json`, lockfile and
deploy configuration, which is what lets the dependency-free service and the two heavy
appkit apps be built and deployed independently of each other.

| Package | What it is | Stack |
|---|---|---|
| [`packages/console`](packages/console) | The authoring console — products, categories, discounts, releases, dashboard, permissions | Next.js 16 App Router, React 19, Tailwind v4 |
| [`packages/release-deploy`](packages/release-deploy) | The release state machine and every production write: branch, fork, merge, diff, deploy, rollback. HTTP service + CLI + clone/audit/backup tooling | Zero-dependency Node ESM |
| [`packages/mc-releases`](packages/mc-releases) | "Release Deployments" — the release workflow inside Merchant Center | Merchant Center Custom Application (appkit) |
| [`packages/mc-branch-editor`](packages/mc-branch-editor) | Branch-scoped product authoring inside Merchant Center | Merchant Center Custom Application (appkit) |

Built from scratch rather than forked from a starter, so no bullet below carries
provenance tags.

Two commercetools projects, and which one gets written is the whole design:

- **Authoring** (`CTP_*` / `STAGE_CTP_*`) — the catalog being edited, the release data,
  the access list, and the console's own user accounts.
- **Production** (`PROD_CTP_*` / `LIVE_CTP_*`) — written **only** by the deploy service.
  The console holds no write credentials for it and reads it read-only, for the
  dashboard's sales figures.

Nothing about a particular company or catalog is compiled in: branding, locale,
currency, the featured product attributes, the storefront links and the demo login are
environment variables read through `packages/console/lib/config.ts`. See
[`docs/configuration.md`](docs/configuration.md).

## The console — `packages/console`

A thin, RSC-heavy Next.js app over the two projects and the service. Paths in this
section are relative to `packages/console/`.

### Authentication & access control

- Email/password sign-in (`app/login/page.tsx`, `app/api/auth/login/route.ts`)
  authenticated against commercetools **Customer** sign-in in the AUTHORING
  project (`lib/auth-ct.ts`). Sign-in then requires a `release-acl` entry: the access
  list is the roster, so a shopper in the same project with a valid password is
  refused with a `403` rather than admitted.
- Session is a signed JWT (`jose`, HS256) in an httpOnly cookie (`lib/auth.ts`,
  `rm_session`), 30-day expiry. `lib/auth-constants.ts` holds the cookie names;
  the demo personas and their shared password come from `lib/config.ts`.
- **"Use demo credentials"** button plus one-click demo personas (Admin,
  Author, Reviewer, Publisher) on the login page sharing one password
  (`lib/config.ts` `DEMO_USERS` / `DEMO_PASSWORD`, both env-overridable);
  seeded as real customers by `tools/seed-auth-customers.mjs`. Set
  `NEXT_PUBLIC_DEMO_LOGIN=false` and the panel disappears.
- Logout clears the session cookie (`app/api/auth/logout/route.ts`).
- **`BOOTSTRAP_ADMIN_EMAIL`** (`lib/env.ts`, server-side only) holds admin until the
  access list has real entries, so a fresh install has exactly one named way in.
  The Permissions page prompts that account to grant itself Admin.
- **RBAC** (`lib/acl.ts`): roles `author | reviewer | publisher | admin` map to
  capabilities `edit | approve | publish | admin`, stored as custom objects
  (container `release-acl`) in the `release-manager` project, keyed by
  base64url(email). An empty access list admits nobody except
  `BOOTSTRAP_ADMIN_EMAIL`.
  `assertCan()` / `capabilityForStatus()` gate every server action.
- **Permissions admin UI** (`/settings/permissions`, `components/acl/PermissionsTable.tsx`):
  add/edit/remove a user's roles; admin-only.
- Per-user UI prefs (e.g. saved table column layout) stored the same way,
  container `rm-user-prefs` (`lib/user-prefs.ts`, `lib/prefs-actions.ts`).

### Release lifecycle (the core workflow)

- **Releases** (`/releases`, `/releases/new`, `/releases/[key]`) are named
  bundles of catalog/promotion changes with a state machine: `draft →
  ready-for-review → approved → published`, plus `rolled-back`; a `history[]`
  audit trail of every transition (who/when/note) (`lib/types.ts`).
- Create a release (`components/releases/CreateReleaseForm.tsx`,
  `createReleaseAction`) — provisions a dedicated working-copy **branch**
  (`lib/branch.ts`, `lib/product-edit.ts` `ensureReleaseBranch`) the moment
  it's created.
- **Active release** picker (`components/console/ReleasePicker.tsx`,
  `lib/release-context.tsx`, `/api/active-release`): the release you're
  "working in" is a cookie-backed selection surfaced everywhere in the top
  bar; all edit actions require one to be picked.
- **Members**: a release tracks which products/categories/cart-discounts/
  product-discounts/discount-codes/discount-groups it touches
  (`ReleaseMembers`); editable via `MemberPicker` or auto-added the first time
  you edit a resource while that release is active (fork-on-first-edit).
- **Deletions**: a release can also mark existing resources for **removal**
  from production on deploy (`ReleaseMembers`-shaped `deletions`, rendered as
  a "Marked for removal" panel with strikethrough chips).
- **Auto-add config**: a global on/off toggle + "current release" so freshly
  edited resources auto-enroll (`lib/types.ts` `AutoAddConfig`,
  `service.getConfig/setConfig`).
- **Lifecycle transitions** with role gates: author sends draft →
  ready-for-review (`stagePublishAction`, which also publishes the release's
  products to the staging storefront project); reviewer approves or **sends
  back** to draft (requires a rejection note, enforced client + review UX);
  publisher ships approved → production.
- **Working-copy branches** (`lib/branch.ts`): each release's edits live on a
  branch whose resources are the canonical key suffixed `__b__<branchId>`
  (`KEY_DELIM`); the UI always strips this back to the canonical key/slug —
  the word "branch" never appears in the UI copy (it's called a release's
  private working copy).
- **Fork-on-first-edit**: editing a product/category/discount while a release
  is active transparently forks a private copy onto the release's branch
  (`forkProduct`, `forkResource`) and auto-enrolls it as a release member;
  production/main is never touched until deploy.
- **Working-copy existence probing**: because the branch registry can lag or
  race (documented at length in `lib/product-edit.ts` / `lib/discounts.ts`),
  the app always double-checks the physical CT resource before trusting the
  registry, to avoid silently editing the live resource.
- **Merge to main** (field-level three-way merge, `service.mergePreview` /
  `service.merge`): before shipping, a release's branch edits must be folded
  onto the shared trunk. The UI shows each touched asset's state (mergeable /
  add / conflict / merged/unchanged) and, per conflicting field, a
  side-by-side "this release" vs. "current main" picker
  (`components/releases/ReleaseDetail.tsx`) — resolutions are submitted back
  to the merge-apply call. Shipping is blocked ("Merge to main first") while
  unresolved merges remain.
- **Preview / validate / diff** (`previewAction`): dry-run comparison of
  staging vs. live before shipping — missing-reference validation (is
  everything the release needs actually present in live?) and a create/
  update/noop/error diff list, plus a **drift** indicator (in-sync / drifted /
  never-shipped) comparing the last-shipped hash to the current staging state.
- **Ship to production** (`deployAction` → `service.deploy`), gated on the
  `publish` capability and on `merge` being complete; confirmed via a native
  `confirm()` prompt; result summarized as create/update/noop/error counts.
- **Instant deploy (admin fast-path)** (`immediateDeployAction`): admin-only
  button that skips review/approval entirely and ships straight to
  production from any status, marking the release published.
- **Rollback** (`undeployAction` → `service.undeploy`): restores production to
  its state just before the release's most recent deploy (deletes what it
  created, reverts what it updated), using `__prod__` baselines the deploy
  snapshotted; surfaced as "↺ Roll back last deploy" on published releases.
- **Ship history**: every deploy/rollback/dry-run attempt is listed with
  timestamp, kind, apply/dry-run, ok/error, and create/update counts.
- **Staging preview**: each release links out to the live staging storefront
  (B2C or B2B toggle) so the release's actual in-progress content can be
  viewed on the real site before shipping.
- **Checkpoint / restore versioning** (`lib/product-edit.ts` `saveVersion` /
  `listVersions` / `restoreVersion`, `checkpointProductAction`,
  `restoreProductVersionAction`, UI in `components/products/ProductEditor.tsx`):
  save named point-in-time snapshots of a product's working copy while
  editing, and restore any prior checkpoint (overwriting the current working
  copy) — a lightweight undo/versioning system scoped to a release's branch.

### Product authoring (`/products`)

- Product list/search (`lib/products.ts`, `components/products/ProductsTable.tsx`,
  `ProductFiltersBar.tsx`): full-text search via the commercetools **Product
  Search API** when a query is present, otherwise a filtered/sorted
  `product-projections` query; filters by category, the configured facet
  attribute, published
  (online/offline) state; sortable (name/created/modified); paginated.
  Release working-copy products are always excluded from the canonical list
  (resolved to their canonical row instead) so each product shows once.
- **Release overlay**: when viewing "in this release," a member product's
  working-copy data (name/price/image/publish state) is shown in place of the
  live version.
- Column manager with per-user, per-table persisted column order/visibility
  (`components/console/ColumnManager.tsx`, `lib/columns.ts`, `useColumnPref.ts`,
  `saveColumnPrefAction`).
- **Product editor** (`components/products/ProductEditor.tsx`,
  `AttributesTab.tsx`, `VariantsTab.tsx`, `lib/product-edit.ts`,
  `lib/product-editor-types.ts`): edit name/slug/description/SEO meta,
  per-productType attributes (typed inputs driven by live product-type
  attribute definitions, incl. enums/sets), and variants — add/remove
  variants, SKU/variant-key, prices (amount/currency/country/customer
  group/channel/date range) via add/change/removePrice, images (external URL
  add, remove, reorder, relabel), and category membership. Every edit is
  server-validated against a per-resource action whitelist
  (`ALLOWED_PRODUCT_ACTIONS` in `lib/actions.ts`) before being applied to the
  release's forked working copy.
- **Create product wizard** (`components/products/CreateProductWizard.tsx`,
  `createProductAction`): name, the two featured attributes, price in the
  configured currency, category, image URL, description → auto-generates a
  unique key/slug/SKU and creates a published product directly. The product
  type comes from `NEW_PRODUCT_TYPE_KEY`, else the project's first.
- **Take online/offline** two ways: release-scoped (`setProductPublishedAction` —
  forks + publishes/unpublishes the working copy only; production changes on
  deploy) and an **admin fast-path** (`publishProductAction` →
  `service.publishProduct`) that flips both stage and live at once by
  canonical key, independent of any release, dry-run capable.
- **Image upload** to a variant of the working copy (`app/api/products/[key]/image/route.ts`,
  `uploadProductImage`) — binary upload via the CT image endpoint, then
  re-publishes so the projection reflects it.
- **CSV export** (`/api/products/export`) — key, name, the two featured
  attributes under their own commercetools names, and price, for the current
  filtered list.
- **CSV import** (`/api/products/import`, `components/products/ProductImportExport.tsx`) —
  bulk-update name and the two featured attributes by key from an uploaded CSV
  (columns matched case-insensitively, so an export round-trips), applied to
  the active release's working copies, with a per-row error report.

### Category authoring (`/categories`)

- Category list + full tree view (`lib/categories.ts`,
  `components/categories/CategoryTree.tsx`, `CategoryEditor.tsx`,
  `CategoryPicker.tsx`) with parent/child hierarchy, order hint, keyed
  breadcrumb paths (e.g. for discount target pickers).
- **Category editor**: name, slug, description, SEO meta (title/description/
  keywords), order hint, parent — all release-aware (fork-on-edit) via
  `lib/resource-edit.ts`'s whitelisted `changeName/changeSlug/setDescription/
  setKey/changeParent/changeOrderHint/setMetaTitle/setMetaDescription/
  setMetaKeywords` actions.
- **Create category wizard** (`CreateCategoryWizard.tsx`, `createCategoryAction`) —
  name + optional parent, auto-generated unique key/slug.
- **Add products to a category** (`AddProductsToCategory.tsx`,
  `addProductsToCategoryAction`) — search/pick products, add them to the
  category (forks + `addToCategory` per product, best-effort per-item).
- **Category products panel** (`CategoryProductsPanel.tsx`,
  `listCategoryProducts`) — shows a category's member products through the
  active release's lens (working-copy version wins over live).

### Discounts & promotions (`/discounts`)

- Three discount kinds in one tabbed UI (`lib/discounts.ts`,
  `components/discounts/DiscountEditor.tsx`): **cart discounts**, **product
  discounts**, and **discount codes**.
- **Visual discount builder** (`lib/discount-model.ts`) mirrors the Merchant
  Center's value + target + predicate structure instead of raw JSON:
  - Cart discount values: percentage off, fixed amount off, fixed price, free
    gift line item (with product/variant/channel refs); targets: entire
    order, matching line items, matching custom line items, shipping,
    multi-buy (Buy X get Y, with trigger/discounted quantity, max
    occurrence, cheapest/most-expensive selection), and pattern/bundle
    (Buy & Get with multiple trigger/target components).
  - **One-click presets**: % off order, $ off order over $X, free shipping,
    % off matching items, BOGO, free gift — pre-fill common scenarios.
  - Product discount values: percentage/fixed/external, with a simplified
    category (+ include-subcategories) / facet-attribute predicate builder, falling
    back to raw predicate text for anything more complex.
  - **Round-trip-safe raw fallback**: any value/predicate shape the visual
    model can't represent flips the editor to "advanced" (raw JSON/predicate
    text) rather than silently mangling it.
  - Discount codes: linked cart discounts, max applications (total / per
    customer), extra cart predicate, customer groups.
- **Generic predicate builder** (`lib/predicate/*`) — a full visual
  query-builder (AND/OR groups, NOT, nested conditions) shared across cart,
  line-item, product, and custom-line-item predicate contexts
  (`components/discounts/PredicateBuilder.tsx`): field picker grouped by
  section (static fields per context + live product attributes/custom fields
  merged in from the project), typed operators per field kind (money, number,
  string, boolean, date, collection), collection ops (`contains`, `contains
  any/all`, `is empty`), cart-only aggregate functions
  (`lineItemCount`/`lineItemTotal`/`lineItemExists` with a nested sub-condition),
  and a hand-written recursive-descent **parser + tokenizer**
  (`lib/predicate/parse.ts`) with a strict round-trip guard — a predicate is
  only shown as a visual tree if re-serializing it reproduces the original
  text exactly, otherwise it falls back to raw text editing.
- **Discount groups** (native CT "best deal" containers): list with member
  counts (`lib/discount-groups.ts`), create/edit/delete
  (`DiscountGroupsManager.tsx`, `createDiscountGroupAction` /
  `updateDiscountGroupAction` / `deleteDiscountGroupAction`), and assignment
  from the cart-discount editor for value/target combinations that are
  group-eligible.
- **Priority / layout manager** (`lib/discount-layout.ts`,
  `PriorityManager.tsx`): drag-orderable groups of discounts per kind
  (cart/product), persisted as a custom object (`rm-discount-layout`) in the
  `release-manager` project; saving derives and writes deterministic, unique,
  descending `sortOrder` values to the underlying discounts, with a
  multi-pass retry/perturbation strategy to dodge sortOrder uniqueness
  collisions and optimistic-concurrency conflicts.
- **Release-aware discount editing**: every create/edit is whitelisted per
  discount kind (`ALLOWED_RESOURCE_ACTIONS` in `lib/actions.ts`), forks onto
  the active release's working copy, and auto-enrolls the release.
- **Staged deletion**: mark a cart/product discount or discount code for
  removal on deploy (`setDiscountDeletionAction`) — recorded in the release's
  `deletions`, removed from the active member list.
- **Discount code linking** (`listCartDiscountRefs`) and **facet value list**
  (`listFacetValues`) helpers feed the code/product-discount pickers.

### Merchandising dashboard (`/`)

- Real, live sales analytics pulled directly from the **PRODUCTION** project
  (read-only `prodCt`), not from any local cache (`lib/dashboard.ts`).
- Range filters (today / 7d / 30d / all / custom date range) and channel
  filter (all / B2B / B2C, split on presence of `businessUnit`).
- KPIs: total sales (in the configured reporting currency, cross-currency
  converted via the `NEXT_PUBLIC_FX_RATES` table),
  order count, average order value, active promotion count, and a
  period-over-period trend percentage.
- **Sales trend chart** — bucketed bar chart (hourly buckets for ≤2-day
  ranges, daily otherwise), computed by real `completedAt`/`createdAt`.
- **Top products** and **top categories** by revenue (primary-category
  attribution).
- **Promotions table** — every active cart discount / product discount /
  discount code, each with real attributed order count and revenue impact
  (derived from each order's `discountOnTotalPrice`, `discountedPricePerQuantity`,
  line-item `price.discounted`, `shippingInfo.discountedPrice`, and applied
  `discountCodes`).
- Compact "Releases" strip (recent releases + status + quick links) surfaced
  above the analytics.

### Key / release-readiness audit (`/audit`)

- **Key audit report** (`service.keyAudit`) toggle between `live` and `stage`
  projects: for each resource group (promotion / product / reference layer),
  shows total vs. keyed count and flags missing keys — required resources
  missing a key are called out as blocking; also reports embedded-price key
  coverage (prices scanned across variants, how many lack a key). Every
  resource needs a key to ship across projects, so this page is the
  pre-flight check for a clean release.

### Console shell / UX

- Collapsible sidebar (`components/console/Sidebar.tsx`, cookie-persisted
  collapse state, no flash-of-wrong-state on reload) with grouped nav
  (`Nav.tsx`): Dashboard; **Author** (Products, Categories, Discounts);
  **Ship** (Releases, Key Audit); **Sites** (external links to live staging +
  production B2C/B2B storefronts); **Admin** (Permissions). commercetools-
  branded (outline cube mark, dark indigo `#191741` sidebar chrome).
- Top bar (`components/console/TopBar.tsx`) shows the signed-in email, roles,
  and the active-release picker.
- Reusable `PageHeader`, `StatusBadge` (per release status), `Placeholder`
  components for consistent page chrome.
- Server Actions throughout (`lib/actions.ts`, `"use server"`) — every
  mutation is authenticated (`getSession`), authorized (`assertCan`), and
  scoped to the active release where applicable, returning a uniform
  `{ ok, data | error }` shape the client components render directly.

### Store availability

- `lib/stores.ts`: list commercetools **Stores**, and resolve which products
  a given store carries via its active product selections (or "carries the
  whole catalog" when it has none) — used by `storeAvailabilityAction` for
  per-store availability checks.

## The release-deploy service — `packages/release-deploy`

The release state machine and every cross-project operation, as a zero-dependency Node
ESM HTTP service (`server.mjs`, `PORT` default 8080) plus a CLI over the same libraries.
Bearer auth from `DEPLOY_SERVICE_TOKEN`; **unset skips the check entirely**, which is
convenient locally and leaves every production-writing endpoint open when deployed.
Paths in this section are relative to `packages/release-deploy/`.

### Release lifecycle and registry

- Releases stored as CustomObjects in the authoring project (`lib/registry.mjs`,
  container `release-registry`, key = release key), each carrying members, a lifecycle
  state, a `history[]` audit trail of every transition with actor/timestamp/note, and
  per-deploy audit entries with a content hash.
- Two-publish content-approval lifecycle: `draft → ready-for-review → approved →
  published`, plus `rolled-back`, with the transition table and its legal edges encoded
  in one place rather than checked per-endpoint.
- **Approver ≠ author gate**, with an admin exemption (`allowSelfApprove`) so a
  one-person deployment is not deadlocked (`test/transition-approve-gate.test.mjs`).
- **Drift detection**: each deploy records a content hash of what shipped, so a later
  read reports in-sync / drifted / never-shipped against current authoring content.
- `GET|POST /releases`, `GET /releases/:key`, `PUT /releases/:key/members`,
  `POST /releases/:key/status`.

### Working copies (branches)

- Compound-key encoding (`lib/branch.mjs`): a branch copy suffixes every field
  commercetools enforces project-wide uniqueness on — `key`, `slug`, variant `sku`,
  category `key`, discount `key`, `DiscountCode.code` — so two authors can hold
  divergent copies of the same logical asset side by side in one project.
  `canonicalizeBundle` strips the suffix on the way to production, so live never sees a
  branch-shaped identifier.
- **Fork on first edit** (`lib/branch-ops.mjs`): copy a canonical asset onto a branch
  and snapshot it as v0. The HEAD of each (asset × branch) is a live resource in the
  authoring project; prior versions are immutable canonicalized-JSON snapshots in the
  `release-asset-history` container, so the authoring project stays bounded and
  production never sees version data.
- **Save / restore checkpoints** per asset per branch, and a version list
  (`POST /branches/:id/assets/:asset/save`, `/restore`, `GET .../versions`).
- **Compare-and-swap branch registry writes** (`lib/registry.mjs`): commercetools
  rejects a stale version with a 409, so concurrent branch writes retry rather than
  silently dropping one, and a fork self-heals a registry entry it finds missing
  (`test/branch-registry-cas.test.mjs`).
- `GET /branches`, `GET /branches/:id`, `POST /branches`, `POST /branches/:id/status`,
  `POST /branches/:id/fork`, `POST /branches/:id/close`.

### Merge to main

- **Field-level three-way merge** (`lib/merge.mjs`): base = content at fork, ours = the
  branch HEAD, theirs = the trunk now. Per-field rather than per-asset, so two releases
  that edited different fields of the same product merge cleanly and only a field both
  sides changed to different values is a conflict.
- Merge report classifies each touched asset as mergeable / add / conflict /
  merged-unchanged, and merge-apply accepts per-field resolutions
  (`POST /branches/:id/merge-report`, `POST /releases/:key/merge`).

### Serialize, validate, deploy, roll back

- **Portable release bundles** (`lib/serialize.mjs`): everything referenceable is
  emitted **by key** — product type, categories, tax category, state, stores, customer
  groups, channels, discount groups, and the cart discounts a discount code points at —
  because commercetools ids are per-project UUIDs and a key-based `ResourceIdentifier`
  resolves in the target project.
- **Ids embedded inside predicate strings** (`categories.id = "…uuid…"`) and
  `giftLineItem` values are scanned per discount, resolved to `{typeId, key}` in the
  source and rewritten source-id → target-id at deploy — a no-op when predicates are
  already key-based.
- **Reference attributes remapped across projects**: products carrying a
  `key-value-document` reference attribute get an id map built by matching CustomObject
  keys (`--remap-ref-attrs auto`, `--ref-containers`), or from a prebuilt map file.
- **Idempotent upsert by key** (`lib/deploy.mjs`): create if absent, else diff and emit
  only the update actions for fields that changed. Deploying a bundle back into the
  project it came from is a clean no-op, which is the live→live self-test.
- **Dry-run by default** everywhere; `--apply` / `apply: true` to write. A deploy refuses
  if any reference is unresolved in the source or missing in the target.
- **Production baseline snapshots** (`lib/prod-history.mjs`): before every deploy, the
  current live content of each touched asset is snapshotted under a reserved `__prod__`
  branch in the authoring project — so a rollback has something to restore, and a
  deletion has somewhere to record what was removed. Production stays clean.
- **Rollback** (`lib/undeploy.mjs`): deletes what the deploy created and reverts what it
  updated, from that baseline. One step back from the last deploy, not an arbitrary point
  in history.
- **Stage publish** (`lib/stage-publish.mjs`): authors edit products as staged changes, so
  reviewing a release on a staging storefront requires publishing staged → current on the
  authoring project first.
- `POST /releases/:key/validate`, `/diff`, `/deploy`, `/undeploy`, `/stage-publish`,
  `POST /products/:key/publish`, and `POST /deploy` for an ad-hoc deploy with no release.
- `GET /catalog/members` serves the pickable products, categories and discounts behind both
  front ends' member pickers, cached per project for 120s so a picker does not re-page the
  whole catalog on every keystroke. Only keyed resources are offered, since an unkeyed one
  cannot ship.
- `GET /health` for liveness.

### Access control and notifications

- **Role-based access control** (`lib/acl.mjs`): `author | reviewer | publisher | admin`
  → `edit | approve | publish | admin`, one CustomObject per user in `release-acl`, keyed
  base64url(lowercased email) because commercetools CustomObject keys cannot contain `@`.
  The same container and the same key derivation the console uses, so there is one roster.
- **Fail-open on an empty ACL** — every user has full access until the first role is
  granted, so a fresh install cannot lock itself out. `bin/seed-acl.mjs` grants the
  bootstrap admin and turns enforcement on.
- `GET /acl/me`, `GET|POST /acl`, `DELETE /acl/:key`.
- **Lifecycle email notifications** (`lib/notify.mjs`), recipients resolved from the ACL
  by capability: submitted → every reviewer, approved → every publisher, published → the
  author, rejected → the author. The acting user is never emailed about their own action.
- Provider auto-detected from whichever key is set — Resend, SendGrid, Postmark — falling
  back to a `log` transport that prints the intended mail, so the workflow runs with no
  email account configured. Best-effort and timeout-bounded: `notifyTransition()` never
  throws, so a mail failure cannot break a lifecycle transition.
- The hooks live where state actually changes (`transition()` and `recordDeployment()` in
  `lib/registry.mjs`), so both the `/status` and `/stage-publish` routes are covered
  without double-sending.

### Auto-add from commercetools change events

- **Auto-add configuration** (`lib/config.mjs`, container `release-config`): a master
  switch plus the draft release that freshly-changed resources enrol into.
- `POST /events` accepts a Google Cloud Pub/Sub push carrying a commercetools change
  notification for a product / category / cart discount / product discount / discount
  code and adds the changed resource to the current release.
- `bin/setup-events.mjs` creates or updates the commercetools Subscription that feeds it.

### Key audit

- **Missing-key report** (`lib/key-audit.mjs`, `GET /resources/key-audit`): per resource
  group, total vs keyed count, which required resources lack a key, and embedded-price key
  coverage across variants. Cross-project deploys match by key, so anything unkeyed cannot
  ship — this is the pre-flight check.

### CLI and operator scripts

- `bin/cli.mjs` — `audit`, `serialize`, `validate`, `deploy`, `rebaseline`, and
  `release list|show|create|members|status|delete`, over selections like
  `--all-promotions`, `--cart-discounts a,b|*`, `--products k1,k2|*`, `--categories *`.
- `rebaseline` pulls the whole catalog production → authoring, remapping reference-attribute
  ids, to reset the authoring baseline to production.
- `bin/clone-reference.mjs` — seed a target project's reference layer (product types,
  categories, channels, stores, tax categories, states) by key in dependency order. The
  prerequisite for a release validating against a fresh project. Create-if-absent, never
  overwrites.
- `bin/clone-b2b.mjs` — clone the login and B2B layer for functional parity: associate
  roles → customers → business units, in dependency order, re-creating customers with a
  known password since hashes cannot be exported, and emitting a customer-id map.
- `bin/clone-custom-objects.mjs` — clone whole CustomObject containers preserving
  container+key, emitting the id map needed to remap reference attributes.
- `bin/baseline-production.mjs` — one-time bootstrap giving every keyed production asset a
  `__prod__` v1 rollback floor. Idempotent.
- `bin/backup.mjs` — full project export: every queryable resource endpoint plus project
  settings into timestamped JSON with a per-entity manifest; endpoints that error (feature
  off, missing scope) are recorded as skipped rather than fatal.
- `bin/migrate-containers.mjs` — copy CustomObjects from legacy container names to the
  current `release-*` ones, including the console's former separate `rm-acl` roster.
  Copy-first / delete-later in two deliberate steps, and idempotent, so a partial failure
  resumes instead of clobbering.
- `bin/notify-check.mjs` — send one sample notification to verify `EMAIL_*` end to end.

### Tests

- 57 unit tests on plain `node --test`, no credentials and no network, in about 150ms
  (`npm test`): branch encoding and canonicalization, branch ops, the CAS branch registry
  under concurrent writes, field-level merge conflicts, deploy/publish, production history,
  the approve gate, and notification recipient resolution.
- **The end-to-end suite is deliberately outside that gate** (`npm run test:e2e`,
  `test/e2e-release.test.mjs`, `test/e2e-undeploy.test.mjs`): it writes to two real
  commercetools projects and takes minutes. It refuses to run unless the resolved project
  key matches `E2E_STAGE_PROJECT`, which is what stands between a stray `RUN_E2E=1` and a
  real catalog. See `test/README-e2e.md`.

## Release Deployments — `packages/mc-releases`

The release workflow as a Merchant Center Custom Application, for teams who would rather
not run a separate console. Talks to the deploy service over HTTP using
`additionalEnv.deployServiceUrl`, whose origin must be in the app's CSP `connect-src`
(`custom-application-config.mjs`). Registration steps in `REGISTRATION.md`.

- **Release list** (`src/components/releases/releases-list.tsx`) with status badges and
  drill-in.
- **Create a release** and pick its members — products, categories, cart discounts,
  product discounts, discount codes, discount groups
  (`create-release.tsx`, `member-picker.tsx`).
- **Release detail** (`release-detail.tsx`) driving the whole lifecycle: publish to stage
  for review, approve or send back with a note, validate references, preview the diff, and
  deploy stage → live.
- **Post-approval publish prompt**: an approver who also holds the publish capability is
  offered "Publish to production now?" on approving; one who does not is told a publisher
  must do it, and the release stays `approved`. "Not now" dismisses and leaves it for a
  publisher.
- **Auto-add bar** (`auto-add-bar.tsx`) — toggle the change-listener auto-add and pick the
  release changed resources enrol into.
- **Key audit view** (`src/components/audit/key-audit.tsx`) — the missing-key report per
  project.
- **Permissions panel** (`src/components/acl/permissions.tsx`), admin-only, over the same
  `release-acl` roster.
- **Capability-aware UI** (`src/sdk/use-capabilities.ts`): the signed-in Merchant Center
  user's email is resolved to roles through the service, and controls the user cannot use
  are not offered. It falls **open** while loading and on error, so a slow or failing ACL
  read never hides a real action — the service re-checks every capability server-side, so
  the UI is a convenience rather than the enforcement point.
- **Browser smoke test** for the publish-prompt decision (`test/ui/`), driving a standalone
  harness page that reproduces the modal's markup rather than the authenticated Merchant
  Center iframe. Playwright is deliberately not a dependency — `npx playwright test test/ui`
  installs it on demand.

## Branch product editor — `packages/mc-branch-editor`

Branch-scoped product authoring as a second Merchant Center Custom Application, for
editing a release's working copy without leaving Merchant Center.

- **Branch picker** (`src/components/branch/branch-bar.tsx`, `src/branch-context.tsx`) —
  choose the working copy to edit; the selection persists in local storage and scopes every
  view below it.
- **Branch-scoped product list** (`src/components/products/products-list.tsx`) resolving
  each canonical product to its branch HEAD where one exists.
- **Product detail editor** (`product-detail.tsx`) — edit the branch HEAD's content, fork a
  canonical product onto the branch on first edit, and save or restore named versions from
  the asset history.
- Reads commercetools directly for catalog data through the Merchant Center session
  (`src/sdk/use-ctp.ts`) and the deploy service for branch and version operations
  (`src/sdk/use-service.ts`).

## Repo-level tooling and deployment

- **The local gate is the only gate** — there is no CI. From the repo root:
  `npm run test` (service unit tests), `npm run typecheck` and `npm run lint` (console and
  both Merchant Center apps), `npm run build` (console), and `npm run predeploy` chaining
  all four. `npm run install:all` installs the three packages that have dependencies.
- **The console** deploys to Netlify via `@netlify/plugin-nextjs` on Node 22. The root
  `netlify.toml` sets `base = "packages/console"`; the rest of the build config comes from
  that package's own `netlify.toml`. `packages/console/next.config.ts` pins
  `turbopack.root` to the package so module resolution does not walk out of it.
- **The deploy service** runs as a container from source — no build step, no
  `node_modules` — e.g. `gcloud run deploy --source packages/release-deploy`.
- **The Merchant Center apps** are separate Netlify sites, each with its own base directory
  and `netlify.toml`, deployed by Git auto-publish.
- `AGENTS.md` / `CLAUDE.md` warn that this Next.js version has training-data-breaking
  changes and to consult `node_modules/next/dist/docs/` before writing code against it.
- **Console provisioning scripts** (`packages/console/tools/*.mjs`, idempotent, run against
  admin credentials resolved by `tools/ct-admin.mjs`; see
  [`docs/operations.md`](docs/operations.md)): `ensure-client.mjs <authoring|production>`
  mints that project's scoped API client and prints its `.env` lines; `seed-acl-users` seeds
  the demo RBAC roles and `seed-auth-customers` the demo login personas as real customers,
  both from the same `NEXT_PUBLIC_DEMO_USERS` list the login page reads; `seed-demo-orders`
  and `seed-promo-orders` backfill realistic, time-spread, promotion-bearing production
  orders so the dashboard has real data (the latter drives an actual cart → order flow so
  commercetools computes real discount attribution, with scenarios derived from the
  project's own categories, prices and active discount codes);
  `reconcile-branch-registry` audits and repairs the branch asset registry against the
  working-copy resources that physically exist.
- **Fill an empty authoring project from production** (`tools/provision-stage.mjs`,
  `--dry-run` / `--verify` / `--only=`): copies project settings, custom-field types, tax
  categories, product types, zones, channels, customer groups, recurrence policies, states,
  categories, shipping methods, promotions, stores, products, inventory and custom objects,
  in dependency order, rewriting every reference by key. This is how a project created
  "from scratch" gets a catalog — commercetools offers a sample dataset only in the
  creation form and nothing can add one afterwards. Re-runnable: each stage matches
  existing rows by key (by `(sku, supplyChannel)` for inventory, `container/key` for custom
  objects) and skips them, so an interrupted run resumes. Three cases it handles that
  otherwise corrupt the target silently — the target's languages, currencies and countries
  are widened to the union of both projects' settings *and* every locale, price and tax
  rate found in the data, because a product can carry a locale its project no longer lists;
  enum attributes are written as the bare key though they read back as `{key, label}`; and
  a price's uniqueness scope includes `recurrencePolicy`, without which a subscription
  product's per-interval prices collapse into duplicates and commercetools rejects the
  create. Reference *attributes* take two passes, since their values are `{typeId, id}`
  rather than keys, so a product pointing at another product is created first and the
  reference set once every target id exists. Deliberately skips customers (a password
  cannot be exported, so copies would be accounts nobody can sign into) and orders (they
  reference customers, and a staging catalog needs no history).
- **MIT, `AS IS`, unsupported.** Every source file carries an SPDX header; the terms are in
  [`LICENSE`](LICENSE), and [`SUPPORT.md`](SUPPORT.md) covers what to check before pointing
  this at a production project.
