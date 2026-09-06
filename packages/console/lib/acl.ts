/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct } from "./ct";
import { env } from "./env";
import type { Actor, AclEntry, Role } from "./types";
import { ACL_CONTAINER } from "./containers";

/**
 * The access list: who may use this console and what they may do. Custom objects in the
 * authoring project (container `release-acl`), keyed by base64url of the lowercased email.
 *
 * It is the roster, not just the permission table. An entry here is what admits someone
 * — the same project holds storefront shoppers, and sign-in alone would otherwise let
 * any of them reach the console.
 *
 * Roles → capabilities:
 *   author → edit · reviewer → approve · publisher → publish · admin → all (+ manage)
 *
 * An empty list admits nobody except `BOOTSTRAP_ADMIN_EMAIL`, which holds admin until a
 * real entry exists. That one named account is how a fresh install gets in.
 *
 * **The release-deploy service reads the same container** and derives its keys the same
 * way ([`packages/release-deploy/lib/acl.mjs`](../../release-deploy/lib/acl.mjs)), so a
 * role granted here is the role it enforces on approve and publish, and the address it
 * notifies. The two must stay one list: the service treats an empty ACL as open access,
 * so a console-only roster would leave every service endpoint ungated behind a UI that
 * looks locked down.
 */

const CONTAINER = ACL_CONTAINER;

export function emailKey(email: string): string {
  return Buffer.from(email.trim().toLowerCase()).toString("base64url");
}

export function capabilities(roles: Role[] = []): Actor["can"] {
  const admin = roles.includes("admin");
  return {
    edit: admin || roles.includes("author"),
    approve: admin || roles.includes("reviewer"),
    publish: admin || roles.includes("publisher"),
    admin,
  };
}

type CoValue = { email: string; roles: Role[]; updatedAt?: string; by?: string };
type Co = { key: string; value: CoValue };
type CoList = { results: Co[] };

export async function listAcl(): Promise<AclEntry[]> {
  const r = await ct.get<CoList>(`/custom-objects/${CONTAINER}?limit=500`);
  return r.results.map((o) => ({
    email: o.value.email,
    roles: o.value.roles || [],
    updatedAt: o.value.updatedAt,
    by: o.value.by,
  }));
}

export async function setAcl(email: string, roles: Role[], by: string): Promise<AclEntry> {
  const clean = email.trim().toLowerCase();
  const value: CoValue = { email: clean, roles: [...new Set(roles)], updatedAt: new Date().toISOString(), by };
  await ct.post(`/custom-objects`, { container: CONTAINER, key: emailKey(clean), value });
  return { email: clean, roles: value.roles, updatedAt: value.updatedAt, by };
}

export async function removeAcl(email: string): Promise<void> {
  await ct.del(`/custom-objects/${CONTAINER}/${ct.enc(emailKey(email))}`).catch(() => {});
}

const NO_CAPABILITIES = { edit: false, approve: false, publish: false, admin: false } as const;

/**
 * Resolve an actor's effective capabilities.
 *
 * An access-list entry wins. Failing that, the bootstrap admin gets full capabilities
 * and is flagged as such, so the UI can prompt them to make it permanent. Everyone else
 * gets nothing — an unknown email is not a privileged one.
 */
export async function resolveActor(email: string): Promise<Actor> {
  const clean = (email || "").trim().toLowerCase();
  const all = await listAcl().catch(() => [] as AclEntry[]);
  const entry = all.find((e) => e.email.toLowerCase() === clean);
  if (entry) {
    const roles = entry.roles ?? [];
    return { email: clean, roles, bootstrap: false, can: capabilities(roles) };
  }
  if (clean && clean === env.BOOTSTRAP_ADMIN_EMAIL) {
    return { email: clean, roles: ["admin"], bootstrap: true, can: capabilities(["admin"]) };
  }
  return { email: clean, roles: [], bootstrap: false, can: { ...NO_CAPABILITIES } };
}

/** May this email use the console at all? The gate `POST /api/auth/login` applies. */
export async function hasConsoleAccess(email: string): Promise<boolean> {
  const actor = await resolveActor(email);
  return actor.roles.length > 0 || actor.bootstrap;
}

export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(message: string) {
    super(message);
  }
}

/** Throw ForbiddenError unless the actor holds `capability`. */
export async function assertCan(email: string, capability: keyof Actor["can"]): Promise<Actor> {
  const actor = await resolveActor(email);
  if (!actor.can[capability]) {
    throw new ForbiddenError(`"${email || "unknown"}" lacks "${capability}" permission`);
  }
  return actor;
}

/** Capability required to move a release to a given status (mirrors the pipeline). */
export function capabilityForStatus(to: string): keyof Actor["can"] {
  if (to === "ready-for-review") return "edit";
  if (to === "approved") return "approve";
  if (to === "published") return "publish";
  return "edit"; // back-to-draft / send-back
}
