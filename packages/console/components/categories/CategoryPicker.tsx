/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useMemo, useState } from "react";
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
    list.sort((a, b) => (a.orderHint || "z").localeCompare(b.orderHint || "z") || a.name.localeCompare(b.name));
    for (const c of list) { c.depth = depth; sortRec(c.children, depth + 1); }
  };
  sortRec(roots, 0);
  return roots;
}

/**
 * A searchable category tree used as a form control. `multiple` toggles between
 * single-select (radio-like; a product's one category on create) and multi-select
 * (checkboxes; changing every category a product belongs to when editing).
 */
export default function CategoryPicker({
  nodes,
  value,
  onChange,
  multiple = false,
  disabled = false,
}: {
  nodes: CategoryNode[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const selected = useMemo(() => new Set(value), [value]);
  const nameById = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);
  const parentById = useMemo(() => new Map(nodes.map((n) => [n.id, n.parentId])), [nodes]);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Default: expand the top level, collapse everything deeper (depth ≥ 1).
    const c = new Set<string>();
    const walk = (list: TreeNode[]) => list.forEach((n) => { if (n.depth >= 1 && n.hasChildren) c.add(n.id); walk(n.children); });
    walk(roots);
    return c;
  });

  const q = query.trim().toLowerCase();

  // When searching: keep any node that matches, plus all its ancestors (so the
  // branch stays navigable), and force those branches open.
  const { visible, forceOpen } = useMemo(() => {
    if (!q) return { visible: null as Set<string> | null, forceOpen: new Set<string>() };
    const vis = new Set<string>();
    const open = new Set<string>();
    const match = (n: TreeNode) => n.name.toLowerCase().includes(q) || (n.key ?? "").toLowerCase().includes(q);
    const walk = (n: TreeNode, ancestors: string[]): boolean => {
      let childHit = false;
      for (const c of n.children) childHit = walk(c, [...ancestors, n.id]) || childHit;
      if (match(n) || childHit) {
        vis.add(n.id);
        ancestors.forEach((a) => { vis.add(a); open.add(a); });
        if (childHit) open.add(n.id);
        return true;
      }
      return false;
    };
    roots.forEach((r) => walk(r, []));
    return { visible: vis, forceOpen: open };
  }, [q, roots]);

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const isOpen = (id: string) => (q ? forceOpen.has(id) : !collapsed.has(id));
  const allParentIds = useMemo(() => nodes.filter((n) => n.hasChildren).map((n) => n.id), [nodes]);

  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      parts.unshift(nameById.get(cur) ?? cur);
      cur = parentById.get(cur) || undefined;
    }
    return parts.join(" › ");
  };

  function pick(id: string) {
    if (disabled) return;
    if (multiple) {
      const next = new Set(selected);
      next.has(id) ? next.delete(id) : next.add(id);
      onChange([...next]);
    } else {
      onChange([id]);
    }
  }

  function highlight(text: string) {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text;
    return (<>{text.slice(0, i)}<mark className="rounded bg-amber-200/70 px-0.5">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>);
  }

  function Row({ n }: { n: TreeNode }) {
    if (visible && !visible.has(n.id)) return null;
    const open = isOpen(n.id);
    const isSel = selected.has(n.id);
    return (
      <li>
        <div className="flex items-center gap-1 rounded-md py-0.5" style={{ paddingLeft: `${n.depth * 16}px` }}>
          {n.hasChildren ? (
            <button type="button" onClick={() => toggle(n.id)} aria-label={open ? "Collapse" : "Expand"} className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-black/10 hover:text-foreground">
              <svg viewBox="0 0 16 16" className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : (
            <span className="flex size-5 shrink-0 items-center justify-center text-muted/40">·</span>
          )}
          <button
            type="button"
            onClick={() => pick(n.id)}
            disabled={disabled}
            aria-pressed={isSel}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              isSel && !multiple ? "bg-accent font-medium text-accent-fg" : isSel ? "bg-accent-soft font-medium text-foreground" : "hover:bg-accent-soft/60"
            }`}
          >
            {multiple && (
              <span className={`grid size-4 shrink-0 place-items-center rounded border ${isSel ? "border-accent bg-accent text-accent-fg" : "border-border bg-white"}`}>
                {isSel && <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 8l3.5 3.5L13 4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
            )}
            <span className="truncate">{highlight(n.name)}</span>
            {n.hasChildren && <span className={`shrink-0 rounded px-1.5 text-[10px] font-normal ${isSel && !multiple ? "bg-white/20 text-accent-fg" : "bg-black/5 text-muted"}`}>{n.children.length}</span>}
          </button>
        </div>
        {n.hasChildren && open && <ul>{n.children.map((c) => <Row key={c.id} n={c} />)}</ul>}
      </li>
    );
  }

  const nothingMatches = !!q && (!visible || visible.size === 0);
  const inputCls = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02]";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories…"
            disabled={disabled}
            className={`${inputCls} pr-7`}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground" aria-label="Clear search">×</button>
          )}
        </div>
        <button type="button" onClick={() => setCollapsed(new Set())} disabled={!!q || disabled} className="rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted hover:bg-black/[.04] disabled:opacity-40">Expand all</button>
        <button type="button" onClick={() => setCollapsed(new Set(allParentIds))} disabled={!!q || disabled} className="rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted hover:bg-black/[.04] disabled:opacity-40">Collapse all</button>
      </div>

      <div className="max-h-72 overflow-auto rounded-lg border border-border bg-white p-2">
        {!multiple && (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className={`mb-1 w-full rounded-md px-2 py-1 text-left text-sm disabled:opacity-50 ${value.length === 0 ? "bg-accent font-medium text-accent-fg" : "text-muted hover:bg-accent-soft/60"}`}
          >
            — No category —
          </button>
        )}
        {nothingMatches ? (
          <p className="px-3 py-8 text-center text-sm text-muted">No categories match “{query}”.</p>
        ) : (
          <ul>{roots.map((r) => <Row key={r.id} n={r} />)}</ul>
        )}
      </div>

      {/* selected summary */}
      {multiple ? (
        value.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {value.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent">
                {pathOf(id)}
                <button type="button" onClick={() => pick(id)} disabled={disabled} className="grid size-4 place-items-center rounded-full hover:bg-accent/20 disabled:opacity-50" aria-label={`Remove ${nameById.get(id) ?? id}`}>
                  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">No categories selected.</p>
        )
      ) : (
        value[0] && <p className="mt-1.5 text-xs text-muted">Selected: <span className="font-medium text-foreground">{pathOf(value[0])}</span></p>
      )}
    </div>
  );
}
