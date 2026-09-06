/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import PageHeader from "@/components/console/PageHeader";
import { listDiscounts, DISCOUNT_TABS, type DiscountKind } from "@/lib/discounts";
import { loadLayoutData } from "@/lib/discount-layout";
import type { OrderableKind } from "@/lib/discount-layout-types";
import PriorityManager from "@/components/discounts/PriorityManager";
import { getActiveReleaseKey } from "@/lib/auth";
import { service } from "@/lib/service";

export const dynamic = "force-dynamic";
const MEMBER_FIELD: Record<DiscountKind, string> = { "cart-discount": "cartDiscounts", "product-discount": "productDiscounts", "discount-code": "discountCodes" };

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const sp = await searchParams;
  const kind = (DISCOUNT_TABS.some((t) => t.key === sp.type) ? sp.type : "cart-discount") as DiscountKind;
  const q = sp.q ?? "";
  const rows = await listDiscounts(kind, q);

  let memberSet = new Set<string>();
  let deletionSet = new Set<string>();
  const rk = await getActiveReleaseKey();
  if (rk) {
    try {
      const rel = (await service.getRelease(rk)).release;
      memberSet = new Set((rel.members as Record<string, string[]>)?.[MEMBER_FIELD[kind]] ?? []);
      deletionSet = new Set((rel.deletions as Record<string, string[]> | undefined)?.[MEMBER_FIELD[kind]] ?? []);
    } catch {
      /* ignore */
    }
  }
  const tabHref = (k: string) => `/discounts?type=${k}`;
  const orderable = kind !== "discount-code";
  const layout = orderable ? await loadLayoutData(kind as OrderableKind) : null;

  return (
    <>
      <PageHeader title="Discounts" description="Create and edit promotions in the release you're working on." />
      <div className="p-6">
        <div className="mb-4 flex gap-1.5 border-b border-border">
          {DISCOUNT_TABS.map((t) => (
            <Link key={t.key} href={tabHref(t.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${kind === t.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`}>
              {t.label}
            </Link>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <form action="/discounts" method="get" className="flex gap-2">
            <input type="hidden" name="type" value={kind} />
            <input name="q" defaultValue={q} placeholder="Search…" className="w-64 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
            <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90">Search</button>
            {q && <Link href={tabHref(kind)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04]">Clear</Link>}
          </form>
          <div className="flex items-center gap-2">
            {kind === "cart-discount" && <Link href="/discounts/groups" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04]">Discount groups</Link>}
            {layout && <PriorityManager data={layout} />}
            <Link href={`/discounts/${kind}/new`} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90">+ New {DISCOUNT_TABS.find((t) => t.key === kind)?.label.replace(/s$/, "").toLowerCase()}</Link>
          </div>
        </div>

        <p className="mb-2 text-xs text-muted">{rows.length} {DISCOUNT_TABS.find((t) => t.key === kind)?.label.toLowerCase()}</p>

        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="border-b border-border px-4 py-2.5 font-semibold">{kind === "discount-code" ? "Code" : "Discount"}</th>
                <th className="border-b border-border px-4 py-2.5 font-semibold">{kind === "discount-code" ? "Applies" : "Value"}</th>
                <th className="border-b border-border px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-accent-soft/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/discounts/${kind}/${encodeURIComponent(d.key ?? d.id)}`} className="inline-flex items-center gap-2 font-medium text-accent">
                      <span className={d.key && deletionSet.has(d.key) ? "text-muted line-through" : undefined}>{kind === "discount-code" ? <span className="font-mono">{d.code}</span> : d.name}</span>
                      {d.key && deletionSet.has(d.key)
                        ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-critical">removing</span>
                        : d.key && memberSet.has(d.key) && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">in release</span>}
                    </Link>
                    {kind === "discount-code" && <span className="ml-2 text-xs text-muted">{d.name}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{d.summary}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.isActive ? "bg-emerald-50 text-emerald-700" : "bg-black/5 text-muted"}`}>{d.isActive ? "Active" : "Inactive"}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-muted">None found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
