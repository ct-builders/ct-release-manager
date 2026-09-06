/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { storeAvailabilityAction } from "@/lib/actions";
import AddProductsToCategory from "./AddProductsToCategory";
import type { ProductRow } from "@/lib/products";
import type { StoreOption } from "@/lib/stores";

export default function CategoryProductsPanel({
  products,
  total,
  stores,
  categoryId,
  categoryName,
  facetValues,
  releaseActive,
}: {
  products: ProductRow[];
  total: number;
  stores: StoreOption[];
  categoryId: string;
  categoryName: string;
  facetValues: string[];
  releaseActive: boolean;
}) {
  const [store, setStore] = useState("");
  const [avail, setAvail] = useState<{ all: boolean; keys: Set<string> } | null>(null);
  const [loading, setLoading] = useState(false);

  async function pickStore(key: string) {
    setStore(key);
    setAvail(null);
    if (!key) return;
    setLoading(true);
    const res = await storeAvailabilityAction(key);
    setLoading(false);
    if (res.ok && res.data) setAvail({ all: res.data.all, keys: new Set(res.data.keys) });
  }

  const inStore = (p: ProductRow): boolean | null => (!store || !avail ? null : avail.all ? true : !!p.key && avail.keys.has(p.key));

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          Products in this category <span className="text-sm font-normal text-muted">({total})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Store:</span>
            <select value={store} onChange={(e) => pickStore(e.target.value)} className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm">
              <option value="">All stores (catalog)</option>
              {stores.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
          </label>
          {releaseActive && (
            <AddProductsToCategory
              categoryId={categoryId}
              categoryName={categoryName}
              facetValues={facetValues}
              existingKeys={products.map((p) => p.key).filter((k): k is string => !!k)}
              releaseActive={releaseActive}
            />
          )}
        </div>
      </div>

      {store && !loading && avail?.all && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This store has no product selections configured, so it carries the whole catalog — every product below is available in it.
        </p>
      )}
      {loading && <p className="mb-3 text-sm text-muted">Checking store availability…</p>}

      {products.length === 0 ? (
        <p className="text-sm text-muted">No products in this category yet.</p>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
          {products.map((p) => {
            const av = inStore(p);
            return (
              <Link key={p.id} href={`/products/${encodeURIComponent(p.key ?? p.id)}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent-soft/40">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt="" className="size-9 rounded object-contain bg-black/[.03]" />
                ) : (
                  <span className="grid size-9 place-items-center rounded bg-black/[.04] text-[10px] text-muted">—</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-accent">{p.name}</span>
                  <span className="block truncate font-mono text-xs text-muted">{p.key}</span>
                </span>
                <span className="hidden shrink-0 text-muted sm:block">{p.facet ?? ""}</span>
                <span className="w-16 shrink-0 text-right font-medium">{p.priceLabel ?? ""}</span>
                {av === null ? null : av ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">in store</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-muted">not in store</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
      {total > products.length && (
        <p className="mt-2 text-xs text-muted">Showing {products.length} of {total}.</p>
      )}
    </div>
  );
}
