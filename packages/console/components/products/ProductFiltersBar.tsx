/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SORTS, type SortKey } from "@/lib/product-constants";
import { FACET_ATTRIBUTE, hasFacetAttribute, facetPlural } from "@/lib/config";

type Current = { q: string; sort: SortKey; category: string; facet: string; published?: "true" | "false"; inrelease: boolean };

/** The facet filter travels in the URL under the attribute's own name, so links read as `?brand=Acme`. */
export const FACET_PARAM = FACET_ATTRIBUTE.name || "facet";

export default function ProductFiltersBar({
  current,
  categories,
  facetValues,
  hasActiveRelease,
}: {
  current: Current;
  categories: { id: string; name: string }[];
  facetValues: string[];
  hasActiveRelease: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(current.q);

  function push(patch: Partial<Current>) {
    const next = { ...current, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.sort && next.sort !== "name-asc") params.set("sort", next.sort);
    if (next.category) params.set("category", next.category);
    if (next.facet) params.set(FACET_PARAM, next.facet);
    if (next.published) params.set("published", next.published);
    if (next.inrelease) params.set("inrelease", "1");
    const qs = params.toString();
    router.push(qs ? `/products?${qs}` : "/products");
  }

  const active = current.q || current.category || current.facet || current.published || current.inrelease || current.sort !== "name-asc";
  const sel = "rounded-lg border border-border bg-white px-2.5 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          push({ q });
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products…"
          className="w-64 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <button className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:opacity-90">Search</button>
      </form>

      <select className={sel} value={current.sort} onChange={(e) => push({ sort: e.target.value as SortKey })} aria-label="Sort">
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>Sort: {s.label}</option>
        ))}
      </select>

      <select className={sel} value={current.category} onChange={(e) => push({ category: e.target.value })} aria-label="Category">
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {hasFacetAttribute && (
        <select className={sel} value={current.facet} onChange={(e) => push({ facet: e.target.value })} aria-label={FACET_ATTRIBUTE.label}>
          <option value="">All {facetPlural}</option>
          {facetValues.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      )}

      <select
        className={sel}
        value={current.published ?? ""}
        onChange={(e) => push({ published: (e.target.value || undefined) as "true" | "false" | undefined })}
        aria-label="Availability"
      >
        <option value="">Live &amp; offline</option>
        <option value="true">Live only</option>
        <option value="false">Offline only</option>
      </select>

      {hasActiveRelease && (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
          <input type="checkbox" checked={current.inrelease} onChange={(e) => push({ inrelease: e.target.checked })} className="size-4 accent-[var(--accent)]" />
          In this release
        </label>
      )}

      {active && (
        <button onClick={() => router.push("/products")} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/[.04]">
          Clear
        </button>
      )}
    </div>
  );
}
