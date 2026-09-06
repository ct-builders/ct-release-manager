/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createCategoryAction } from "@/lib/actions";
import type { CategoryNode } from "@/lib/categories";

type TreeNode = CategoryNode & { children: TreeNode[]; depth: number };

function buildTree(nodes: CategoryNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  nodes.forEach((n) => byId.set(n.id, { ...n, children: [], depth: 0 }));
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (list: TreeNode[], depth: number) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of list) { c.depth = depth; sortRec(c.children, depth + 1); }
  };
  sortRec(roots, 0);
  return roots;
}

export default function CreateCategoryWizard({ nodes, hasActiveRelease }: { nodes: CategoryNode[]; hasActiveRelease: boolean }) {
  const router = useRouter();
  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const nameById = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null); // null = top level
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { if (busy) return; setOpen(false); setName(""); setParentId(null); setError(null); };
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function create() {
    setBusy(true); setError(null);
    const res = await createCategoryAction({ name, parentId: parentId ?? undefined });
    if (res.ok && res.data) router.push(`/categories/${encodeURIComponent(res.data.key)}`);
    else { setBusy(false); setError(res.ok ? "Something went wrong." : res.error); }
  }

  const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";
  const parentLabel = parentId ? (nameById.get(parentId) ?? "…") : "Top level (no parent)";

  function Node({ n }: { n: TreeNode }) {
    const isOpen = expanded.has(n.id);
    const selected = parentId === n.id;
    return (
      <li>
        <div className="flex items-center gap-1 rounded-md py-0.5" style={{ paddingLeft: `${n.depth * 16}px` }}>
          {n.children.length ? (
            <button type="button" onClick={() => toggle(n.id)} className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-black/10">
              <svg viewBox="0 0 16 16" className={`size-3 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => setParentId(n.id)}
            className={`flex-1 truncate rounded-md px-2 py-1 text-left text-sm ${selected ? "bg-accent text-accent-fg" : "hover:bg-accent-soft/60"}`}
          >
            {n.name}
          </button>
        </div>
        {n.children.length > 0 && isOpen && <ul>{n.children.map((c) => <Node key={c.id} n={c} />)}</ul>}
      </li>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
        Add category
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,20,.45)", backdropFilter: "blur(3px)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
              <h2 className="text-base font-semibold">Add a category</h2>
              <button onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-black/[.06] hover:text-foreground" aria-label="Close">
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
              </button>
            </div>

            <div className="grid gap-4 overflow-y-auto px-6 py-5">
              {!hasActiveRelease && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Pick a release in the top bar first — new categories are added to the release you&apos;re working on.</p>
              )}
              <div>
                <span className="mb-1 block text-sm font-medium">Category name</span>
                <input className={input} autoFocus value={name} placeholder="e.g. Brake Kits" disabled={!hasActiveRelease} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium">Where does it go?</span>
                <p className="mb-1.5 text-xs text-muted">Selected parent: <span className="font-medium text-foreground">{parentLabel}</span></p>
                <div className="max-h-64 overflow-auto rounded-lg border border-border bg-white p-2">
                  <button
                    type="button"
                    onClick={() => setParentId(null)}
                    className={`mb-1 w-full rounded-md px-2 py-1 text-left text-sm font-medium ${parentId === null ? "bg-accent text-accent-fg" : "hover:bg-accent-soft/60"}`}
                  >
                    Top level (no parent)
                  </button>
                  <ul>{roots.map((r) => <Node key={r.id} n={r} />)}</ul>
                </div>
              </div>
              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-critical">{error}</p>}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border bg-surface px-6 py-3">
              <button onClick={close} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">Cancel</button>
              <button onClick={create} disabled={busy || !name.trim() || !hasActiveRelease} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
                {busy ? "Adding…" : "Add category"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
