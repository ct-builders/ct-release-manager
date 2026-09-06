/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use server";

import { getSession } from "./auth";
import { setColumnPref } from "./user-prefs";
import type { ColumnPref } from "./columns";

/** Persist a table's column layout to the signed-in user's profile. Best-effort. */
export async function saveColumnPrefAction(tableId: string, pref: ColumnPref): Promise<void> {
  const session = await getSession();
  if (!session?.email || !tableId) return;
  const clean: ColumnPref = {
    order: (pref?.order ?? []).map(String).slice(0, 200),
    hidden: (pref?.hidden ?? []).map(String).slice(0, 200),
  };
  await setColumnPref(session.email, tableId, clean).catch(() => {});
}
