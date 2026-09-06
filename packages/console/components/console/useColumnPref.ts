/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useRef, useState } from "react";
import { saveColumnPrefAction } from "@/lib/prefs-actions";
import type { ColumnPref } from "@/lib/columns";

/**
 * Local column-layout state that auto-persists to the user's profile (debounced).
 * Returns the current pref and an updater — call the updater from the ColumnManager.
 */
export function useColumnPref(tableId: string, initial: ColumnPref): readonly [ColumnPref, (next: ColumnPref) => void] {
  const [pref, setPref] = useState<ColumnPref>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (next: ColumnPref) => {
    setPref(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveColumnPrefAction(tableId, next).catch(() => {});
    }, 400);
  };

  return [pref, update] as const;
}
