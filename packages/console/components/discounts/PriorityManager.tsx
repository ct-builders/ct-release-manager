/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveDiscountLayoutAction } from "@/lib/actions";
import type { DiscountGroup, LayoutData } from "@/lib/discount-layout-types";

// Soft left-bar tints so groups read as distinct buckets (light theme only).
const TINTS = [
  { bar: "bg-rose-400", chip: "bg-rose-50 text-rose-700" },
  { bar: "bg-amber-400", chip: "bg-amber-50 text-amber-700" },
  { bar: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700" },
  { bar: "bg-sky-400", chip: "bg-sky-50 text-sky-700" },
  { bar: "bg-violet-400", chip: "bg-violet-50 text-violet-700" },
  { bar: "bg-teal-400", chip: "bg-teal-50 text-teal-700" },
];

const uid = () => `g${Math.random().toString(36).slice(2, 9)}`;

export default function PriorityManager({ data, highlightKey, triggerLabel }: { data: LayoutData; highlightKey?: string; triggerLabel?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [groups, setGroups] = useState<DiscountGroup[]>(data.groups);
  const [drag, setDrag] = useState<string | null>(null);
  const [hint, setHint] = useState<{ gid: string; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const byKey = useMemo(() => new Map(data.discounts.map((d) => [d.key, d])), [data.discounts]);
  const rank = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    groups.forEach((g) => g.items.forEach((k) => m.set(k, ++i)));
    return m;
  }, [groups]);
  const total = data.discounts.length;
  const dirty = JSON.stringify(groups) !== JSON.stringify(data.groups);
  const kindLabel = data.kind === "cart-discount" ? "cart discounts" : "product discounts";

  useEffect(() => {
    if (!open) return;
    setGroups(data.groups);
    const t = setTimeout(() => setShown(true), 10);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) close(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.groups]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!open || !shown || !highlightKey) return;
    const el = document.querySelector(`[data-rm-key="${CSS.escape(highlightKey)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, shown, highlightKey]);

  function close() { setShown(false); setTimeout(() => setOpen(false), 150); }

  function move(gid: string, index: number) {
    if (!drag) return;
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, items: [...g.items] }));
      let src: DiscountGroup | undefined; let si = -1;
      for (const g of next) { const idx = g.items.indexOf(drag); if (idx >= 0) { src = g; si = idx; break; } }
      if (!src) return prev;
      const tgt = next.find((g) => g.id === gid);
      if (!tgt) return prev;
      src.items.splice(si, 1);
      let insert = index;
      if (src === tgt && si < insert) insert--;
      insert = Math.max(0, Math.min(insert, tgt.items.length));
      tgt.items.splice(insert, 0, drag);
      return next;
    });
    setDrag(null); setHint(null);
  }

  const addGroup = () => setGroups((p) => [...p, { id: uid(), name: `Group ${p.length + 1}`, items: [] }]);
  const renameGroup = (id: string, name: string) => setGroups((p) => p.map((g) => (g.id === id ? { ...g, name } : g)));
  const deleteGroup = (id: string) => setGroups((p) => {
    const g = p.find((x) => x.id === id);
    if (!g) return p;
    const rest = p.filter((x) => x.id !== id);
    if (!g.items.length) return rest.length ? rest : p;
    const home = rest[0] ?? { id: uid(), name: "Ungrouped", items: [] };
    home.items = [...home.items, ...g.items];
    return rest.length ? rest : [home];
  });
  const moveGroup = (id: string, dir: -1 | 1) => setGroups((p) => {
    const i = p.findIndex((g) => g.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function save() {
    setBusy(true);
    const res = await saveDiscountLayoutAction(data.kind, groups);
    setBusy(false);
    if (res.ok) {
      setToast({ ok: true, text: `Priority saved — ${res.data?.reordered ?? 0} updated` });
      router.refresh();
      setTimeout(close, 700);
    } else setToast({ ok: false, text: res.error });
  }

  const DropLine = ({ active }: { active: boolean }) => (
    <div className={`mx-1 my-0.5 h-0.5 rounded-full transition-all ${active ? "bg-accent shadow-[0_0_0_1px_var(--accent)]" : "bg-transparent"}`} />
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium hover:bg-black/[.04]"
      >
        <svg viewBox="0 0 16 16" className="size-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4h8M4 8h8M4 12h5" strokeLinecap="round" /><path d="M12.5 10v4M12.5 14l1.3-1.3M12.5 14l-1.3-1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {triggerLabel ?? "Manage priority"}
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-150 ${shown ? "opacity-100" : "opacity-0"}`}
          style={{ background: "rgba(15,15,20,.45)", backdropFilter: "blur(3px)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}
        >
          <div className={`flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl transition-all duration-150 ${shown ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}>
            {/* header */}
            <div className="flex items-start justify-between gap-4 border-b border-border bg-surface px-6 py-4">
              <div>
                <h2 className="text-base font-semibold">Discount priority</h2>
                <p className="mt-0.5 text-xs text-muted">Drag {kindLabel} into groups and order them. Higher in the list = applied first. Saving updates the whole {kindLabel === "cart discounts" ? "cart" : "product"}-discount order.</p>
              </div>
              <button onClick={() => !busy && close()} className="rounded-lg p-1.5 text-muted hover:bg-black/[.06] hover:text-foreground" aria-label="Close">
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
              </button>
            </div>

            {/* body */}
            <div className="flex min-h-0 flex-1">
              {/* priority rail */}
              <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-surface/60 py-4 text-[10px] font-semibold uppercase tracking-wide text-muted">
                <span className="text-accent">first</span>
                <div className="w-1 flex-1 rounded-full bg-gradient-to-b from-accent via-accent/40 to-black/10" />
                <span>last</span>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
                {groups.map((g, gi) => {
                  const tint = TINTS[gi % TINTS.length];
                  return (
                    <div key={g.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                        <span className={`h-5 w-1.5 rounded-full ${tint.bar}`} />
                        <input
                          value={g.name}
                          onChange={(e) => renameGroup(g.id, e.target.value)}
                          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-semibold outline-none focus:bg-white focus:ring-2 focus:ring-accent-soft"
                        />
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tint.chip}`}>{g.items.length}</span>
                        <div className="flex items-center">
                          <button onClick={() => moveGroup(g.id, -1)} disabled={gi === 0} className="rounded p-1 text-muted hover:bg-black/[.06] disabled:opacity-30" aria-label="Move group up">
                            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M8 3l-4 4M8 3l4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          <button onClick={() => moveGroup(g.id, 1)} disabled={gi === groups.length - 1} className="rounded p-1 text-muted hover:bg-black/[.06] disabled:opacity-30" aria-label="Move group down">
                            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 13V3M8 13l-4-4M8 13l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </div>
                        <button onClick={() => deleteGroup(g.id)} className="rounded p-1 text-muted hover:bg-red-50 hover:text-critical" aria-label="Delete group">
                          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 5h10M6 5V3.5h4V5M4.5 5l.5 8h6l.5-8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                      </div>

                      <div
                        className="min-h-[52px] p-2"
                        onDragOver={(e) => { e.preventDefault(); if (!g.items.length) setHint({ gid: g.id, index: 0 }); }}
                        onDrop={(e) => { e.preventDefault(); move(g.id, hint && hint.gid === g.id ? hint.index : g.items.length); }}
                      >
                        {g.items.length === 0 && (
                          <div className={`flex h-10 items-center justify-center rounded-lg border border-dashed text-xs text-muted ${hint?.gid === g.id ? "border-accent bg-accent-soft/40" : "border-border"}`}>Drop discounts here</div>
                        )}
                        {g.items.map((key, i) => {
                          const d = byKey.get(key);
                          const dragging = drag === key;
                          return (
                            <div key={key}>
                              <DropLine active={hint?.gid === g.id && hint.index === i} />
                              <div
                                draggable
                                data-rm-key={key}
                                onDragStart={() => setDrag(key)}
                                onDragEnd={() => { setDrag(null); setHint(null); }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  const r = e.currentTarget.getBoundingClientRect();
                                  setHint({ gid: g.id, index: e.clientY > r.top + r.height / 2 ? i + 1 : i });
                                }}
                                className={`group flex cursor-grab items-center gap-2.5 rounded-lg border bg-white px-3 py-2 transition ${dragging ? "border-accent opacity-40" : key === highlightKey ? "border-accent ring-2 ring-accent-soft" : "border-border hover:border-accent/50 hover:shadow-sm"}`}
                              >
                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{rank.get(key)}</span>
                                <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted/60" fill="currentColor"><circle cx="6" cy="4" r="1" /><circle cx="10" cy="4" r="1" /><circle cx="6" cy="8" r="1" /><circle cx="10" cy="8" r="1" /><circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" /></svg>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">{d?.name ?? key}</div>
                                  <div className="truncate text-xs text-muted">{d?.summary}</div>
                                </div>
                                {d && !d.isActive && <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-muted">inactive</span>}
                              </div>
                            </div>
                          );
                        })}
                        {g.items.length > 0 && <DropLine active={hint?.gid === g.id && hint.index === g.items.length} />}
                      </div>
                    </div>
                  );
                })}

                <button onClick={addGroup} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted hover:border-accent hover:text-accent">
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
                  Add group
                </button>
              </div>
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3">
              <span className="text-xs text-muted">{total} {kindLabel} · {groups.length} group{groups.length === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => !busy && close()} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04]">Cancel</button>
                <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Save priority"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`fixed bottom-5 right-5 z-[60] rounded-lg border px-4 py-2.5 text-sm shadow-lg ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"}`}>{toast.text}</div>}
    </>
  );
}
