/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
    for (const c of list) {
      c.depth = depth;
      sortRec(c.children, depth + 1);
    }
  };
  sortRec(roots, 0);
  return roots;
}

export default function CategoryTree({ nodes, memberKeys }: { nodes: CategoryNode[]; memberKeys: string[] }) {
  const members = useMemo(() => new Set(memberKeys), [memberKeys]);
  const roots = useMemo(() => buildTree(nodes), [nodes]);
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
      const self = match(n);
      if (self || childHit) {
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

  const total = nodes.length;
  const allIds = useMemo(() => nodes.filter((n) => n.hasChildren).map((n) => n.id), [nodes]);

  function highlight(text: string) {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text;
    return (<>{text.slice(0, i)}<mark className="rounded bg-amber-200/70 px-0.5">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>);
  }

  function Row({ n }: { n: TreeNode }) {
    if (visible && !visible.has(n.id)) return null;
    const open = isOpen(n.id);
    const inRelease = n.key && members.has(n.key);
    return (
      <li>
        <div
          className="group flex items-center gap-1 rounded-md py-1 pr-2 hover:bg-accent-soft/50"
          style={{ paddingLeft: `${n.depth * 20 + 4}px` }}
        >
          {n.hasChildren ? (
            <button
              onClick={() => toggle(n.id)}
              aria-label={open ? "Collapse" : "Expand"}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-black/10 hover:text-foreground"
            >
              <svg viewBox="0 0 16 16" className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : (
            <span className="flex size-5 shrink-0 items-center justify-center text-muted/50">·</span>
          )}
          <Link
            href={`/categories/${encodeURIComponent(n.key ?? n.id)}`}
            className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-medium text-foreground hover:text-accent"
          >
            <span className="truncate">{highlight(n.name)}</span>
            {n.hasChildren && <span className="shrink-0 rounded bg-black/5 px-1.5 text-[10px] font-normal text-muted">{n.children.length}</span>}
            {inRelease && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">in release</span>}
          </Link>
          {n.key && <span className="shrink-0 font-mono text-[11px] text-muted opacity-0 group-hover:opacity-100">{highlight(n.key)}</span>}
        </div>
        {n.hasChildren && open && (
          <ul>{n.children.map((c) => <Row key={c.id} n={c} />)}</ul>
        )}
      </li>
    );
  }

  const nothingMatches = !!q && (!visible || visible.size === 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter categories…"
            className="w-72 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground" aria-label="Clear">×</button>
          )}
        </div>
        <button onClick={() => setCollapsed(new Set())} disabled={!!q} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted hover:bg-black/[.04] disabled:opacity-40">Expand all</button>
        <button onClick={() => setCollapsed(new Set(allIds))} disabled={!!q} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted hover:bg-black/[.04] disabled:opacity-40">Collapse all</button>
        <span className="ml-auto text-xs text-muted">{total} categories</span>
      </div>

      <div className="rounded-xl border border-border bg-surface p-2">
        {nothingMatches ? (
          <p className="px-3 py-10 text-center text-sm text-muted">No categories match “{query}”.</p>
        ) : (
          <ul>{roots.map((r) => <Row key={r.id} n={r} />)}</ul>
        )}
      </div>
    </div>
  );
}
