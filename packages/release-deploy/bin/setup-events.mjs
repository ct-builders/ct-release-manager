#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * setup-events.mjs — create/update the commercetools change Subscription that
 * feeds the auto-add feature. Fires on product / category / cart-discount /
 * product-discount / discount-code changes in the STAGE project → Google Cloud
 * Pub/Sub topic (which a push subscription forwards to the deploy service
 * /events endpoint).
 *
 * PREREQ (do first, in GCP): the Pub/Sub topic must exist AND grant
 * roles/pubsub.publisher to subscriptions@commercetools-platform.iam.gserviceaccount.com
 * — otherwise CT's test notification on create fails.
 *
 *   node bin/setup-events.mjs            # create or update
 *   node bin/setup-events.mjs --delete   # remove the subscription
 *
 * Env: EVENTS_TOPIC (default release-events), EVENTS_GCP_PROJECT (default your-gcp-project).
 */
import { ctClient } from '../lib/ct.mjs';

const KEY = 'release-autoadd';
const TOPIC = process.env.EVENTS_TOPIC || 'release-events';
const GCP_PROJECT = process.env.EVENTS_GCP_PROJECT || 'your-gcp-project';
const RESOURCES = ['product', 'category', 'cart-discount', 'product-discount', 'discount-code'];

const destination = { type: 'GoogleCloudPubSub', projectId: GCP_PROJECT, topic: TOPIC };
const changes = RESOURCES.map((resourceTypeId) => ({ resourceTypeId }));

const stage = await ctClient('stage');
const del = process.argv.includes('--delete');
const existing = await stage.byKey('subscriptions', KEY);

if (del) {
  if (!existing) { console.log(`no subscription "${KEY}" to delete`); process.exit(0); }
  const r = await stage.del(`/subscriptions/key=${KEY}?version=${existing.version}`);
  console.log(r.ok ? `deleted subscription "${KEY}"` : `delete failed: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  process.exit(r.ok ? 0 : 1);
}

if (!existing) {
  const r = await stage.post('/subscriptions', { key: KEY, destination, changes });
  if (!r.ok) { console.error(`create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`); process.exit(1); }
  console.log(`created subscription "${KEY}" → pubsub ${GCP_PROJECT}/${TOPIC} on [${RESOURCES.join(', ')}]`);
} else {
  const r = await stage.post(`/subscriptions/key=${KEY}`, { version: existing.version, actions: [{ action: 'setChanges', changes }, { action: 'setMessages', messages: [] }, { action: 'changeDestination', destination }] });
  if (!r.ok) { console.error(`update failed: ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`); process.exit(1); }
  console.log(`updated subscription "${KEY}" → pubsub ${GCP_PROJECT}/${TOPIC} on [${RESOURCES.join(', ')}]`);
}
