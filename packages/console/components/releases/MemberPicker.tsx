/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogOption } from "@/lib/types";

/**
 * Searchable multi-select for release members: type to filter by name/key, click
 * a result to add, remove via chips. Filters the given option list client-side.
 */
export default function MemberPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: CatalogOption[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const byKey = useMemo(() => Object.fromEntries(options.map((o) => [o.key, o])), [options]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options
      .filter(
        (o) =>
          !selectedSet.has(o.key) &&
          (!s || o.key.toLowerCase().includes(s) || (o.name ?? "").toLowerCase().includes(s))
      )
      .slice(0, 50);
  }, [q, options, selectedSet]);

  const add = (k: string) => {
    onChange([...selected, k]);
    setQ("");
  };
  const remove = (k: string) => onChange(selected.filter((x) => x !== k));

  return (
    <div ref={boxRef}>
      <label className="mb-1.5 block text-sm font-semibold">
        {label} <span className="font-normal text-muted">({selected.length})</span>
      </label>

      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft py-1 pl-2.5 pr-1.5 text-xs font-medium text-accent"
            >
              {byKey[k]?.name || k}
              <button
                type="button"
                onClick={() => remove(k)}
                title="Remove"
                className="text-sm leading-none text-accent/70 hover:text-accent"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          value={q}
          placeholder={`Search ${label.toLowerCase()}…`}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        {open && (matches.length > 0 || q) && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-60 overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
            {matches.length === 0 && <div className="px-3 py-2.5 text-sm text-muted">No matches</div>}
            {matches.map((o) => (
              <button
                type="button"
                key={o.key}
                onClick={() => add(o.key)}
                className="flex w-full items-center justify-between gap-3 border-t border-border/60 px-3 py-2 text-left first:border-t-0 hover:bg-accent-soft"
              >
                <span className="text-sm">{o.name || o.key}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{o.key}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
