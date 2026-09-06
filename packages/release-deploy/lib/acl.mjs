/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * acl.mjs — role-based access control for the release workflow.
 *
 * Roles are stored as CustomObjects in the STAGE project, container `release-acl`,
 * ONE object per user. commercetools CustomObject keys can't contain `@`
 * (allowed set [-_~.a-zA-Z0-9]), so the key is base64url(lowercased email); the
 * real email lives in the value. value = { email, roles, updatedAt, updatedBy }.
 *
 * Roles → capabilities:
 *   author    → edit    (create/edit releases + members, submit, send back)
 *   reviewer  → approve (approve / reject an in-review release)
 *   publisher → publish (deploy an approved/published release to live)
 *   admin     → all of the above + manage this ACL
 *
 * FAIL-OPEN: when the ACL set is empty every user has full access ("open mode"),
 * so a fresh install cannot lock itself out before anyone has been granted a
 * role. Enforcement turns on the moment the first user is added — which means an
 * install that never adds one is running with every capability granted to
 * everybody. `bin/seed-acl.mjs` exists to close that on day one.
 *
 * TRUST MODEL — read this before deploying. The actor's email is supplied by the
 * CALLER (`ctx.user.email` from the MC app, or the console's signed-in user), and
 * the only thing authenticating that claim is the shared bearer token. So the
 * roles here answer "what may this email do", not "is this really that email":
 * anyone holding the token can assert any identity, exactly as they can with the
 * `by` audit field. Two consequences — keep `DEPLOY_SERVICE_TOKEN` as sensitive
 * as the production credentials it fronts, and do not expose the service beyond
 * the front ends that hold it. Verifying the forwarded session itself would raise
 * that bar and is not implemented.
 */

export const ACL_CONTAINER = 'release-acl';
export const ROLES = ['author', 'reviewer', 'publisher', 'admin'];

const nowIso = () => new Date().toISOString();
const normEmail = (email) => String(email || '').trim().toLowerCase();

// email → valid CustomObject key
export function emailKey(email) {
  return Buffer.from(normEmail(email)).toString('base64url'); // base64url strips '=' padding
}

// role list → capability flags (admin implies everything)
export function capabilities(roles = []) {
  const admin = roles.includes('admin');
  return {
    edit: admin || roles.includes('author'),
    approve: admin || roles.includes('reviewer'),
    publish: admin || roles.includes('publisher'),
    admin,
  };
}

export async function listAcl(stage) {
  const objs = await stage.all(`/custom-objects/${ACL_CONTAINER}`).catch(() => []);
  return objs.map((o) => o.value).filter(Boolean);
}

export async function getAcl(stage, email) {
  const o = await stage.get(`/custom-objects/${ACL_CONTAINER}/${emailKey(email)}`);
  return o && o.value ? o.value : null;
}

export async function setAcl(stage, { email, roles, by }) {
  const e = normEmail(email);
  if (!e) throw new Error('email required');
  const clean = [...new Set((roles || []).filter((r) => ROLES.includes(r)))];
  const value = { email: e, roles: clean, updatedAt: nowIso(), updatedBy: by || 'unknown' };
  const r = await stage.post('/custom-objects', { container: ACL_CONTAINER, key: emailKey(e), value });
  if (!r.ok) throw new Error(`write acl ${e} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.value;
}

export async function removeAcl(stage, email) {
  const r = await stage.del(`/custom-objects/${ACL_CONTAINER}/${emailKey(email)}`);
  if (!r.ok && r.status !== 404) throw new Error(`delete acl ${email} failed: ${r.status}`);
  return { removed: normEmail(email) };
}

// resolve an actor's effective capabilities. open mode (all-true) when ACL is empty.
export async function resolveActor(stage, email) {
  const all = await listAcl(stage);
  if (!all.length) {
    return { email: normEmail(email), roles: [], open: true, can: { edit: true, approve: true, publish: true, admin: true } };
  }
  const e = normEmail(email);
  const entry = all.find((a) => normEmail(a.email) === e);
  const roles = entry?.roles || [];
  return { email: e, roles, open: false, can: capabilities(roles) };
}

// throw a 403-style error unless the actor holds `capability`
export async function assertCan(stage, email, capability) {
  const actor = await resolveActor(stage, email);
  if (!actor.can[capability]) {
    const e = new Error(`forbidden: "${email || 'unknown'}" lacks "${capability}" permission`);
    e.code = 403;
    throw e;
  }
  return actor;
}
