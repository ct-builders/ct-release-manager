/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * config.mjs — the pipeline's auto-add configuration, stored as a CustomObject in
 * the STAGE project (container `release-config`, key `config`).
 *
 * {
 *   autoAddEnabled: boolean,     // master switch for the change-listener auto-add
 *   currentReleaseKey: string|null,  // the draft release changes get added to
 *   updatedAt, updatedBy
 * }
 *
 * When a product / category / discount / discount-code changes on stage, the
 * Pub/Sub push handler (server.mjs) adds its key to `currentReleaseKey`'s members
 * — but only while `autoAddEnabled` is true and the target release is a draft.
 */
export const CONFIG_CONTAINER = 'release-config';
export const CONFIG_KEY = 'config';

const DEFAULT = { autoAddEnabled: false, currentReleaseKey: null };

export async function getConfig(stage) {
  const o = await stage.get(`/custom-objects/${CONFIG_CONTAINER}/${CONFIG_KEY}`);
  return { ...DEFAULT, ...(o && o.value ? o.value : {}) };
}

export async function setConfig(stage, patch, by) {
  const cur = await getConfig(stage);
  const next = {
    autoAddEnabled: patch.autoAddEnabled != null ? !!patch.autoAddEnabled : cur.autoAddEnabled,
    currentReleaseKey: patch.currentReleaseKey !== undefined ? patch.currentReleaseKey : cur.currentReleaseKey,
    updatedAt: new Date().toISOString(),
    updatedBy: by || 'unknown',
  };
  const r = await stage.post('/custom-objects', { container: CONFIG_CONTAINER, key: CONFIG_KEY, value: next });
  if (!r.ok) throw new Error(`write config failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.value;
}
