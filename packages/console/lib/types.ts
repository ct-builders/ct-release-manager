/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Shapes returned by the release-deploy service. Kept in sync with its lib/registry.mjs. */

export type ReleaseStatus = "draft" | "ready-for-review" | "approved" | "published" | "rolled-back";

export type ReleaseMembers = {
  products: string[];
  categories: string[];
  cartDiscounts: string[];
  productDiscounts: string[];
  discountCodes: string[];
  discountGroups?: string[];
};

export type ReleaseHistoryEntry = { at: string; by: string; to: string; note?: string };

export type Release = {
  key: string;
  title: string;
  description?: string;
  status: ReleaseStatus;
  author: string;
  approver?: string | null;
  branchId?: string;
  members: ReleaseMembers;
  /** keys to REMOVE from the target on deploy (same per-type shape as members). */
  deletions?: ReleaseMembers;
  history?: ReleaseHistoryEntry[];
  deployments?: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type BranchStatus = "open" | "frozen" | "merged" | "abandoned";
export type BranchAsset = { headKey: string; version: number; forkedFromHash?: string | null; updatedAt?: string };
export type Branch = {
  branchId: string;
  title: string;
  baseBranch: string;
  status: BranchStatus;
  author: string;
  assets: Record<string, BranchAsset>;
  createdAt: string;
  updatedAt: string;
};

/** Effective capabilities for the signed-in user, from release-acl. */
export type Actor = {
  email: string;
  roles: string[];
  /** true when these capabilities come from BOOTSTRAP_ADMIN_EMAIL rather than an access-list entry */
  bootstrap: boolean;
  can: { edit: boolean; approve: boolean; publish: boolean; admin: boolean };
};

export type AclEntry = { email: string; roles: Role[]; by?: string; updatedAt?: string };

/** commercetools localized string. */
export type LocalizedString = Record<string, string>;

/** The member field on a release for each editable resource type. */
export type ResourceType = "product" | "category" | "cart-discount" | "product-discount" | "discount-code";

// ---- release helpers (client-safe) ----
export type MemberKind = keyof ReleaseMembers;
export const MEMBER_KINDS: { key: MemberKind; label: string }[] = [
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories" },
  { key: "cartDiscounts", label: "Cart discounts" },
  { key: "productDiscounts", label: "Product discounts" },
  { key: "discountCodes", label: "Discount codes" },
  { key: "discountGroups", label: "Discount groups" },
];

export const memberCount = (m: Partial<ReleaseMembers> = {}): number =>
  MEMBER_KINDS.reduce((n, k) => n + (m[k.key]?.length ?? 0), 0);

export const ROLES = ["author", "reviewer", "publisher", "admin"] as const;
export type Role = (typeof ROLES)[number];

// ---- catalog / config / audit / preview shapes ----
export type CatalogOption = { key: string; name?: string; code?: string };
export type CatalogMembers = { project: string } & Record<MemberKind, CatalogOption[]>;

export type AutoAddConfig = {
  autoAddEnabled: boolean;
  currentReleaseKey: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type Deployment = {
  at: string;
  by: string;
  target: string;
  apply: boolean;
  hash: string;
  ok: boolean;
  summary: { create: number; update: number; noop: number; error: number };
};

/** Per-project outcome of an admin product publish/unpublish (one for stage, one for live). */
export type ProductPublishProjectResult = {
  found: boolean;
  changed?: boolean;
  published?: boolean;
  dryRun?: boolean;
  from?: boolean;
  to?: boolean;
  error?: string;
  status?: number;
};
/** Response from POST /products/:key/publish — takes one product online/offline in stage + live. */
export type ProductPublishResult = {
  key: string;
  published: boolean;
  applied: boolean;
  ok: boolean;
  result: Partial<Record<"stage" | "live", ProductPublishProjectResult>>;
};

// ---- merge to main (field-level three-way) ----
export type MergeFieldState = "unchanged" | "ours" | "theirs" | "converged" | "conflict";
export type MergeField = {
  field: string;
  label: string;
  state: MergeFieldState;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
};
export type MergeAssetState = "unchanged" | "mergeable" | "add" | "conflict" | "merged";
export type MergeAsset = {
  canonicalKey: string;
  resourceType: string;
  state: MergeAssetState;
  isAdd?: boolean;
  alreadyMerged?: boolean;
  fields: MergeField[];
  conflicts: MergeField[];
  error?: string;
};
export type MergeConflict = {
  canonicalKey: string;
  resourceType: string;
  field: string;
  label: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
};
/** key for a per-field resolution: `${canonicalKey}:${field}` → "ours" | "theirs". */
export type MergeResolutions = Record<string, "ours" | "theirs">;
export type MergeResult = {
  branchId: string;
  applied: boolean;
  needsResolution?: boolean;
  assets: MergeAsset[];
  conflicts: MergeConflict[];
  unresolved: MergeConflict[];
  merged?: { canonicalKey: string; action: string; actions?: string[]; error?: string }[];
  note?: string;
};

export type DiffRow = { type: string; key: string; action: string; actions?: string[]; error?: string };
export type ValidateResult = {
  unresolved: unknown[];
  missing: { resource: string; key: string; field: string }[];
  deployable: boolean;
};
export type DiffResult = {
  summary: { create: number; update: number; noop: number; error: number };
  diff: DiffRow[];
  hash: string;
  drift: string | null;
};

export type AuditResourceRow = {
  type: string;
  group: string;
  total: number;
  withKey: number;
  missingKey: number;
  required?: boolean;
  unavailable?: boolean;
  note?: string;
};
export type AuditReport = {
  project: string;
  resources: AuditResourceRow[];
  embeddedPrices?: {
    productsScanned: number;
    variantsScanned: number;
    totalPrices: number;
    pricesMissingKey: number;
    productsWithGaps: number;
  };
  summary: { totalMissing: number; typesWithGaps: string[]; clean: boolean };
};
