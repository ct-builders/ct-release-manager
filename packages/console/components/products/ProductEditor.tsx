/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { applyProductActionsAction, checkpointProductAction, restoreProductVersionAction, publishProductAction, setProductPublishedAction } from "@/lib/actions";
import type { EditProduct, CtAction, PriceRefs } from "@/lib/product-editor-types";
import type { CategoryNode } from "@/lib/categories";
import type { ColumnPref } from "@/lib/columns";
import AttributesTab from "./editor/AttributesTab";
import VariantsManager, { PricesEditor, ImagesEditor } from "./editor/VariantsTab";
import CategoryPicker from "@/components/categories/CategoryPicker";
import { LOCALE } from "@/lib/config";

type Tab = "general" | "categories" | "attributes" | "prices" | "images" | "variants";

export default function ProductEditor({
  canonicalKey,
  product,
  priceRefs,
  categoryNodes,
  releaseActive,
  releaseTitle,
  forked,
  versions,
  canAdmin = false,
  publishState,
  pricesColumnPref,
}: {
  canonicalKey: string;
  product: EditProduct;
  priceRefs?: PriceRefs;
  categoryNodes: CategoryNode[];
  releaseActive: boolean;
  releaseTitle?: string;
  forked: boolean;
  versions: { version: number; at: string }[];
  /** admin capability — gates the online/offline availability control */
  canAdmin?: boolean;
  /** canonical product's current published (online) state in stage + live */
  publishState?: { exists: boolean; published: boolean };
  /** the signed-in user's saved column layout for the price table */
  pricesColumnPref?: ColumnPref;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("general");
  const [busy, setBusy] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [g, setG] = useState({ name: product.name, slug: product.slug, description: product.description });
  const [cats, setCats] = useState<string[]>(product.categories);

  // The product key is read-only: it's the canonical identity, and when editing a
  // release the fetched record's key carries a `__b__<branchId>` working-copy suffix
  // that must never be shown as editable (or renamed — it would break the compound-key
  // contract the deploy service relies on). Show the canonical part; surface the
  // working-copy suffix, if any, as a small caption underneath.
  const releaseSuffix = product.key && product.key !== canonicalKey ? product.key.slice(canonicalKey.length) : "";

  // Single-variant products show attributes in the main view; multi-variant products get a unified per-variant "Variants" view.
  const multi = product.variants.length > 1;
  const master = product.variants.find((v) => v.id === product.masterVariantId) ?? product.variants[0];
  const tabs: { id: Tab; label: string }[] = multi
    ? [{ id: "general", label: "General" }, { id: "categories", label: "Categories" }, { id: "variants", label: "Variants" }]
    : [{ id: "general", label: "General" }, { id: "categories", label: "Categories" }, { id: "attributes", label: "Attributes" }, { id: "prices", label: "Prices" }, { id: "images", label: "Images" }];

  // adding/removing a variant can flip the tab set; derive a valid active tab rather than storing a stale one
  const activeTab: Tab = tabs.some((t) => t.id === tab) ? tab : multi ? "variants" : "attributes";

  useEffect(() => {
    setG({ name: product.name, slug: product.slug, description: product.description });
    setCats(product.categories);
  }, [product]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  async function apply(actions: CtAction[]): Promise<boolean> {
    if (!actions.length) return true;
    setBusy(true);
    const res = await applyProductActionsAction(canonicalKey, actions);
    setBusy(false);
    if (res.ok) {
      setToast({ ok: true, text: `Saved to “${releaseTitle}”` });
      router.refresh();
      return true;
    }
    setToast({ ok: false, text: res.error });
    return false;
  }

  async function uploadImage(variantId: number, file: File): Promise<boolean> {
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("variantId", String(variantId));
    const r = await fetch(`/api/products/${encodeURIComponent(canonicalKey)}/image`, { method: "POST", body: fd });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setToast({ ok: true, text: "Image uploaded" });
      router.refresh();
      return true;
    }
    setToast({ ok: false, text: j.error || "Upload failed" });
    return false;
  }

  async function saveGeneral() {
    const a: CtAction[] = [];
    if (g.name !== product.name) a.push({ action: "changeName", name: { [LOCALE]: g.name }, staged: false });
    if (g.slug !== product.slug) a.push({ action: "changeSlug", slug: { [LOCALE]: g.slug }, staged: false });
    if (g.description !== product.description) a.push({ action: "setDescription", description: { [LOCALE]: g.description }, staged: false });
    await apply(a);
  }

  async function saveCategories() {
    const before = new Set(product.categories);
    const after = new Set(cats);
    const a: CtAction[] = [];
    for (const id of after) if (!before.has(id)) a.push({ action: "addToCategory", category: { typeId: "category", id }, staged: false });
    for (const id of before) if (!after.has(id)) a.push({ action: "removeFromCategory", category: { typeId: "category", id }, staged: false });
    await apply(a);
  }

  async function addVariant() {
    // Copy SameForAll attribute values from the master so commercetools validation passes.
    const shared = product.attrDefs
      .filter((d) => d.constraint === "SameForAll")
      .map((d) => master.attributes.find((a) => a.name === d.name))
      .filter((a): a is { name: string; value: unknown } => !!a)
      .map((a) => ({ name: a.name, value: a.value }));
    const ok = await apply([{ action: "addVariant", ...(shared.length ? { attributes: shared } : {}), staged: false }]);
    if (ok) setTab("variants");
  }

  async function checkpoint() {
    setBusy(true);
    const res = await checkpointProductAction(canonicalKey);
    setBusy(false);
    if (res.ok) {
      setToast({ ok: true, text: `Checkpoint v${res.data?.version} saved` });
      router.refresh();
    } else setToast({ ok: false, text: res.error });
  }
  async function restore(v: number) {
    if (!window.confirm(`Restore checkpoint v${v}? Overwrites the current working copy.`)) return;
    setBusy(true);
    const res = await restoreProductVersionAction(canonicalKey, v);
    setBusy(false);
    if (res.ok) {
      setToast({ ok: true, text: `Restored v${v}` });
      router.refresh();
    } else setToast({ ok: false, text: res.error });
  }

  async function togglePublish() {
    const online = !!publishState?.published;
    const next = !online;
    const verb = next ? "bring ONLINE" : "take OFFLINE";
    if (!window.confirm(`This will ${verb} “${product.name}” in BOTH staging and production, immediately. Continue?`)) return;
    setPubBusy(true);
    const res = await publishProductAction(canonicalKey, next);
    setPubBusy(false);
    if (res.ok && res.data) {
      const r = res.data.result;
      const state = (s?: { found?: boolean; error?: string }) =>
        !s || !s.found ? "not found" : s.error ? `error: ${s.error}` : "✓";
      setToast({ ok: res.data.ok, text: `${next ? "Online" : "Offline"} — staging ${state(r.stage)}, production ${state(r.live)}` });
      router.refresh();
    } else {
      setToast({ ok: false, text: res.ok ? "error" : res.error });
    }
  }

  // Release-scoped availability: edit the working copy; production changes on deploy.
  async function toggleReleasePublish() {
    const next = !releaseOnline;
    setPubBusy(true);
    const res = await setProductPublishedAction(canonicalKey, next);
    setPubBusy(false);
    if (res.ok) {
      setToast({ ok: true, text: `${next ? "Online" : "Offline"} in this release — takes effect in production when the release deploys.` });
      router.refresh();
    } else setToast({ ok: false, text: res.error });
  }

  const disabled = !releaseActive || busy;
  const online = !!publishState?.published;
  const releaseOnline = product.published;
  const gDirty = g.name !== product.name || g.slug !== product.slug || g.description !== product.description;
  const catsDirty = cats.length !== product.categories.length || cats.some((id) => !product.categories.includes(id));
  const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02] disabled:text-muted";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";
  const tabCls = (t: Tab) => `px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${activeTab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`;
  const onBtn = "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50";
  const offBtn = "rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50";

  return (
    <>
      {!releaseActive && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You&apos;re browsing live (read-only). Pick a release in the top bar to edit this product in a working copy.
        </div>
      )}

      {/* Prominent availability + variant actions, right at the top */}
      {(releaseActive || (canAdmin && publishState?.exists)) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3">
          {releaseActive && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">In this release</span>
              {releaseTitle && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">{releaseTitle}</span>}
              <AvailPill online={releaseOnline} />
              <button onClick={toggleReleasePublish} disabled={pubBusy || busy} className={releaseOnline ? offBtn : onBtn}>
                {pubBusy ? "Working…" : releaseOnline ? "Take offline" : "Bring online"}
              </button>
            </div>
          )}
          {canAdmin && publishState?.exists && (
            <div className="flex items-center gap-2 sm:border-l sm:border-border sm:pl-6">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Live &amp; staging</span>
              <AvailPill online={online} />
              <button onClick={togglePublish} disabled={pubBusy} className={online ? offBtn : onBtn}>
                {pubBusy ? "Working…" : online ? "Take offline" : "Bring online"}
              </button>
            </div>
          )}
          {releaseActive && (
            <button onClick={addVariant} disabled={busy} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">
              + Add variant
            </button>
          )}
          {releaseActive && (
            <p className="basis-full text-[11px] text-muted">
              Release availability takes effect when the release deploys{canAdmin && publishState?.exists ? "; “Live & staging” applies immediately, bypassing the release" : ""}.
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button key={t.id} className={tabCls(t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          {releaseActive && (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
              {forked ? "editing working copy" : "edits save to this release"}
            </span>
          )}
        </div>

        <div className="p-5">
          {activeTab === "general" && (
            <div className="grid max-w-2xl gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className={label}>Name</span>
                  <input aria-label="Product name" className={input} value={g.name} disabled={disabled} onChange={(e) => setG({ ...g, name: e.target.value })} />
                </div>
                <div>
                  <span className={label}>Slug</span>
                  <input aria-label="Product slug" className={input} value={g.slug} disabled={disabled} onChange={(e) => setG({ ...g, slug: e.target.value })} />
                </div>
                <div>
                  <span className={label}>Key</span>
                  <div
                    className="w-full rounded-lg border border-border bg-black/[.03] px-3 py-2 font-mono text-sm text-muted"
                    title="The product key is read-only"
                    aria-readonly="true"
                  >
                    {canonicalKey}
                  </div>
                  {releaseSuffix && (
                    <span className="mt-1 block font-mono text-[10px] leading-tight text-muted/70" title="Working-copy suffix for this release">
                      {releaseSuffix}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className={label}>Description</span>
                <textarea className={`${input} h-24 resize-y`} value={g.description} disabled={disabled} onChange={(e) => setG({ ...g, description: e.target.value })} />
              </div>
              {releaseActive && (
                <div>
                  <button onClick={saveGeneral} disabled={!gDirty || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
                    {busy ? "Saving…" : "Save general info"}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "categories" && (
            <div className="grid max-w-2xl gap-4">
              <div>
                <span className={label}>Categories</span>
                <p className="-mt-0.5 mb-2 text-xs text-muted">Choose every category this product should appear in. Search or browse the tree.</p>
                <CategoryPicker multiple nodes={categoryNodes} value={cats} onChange={setCats} disabled={disabled} />
              </div>
              {releaseActive && (
                <div>
                  <button onClick={saveCategories} disabled={!catsDirty || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
                    {busy ? "Saving…" : "Save categories"}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "attributes" && (
            <AttributesTab attrDefs={product.attrDefs} variant={master} variantId={product.masterVariantId} apply={apply} disabled={disabled} busy={busy} releaseActive={releaseActive} />
          )}

          {activeTab === "prices" && (
            <PricesEditor variant={master} refs={priceRefs ?? { customerGroups: [], channels: [] }} apply={apply} disabled={disabled} busy={busy} releaseActive={releaseActive} columnPref={pricesColumnPref} />
          )}

          {activeTab === "images" && (
            <ImagesEditor variant={master} apply={apply} uploadImage={uploadImage} busy={busy} releaseActive={releaseActive} />
          )}

          {activeTab === "variants" && (
            <VariantsManager product={product} priceRefs={priceRefs} apply={apply} uploadImage={uploadImage} disabled={disabled} busy={busy} releaseActive={releaseActive} branchSuffix={releaseSuffix} pricesColumnPref={pricesColumnPref} />
          )}
        </div>
      </div>

      {releaseActive && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Working copy history</h2>
            <button onClick={checkpoint} disabled={!forked || busy} title={forked ? "" : "Make a change first"} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">
              Save checkpoint
            </button>
          </div>
          {versions.length === 0 ? (
            <p className="text-xs text-muted">No checkpoints yet.</p>
          ) : (
            <div className="space-y-1.5">
              {versions.map((v) => (
                <div key={v.version} className="flex items-center gap-3 text-sm">
                  <span className="rounded-md bg-black/5 px-2 py-0.5 text-xs font-semibold">v{v.version}</span>
                  <span className="text-muted">{new Date(v.at).toLocaleString()}</span>
                  <button onClick={() => restore(v.version)} disabled={busy} className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"}`}>
          {toast.text}
        </div>
      )}
    </>
  );
}

function AvailPill({ online }: { online: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${online ? "bg-emerald-100 text-emerald-700" : "bg-black/[.06] text-muted"}`}>
      <span className={`size-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
      {online ? "Online" : "Offline"}
    </span>
  );
}
