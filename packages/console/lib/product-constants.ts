/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Client-safe product list constants (no server-only import). */

export type SortKey = "name-asc" | "name-desc" | "modified-desc" | "created-desc" | "created-asc";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "name-asc", label: "Name (A–Z)" },
  { key: "name-desc", label: "Name (Z–A)" },
  { key: "modified-desc", label: "Recently updated" },
  { key: "created-desc", label: "Newest" },
  { key: "created-asc", label: "Oldest" },
];
