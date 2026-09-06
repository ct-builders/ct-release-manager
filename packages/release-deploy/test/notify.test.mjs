/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * notify.test.mjs — pure tests for the email-notification routing/templating.
 * Uses the "log" transport (no network) and a fake stage client with a canned
 * release-acl set, so it verifies WHO gets notified for each event and that the
 * function is truly best-effort (never throws), without sending anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyTransition, recipientsForCapability, buildMessage, readConfig } from '../lib/notify.mjs';

// force the log transport for every test in this file (no real provider calls)
process.env.EMAIL_PROVIDER = 'log';
delete process.env.RESEND_API_KEY;
delete process.env.SENDGRID_API_KEY;
delete process.env.POSTMARK_SERVER_TOKEN;
delete process.env.EMAIL_ENABLED;

// fake ct client — only listAcl (→ stage.all('/custom-objects/release-acl')) is used
function fakeStage(aclEntries) {
  return {
    all: async (path) => (path.includes('release-acl') ? aclEntries.map((value) => ({ value })) : []),
  };
}

const ACL = [
  { email: 'author@ex.com', roles: ['author'] },
  { email: 'rev1@ex.com', roles: ['reviewer'] },
  { email: 'REV2@ex.com', roles: ['author', 'reviewer'] }, // mixed roles + uppercase
  { email: 'pub@ex.com', roles: ['publisher'] },
  { email: 'boss@ex.com', roles: ['admin'] }, // admin ⇒ approve AND publish
  { email: 'not-an-email', roles: ['reviewer'] }, // bogus — filtered out
];

const release = {
  key: 'summer-sale', title: 'Summer Sale', author: 'author@ex.com',
  members: { products: ['a', 'b'], categories: ['c'], cartDiscounts: [], productDiscounts: [], discountCodes: [], discountGroups: [] },
};

test('recipientsForCapability resolves + lowercases + drops bad emails', async () => {
  const stage = fakeStage(ACL);
  const approvers = await recipientsForCapability(stage, 'approve');
  assert.deepEqual(approvers.sort(), ['boss@ex.com', 'rev1@ex.com', 'rev2@ex.com']);
  const publishers = await recipientsForCapability(stage, 'publish');
  assert.deepEqual(publishers.sort(), ['boss@ex.com', 'pub@ex.com']);
});

test('submitted → reviewers (+admin), actor excluded', async () => {
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'submitted', by: 'author@ex.com' });
  assert.equal(r.sent, true);
  assert.deepEqual(r.to.sort(), ['boss@ex.com', 'rev1@ex.com', 'rev2@ex.com']);
});

test('approved → publishers (+admin), acting reviewer excluded', async () => {
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'approved', by: 'rev1@ex.com' });
  assert.deepEqual(r.to.sort(), ['boss@ex.com', 'pub@ex.com']);
});

test('approved by an admin excludes that admin from the publisher list', async () => {
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'approved', by: 'boss@ex.com' });
  assert.deepEqual(r.to.sort(), ['pub@ex.com']);
});

test('published → the author', async () => {
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'published', by: 'pub@ex.com' });
  assert.deepEqual(r.to, ['author@ex.com']);
});

test('rejected → the author', async () => {
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'rejected', by: 'rev1@ex.com', note: 'fix pricing' });
  assert.deepEqual(r.to, ['author@ex.com']);
});

test('open mode (empty ACL) → role-based events have no recipients', async () => {
  const r = await notifyTransition(fakeStage([]), release, { event: 'submitted', by: 'author@ex.com' });
  assert.equal(r.sent, undefined);
  assert.equal(r.skipped, 'no recipients');
});

test('author events still work with an empty ACL (author is on the release)', async () => {
  const r = await notifyTransition(fakeStage([]), release, { event: 'published', by: 'pub@ex.com' });
  assert.deepEqual(r.to, ['author@ex.com']);
});

test('EMAIL_ENABLED=false disables everything', async () => {
  process.env.EMAIL_ENABLED = 'false';
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'submitted', by: 'author@ex.com' });
  delete process.env.EMAIL_ENABLED;
  assert.match(r.skipped, /disabled/);
});

test('unknown event is skipped, not sent', async () => {
  const r = await notifyTransition(fakeStage(ACL), release, { event: 'bogus', by: 'x@ex.com' });
  assert.match(r.skipped, /unknown event/);
});

test('never throws even when the stage client blows up', async () => {
  const broken = { all: async () => { throw new Error('boom'); } };
  // recipientsForCapability swallows the ACL error → resolves to no recipients
  const r = await notifyTransition(broken, release, { event: 'submitted', by: 'author@ex.com' });
  assert.equal(r.skipped, 'no recipients');
});

test('buildMessage subjects/bodies carry the key and member summary', () => {
  const submitted = buildMessage('submitted', release, { by: 'author@ex.com', linkBase: 'https://mc/x/releases' });
  assert.match(submitted.subject, /Summer Sale/);
  assert.match(submitted.text, /summer-sale/);
  assert.match(submitted.text, /2 products, 1 category/); // pluralization
  assert.match(submitted.text, /https:\/\/mc\/x\/releases\/summer-sale/); // deep link
  assert.match(submitted.html, /Open release/);

  const rejected = buildMessage('rejected', release, { by: 'rev1@ex.com', note: 'fix pricing' });
  assert.match(rejected.text, /Reason: fix pricing/);
});

test('readConfig auto-detects provider from whichever key is set', () => {
  assert.equal(readConfig({ RESEND_API_KEY: 'k' }).provider, 'resend');
  assert.equal(readConfig({ SENDGRID_API_KEY: 'k' }).provider, 'sendgrid');
  assert.equal(readConfig({ POSTMARK_SERVER_TOKEN: 'k' }).provider, 'postmark');
  assert.equal(readConfig({}).provider, 'log');
  assert.equal(readConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }).apiKey, 'k');
});
