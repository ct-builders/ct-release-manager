/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import PageHeader from "@/components/console/PageHeader";
import { service } from "@/lib/service";
import type { AuditReport, AuditResourceRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const GROUPS: { key: string; label: string }[] = [
  { key: "promotion", label: "Promotion layer" },
  { key: "product", label: "Product layer" },
  { key: "reference", label: "Reference layer" },
];

function statusCell(r: AuditResourceRow) {
  if (r.unavailable) return <span className="text-muted">unavailable</span>;
  if (r.total === 0) return <span className="text-muted">empty</span>;
  if (r.missingKey === 0) return <span className="font-semibold text-positive">✓ all keyed</span>;
  return (
    <span className={`font-bold ${r.required ? "text-critical" : "text-warning"}`}>
      {r.missingKey} missing{r.required ? " (required!)" : ""}
    </span>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const sp = await searchParams;
  const project: "live" | "stage" = sp.project === "stage" ? "stage" : "live";

  let report: AuditReport | null = null;
  let error: string | null = null;
  try {
    report = await service.keyAudit(project);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const toggle = (
    <div className="flex gap-1.5">
      {(["live", "stage"] as const).map((p) => (
        <Link
          key={p}
          href={`/audit?project=${p}`}
          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold capitalize ${
            project === p ? "border-accent bg-accent text-accent-fg" : "border-border bg-white hover:bg-black/[.04]"
          }`}
        >
          {p}
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Key Audit"
        description="Every item needs a key to ship across projects. Fix gaps before releasing."
        actions={toggle}
      />
      <div className="max-w-4xl p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-critical">Failed to load audit: {error}</div>}

        {report && (
          <>
            <div
              className={`mb-4 rounded-xl border p-4 text-sm font-semibold ${
                report.summary.clean
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {report.summary.clean
                ? `✓ ${report.project} is clean — every item has a key. Ready for cross-project ships.`
                : `⚠ ${report.summary.totalMissing} item(s) missing a key across: ${report.summary.typesWithGaps.join(", ")}`}
            </div>

            {GROUPS.map((g) => {
              const rows = report.resources.filter((r) => r.group === g.key);
              if (!rows.length) return null;
              return (
                <div key={g.key} className="mb-4 overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="bg-black/[.02] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted">
                    {g.label}
                  </div>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-4 py-2 font-semibold">Resource</th>
                        <th className="px-4 py-2 font-semibold">Total</th>
                        <th className="px-4 py-2 font-semibold">Keyed</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.type} className="border-t border-border/60">
                          <td className="px-4 py-2.5">{r.type}</td>
                          <td className="px-4 py-2.5">{r.total}</td>
                          <td className="px-4 py-2.5">{r.withKey}</td>
                          <td className="px-4 py-2.5">{statusCell(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}

            {report.embeddedPrices && (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                <strong>Embedded prices</strong> — {report.embeddedPrices.totalPrices} prices across{" "}
                {report.embeddedPrices.productsScanned} products ·{" "}
                <span className={report.embeddedPrices.pricesMissingKey ? "font-semibold text-warning" : "font-semibold text-positive"}>
                  {report.embeddedPrices.pricesMissingKey} missing key
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
