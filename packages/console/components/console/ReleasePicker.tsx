/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useReleases } from "@/lib/release-context";

/** "Working on: [Release ▾]" — chooses which release's working copy you edit. */
export default function ReleasePicker() {
  const { active, editable, setActive, pending } = useReleases();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted">Working on</span>
      <div className="relative">
        <select
          value={active?.key ?? ""}
          onChange={(e) => setActive(e.target.value || null)}
          disabled={pending}
          className="appearance-none rounded-lg border border-border bg-white py-1.5 pl-3 pr-8 text-sm font-medium outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60"
        >
          <option value="">— no release (browsing live) —</option>
          {editable.map((r) => (
            <option key={r.key} value={r.key}>
              {r.title || r.key}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {active ? (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          draft
        </span>
      ) : (
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-muted">
          read-only
        </span>
      )}
    </div>
  );
}
