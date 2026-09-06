/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { searchProductsForPickerAction, addProductsToCategoryAction } from "@/lib/actions";
import type { ProductRow } from "@/lib/products";
import { hasFacetAttribute, facetPlural } from "@/lib/config";

export default function AddProductsToCategory({
  categoryId,
  categoryName,
  facetValues,
  existingKeys,
  releaseActive,
}: {
  categoryId: string;
  categoryName: string;
  facetValues: string[];
  existingKeys: string[];
  releaseActive: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [facet, setFacet] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const inCategory = new Set(existingKeys);

  async function search(reset = true) {
    setLoading(true);
    const nextOffset = reset ? 0 : offset + 20;
    const res = await searchProductsForPickerAction({ q, facet, offset: nextOffset });
    setLoading(false);
    if (res.ok && res.data) {
      setTotal(res.data.total);
      setOffset(nextOffset);
      setRows((prev) => (reset ? res.data!.results : [...prev, ...res.data!.results]));
    }
  }

  function openModal() {
    setOpen(true);
    setSelected(new Set());
    setMsg(null);
    setQ("");
    setFacet("");
    setRows([]);
    setTotal(0);
    setOffset(0);
    void search(true);
  }
  const close = () => { if (!busy) setOpen(false); };

  const toggle = (key: string) =>
    setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const selectableRows = rows.filter((r) => r.key && !inCategory.has(r.key));
  const allShownSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.key!));
  const toggleAllShown = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allShownSelected) selectableRows.forEach((r) => n.delete(r.key!));
      else selectableRows.forEach((r) => n.add(r.key!));
      return n;
    });

  async function add() {
    setBusy(true);
    setMsg(null);
    const res = await addProductsToCategoryAction(categoryId, [...selected]);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setMsg(res.error);
  }

  const input = "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

  return (
    <>
      <button onClick={openModal} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:opacity-90">
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
        Add products
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,20,.45)", backdropFilter: "blur(3px)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
              <div>
                <h2 className="text-base font-semibold">Add products to “{categoryName}”</h2>
                <p className="mt-0.5 text-xs text-muted">Pick products to add to this category. Saved to the release you&apos;re working on.</p>
              </div>
              <button onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-black/[.06] hover:text-foreground" aria-label="Close">
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
              </button>
            </div>

            {/* filters */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
              <input
                className={`${input} flex-1`}
                placeholder="Search products…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void search(true); }}
              />
              {hasFacetAttribute && (
                <select className={input} value={facet} onChange={(e) => { setFacet(e.target.value); }}>
                  <option value="">All {facetPlural}</option>
                  {facetValues.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              <button onClick={() => void search(true)} disabled={loading} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">Search</button>
            </div>

            {/* results */}
            <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={!selectableRows.length} className="size-4 accent-[var(--accent)]" />
                  Select all shown
                </label>
                <span>{total.toLocaleString()} match{total === 1 ? "" : "es"}{selected.size ? ` · ${selected.size} selected` : ""}</span>
              </div>
              {rows.length === 0 && !loading ? (
                <p className="py-8 text-center text-sm text-muted">No products match.</p>
              ) : (
                <div className="divide-y divide-border/60 rounded-lg border border-border">
                  {rows.map((r) => {
                    const already = r.key ? inCategory.has(r.key) : false;
                    const checked = r.key ? selected.has(r.key) : false;
                    return (
                      <label key={r.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${already ? "opacity-50" : "cursor-pointer hover:bg-accent-soft/40"}`}>
                        <input type="checkbox" checked={checked} disabled={already || !r.key} onChange={() => r.key && toggle(r.key)} className="size-4 accent-[var(--accent)]" />
                        {r.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.image} alt="" className="size-9 rounded object-contain bg-black/[.03]" />
                        ) : (
                          <span className="grid size-9 place-items-center rounded bg-black/[.04] text-[10px] text-muted">—</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block truncate font-mono text-xs text-muted">{r.key}</span>
                        </span>
                        <span className="hidden shrink-0 text-muted sm:block">{r.facet ?? ""}</span>
                        {already && <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-muted">in category</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              {loading && <p className="py-3 text-center text-sm text-muted">Loading…</p>}
              {!loading && rows.length < total && (
                <button onClick={() => void search(false)} className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium hover:bg-black/[.04]">Load more</button>
              )}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3">
              {msg ? <span className="text-sm text-critical">{msg}</span> : <span className="text-xs text-muted">{selected.size} selected</span>}
              <div className="flex items-center gap-2">
                <button onClick={close} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">Cancel</button>
                <button onClick={add} disabled={busy || !selected.size || !releaseActive} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50" title={releaseActive ? "" : "Pick a release first"}>
                  {busy ? "Adding…" : `Add ${selected.size || ""} to category`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
