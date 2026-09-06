/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct } from "./ct";
import { emailKey } from "./acl";
import type { ColumnPref } from "./columns";
import { USER_PREFS_CONTAINER } from "./containers";

/**
 * Per-user UI preferences (e.g. table column layout), stored as custom objects in
 * the authoring project alongside the access list. One
 * object per (user, table): container `rm-user-prefs`,
 * key = `<base64url(email)>__<tableId>`.
 */
const CONTAINER = USER_PREFS_CONTAINER;
const prefKey = (email: string, tableId: string) => `${emailKey(email)}__${tableId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export async function getColumnPref(email: string, tableId: string): Promise<ColumnPref | null> {
  const clean = (email || "").trim().toLowerCase();
  if (!clean) return null;
  try {
    const o = await ct.get<{ value: { order?: string[]; hidden?: string[] } }>(
      `/custom-objects/${CONTAINER}/${ct.enc(prefKey(clean, tableId))}`
    );
    return { order: o.value.order ?? [], hidden: o.value.hidden ?? [] };
  } catch {
    return null; // not set yet (404) or transient — caller falls back to defaults
  }
}

export async function setColumnPref(email: string, tableId: string, pref: ColumnPref): Promise<void> {
  const clean = (email || "").trim().toLowerCase();
  if (!clean) return;
  await ct.post(`/custom-objects`, {
    container: CONTAINER,
    key: prefKey(clean, tableId),
    value: { email: clean, tableId, order: pref.order, hidden: pref.hidden, updatedAt: new Date().toISOString() },
  });
}
