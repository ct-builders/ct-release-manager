/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

const MAP: Record<string, string> = {
  draft: "bg-black/5 text-muted",
  "ready-for-review": "bg-amber-100 text-amber-800",
  approved: "bg-indigo-100 text-indigo-800",
  published: "bg-emerald-100 text-emerald-700",
  "rolled-back": "bg-red-100 text-red-700",
};

/** Colored pill for a release lifecycle status. */
export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${MAP[status] ?? MAP.draft}`}
    >
      {status.replace(/-/g, " ")}
    </span>
  );
}
