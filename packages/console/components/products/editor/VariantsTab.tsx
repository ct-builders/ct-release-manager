/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useMemo, useRef, useState } from "react";
import type { EditProduct, EditVariant, CtAction, PriceRefs } from "@/lib/product-editor-types";
import { resolveColumns, EMPTY_PREF, type ColumnPref } from "@/lib/columns";
import ColumnManager from "@/components/console/ColumnManager";
import { useColumnPref } from "@/components/console/useColumnPref";
import AttributesTab from "./AttributesTab";
import { CURRENCY, CURRENCIES, COUNTRIES as CONFIGURED_COUNTRIES } from "@/lib/config";

// a blank first option means "no country" — a price that applies everywhere
const COUNTRIES = ["", ...CONFIGURED_COUNTRIES];
const EMPTY_REFS: PriceRefs = { customerGroups: [], channels: [] };
type PriceRow = {
  id?: string;
  currencyCode: string;
  amount: string;
  country: string;
  customerGroupId: string;
  channelId: string;
  validFrom: string; // datetime-local
  validUntil: string; // datetime-local
};
type PriceSortKey = "amount" | "currencyCode" | "country" | "customerGroupId" | "channelId" | "validFrom" | "validUntil";
// `w` is a relative width weight, used to size columns proportionally to whichever are shown.
const PRICE_COLS: { key: PriceSortKey; label: string; numeric?: boolean; w: number }[] = [
  { key: "amount", label: "Amount", numeric: true, w: 8 },
  { key: "currencyCode", label: "Currency", w: 8 },
  { key: "country", label: "Country", w: 8 },
  { key: "customerGroupId", label: "Customer group", w: 20 },
  { key: "channelId", label: "Channel", w: 20 },
  { key: "validFrom", label: "Valid from", w: 15 },
  { key: "validUntil", label: "Valid until", w: 15 },
];

/** Multi-variant view: a grid of variant cards; clicking one opens a focused window (its own tabs). */
export default function VariantsManager({
  product,
  priceRefs = EMPTY_REFS,
  apply,
  uploadImage,
  disabled,
  busy,
  releaseActive,
  branchSuffix = "",
  pricesColumnPref,
}: {
  product: EditProduct;
  priceRefs?: PriceRefs;
  apply: (actions: CtAction[]) => Promise<boolean>;
  uploadImage: (variantId: number, file: File) => Promise<boolean>;
  disabled: boolean;
  busy: boolean;
  releaseActive: boolean;
  branchSuffix?: string;
  pricesColumnPref?: ColumnPref;
}) {
  const master = product.masterVariantId;
  const [openId, setOpenId] = useState<number | null>(null);

  const openVariant = product.variants.find((v) => v.id === openId) ?? null;
  // if the open variant was removed by a save, close its window
  if (openId != null && !openVariant) setOpenId(null);

  const strip = (v?: string) => (v && branchSuffix && v.endsWith(branchSuffix) ? v.slice(0, -branchSuffix.length) : v);

  return (
    <div className="max-w-[1400px] space-y-4">
      <p className="text-sm text-muted">
        {product.variants.length} variant{product.variants.length === 1 ? "" : "s"}. Click a variant to edit its details, attributes, prices, and images.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {product.variants.map((v) => (
          <button
            key={v.id}
            onClick={() => setOpenId(v.id)}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition hover:border-accent hover:bg-accent-soft/30"
          >
            {v.images[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.images[0].url} alt="" className="size-14 shrink-0 rounded-lg bg-black/[.03] object-contain" />
            ) : (
              <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-black/[.04] text-[10px] text-muted">no image</span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">#{v.id}</span>
                {v.id === master && <span className="rounded bg-black/[.06] px-1 text-[9px] font-medium uppercase text-muted">master</span>}
              </div>
              <p className="truncate font-mono text-xs text-muted">{strip(v.sku) || "no SKU"}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {v.prices.length} price{v.prices.length === 1 ? "" : "s"} · {v.images.length} image{v.images.length === 1 ? "" : "s"}
              </p>
            </div>
          </button>
        ))}
      </div>

      {openVariant && (
        <VariantModal
          key={openVariant.id}
          variant={openVariant}
          isMaster={openVariant.id === master}
          attrDefs={product.attrDefs}
          priceRefs={priceRefs}
          apply={apply}
          uploadImage={uploadImage}
          disabled={disabled}
          busy={busy}
          releaseActive={releaseActive}
          branchSuffix={branchSuffix}
          pricesColumnPref={pricesColumnPref}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** A single variant opened in its own window, with its own tabs. */
function VariantModal({
  variant,
  isMaster,
  attrDefs,
  priceRefs,
  apply,
  uploadImage,
  disabled,
  busy,
  releaseActive,
  branchSuffix,
  pricesColumnPref,
  onClose,
}: {
  variant: EditVariant;
  isMaster: boolean;
  attrDefs: EditProduct["attrDefs"];
  priceRefs: PriceRefs;
  apply: (a: CtAction[]) => Promise<boolean>;
  uploadImage: (variantId: number, file: File) => Promise<boolean>;
  disabled: boolean;
  busy: boolean;
  releaseActive: boolean;
  branchSuffix: string;
  pricesColumnPref?: ColumnPref;
  onClose: () => void;
}) {
  type VTab = "details" | "attributes" | "prices" | "images";
  const [tab, setTab] = useState<VTab>("details");
  const tabs: { id: VTab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "attributes", label: "Attributes" },
    { id: "prices", label: "Prices" },
    { id: "images", label: "Images" },
  ];
  const strip = (v?: string) => (v && branchSuffix && v.endsWith(branchSuffix) ? v.slice(0, -branchSuffix.length) : v);
  const tabCls = (active: boolean) =>
    `px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`;

  async function removeVariant() {
    if (!window.confirm(`Remove variant #${variant.id}? This deletes its SKU, prices, and images.`)) return;
    const ok = await apply([{ action: "removeVariant", id: variant.id, staged: false }]);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-base font-semibold">Variant #{variant.id}</h2>
            {isMaster && <span className="rounded bg-black/[.06] px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">master</span>}
            {strip(variant.sku) && <span className="truncate font-mono text-xs text-muted">{strip(variant.sku)}</span>}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-sm font-medium hover:bg-black/[.04]" aria-label="Close">✕</button>
        </div>
        <div className="flex gap-1 border-b border-border px-5">
          {tabs.map((t) => (
            <button key={t.id} className={tabCls(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="p-5">
          {tab === "details" && (
            <VariantIdentity variant={variant} isMaster={isMaster} apply={apply} onRemove={removeVariant} disabled={disabled} busy={busy} releaseActive={releaseActive} branchSuffix={branchSuffix} />
          )}
          {tab === "attributes" && (
            <AttributesTab attrDefs={attrDefs} variant={variant} variantId={variant.id} apply={apply} disabled={disabled} busy={busy} releaseActive={releaseActive} />
          )}
          {tab === "prices" && <PricesEditor variant={variant} refs={priceRefs} apply={apply} disabled={disabled} busy={busy} releaseActive={releaseActive} columnPref={pricesColumnPref} />}
          {tab === "images" && <ImagesEditor variant={variant} apply={apply} uploadImage={uploadImage} busy={busy} releaseActive={releaseActive} />}
        </div>
      </div>
    </div>
  );
}

function VariantIdentity({
  variant,
  isMaster,
  apply,
  onRemove,
  disabled,
  busy,
  releaseActive,
  branchSuffix = "",
}: {
  variant: EditVariant;
  isMaster: boolean;
  apply: (a: CtAction[]) => Promise<boolean>;
  onRemove: () => void;
  disabled: boolean;
  busy: boolean;
  releaseActive: boolean;
  /** working-copy suffix (e.g. "__b__r-spring-sale-2026"); hidden from the user, re-applied on save */
  branchSuffix?: string;
}) {
  // Show only the canonical SKU/key — never the working-copy suffix (mirrors the read-only product key).
  const strip = (v?: string) => (v && branchSuffix && v.endsWith(branchSuffix) ? v.slice(0, -branchSuffix.length) : v ?? "");
  const encode = (v: string) => (v && branchSuffix ? v + branchSuffix : v);
  const origSku = strip(variant.sku);
  const origKey = strip(variant.key);
  const [sku, setSku] = useState(origSku);
  const [vkey, setVkey] = useState(origKey);
  const dirty = sku !== origSku || vkey !== origKey;

  async function save() {
    const actions: CtAction[] = [];
    if (sku !== origSku) actions.push({ action: "setSku", variantId: variant.id, sku: encode(sku.trim()) || undefined, staged: false });
    if (vkey !== origKey) actions.push({ action: "setProductVariantKey", variantId: variant.id, key: encode(vkey.trim()) || undefined, staged: false });
    await apply(actions);
  }

  const input = "rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:bg-black/[.02] disabled:text-muted";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-black/[.015] p-3">
      <div>
        <span className={label}>SKU</span>
        <input className={`${input} w-44`} value={sku} disabled={disabled} placeholder="—" onChange={(e) => setSku(e.target.value)} />
      </div>
      <div>
        <span className={label}>Variant key</span>
        <input className={`${input} w-44`} value={vkey} disabled={disabled} placeholder="—" onChange={(e) => setVkey(e.target.value)} />
      </div>
      {releaseActive && (
        <>
          <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
          {!isMaster && (
            <button onClick={onRemove} disabled={busy} className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-critical hover:bg-red-50 disabled:opacity-50">
              Remove variant
            </button>
          )}
        </>
      )}
    </div>
  );
}

const toLocalDT = (iso?: string) => (iso ? iso.slice(0, 16) : "");
const toIso = (local: string) => (local.trim() ? new Date(local).toISOString() : undefined);

export function PricesEditor({ variant, refs, apply, disabled, busy, releaseActive, columnPref }: { variant: EditVariant; refs: PriceRefs; apply: (a: CtAction[]) => Promise<boolean>; disabled: boolean; busy: boolean; releaseActive: boolean; columnPref?: ColumnPref }) {
  const original = useMemo<PriceRow[]>(
    () =>
      variant.prices.map((p) => ({
        id: p.id,
        currencyCode: p.currencyCode,
        amount: (p.centAmount / 100).toFixed(2),
        country: p.country ?? "",
        customerGroupId: p.customerGroupId ?? "",
        channelId: p.channelId ?? "",
        validFrom: toLocalDT(p.validFrom),
        validUntil: toLocalDT(p.validUntil),
      })),
    [variant]
  );
  const [rows, setRows] = useState<PriceRow[]>(original);
  const [sort, setSort] = useState<{ key: PriceSortKey; dir: 1 | -1 } | null>(null);
  const [colPref, setColPref] = useColumnPref("price-editor", columnPref ?? EMPTY_PREF);

  const setRow = (i: number, patch: Partial<PriceRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // adding clears the sort so the new blank row lands at the bottom, ready to fill in
  const addRow = () => {
    setSort(null);
    setRows((rs) => [...rs, { currencyCode: CURRENCY, amount: "", country: "", customerGroupId: "", channelId: "", validFrom: "", validUntil: "" }]);
  };
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const dirty = JSON.stringify(rows) !== JSON.stringify(original);

  // Sort is display-only: `order` holds indices into `rows`, so every cell edit still addresses the real row.
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!sort) return idx;
    const { key, dir } = sort;
    const val = (r: PriceRow): number | string =>
      key === "amount" ? Number(r.amount) || 0
      : key === "customerGroupId" ? refs.customerGroups.find((g) => g.id === r.customerGroupId)?.name ?? ""
      : key === "channelId" ? refs.channels.find((c) => c.id === r.channelId)?.name ?? ""
      : r[key];
    return idx.sort((a, b) => {
      const va = val(rows[a]);
      const vb = val(rows[b]);
      return typeof va === "number" && typeof vb === "number" ? (va - vb) * dir : String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort, refs]);
  const toggleSort = (key: PriceSortKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  function priceBody(r: PriceRow) {
    return {
      value: { currencyCode: r.currencyCode, centAmount: Math.round((Number(r.amount) || 0) * 100) },
      ...(r.country ? { country: r.country.toUpperCase() } : {}),
      ...(r.customerGroupId ? { customerGroup: { typeId: "customer-group", id: r.customerGroupId } } : {}),
      ...(r.channelId ? { channel: { typeId: "channel", id: r.channelId } } : {}),
      ...(toIso(r.validFrom) ? { validFrom: toIso(r.validFrom) } : {}),
      ...(toIso(r.validUntil) ? { validUntil: toIso(r.validUntil) } : {}),
    };
  }

  async function save() {
    const actions: CtAction[] = [];
    const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id));
    for (const o of original) if (o.id && !keptIds.has(o.id)) actions.push({ action: "removePrice", priceId: o.id, staged: false });
    for (const r of rows) {
      if (!r.amount) continue;
      if (!r.id) actions.push({ action: "addPrice", variantId: variant.id, price: priceBody(r), staged: false });
      else {
        const o = original.find((x) => x.id === r.id)!;
        if (JSON.stringify(o) !== JSON.stringify(r)) actions.push({ action: "changePrice", priceId: r.id, price: priceBody(r), staged: false });
      }
    }
    await apply(actions);
  }

  const input = "w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm outline-none focus:border-accent disabled:bg-transparent disabled:border-transparent disabled:text-foreground";

  const visibleCols = resolveColumns(PRICE_COLS, colPref);
  const actionsW = 6;
  const totalW = visibleCols.reduce((s, c) => s + c.w, 0) + actionsW;
  const minW = visibleCols.length * 150 + 100;

  const cell = (key: PriceSortKey, r: PriceRow, i: number) => {
    switch (key) {
      case "amount":
        return (
          <input
            className={`${input} text-right tabular-nums`}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={r.amount}
            disabled={disabled}
            onChange={(e) => {
              // allow free entry while typing (incl. a trailing dot / up to 2 decimals)
              if (/^\d*\.?\d{0,2}$/.test(e.target.value)) setRow(i, { amount: e.target.value });
            }}
            onBlur={() => setRow(i, { amount: r.amount === "" ? "" : (Number(r.amount) || 0).toFixed(2) })}
          />
        );
      case "currencyCode":
        return (
          <select className={input} value={r.currencyCode} disabled={disabled} onChange={(e) => setRow(i, { currencyCode: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        );
      case "country":
        return (
          <select className={input} value={r.country} disabled={disabled} onChange={(e) => setRow(i, { country: e.target.value })}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c || "Any"}</option>)}
          </select>
        );
      case "customerGroupId":
        return (
          <select className={input} value={r.customerGroupId} disabled={disabled} onChange={(e) => setRow(i, { customerGroupId: e.target.value })}>
            <option value="">Any</option>
            {refs.customerGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        );
      case "channelId":
        return (
          <select className={input} value={r.channelId} disabled={disabled} onChange={(e) => setRow(i, { channelId: e.target.value })}>
            <option value="">Any</option>
            {refs.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        );
      case "validFrom":
        return <input className={input} type="datetime-local" value={r.validFrom} disabled={disabled} onChange={(e) => setRow(i, { validFrom: e.target.value })} />;
      case "validUntil":
        return <input className={input} type="datetime-local" value={r.validUntil} disabled={disabled} onChange={(e) => setRow(i, { validUntil: e.target.value })} />;
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Prices</h3>
        <ColumnManager columns={PRICE_COLS.map((c) => ({ key: c.key, label: c.label }))} pref={colPref} onChange={setColPref} />
      </div>
      <p className="mb-2.5 text-xs text-muted">Each price applies only when the cart matches its constraints — currency, and optionally country, customer group, channel, and date range. The most specific match wins. Click a column header to sort.</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-black/[.015] px-3 py-8 text-center text-sm text-muted">No prices yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: `${minW}px` }}>
            <colgroup>
              {visibleCols.map((c) => <col key={c.key} style={{ width: `${((c.w / totalW) * 100).toFixed(3)}%` }} />)}
              <col style={{ width: `${((actionsW / totalW) * 100).toFixed(3)}%` }} />
            </colgroup>
            <thead>
              <tr className="bg-black/[.03]">
                {visibleCols.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th key={c.key} className={`border-b border-border px-3 py-2.5 ${c.numeric ? "text-right" : "text-left"}`}>
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition ${active ? "text-accent" : "text-muted hover:text-foreground"} ${c.numeric ? "flex-row-reverse" : ""}`}
                        title={`Sort by ${c.label.toLowerCase()}`}
                      >
                        <span className="whitespace-nowrap">{c.label}</span>
                        <span className="text-[9px] leading-none">{active ? (sort!.dir === 1 ? "▲" : "▼") : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
                <th className="border-b border-border px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {order.map((i) => {
                const r = rows[i];
                return (
                  <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-black/[.015]">
                    {visibleCols.map((c) => (
                      <td key={c.key} className="px-3 py-1.5 align-middle">{cell(c.key, r, i)}</td>
                    ))}
                    <td className="px-3 py-1.5 text-right align-middle">
                      {releaseActive && (
                        <button onClick={() => removeRow(i)} disabled={busy} title="Remove this price" className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-critical hover:bg-red-50 disabled:opacity-50">Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {releaseActive && (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={addRow} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/[.04]">+ Add price</button>
          <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
            {busy ? "Saving…" : "Save prices"}
          </button>
        </div>
      )}
    </div>
  );
}

export function ImagesEditor({ variant, apply, uploadImage, busy, releaseActive }: { variant: EditVariant; apply: (a: CtAction[]) => Promise<boolean>; uploadImage: (variantId: number, file: File) => Promise<boolean>; busy: boolean; releaseActive: boolean }) {
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const imgs = variant.images;

  const remove = (u: string) => apply([{ action: "removeImage", variantId: variant.id, imageUrl: u, staged: false }]);
  const move = (u: string, position: number) => apply([{ action: "moveImageToPosition", variantId: variant.id, imageUrl: u, position, staged: false }]);
  const addUrl = () => {
    const u = url.trim();
    if (!u) return;
    setUrl("");
    apply([{ action: "addExternalImage", variantId: variant.id, image: { url: u, dimensions: { w: 0, h: 0 } }, staged: false }]);
  };

  const input = "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-black/[.02]";

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Images</h3>
      {imgs.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No images.</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-3">
          {imgs.map((im, i) => (
            <div key={im.url} className="w-32 rounded-lg border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt={im.label ?? ""} className="mb-1.5 h-24 w-full rounded object-contain bg-black/[.03]" />
              {releaseActive && (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex gap-1">
                    <button onClick={() => move(im.url, Math.max(0, i - 1))} disabled={busy || i === 0} className="rounded border border-border px-1.5 hover:bg-black/[.04] disabled:opacity-40" title="Move left">←</button>
                    <button onClick={() => move(im.url, Math.min(imgs.length - 1, i + 1))} disabled={busy || i === imgs.length - 1} className="rounded border border-border px-1.5 hover:bg-black/[.04] disabled:opacity-40" title="Move right">→</button>
                  </div>
                  <button onClick={() => remove(im.url)} disabled={busy} className="rounded border border-border px-1.5 text-critical hover:bg-red-50">Remove</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {releaseActive && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} w-72`} placeholder="Image URL…" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
          <button onClick={addUrl} disabled={busy || !url.trim()} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">Add by URL</button>
          <span className="text-xs text-muted">or</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            disabled={busy}
            className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-accent-fg"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await uploadImage(variant.id, f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
