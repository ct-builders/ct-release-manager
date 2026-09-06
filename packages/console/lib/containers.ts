/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * commercetools CustomObject containers.
 *
 * The `release-*` containers are shared with the release-deploy service, and
 * their names are part of the wire contract with it — the service reads and
 * writes the same strings, from
 * [`packages/release-deploy/lib/registry.mjs`](../../release-deploy/lib/registry.mjs)
 * and [`lib/acl.mjs`](../../release-deploy/lib/acl.mjs). They are constants
 * rather than configuration for that reason: renaming one here without
 * redeploying the service makes this console read an empty store.
 *
 * The `rm-*` containers are this console's own and have no second reader.
 *
 * A deployment provisioned by an older revision holds the same data under older
 * names. Move it across with the service's `bin/migrate-containers.mjs` before
 * pointing this console at the project, or the release list and the access list
 * both come back empty.
 */

/** Releases, in the authoring project. Owned by the release-deploy service. */
export const RELEASE_CONTAINER = "release-registry";

/** Branch registries — one object per branch, listing its forked assets. Service-owned. */
export const BRANCH_CONTAINER = "release-branch";

/** Per-asset checkpoint snapshots taken on fork and on save. Service-owned. */
export const ASSET_HISTORY_CONTAINER = "release-asset-history";

/**
 * The access list: who may use this system and what they may do (`lib/acl.ts`).
 *
 * Shared with the service, which resolves the same roles to decide who may
 * approve or publish and who gets notified on a transition. One roster, so a
 * role granted on the Permissions page is the role the service enforces.
 */
export const ACL_CONTAINER = "release-acl";

/** Per-user UI preferences (`lib/user-prefs.ts`). Console-only. */
export const USER_PREFS_CONTAINER = "rm-user-prefs";

/** Discount-editor layout configuration (`lib/discount-layout.ts`). Console-only. */
export const DISCOUNT_LAYOUT_CONTAINER = "rm-discount-layout";
