/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useRouter } from "next/navigation";
import StatusBadge from "@/components/console/StatusBadge";
import { memberCount, type Release } from "@/lib/types";

export default function ReleasesTable({ releases }: { releases: Release[] }) {
  const router = useRouter();

  if (releases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
        No releases yet. Create one to group changes for shipping to live.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted">
            <th className="border-b border-border px-4 py-2.5 font-semibold">Release</th>
            <th className="border-b border-border px-4 py-2.5 font-semibold">Status</th>
            <th className="border-b border-border px-4 py-2.5 font-semibold">Items</th>
            <th className="border-b border-border px-4 py-2.5 font-semibold">Author → Approver</th>
            <th className="border-b border-border px-4 py-2.5 font-semibold">Last ship</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r) => {
            const last = (r.deployments as { at: string; apply?: boolean; ok?: boolean }[] | undefined)?.[0];
            return (
              <tr
                key={r.key}
                onClick={() => router.push(`/releases/${encodeURIComponent(r.key)}`)}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent-soft/40"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-accent">{r.title || r.key}</div>
                  <div className="font-mono text-xs text-muted">{r.key}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">{memberCount(r.members)}</td>
                <td className="px-4 py-3">
                  <span>{r.author}</span>
                  <span className="text-muted"> → {r.approver || "—"}</span>
                </td>
                <td className="px-4 py-3 text-muted">
                  {last ? (
                    <span title={last.at}>
                      {last.apply ? "Shipped" : "Dry-run"} {last.ok ? "✓" : "✗"}{" "}
                      <span className="text-xs">{new Date(last.at).toLocaleDateString()}</span>
                    </span>
                  ) : (
                    "never"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
