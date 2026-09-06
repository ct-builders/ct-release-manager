/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * transition-approve-gate.test.mjs — the approval gate's separation-of-duties rule.
 *
 * `reg.transition(... 'approved' ...)` enforces approver ≠ author so an approval is
 * a real second pair of eyes — EXCEPT for admins, who pass `allowSelfApprove:true`
 * (the service derives this from the actor's `admin` capability) so an admin can
 * drive a release end-to-end on their own. These tests pin all three cases.
 *
 * Hermetic: an in-memory CustomObject store stands in for commercetools, and the
 * best-effort email notifier is disabled so nothing touches the network.
 */
process.env.EMAIL_ENABLED = 'false';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as reg from '../lib/registry.mjs';

// Minimal commercetools-like client — just the CustomObject ops the registry uses.
function makeStage() {
  const store = new Map(); // `${container}/${key}` -> value
  return {
    async get(p) {
      const m = p.match(/^\/custom-objects\/([^/?]+)\/([^/?]+)/);
      if (!m) return {};
      const value = store.get(`${m[1]}/${decodeURIComponent(m[2])}`);
      return value ? { value } : {};
    },
    async post(p, body) {
      if (p !== '/custom-objects') return { ok: true, status: 200, body: {} };
      store.set(`${body.container}/${body.key}`, structuredClone(body.value));
      return { ok: true, status: 200, body: { value: structuredClone(body.value) } };
    },
    async all(p) {
      const m = p.match(/^\/custom-objects\/([^/?]+)/);
      if (!m) return [];
      const prefix = `${m[1]}/`;
      return [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, value]) => ({ value }));
    },
    async del() { return { ok: true, status: 200, body: {} }; },
  };
}

const AUTHOR = 'author@example.com';
const REVIEWER = 'reviewer@example.com';

// walk a fresh release up to the point where it's awaiting approval
async function readyForReview(stage, key) {
  await reg.createRelease(stage, { key, title: key, author: AUTHOR });
  await reg.transition(stage, key, 'ready-for-review', { by: AUTHOR });
}

test('a non-admin cannot approve a release they authored (separation of duties)', async () => {
  const stage = makeStage();
  await readyForReview(stage, 'rel-self');
  await assert.rejects(
    () => reg.transition(stage, 'rel-self', 'approved', { by: AUTHOR }),
    /approver must differ from author/,
    'author self-approval must be blocked when not an admin',
  );
});

test('a different actor approves normally and is recorded as approver', async () => {
  const stage = makeStage();
  await readyForReview(stage, 'rel-other');
  const rel = await reg.transition(stage, 'rel-other', 'approved', { by: REVIEWER });
  assert.equal(rel.status, 'approved');
  assert.equal(rel.approver, REVIEWER);
  assert.notEqual(rel.approver, rel.author);
});

test('an admin may self-approve their own release (allowSelfApprove)', async () => {
  const stage = makeStage();
  await readyForReview(stage, 'rel-admin');
  const rel = await reg.transition(stage, 'rel-admin', 'approved', { by: AUTHOR, allowSelfApprove: true });
  assert.equal(rel.status, 'approved');
  assert.equal(rel.approver, AUTHOR, 'admin becomes the approver of their own release');
});
