/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ProductRow } from "@/lib/products";
import { resolveColumns, type ColumnPref } from "@/lib/columns";
import ColumnManager from "@/components/console/ColumnManager";
import { useColumnPref } from "@/components/console/useColumnPref";
import { FACET_ATTRIBUTE, CODE_ATTRIBUTE, hasFacetAttribute, hasCodeAttribute } from "@/lib/config";

const TABLE_ID = "products-list";

type Col = { key: string; label: string; align?: "right"; cell: (p: ProductRow) => ReactNode };

export default function ProductsTable({
  rows,
  memberKeys,
  initialPref,
}: {
  rows: ProductRow[];
  memberKeys: string[];
  initialPref: ColumnPref;
}) {
  const [pref, setPref] = useColumnPref(TABLE_ID, initialPref);
  const members = new Set(memberKeys);

  const columns: Col[] = [
    {
      key: "product",
      label: "Product",
      cell: (p) => (
        <Link href={`/products/${encodeURIComponent(p.key ?? p.id)}`} className="flex items-center gap-3">
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt="" className="size-9 rounded bg-black/[.03] object-contain" />
          ) : (
            <span className="grid size-9 place-items-center rounded bg-black/[.04] text-[10px] text-muted">—</span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-accent">{p.name}</span>
            <span className="block truncate font-mono text-xs text-muted">{p.key}</span>
          </span>
          {p.key && members.has(p.key) && (
            <span className="ml-1 shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">in release</span>
          )}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Status",
      cell: (p) =>
        p.published === false ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[.06] px-2 py-0.5 text-xs font-semibold text-muted">
            <span className="size-1.5 rounded-full bg-slate-400" /> Offline
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Live
          </span>
        ),
    },
    // the two featured product attributes, present only when configured (lib/config.ts)
    ...(hasFacetAttribute
      ? [{ key: "facet", label: FACET_ATTRIBUTE.shortLabel, cell: (p: ProductRow) => <span className="text-muted">{p.facet ?? "—"}</span> } satisfies Col]
      : []),
    ...(hasCodeAttribute
      ? [{ key: "code", label: CODE_ATTRIBUTE.shortLabel, cell: (p: ProductRow) => <span className="font-mono text-xs text-muted">{p.code ?? "—"}</span> } satisfies Col]
      : []),
    { key: "price", label: "Price", align: "right", cell: (p) => <span className="font-medium">{p.priceLabel ?? "—"}</span> },
  ];

  const visible = resolveColumns(columns, pref);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ColumnManager columns={columns.map((c) => ({ key: c.key, label: c.label }))} pref={pref} onChange={setPref} />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              {visible.map((c) => (
                <th key={c.key} className={`border-b border-border px-4 py-2.5 font-semibold ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-accent-soft/40">
                {visible.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""}`}>
                    {c.cell(p)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visible.length} className="px-4 py-10 text-center text-muted">No products match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
