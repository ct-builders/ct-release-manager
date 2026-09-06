/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { orderedKeys, type ColumnDef, type ColumnPref } from "@/lib/columns";

/**
 * A "Columns" button + popover: toggle which columns show and reorder them.
 * Controlled — `onChange` gets the complete next pref (order includes every known
 * column) so the parent can apply it and persist it.
 */
export default function ColumnManager({
  columns,
  pref,
  onChange,
}: {
  columns: ColumnDef[];
  pref: ColumnPref;
  onChange: (next: ColumnPref) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const order = orderedKeys(columns.map((c) => c.key), pref);
  const hidden = new Set(pref.hidden);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const visibleCount = order.filter((k) => !hidden.has(k)).length;

  const move = (k: string, dir: -1 | 1) => {
    const i = order.indexOf(k);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ order: next, hidden: [...hidden] });
  };
  const toggle = (k: string) => {
    const next = new Set(hidden);
    // keep at least one column visible
    if (!next.has(k) && visibleCount <= 1) return;
    next.has(k) ? next.delete(k) : next.add(k);
    onChange({ order, hidden: [...next] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-black/[.04]"
        title="Choose and reorder columns"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
          <path d="M6.5 2.5v11M10.5 2.5v11" stroke="currentColor" />
        </svg>
        Columns
        <span className="text-xs text-muted">{visibleCount}/{order.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Show &amp; order columns</p>
          <ul className="max-h-80 overflow-auto">
            {order.map((k, i) => {
              const shown = !hidden.has(k);
              return (
                <li key={k} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[.03]">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={shown} onChange={() => toggle(k)} className="size-4 accent-[var(--accent)]" />
                    <span className={`truncate text-sm ${shown ? "" : "text-muted"}`}>{labelOf(k)}</span>
                  </label>
                  <div className="flex shrink-0 gap-0.5">
                    <button type="button" onClick={() => move(k, -1)} disabled={i === 0} className="rounded border border-border px-1.5 text-xs leading-5 hover:bg-black/[.04] disabled:opacity-30" title="Move up" aria-label={`Move ${labelOf(k)} up`}>↑</button>
                    <button type="button" onClick={() => move(k, 1)} disabled={i === order.length - 1} className="rounded border border-border px-1.5 text-xs leading-5 hover:bg-black/[.04] disabled:opacity-30" title="Move down" aria-label={`Move ${labelOf(k)} down`}>↓</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="px-2 pb-1 pt-1.5 text-[10px] text-muted">Saved to your profile automatically.</p>
        </div>
      )}
    </div>
  );
}
