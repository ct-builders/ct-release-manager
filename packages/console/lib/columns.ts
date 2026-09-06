/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Client-safe column-manager types + resolution. Shared by the tables and the
 * server-side preference store. A user's column preference is stored per table
 * (a stable `tableId`) as an ordering of column keys plus a set of hidden keys. */

export type ColumnDef = { key: string; label: string };
export type ColumnPref = { order: string[]; hidden: string[] };
export const EMPTY_PREF: ColumnPref = { order: [], hidden: [] };

/**
 * Full ordered key list (visible + hidden) for the column manager UI: honors the
 * saved order, then appends any columns the pref doesn't know about (e.g. a column
 * added after the pref was saved) so nothing silently disappears.
 */
export function orderedKeys(allKeys: string[], pref?: ColumnPref | null): string[] {
  const order = pref?.order ?? [];
  const known = new Set(allKeys);
  return [...order.filter((k) => known.has(k)), ...allKeys.filter((k) => !order.includes(k))];
}

/** The visible columns, in the user's order — new columns default to visible. */
export function resolveColumns<T extends ColumnDef>(all: T[], pref?: ColumnPref | null): T[] {
  const hidden = new Set(pref?.hidden ?? []);
  const byKey = new Map(all.map((c) => [c.key, c]));
  return orderedKeys(all.map((c) => c.key), pref)
    .filter((k) => !hidden.has(k))
    .map((k) => byKey.get(k)!)
    .filter(Boolean);
}
