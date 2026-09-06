/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { applyResourceActionsAction, checkpointProductAction, restoreProductVersionAction } from "@/lib/actions";
import type { CtAction } from "@/lib/product-editor-types";
import type { CategoryEdit } from "@/lib/categories";
import { LOCALE } from "@/lib/config";

export default function CategoryEditor({
  canonicalKey,
  category,
  options,
  releaseActive,
  releaseTitle,
  forked,
  versions,
}: {
  canonicalKey: string;
  category: CategoryEdit;
  options: { id: string; name: string }[];
  releaseActive: boolean;
  releaseTitle?: string;
  forked: boolean;
  versions: { version: number; at: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState(category);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setF(category), [category]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const set = (k: keyof CategoryEdit, v: string) => setF((s) => ({ ...s, [k]: v }));
  const dirty = (Object.keys(f) as (keyof CategoryEdit)[]).some((k) => f[k] !== category[k]);
  const disabled = !releaseActive || busy;

  async function save() {
    const a: CtAction[] = [];
    const L = (v: string) => ({ [LOCALE]: v });
    if (f.name !== category.name) a.push({ action: "changeName", name: L(f.name) });
    if (f.slug !== category.slug) a.push({ action: "changeSlug", slug: L(f.slug) });
    if (f.description !== category.description) a.push({ action: "setDescription", description: L(f.description) });
    if (f.key !== category.key && f.key?.trim()) a.push({ action: "setKey", key: f.key.trim() });
    if (f.metaTitle !== category.metaTitle) a.push({ action: "setMetaTitle", metaTitle: L(f.metaTitle) });
    if (f.metaDescription !== category.metaDescription) a.push({ action: "setMetaDescription", metaDescription: L(f.metaDescription) });
    if (f.metaKeywords !== category.metaKeywords) a.push({ action: "setMetaKeywords", metaKeywords: L(f.metaKeywords) });
    if (f.orderHint !== category.orderHint && f.orderHint.trim()) a.push({ action: "changeOrderHint", orderHint: f.orderHint.trim() });
    if (f.parentId !== category.parentId && f.parentId) a.push({ action: "changeParent", parent: { typeId: "category", id: f.parentId } });
    setBusy(true);
    const res = await applyResourceActionsAction("category", canonicalKey, a);
    setBusy(false);
    if (res.ok) {
      setToast({ ok: true, text: `Saved to “${releaseTitle}”` });
      router.refresh();
    } else setToast({ ok: false, text: res.error });
  }

  async function checkpoint() {
    setBusy(true);
    const res = await checkpointProductAction(canonicalKey);
    setBusy(false);
    if (res.ok) { setToast({ ok: true, text: `Checkpoint v${res.data?.version}` }); router.refresh(); }
    else setToast({ ok: false, text: res.error });
  }
  async function restore(v: number) {
    if (!window.confirm(`Restore checkpoint v${v}?`)) return;
    setBusy(true);
    const res = await restoreProductVersionAction(canonicalKey, v);
    setBusy(false);
    if (res.ok) { setToast({ ok: true, text: `Restored v${v}` }); router.refresh(); }
    else setToast({ ok: false, text: res.error });
  }

  const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02] disabled:text-muted";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

  return (
    <>
      {!releaseActive && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Pick a release in the top bar to edit this category.</div>
      )}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Category</h2>
          {releaseActive && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{forked ? "editing working copy" : "edits save to this release"}</span>}
        </div>
        <div className="grid max-w-2xl gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div><span className={label}>Name</span><input className={input} value={f.name} disabled={disabled} onChange={(e) => set("name", e.target.value)} /></div>
            <div><span className={label}>Key</span><input className={input} value={f.key ?? ""} disabled={disabled} onChange={(e) => set("key", e.target.value)} /></div>
            <div><span className={label}>Slug</span><input className={input} value={f.slug} disabled={disabled} onChange={(e) => set("slug", e.target.value)} /></div>
            <div>
              <span className={label}>Parent</span>
              <select className={input} value={f.parentId} disabled={disabled} onChange={(e) => set("parentId", e.target.value)}>
                <option value="">— root / keep —</option>
                {options.filter((o) => o.id !== f.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
          <div><span className={label}>Description</span><textarea className={`${input} h-20 resize-y`} value={f.description} disabled={disabled} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><span className={label}>Meta title</span><input className={input} value={f.metaTitle} disabled={disabled} onChange={(e) => set("metaTitle", e.target.value)} /></div>
            <div><span className={label}>Order hint</span><input className={input} value={f.orderHint} disabled={disabled} onChange={(e) => set("orderHint", e.target.value)} /></div>
          </div>
          <div><span className={label}>Meta description</span><input className={input} value={f.metaDescription} disabled={disabled} onChange={(e) => set("metaDescription", e.target.value)} /></div>
          {releaseActive && (
            <div className="flex items-center gap-3">
              <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Save category"}</button>
              <button onClick={checkpoint} disabled={!forked || busy} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">Save checkpoint</button>
            </div>
          )}
        </div>
      </div>

      {releaseActive && versions.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">History</h2>
          <div className="space-y-1.5">
            {versions.map((v) => (
              <div key={v.version} className="flex items-center gap-3 text-sm">
                <span className="rounded-md bg-black/5 px-2 py-0.5 text-xs font-semibold">v{v.version}</span>
                <span className="text-muted">{new Date(v.at).toLocaleString()}</span>
                <button onClick={() => restore(v.version)} disabled={busy} className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"}`}>{toast.text}</div>}
    </>
  );
}
