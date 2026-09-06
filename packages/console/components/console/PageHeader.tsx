/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useReleases } from "@/lib/release-context";
import type { ReactNode } from "react";

/** Consistent section header showing the active "working on" release context. */
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const { active } = useReleases();
  return (
    <div className="border-b border-border bg-surface px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {active ? (
            <span className="rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
              Editing: {active.title || active.key}
            </span>
          ) : (
            <span className="rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium text-muted">
              Browsing live (read-only)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
