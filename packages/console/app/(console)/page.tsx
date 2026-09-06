/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getDashboard, type Range, type Channel } from "@/lib/dashboard";
import { service } from "@/lib/service";
import StatusBadge from "@/components/console/StatusBadge";
import { formatAmount } from "@/lib/money";
import { CURRENCY } from "@/lib/config";
import type { Release } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every dashboard figure is expressed in the reporting currency. */
const money = (n: number) => formatAmount(n, CURRENCY);

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];
const CHANNELS: { key: Channel; label: string }[] = [
  { key: "all", label: "All" },
  { key: "b2b", label: "B2B" },
  { key: "b2c", label: "B2C" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; channel?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = (RANGES.some((r) => r.key === sp.range) ? sp.range : "30d") as Range;
  const channel = (CHANNELS.some((c) => c.key === sp.channel) ? sp.channel : "all") as Channel;

  const d = await getDashboard({ range, channel, from: sp.from, to: sp.to });
  let releases: Release[] = [];
  try {
    releases = (await service.listReleases()).releases ?? [];
  } catch {
    /* ignore */
  }
  const drafts = releases.filter((r) => r.status === "draft").length;
  const up = d.salesTrendPct >= 0;
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.sales));
  const maxProd = Math.max(1, ...d.topProducts.map((p) => p.revenue));
  const maxCat = Math.max(1, ...d.topCategories.map((c) => c.revenue));

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ range, channel, ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), ...patch });
    return `/?${params.toString()}`;
  };
  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-accent text-accent-fg" : "border border-border bg-surface hover:bg-black/[.04]"}`;

  return (
    <>
      <div className="border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted">Online sales performance from production.</p>
      </div>

      <div className="space-y-6 p-6">
        {/* 1. Releases — compact strip at top */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/30 bg-surface px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Releases</h2>
            <span className="text-xs text-muted">{drafts} draft{drafts === 1 ? "" : "s"} · {releases.length} total</span>
          </div>
          {releases.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {releases.slice(0, 4).map((r) => (
                <Link key={r.key} href={`/releases/${encodeURIComponent(r.key)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs transition hover:border-accent hover:bg-accent-soft/40">
                  <span className="max-w-[11rem] truncate font-medium">{r.title || r.key}</span>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Link href="/releases" className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04]">View all</Link>
            <Link href="/releases/new" className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg hover:opacity-90">+ New release</Link>
          </div>
        </div>

        {/* 2. Dates + channel — filter row directly above the reports */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {RANGES.map((r) => (
              <Link key={r.key} href={href({ range: r.key })} className={tab(range === r.key)}>{r.label}</Link>
            ))}
          </div>
          <div className="flex gap-1.5 border-l border-border pl-3">
            {CHANNELS.map((c) => (
              <Link key={c.key} href={href({ channel: c.key })} className={tab(channel === c.key)}>{c.label}</Link>
            ))}
          </div>
          {range === "custom" && (
            <form action="/" method="get" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="range" value="custom" />
              <input type="hidden" name="channel" value={channel} />
              <label className="text-xs text-muted">From<input type="date" name="from" defaultValue={sp.from} className="mt-0.5 block rounded-lg border border-border bg-white px-2 py-1.5 text-sm" /></label>
              <label className="text-xs text-muted">To<input type="date" name="to" defaultValue={sp.to} className="mt-0.5 block rounded-lg border border-border bg-white px-2 py-1.5 text-sm" /></label>
              <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90">Apply</button>
            </form>
          )}
        </div>

        {/* 3. Sales metrics */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Total sales</p>
            <p className="mt-1 text-2xl font-bold text-accent">{money(d.totalSales)}</p>
            <p className="mt-1 flex items-center gap-1 text-xs">
              <span className={`font-semibold ${up ? "text-positive" : "text-critical"}`}>{up ? "▲" : "▼"} {Math.abs(d.salesTrendPct).toFixed(1)}%</span>
              <span className="text-muted">within period</span>
            </p>
          </div>
          <Stat label="Orders" value={d.orders.toLocaleString()} hint={channel === "all" ? "all channels" : channel.toUpperCase()} />
          <Stat label="Avg order value" value={money(d.aov)} hint="approx., across currencies" />
          <Stat label="Active promotions" value={d.activePromotions.toLocaleString()} hint="cart · product · codes" />
        </div>

        {/* sales trend */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Sales trend</h2>
              <p className="text-xs text-muted">selected period · {CURRENCY} (approx., converted across currencies)</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${up ? "bg-emerald-50 text-positive" : "bg-red-50 text-critical"}`}>
              {up ? "Trending up ▲" : "Trending down ▼"} {Math.abs(d.salesTrendPct).toFixed(1)}%
            </span>
          </div>
          <div className="flex h-40 items-stretch gap-1">
            {d.trend.map((t, i) => (
              <div key={i} className="flex flex-1 flex-col justify-end" title={`${t.label}: ${money(t.sales)}`}>
                <div className="w-full rounded-t bg-accent/80 transition hover:bg-accent" style={{ height: `${Math.max(2, (t.sales / maxTrend) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted">
            <span>{d.trend[0]?.label}</span>
            <span>{d.trend[d.trend.length - 1]?.label}</span>
          </div>
        </div>

        {/* top products + categories */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BarList title="Top products" subtitle="by revenue" href="/products" hrefLabel="Products →"
            rows={d.topProducts.map((p) => ({ name: p.name, value: p.revenue, meta: `${p.units} sold`, pct: (p.revenue / maxProd) * 100 }))} />
          <BarList title="Top categories" subtitle="by revenue" href="/categories" hrefLabel="Categories →"
            rows={d.topCategories.map((c) => ({ name: c.name, value: c.revenue, pct: (c.revenue / maxCat) * 100 }))} />
        </div>

        {/* promotions table — impact on revenue */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Promotions</h2>
              <p className="text-xs text-muted">active promotions · revenue impact = revenue of orders that used it, this period</p>
            </div>
            <Link href="/discounts" className="text-xs font-medium text-accent hover:underline">Manage discounts →</Link>
          </div>
          {d.topPromotions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="border-b border-border px-3 py-2 font-semibold">Promotion</th>
                    <th className="border-b border-border px-3 py-2 font-semibold">Type</th>
                    <th className="border-b border-border px-3 py-2 text-right font-semibold">Orders</th>
                    <th className="border-b border-border px-3 py-2 text-right font-semibold">Revenue impact</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topPromotions.map((p) => (
                    <tr key={`${p.type}:${p.label}`} className="border-b border-border/60 last:border-0 hover:bg-accent-soft/30">
                      <td className="px-3 py-2 font-medium">{p.label}</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-muted">{p.type}</span></td>
                      <td className="px-3 py-2 text-right text-muted">{p.orders ? p.orders.toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-right font-medium">{p.revenue ? money(p.revenue) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No active promotions.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function BarList({ title, subtitle, href, hrefLabel, rows }: { title: string; subtitle: string; href: string; hrefLabel: string; rows: { name: string; value: number; meta?: string; pct: number }[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <Link href={href} className="text-xs font-medium text-accent hover:underline">{hrefLabel}</Link>
      </div>
      <div className="space-y-2.5">
        {rows.length === 0 && <p className="text-sm text-muted">No sales in this period.</p>}
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium">{r.name}</span>
              <span className="shrink-0 text-muted">{money(r.value)}{r.meta ? ` · ${r.meta}` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/[.06]">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, r.pct)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
