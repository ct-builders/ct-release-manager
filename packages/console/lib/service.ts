/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { env } from "./env";
import type {
  Release,
  Branch,
  CatalogMembers,
  AutoAddConfig,
  ValidateResult,
  DiffResult,
  AuditReport,
  ProductPublishResult,
  MergeResult,
  MergeResolutions,
} from "./types";

/** The service's alias for the authoring project this console edits against. */
const PROJECT = env.RELEASE_SERVICE_PROJECT;

/**
 * Server-side client for the release-deploy HTTP service (Cloud Run). Called only
 * from route handlers / server code — the bearer token never reaches the browser.
 * `actor` (the signed-in email) is threaded through as the ?actor= / by field so
 * the service can enforce RBAC (release-acl) and attribute lifecycle actions.
 */

export class ServiceError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.RELEASE_SERVICE_TOKEN) headers.Authorization = `Bearer ${env.RELEASE_SERVICE_TOKEN}`;
  const r = await fetch(`${env.RELEASE_SERVICE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new ServiceError(r.status, (j as { error?: string }).error || `service HTTP ${r.status}`, j);
  return j as T;
}

export const service = {
  // ---- releases ----
  listReleases: () => call<{ releases: Release[] }>("GET", `/releases?project=${PROJECT}`),
  getRelease: (key: string) =>
    call<{ release: Release }>("GET", `/releases/${encodeURIComponent(key)}?project=${PROJECT}`),
  createRelease: (b: { key: string; title: string; description?: string; author: string; members?: unknown }) =>
    call<{ release: Release }>("POST", "/releases", { project: PROJECT, ...b }),
  setMembers: (key: string, members: unknown, deletions?: unknown) =>
    call<{ release: Release }>("PUT", `/releases/${encodeURIComponent(key)}/members`, {
      project: PROJECT,
      members,
      ...(deletions !== undefined ? { deletions } : {}),
    }),
  transition: (key: string, to: string, actor: string, note?: string) =>
    call<{ release: Release }>("POST", `/releases/${encodeURIComponent(key)}/status`, { to, by: actor, note }),
  validate: (key: string) =>
    call<ValidateResult>("POST", `/releases/${encodeURIComponent(key)}/validate`, { from: "stage", to: "live" }),
  diff: (key: string) =>
    call<DiffResult>("POST", `/releases/${encodeURIComponent(key)}/diff`, { from: "stage", to: "live" }),
  stagePublish: (key: string, actor: string) =>
    call<{ publish: { summary: Record<string, number> } }>(
      "POST",
      `/releases/${encodeURIComponent(key)}/stage-publish`,
      { by: actor }
    ),
  /**
   * Merge-to-main preview (dry-run): the per-asset/-field three-way report of the
   * release's branch working-copy edits vs the canonical trunk. Never writes.
   */
  mergePreview: (key: string) =>
    call<MergeResult>("POST", `/releases/${encodeURIComponent(key)}/merge`, { from: "stage", apply: false }),
  /**
   * Apply the merge: fold the branch edits onto the trunk. `resolutions` decides each
   * conflicting field ("<canonicalKey>:<field>" → "ours" | "theirs"). Throws a
   * ServiceError(409) with a MergeResult body when a conflict is left unresolved.
   */
  merge: (key: string, actor: string, resolutions: MergeResolutions = {}) =>
    call<MergeResult>("POST", `/releases/${encodeURIComponent(key)}/merge`, { from: "stage", apply: true, by: actor, resolutions }),
  deploy: (key: string, actor: string, apply: boolean) =>
    call<{ applied: boolean; summary: { create: number; update: number; noop: number; error: number } }>(
      "POST",
      `/releases/${encodeURIComponent(key)}/deploy`,
      { from: "stage", to: "live", apply, by: actor }
    ),
  /**
   * Admin fast-path: deploy a release straight to production, skipping review/approval,
   * and advance it to "published" from any status. `immediate:true` makes the service
   * require the `admin` capability (vs. `publish` for a normal ship).
   */
  immediateDeploy: (key: string, actor: string) =>
    call<{ applied: boolean; summary: { create: number; update: number; noop: number; error: number } }>(
      "POST",
      `/releases/${encodeURIComponent(key)}/deploy`,
      { from: "stage", to: "live", apply: true, immediate: true, by: actor }
    ),
  /**
   * Roll back this release's most recent applied deploy — restores whatever the
   * live project looked like just before that deploy ran (delete what it created,
   * revert what it updated), using the `__prod__` baselines snapshotted at deploy
   * time. Throws a ServiceError if there's no reversible deployment on record.
   */
  undeploy: (key: string, actor: string, apply: boolean) =>
    call<{
      applied: boolean;
      plan: { resourceType: string; key: string; action: string; toVersion?: number; reason?: string; error?: string }[];
      summary: { create: number; update: number; noop: number; error: number };
    }>("POST", `/releases/${encodeURIComponent(key)}/undeploy`, { from: "stage", to: "live", apply, by: actor }),

  // ---- products (admin fast-path: online/offline in stage + live at once) ----
  /**
   * Take a single product online (`published:true`) or offline (`false`) in BOTH the
   * authoring (stage) and live projects at once, matched by canonical key. Admin-only;
   * dry-run unless `apply` is true.
   */
  publishProduct: (key: string, published: boolean, actor: string, apply: boolean) =>
    call<ProductPublishResult>("POST", `/products/${encodeURIComponent(key)}/publish`, {
      published,
      by: actor,
      apply,
    }),

  // ---- catalog + auto-add config ----
  catalogMembers: () => call<CatalogMembers>("GET", `/catalog/members?project=${PROJECT}`),
  getConfig: () => call<{ config: AutoAddConfig }>("GET", `/config?project=${PROJECT}`),
  setConfig: (b: { autoAddEnabled: boolean; currentReleaseKey: string | null; by: string }) =>
    call<{ config: AutoAddConfig }>("PUT", "/config", b),

  // ---- branches (working copies) ----
  listBranches: () => call<{ branches: Branch[] }>("GET", "/branches"),
  getBranch: (branchId: string) => call<{ branch: Branch }>("GET", `/branches/${encodeURIComponent(branchId)}`),
  createBranch: (b: { branchId: string; title?: string }) => call<{ branch: Branch }>("POST", "/branches", b),
  fork: (branchId: string, canonicalKey: string, resourceType = "product") =>
    call<{ canonicalKey: string; headKey: string; action: string }>(
      "POST",
      `/branches/${encodeURIComponent(branchId)}/fork`,
      { canonicalKey, resourceType }
    ),
  saveVersion: (branchId: string, canonicalKey: string) =>
    call<{ version: number }>("POST", `/branches/${encodeURIComponent(branchId)}/assets/${encodeURIComponent(canonicalKey)}/save`, {}),
  listVersions: (branchId: string, canonicalKey: string) =>
    call<{ versions: { version: number; at: string }[] }>(
      "GET",
      `/branches/${encodeURIComponent(branchId)}/assets/${encodeURIComponent(canonicalKey)}/versions`
    ),
  restoreVersion: (branchId: string, canonicalKey: string, version: number) =>
    call<unknown>("POST", `/branches/${encodeURIComponent(branchId)}/assets/${encodeURIComponent(canonicalKey)}/restore`, { version }),

  // ---- audit ----
  keyAudit: (project: "live" | "stage") => call<AuditReport>("GET", `/resources/key-audit?project=${project}`),

  raw: call,
};
