/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { applyResourceActionsAction, checkpointProductAction, createDiscountAction, restoreProductVersionAction, setDiscountDeletionAction } from "@/lib/actions";
import type { CtAction } from "@/lib/product-editor-types";
import type { DiscountEdit, CartDiscountRef } from "@/lib/discounts";
import type { DiscountGroupOption } from "@/lib/discount-groups";
import type { CategoryOption } from "@/lib/categories";
import { slugifyKey } from "@/lib/slug";
import { amount2, amountField2 } from "@/lib/money";
import PredicateBuilder from "./PredicateBuilder";
import PriorityManager from "./PriorityManager";
import type { LayoutData } from "@/lib/discount-layout-types";
import type { DynamicCatalog } from "@/lib/predicate/catalog";
import type { PredContext } from "@/lib/predicate/model";
import { CURRENCY, LOCALE, FACET_ATTRIBUTE, hasFacetAttribute } from "@/lib/config";
import {
  CURRENCIES,
  SELECTION_MODES,
  APPLICATION_MODES,
  CART_PRESETS,
  TARGET_LABELS,
  VALUE_LABELS,
  allowedTargets,
  emptyCartModel,
  emptyCodeDetail,
  emptyProductModel,
  groupEligible,
  serializeCartTarget,
  serializeCartValue,
  serializeProductPredicate,
  serializeProductValue,
  type CartModel,
  type CartValueType,
  type CartTargetType,
  type CodeDetail,
  type MoneyRow,
  type PatternComp,
  type ProductModel,
  type ProductValueType,
} from "@/lib/discount-model";

const input =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02] disabled:text-muted";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

const APP_MODE_LABELS: Record<string, string> = {
  ProportionateDistribution: "Proportionate — split by each item's share",
  EvenDistribution: "Even — split equally across items",
  IndividualApplication: "Individual — apply to each matching item",
};

// predicate-builder context for a given target type
function targetCtx(t: CartTargetType, patternCustom: boolean): PredContext {
  if (t === "customLineItems" || t === "multiBuyCustomLineItems") return "customLineItem";
  if (t === "pattern") return patternCustom ? "customLineItem" : "lineItem";
  return "lineItem";
}

// ---- shared fragments ----
// Declared at module scope, not inside the editor: a component created during
// render is a new type on every pass and loses its state.

function CategorySelect({
  value,
  onChange,
  includeAny,
  categories,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAny?: boolean;
  categories: CategoryOption[];
  disabled?: boolean;
}) {
  return (
    <select className={input} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{includeAny ? "— any category —" : "— choose a category —"}</option>
      {categories.map((o) => <option key={o.key} value={o.key}>{o.path}</option>)}
    </select>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M6 5V3.5h4V5M4.5 5l.5 8h6l.5-8M6.7 7.5v4M9.3 7.5v4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

export default function DiscountEditor({
  canonicalKey,
  discount,
  categories,
  facetValues,
  dynamic,
  cartRefs,
  discountGroups,
  releaseActive,
  releaseTitle,
  forked,
  versions,
  markedForDeletion,
  mode = "edit",
  rankInfo,
  layout,
}: {
  canonicalKey: string;
  discount: DiscountEdit;
  categories: CategoryOption[];
  facetValues: string[];
  dynamic: DynamicCatalog;
  cartRefs: CartDiscountRef[];
  discountGroups: DiscountGroupOption[];
  releaseActive: boolean;
  releaseTitle?: string;
  forked: boolean;
  versions: { version: number; at: string }[];
  markedForDeletion: boolean;
  mode?: "edit" | "create";
  /** current rank/position, shown next to Stacking (edit mode, cart/product only) */
  rankInfo?: { rank: number; total: number; groupName: string };
  /** discount-layout data enabling the "Manage priority" control (edit mode, cart/product only) */
  layout?: LayoutData;
}) {
  const isCreate = mode === "create";
  const router = useRouter();
  const kind = discount.kind;
  const isCode = kind === "discount-code";
  const isCart = kind === "cart-discount";
  const isProduct = kind === "product-discount";

  const [name, setName] = useState(discount.name);
  const [description, setDescription] = useState(discount.description);
  const [isActive, setActive] = useState(discount.isActive);
  const [c, setC] = useState<CartModel>(discount.cart ?? emptyCartModel());
  const [p, setP] = useState<ProductModel>(discount.product ?? emptyProductModel());
  const [code, setCode] = useState<CodeDetail>(discount.codeDetail ?? emptyCodeDetail());
  // cart settings
  const [stackingMode, setStackingMode] = useState(discount.stackingMode);
  const [requiresCode, setRequiresCode] = useState(discount.requiresDiscountCode);
  const [validFrom, setValidFrom] = useState(discount.validFrom.slice(0, 16));
  const [validUntil, setValidUntil] = useState(discount.validUntil.slice(0, 16));
  const [keyVal, setKeyVal] = useState(discount.key ?? "");
  const [keyEdited, setKeyEdited] = useState(false); // stop auto-deriving the key once the user edits it
  const [codeVal, setCodeVal] = useState(discount.code ?? "");
  const [codeSearch, setCodeSearch] = useState(""); // filter for the "link a cart discount" picker
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setName(discount.name);
    setDescription(discount.description);
    setActive(discount.isActive);
    setC(discount.cart ?? emptyCartModel());
    setP(discount.product ?? emptyProductModel());
    setCode(discount.codeDetail ?? emptyCodeDetail());
    setStackingMode(discount.stackingMode);
    setRequiresCode(discount.requiresDiscountCode);
    setValidFrom(discount.validFrom.slice(0, 16));
    setValidUntil(discount.validUntil.slice(0, 16));
    setKeyVal(discount.key ?? "");
    setCodeVal(discount.code ?? "");
  }, [discount]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const uc = (patch: Partial<CartModel>) => setC((s) => ({ ...s, ...patch }));
  const up = (patch: Partial<ProductModel>) => setP((s) => ({ ...s, ...patch }));
  const uCode = (patch: Partial<CodeDetail>) => setCode((s) => ({ ...s, ...patch }));
  const prodToAdvanced = () => up({ advanced: true, rawPredicate: serializeProductPredicate(p) });

  // on create, typing the name auto-fills the key (until the user edits the key directly)
  const onName = (v: string) => {
    setName(v);
    if (isCreate && !keyEdited) setKeyVal(slugifyKey(v));
  };
  const onKeyInput = (v: string) => {
    setKeyVal(v);
    setKeyEdited(true);
  };

  // change value type, snapping the target to a compatible one
  function setValueType(v: CartValueType) {
    const targets = allowedTargets(v);
    const nextTarget = v === "giftLineItem" ? c.targetType : targets.includes(c.targetType) ? c.targetType : targets[0];
    const patch: Partial<CartModel> = { valueType: v, targetType: nextTarget };
    if (v === "relative" && c.percent === "") patch.percent = "10";
    uc(patch);
  }

  const catName = useMemo(() => {
    const m = new Map(categories.map((o) => [o.key, o.name]));
    return (k: string) => m.get(k) || k || "…";
  }, [categories]);

  const disabled = !releaseActive || busy;
  const validLocalFrom = discount.validFrom.slice(0, 16);
  const validLocalUntil = discount.validUntil.slice(0, 16);
  const validChanged = validFrom !== validLocalFrom || validUntil !== validLocalUntil;
  const keyChanged = keyVal.trim() !== "" && keyVal !== (discount.key ?? "");
  const hasSettings = isCart || isProduct || isCode;
  const settingsDirty =
    (isCart && (stackingMode !== discount.stackingMode || requiresCode !== discount.requiresDiscountCode)) ||
    (hasSettings && (validChanged || keyChanged));
  const dirty =
    name !== discount.name ||
    description !== discount.description ||
    isActive !== discount.isActive ||
    settingsDirty ||
    (isCart && JSON.stringify(c) !== JSON.stringify(discount.cart)) ||
    (isProduct && JSON.stringify(p) !== JSON.stringify(discount.product)) ||
    (isCode && JSON.stringify(code) !== JSON.stringify(discount.codeDetail));

  const productPreview = useMemo(() => {
    if (!isProduct) return "";
    const v = p.valueType === "relative" ? `${p.percent || 0}%` : p.valueType === "external" ? "an external price" : `${amount2(p.amount)} ${p.currency}`;
    let scope: string;
    if (p.categoryKey && p.facet.trim()) scope = `${catName(p.categoryKey)} from ${p.facet.trim()}`;
    else if (p.categoryKey) scope = `${catName(p.categoryKey)}${p.includeSub ? " (incl. subcategories)" : ""}`;
    else if (p.facet.trim()) scope = `all ${p.facet.trim()} products`;
    else scope = "all products";
    return p.valueType === "external" ? `External price applied to ${scope}.` : `${v} off ${scope}.`;
  }, [isProduct, p, catName]);

  const isoOrUndef = (local: string) => (local.trim() ? new Date(local).toISOString() : undefined);
  const freshSort = () => "0." + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e4)).padStart(4, "0");

  async function save() {
    const a: CtAction[] = [];
    const L = (v: string) => ({ [LOCALE]: v });
    if (name !== discount.name) a.push(isCode ? { action: "setName", name: L(name) } : { action: "changeName", name: L(name) });
    if (description !== discount.description) a.push({ action: "setDescription", description: L(description) });
    if (isActive !== discount.isActive) a.push({ action: "changeIsActive", isActive });

    if (isCart && discount.cart) {
      if (JSON.stringify(serializeCartValue(discount.cart)) !== JSON.stringify(serializeCartValue(c)))
        a.push({ action: "changeValue", value: serializeCartValue(c) });
      const nextTarget = serializeCartTarget(c);
      // gift line items have no target; skip changeTarget in that case
      if (nextTarget && JSON.stringify(serializeCartTarget(discount.cart)) !== JSON.stringify(nextTarget))
        a.push({ action: "changeTarget", target: nextTarget });
      if ((c.cartPredicate || "1 = 1") !== (discount.cart.cartPredicate || "1 = 1"))
        a.push({ action: "changeCartPredicate", cartPredicate: c.cartPredicate || "1 = 1" });
      // cart-only settings
      if (stackingMode !== discount.stackingMode) a.push({ action: "changeStackingMode", stackingMode });
      if (requiresCode !== discount.requiresDiscountCode) a.push({ action: "changeRequiresDiscountCode", requiresDiscountCode: requiresCode });
      // native discount group assignment
      const wantGroup = groupEligible(c) ? c.discountGroupKey : "";
      if ((wantGroup || "") !== (discount.cart.discountGroupKey || "")) {
        if (wantGroup) a.push({ action: "setDiscountGroup", discountGroup: { typeId: "discount-group", key: wantGroup } });
        else { a.push({ action: "setDiscountGroup" }); a.push({ action: "changeSortOrder", sortOrder: freshSort() }); }
      }
    }
    if (isProduct && discount.product) {
      if (JSON.stringify(serializeProductValue(discount.product)) !== JSON.stringify(serializeProductValue(p)))
        a.push({ action: "changeValue", value: serializeProductValue(p) });
      if (p.advanced) {
        if (p.rawPredicate !== discount.product.rawPredicate) a.push({ action: "changePredicate", predicate: p.rawPredicate });
      } else if (serializeProductPredicate(discount.product) !== serializeProductPredicate(p)) {
        a.push({ action: "changePredicate", predicate: serializeProductPredicate(p) });
      }
    }
    if (isCode && discount.codeDetail) {
      const cd = discount.codeDetail;
      if (JSON.stringify(code.cartDiscountKeys) !== JSON.stringify(cd.cartDiscountKeys))
        a.push({ action: "changeCartDiscounts", cartDiscounts: code.cartDiscountKeys.map((k) => ({ typeId: "cart-discount", key: k })) });
      if ((code.cartPredicate || "") !== (cd.cartPredicate || "")) {
        const pred = code.cartPredicate.trim();
        a.push({ action: "setCartPredicate", ...(pred && pred !== "1 = 1" ? { cartPredicate: pred } : {}) });
      }
      if (JSON.stringify(code.groups) !== JSON.stringify(cd.groups)) a.push({ action: "changeGroups", groups: code.groups });
      if (code.maxApplications !== cd.maxApplications)
        a.push({ action: "setMaxApplications", ...(code.maxApplications.trim() ? { maxApplications: parseInt(code.maxApplications, 10) } : {}) });
      if (code.maxApplicationsPerCustomer !== cd.maxApplicationsPerCustomer)
        a.push({ action: "setMaxApplicationsPerCustomer", ...(code.maxApplicationsPerCustomer.trim() ? { maxApplicationsPerCustomer: parseInt(code.maxApplicationsPerCustomer, 10) } : {}) });
    }
    // shared settings (cart + product + code)
    if (hasSettings) {
      if (validChanged) a.push({ action: "setValidFromAndUntil", validFrom: isoOrUndef(validFrom), validUntil: isoOrUndef(validUntil) });
      if (keyChanged) a.push({ action: "setKey", key: keyVal.trim() });
    }

    setBusy(true);
    const res = await applyResourceActionsAction(kind, canonicalKey, a);
    setBusy(false);
    if (res.ok) { setToast({ ok: true, text: `Saved to “${releaseTitle}”` }); router.refresh(); }
    else setToast({ ok: false, text: res.error });
  }

  async function create() {
    if (!keyVal.trim()) { setToast({ ok: false, text: "Enter a key." }); return; }
    if (isCode && !codeVal.trim()) { setToast({ ok: false, text: "Enter a code." }); return; }
    const L = (v: string) => ({ [LOCALE]: v });
    const draft: Record<string, unknown> = { key: keyVal.trim(), name: L(name || keyVal.trim()), isActive };
    if (description.trim()) draft.description = L(description);
    if (validFrom.trim()) draft.validFrom = isoOrUndef(validFrom);
    if (validUntil.trim()) draft.validUntil = isoOrUndef(validUntil);
    if (isCart) {
      draft.value = serializeCartValue(c);
      const tgt = serializeCartTarget(c);
      if (tgt) draft.target = tgt;
      draft.cartPredicate = c.cartPredicate || "1 = 1";
      draft.stackingMode = stackingMode;
      draft.requiresDiscountCode = requiresCode;
    } else if (isProduct) {
      draft.value = serializeProductValue(p);
      draft.predicate = p.advanced ? p.rawPredicate || "1 = 1" : serializeProductPredicate(p);
    } else {
      draft.code = codeVal.trim();
      draft.cartDiscounts = code.cartDiscountKeys.map((k) => ({ typeId: "cart-discount", key: k }));
      const pred = code.cartPredicate.trim();
      if (pred && pred !== "1 = 1") draft.cartPredicate = pred;
      if (code.groups.length) draft.groups = code.groups;
      if (code.maxApplications.trim()) draft.maxApplications = parseInt(code.maxApplications, 10);
      if (code.maxApplicationsPerCustomer.trim()) draft.maxApplicationsPerCustomer = parseInt(code.maxApplicationsPerCustomer, 10);
    }
    setBusy(true);
    const res = await createDiscountAction(kind as "cart-discount" | "product-discount" | "discount-code", draft);
    setBusy(false);
    if (res.ok) { setToast({ ok: true, text: "Discount created" }); router.push(`/discounts/${kind}/${encodeURIComponent(res.data!.key)}`); }
    else setToast({ ok: false, text: res.error });
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
  async function setDeletion(remove: boolean) {
    if (remove && !window.confirm(`Delete “${discount.name || discount.code || canonicalKey}”? It stays until you ship “${releaseTitle}”, then it's removed from production. You can undo before shipping.`)) return;
    setBusy(true);
    const res = await setDiscountDeletionAction(kind as "cart-discount" | "product-discount" | "discount-code", canonicalKey, remove);
    setBusy(false);
    if (res.ok) { setToast({ ok: true, text: remove ? "Marked for removal" : "Kept — no longer being removed" }); router.refresh(); }
    else setToast({ ok: false, text: res.error });
  }

  // ---- cart money rows (absolute / fixed) ----
  const setMoneyRow = (i: number, patch: Partial<MoneyRow>) => uc({ money: c.money.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const addMoneyRow = () => {
    const used = new Set(c.money.map((r) => r.currencyCode));
    const next = CURRENCIES.find((x) => !used.has(x)) ?? CURRENCY;
    uc({ money: [...c.money, { currencyCode: next, amount: "0.00" }] });
  };
  const rmMoneyRow = (i: number) => uc({ money: c.money.filter((_, idx) => idx !== i) });

  // ---- pattern components ----
  const patchPattern = (which: "triggerPattern" | "targetPattern", i: number, patch: Partial<PatternComp>) =>
    uc({ [which]: c[which].map((x, idx) => (idx === i ? { ...x, ...patch } : x)) } as Partial<CartModel>);
  const addPattern = (which: "triggerPattern" | "targetPattern") =>
    uc({ [which]: [...c[which], { predicate: "1 = 1", minCount: "1", maxCount: "" }] } as Partial<CartModel>);
  const rmPattern = (which: "triggerPattern" | "targetPattern", i: number) =>
    uc({ [which]: c[which].filter((_, idx) => idx !== i) } as Partial<CartModel>);

  if (markedForDeletion) {
    return (
      <>
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-red-100 text-critical"><TrashIcon className="size-4" /></span>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-critical">Marked for removal</h2>
              <p className="mt-1 text-sm text-red-800">This discount will be deleted from production when <strong>{releaseTitle}</strong> ships. Nothing changes until then — you can keep it.</p>
              <button onClick={() => setDeletion(false)} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-critical hover:bg-red-100 disabled:opacity-50">{busy ? "Working…" : "Keep it — don't remove"}</button>
            </div>
          </div>
        </div>
        {toast && <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"}`}>{toast.text}</div>}
      </>
    );
  }

  const targets = allowedTargets(c.valueType);
  const isMoney = c.valueType === "absolute" || c.valueType === "fixed";
  const isMulti = c.targetType === "multiBuyLineItems" || c.targetType === "multiBuyCustomLineItems";

  return (
    <>
      {!releaseActive && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Pick a release in the top bar to {isCreate ? "create" : "edit"} this discount.</div>}

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold capitalize">{kind.replace(/-/g, " ")}</h2>
          {releaseActive && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{isCreate ? "new — saved to this release" : forked ? "editing working copy" : "edits save to this release"}</span>}
        </div>

        <div className="grid max-w-2xl gap-5">
          {/* --- basics --- */}
          {isCreate ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><span className={label}>Name</span><input className={input} value={name} disabled={disabled} autoFocus onChange={(e) => onName(e.target.value)} /></div>
              <div><span className={label}>Key <span className="font-normal normal-case text-muted">· auto from name</span></span><input className={`${input} font-mono`} value={keyVal} disabled={disabled} placeholder="unique-key" onChange={(e) => onKeyInput(e.target.value)} /></div>
              {isCode && <div><span className={label}>Code <span className="text-critical">*</span></span><input className={`${input} font-mono`} value={codeVal} disabled={disabled} placeholder="COUPONCODE" onChange={(e) => setCodeVal(e.target.value)} /></div>}
            </div>
          ) : isCode ? (
            <div className="grid grid-cols-2 gap-4">
              <div><span className={label}>Name</span><input className={input} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} /></div>
              <div><span className={label}>Code</span><input className={`${input} font-mono`} value={discount.code ?? ""} disabled readOnly /></div>
            </div>
          ) : (
            <div><span className={label}>Name</span><input className={input} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <div><span className={label}>Description</span><textarea className={`${input} h-16 resize-y`} value={description} disabled={disabled} onChange={(e) => setDescription(e.target.value)} /></div>

          {/* ============================ CART DISCOUNT ============================ */}
          {isCart && (
            <>
              {/* presets */}
              <div>
                <span className={label}>Quick start</span>
                <div className="flex flex-wrap gap-2">
                  {CART_PRESETS.map((preset) => (
                    <button key={preset.id} type="button" disabled={disabled} onClick={() => uc(preset.apply())} title={preset.hint}
                      className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:border-accent hover:bg-accent-soft disabled:opacity-50">
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* value */}
              <div className="rounded-lg border border-border p-4">
                <span className={label}>What does this discount give?</span>
                <select className={`${input} max-w-xs`} value={c.valueType} disabled={disabled} onChange={(e) => setValueType(e.target.value as CartValueType)}>
                  {(Object.keys(VALUE_LABELS) as CartValueType[]).map((v) => <option key={v} value={v}>{VALUE_LABELS[v]}</option>)}
                </select>

                {c.valueType === "relative" && (
                  <div className="mt-3 flex items-center gap-1 text-sm">
                    <input className={`${input} w-24`} type="number" step="1" min="0" value={c.percent} disabled={disabled} onChange={(e) => uc({ percent: e.target.value })} /> %
                    {(c.targetType === "shipping" || isMulti) && <span className="ml-1 text-xs text-muted">100% = free</span>}
                  </div>
                )}

                {isMoney && (
                  <div className="mt-3 grid gap-2">
                    <span className="text-xs text-muted">{c.valueType === "fixed" ? "Fixed price per item (one amount per currency)" : "Amount off (one amount per currency)"}</span>
                    {c.money.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input className={`${input} w-28`} type="number" step="0.01" min="0" value={row.amount} disabled={disabled} onChange={(e) => setMoneyRow(i, { amount: e.target.value })} onBlur={(e) => setMoneyRow(i, { amount: amountField2(e.target.value) })} />
                        <select className={`${input} w-24`} value={row.currencyCode} disabled={disabled} onChange={(e) => setMoneyRow(i, { currencyCode: e.target.value })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select>
                        {c.money.length > 1 && <button type="button" onClick={() => rmMoneyRow(i)} disabled={disabled} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-critical disabled:opacity-50">✕</button>}
                      </div>
                    ))}
                    {c.money.length < CURRENCIES.length && <button type="button" onClick={addMoneyRow} disabled={disabled} className="justify-self-start rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">+ Add currency</button>}
                    <div>
                      <span className="mb-1 mt-1 block text-xs text-muted">How is it distributed across items?</span>
                      <select className={`${input} max-w-md`} value={c.applicationMode} disabled={disabled} onChange={(e) => uc({ applicationMode: e.target.value as CartModel["applicationMode"] })}>
                        {APPLICATION_MODES.map((m) => <option key={m} value={m}>{APP_MODE_LABELS[m]}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {c.valueType === "giftLineItem" && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div><span className="mb-1 block text-xs text-muted">Gift product (key)</span><input className={`${input} font-mono`} value={c.giftProduct} disabled={disabled} placeholder="product-key" onChange={(e) => uc({ giftProduct: e.target.value })} /></div>
                    <div><span className="mb-1 block text-xs text-muted">Variant ID</span><input className={input} type="number" min="1" value={c.giftVariantId} disabled={disabled} onChange={(e) => uc({ giftVariantId: e.target.value })} /></div>
                    <div><span className="mb-1 block text-xs text-muted">Supply channel (key, optional)</span><input className={`${input} font-mono`} value={c.giftSupplyChannel} disabled={disabled} onChange={(e) => uc({ giftSupplyChannel: e.target.value })} /></div>
                    <div><span className="mb-1 block text-xs text-muted">Distribution channel (key, optional)</span><input className={`${input} font-mono`} value={c.giftDistributionChannel} disabled={disabled} onChange={(e) => uc({ giftDistributionChannel: e.target.value })} /></div>
                    <p className="sm:col-span-2 text-xs text-muted">The gift is added free when the cart condition below matches. Gift discounts have no separate target and can&apos;t be used in discount groups.</p>
                  </div>
                )}
                {c.advancedValue && (
                  <div className="mt-3">
                    <span className="mb-1 block text-xs text-amber-700">This value type isn&apos;t modeled — edit the raw JSON.</span>
                    <textarea className={`${input} h-24 resize-y font-mono text-xs`} value={c.rawValue} disabled={disabled} spellCheck={false} onChange={(e) => uc({ rawValue: e.target.value })} />
                  </div>
                )}
              </div>

              {/* target (none for gift) */}
              {c.valueType !== "giftLineItem" && (
                <div className="rounded-lg border border-border p-4">
                  <span className={label}>What does it apply to?</span>
                  <select className={`${input} max-w-md`} value={c.targetType} disabled={disabled} onChange={(e) => uc({ targetType: e.target.value as CartTargetType })}>
                    {targets.map((t) => <option key={t} value={t}>{TARGET_LABELS[t]}</option>)}
                  </select>

                  {(c.targetType === "lineItems" || c.targetType === "customLineItems" || isMulti) && (
                    <div className="mt-3">
                      <span className="mb-1 block text-xs text-muted">Which items?</span>
                      <PredicateBuilder context={targetCtx(c.targetType, c.patternCustom)} dynamic={dynamic} value={c.targetPredicate} onChange={(v) => uc({ targetPredicate: v })} categories={categories} facetValues={facetValues} disabled={disabled} emptyLabel="all items" />
                    </div>
                  )}

                  {isMulti && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <label className="text-sm"><span className={label}>Buy (trigger qty)</span><input className={`${input} w-24`} type="number" min="1" value={c.triggerQuantity} disabled={disabled} onChange={(e) => uc({ triggerQuantity: e.target.value })} /></label>
                      <label className="text-sm"><span className={label}>Get (discounted qty)</span><input className={`${input} w-24`} type="number" min="1" value={c.discountedQuantity} disabled={disabled} onChange={(e) => uc({ discountedQuantity: e.target.value })} /></label>
                      <label className="text-sm"><span className={label}>Max times (optional)</span><input className={`${input} w-24`} type="number" min="1" value={c.maxOccurrence} disabled={disabled} placeholder="∞" onChange={(e) => uc({ maxOccurrence: e.target.value })} /></label>
                      <label className="text-sm"><span className={label}>Discount the</span>
                        <select className={`${input} w-40`} value={c.selectionMode} disabled={disabled} onChange={(e) => uc({ selectionMode: e.target.value as CartModel["selectionMode"] })}>
                          {SELECTION_MODES.map((m) => <option key={m} value={m}>{m === "Cheapest" ? "cheapest items" : "most expensive items"}</option>)}
                        </select>
                      </label>
                    </div>
                  )}

                  {c.targetType === "pattern" && (
                    <div className="mt-3 grid gap-3">
                      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={c.patternCustom} disabled={disabled} onChange={(e) => uc({ patternCustom: e.target.checked })} className="size-4 accent-[var(--accent)]" /> Match custom line items instead of line items</label>
                      {(["triggerPattern", "targetPattern"] as const).map((which) => (
                        <div key={which} className="rounded-lg border border-border bg-black/[.015] p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold">{which === "triggerPattern" ? "Trigger units (what must be in the cart)" : "Target units (what gets discounted)"}</span>
                            <button type="button" onClick={() => addPattern(which)} disabled={disabled} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">+ Add</button>
                          </div>
                          {c[which].length === 0 && <p className="text-xs text-muted">{which === "triggerPattern" ? "No trigger — the discount applies whenever the target units are present." : "Add at least one target unit."}</p>}
                          <div className="grid gap-2">
                            {c[which].map((comp, i) => (
                              <div key={i} className="rounded-lg border border-border bg-white p-2">
                                <PredicateBuilder context={c.patternCustom ? "customLineItem" : "lineItem"} dynamic={dynamic} value={comp.predicate} onChange={(v) => patchPattern(which, i, { predicate: v })} categories={categories} facetValues={facetValues} disabled={disabled} emptyLabel="any unit" />
                                <div className="mt-2 flex items-end gap-2">
                                  <label className="text-xs text-muted">min<input className={`${input} w-20`} type="number" min="1" value={comp.minCount} disabled={disabled} onChange={(e) => patchPattern(which, i, { minCount: e.target.value })} /></label>
                                  <label className="text-xs text-muted">max<input className={`${input} w-20`} type="number" min="1" value={comp.maxCount} disabled={disabled} placeholder="∞" onChange={(e) => patchPattern(which, i, { maxCount: e.target.value })} /></label>
                                  <button type="button" onClick={() => rmPattern(which, i)} disabled={disabled} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-critical disabled:opacity-50">Remove</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-sm"><span className={label}>Max times (optional)</span><input className={`${input} w-24`} type="number" min="1" value={c.maxOccurrence} disabled={disabled} placeholder="∞" onChange={(e) => uc({ maxOccurrence: e.target.value })} /></label>
                        <label className="text-sm"><span className={label}>Discount the</span>
                          <select className={`${input} w-40`} value={c.selectionMode} disabled={disabled} onChange={(e) => uc({ selectionMode: e.target.value as CartModel["selectionMode"] })}>
                            {SELECTION_MODES.map((m) => <option key={m} value={m}>{m === "Cheapest" ? "cheapest units" : "most expensive units"}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                  )}

                  {(c.targetType === "totalPrice" || c.targetType === "shipping") && (
                    <p className="mt-2 text-xs text-muted">{c.targetType === "totalPrice" ? "Applies to the whole cart total." : "Applies to the shipping cost."}</p>
                  )}
                </div>
              )}

              {/* cart condition */}
              <div className="rounded-lg border border-border p-4">
                <span className={label}>When does it apply? (cart condition)</span>
                <PredicateBuilder context="cart" dynamic={dynamic} value={c.cartPredicate} onChange={(v) => uc({ cartPredicate: v })} categories={categories} facetValues={facetValues} disabled={disabled} />
              </div>
            </>
          )}

          {/* ============================ PRODUCT DISCOUNT ============================ */}
          {isProduct && !p.advanced && (
            <>
              <div className="rounded-lg border border-border p-4">
                <span className={label}>Which products get this discount?</span>
                <div className="grid gap-2">
                  <div><span className="mb-1 block text-xs text-muted">Category</span><CategorySelect value={p.categoryKey} onChange={(v) => up({ categoryKey: v })} includeAny categories={categories} disabled={disabled} /></div>
                  {p.categoryKey && <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={p.includeSub} disabled={disabled} onChange={(e) => up({ includeSub: e.target.checked })} className="size-4 accent-[var(--accent)]" /> Include subcategories</label>}
                  {hasFacetAttribute && (
                    <div>
                      <span className="mb-1 block text-xs text-muted">{FACET_ATTRIBUTE.label}</span>
                      <input className={input} list="rm-facet-values" placeholder={`— any ${FACET_ATTRIBUTE.label.toLowerCase()} —`} value={p.facet} disabled={disabled} onChange={(e) => up({ facet: e.target.value })} />
                      <datalist id="rm-facet-values">{facetValues.map((v) => <option key={v} value={v} />)}</datalist>
                    </div>
                  )}
                </div>
                {!p.categoryKey && !p.facet.trim() && (
                  <p className="mt-2 text-xs text-amber-700">
                    Applies to every product — pick a category{hasFacetAttribute ? ` or ${FACET_ATTRIBUTE.label.toLowerCase()}` : ""} to narrow it.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-border p-4">
                <span className={label}>Discount</span>
                <div className="flex flex-wrap items-end gap-2">
                  <select className={`${input} w-52`} value={p.valueType} disabled={disabled} onChange={(e) => up({ valueType: e.target.value as ProductValueType })}>
                    <option value="relative">Percentage off</option>
                    <option value="absolute">Fixed amount off</option>
                    <option value="external">External (price set via API)</option>
                  </select>
                  {p.valueType === "relative" && (
                    <label className="flex items-center gap-1 text-sm"><input className={`${input} w-24`} type="number" step="1" min="0" max="100" value={p.percent} disabled={disabled} onChange={(e) => up({ percent: e.target.value })} /> %</label>
                  )}
                  {p.valueType === "absolute" && (
                    <>
                      <input className={`${input} w-28`} type="number" step="0.01" min="0" value={p.amount} disabled={disabled} onChange={(e) => up({ amount: e.target.value })} onBlur={(e) => up({ amount: amountField2(e.target.value) })} />
                      <select className={`${input} w-24`} value={p.currency} disabled={disabled} onChange={(e) => up({ currency: e.target.value })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select>
                    </>
                  )}
                  {p.valueType === "external" && <span className="pb-2 text-xs text-muted">Discounted price is provided per line item via the API.</span>}
                </div>
              </div>
              <button type="button" onClick={prodToAdvanced} disabled={disabled} className="justify-self-start text-xs font-medium text-accent hover:underline disabled:opacity-50">Need a more specific rule? Use the advanced builder →</button>
              <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-4 py-3 text-sm">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-accent">Preview</span>{productPreview}
              </div>
            </>
          )}
          {isProduct && p.advanced && (
            <div className="grid gap-4 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <span className={`${label} mb-0`}>Advanced rule</span>
                <button type="button" onClick={() => up({ advanced: false })} disabled={disabled} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">← Back to simple options</button>
              </div>
              <div>
                <span className={label}>Discount</span>
                <div className="flex flex-wrap items-end gap-2">
                  <select className={`${input} w-52`} value={p.valueType} disabled={disabled} onChange={(e) => up({ valueType: e.target.value as ProductValueType })}>
                    <option value="relative">Percentage off</option>
                    <option value="absolute">Fixed amount off</option>
                    <option value="external">External (price set via API)</option>
                  </select>
                  {p.valueType === "relative" && (
                    <label className="flex items-center gap-1 text-sm"><input className={`${input} w-24`} type="number" step="1" min="0" max="100" value={p.percent} disabled={disabled} onChange={(e) => up({ percent: e.target.value })} /> %</label>
                  )}
                  {p.valueType === "absolute" && (
                    <>
                      <input className={`${input} w-28`} type="number" step="0.01" min="0" value={p.amount} disabled={disabled} onChange={(e) => up({ amount: e.target.value })} onBlur={(e) => up({ amount: amountField2(e.target.value) })} />
                      <select className={`${input} w-24`} value={p.currency} disabled={disabled} onChange={(e) => up({ currency: e.target.value })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select>
                    </>
                  )}
                  {p.valueType === "external" && <span className="pb-2 text-xs text-muted">Discounted price is provided per line item via the API.</span>}
                </div>
              </div>
              <div>
                <span className={label}>Which products get this discount?</span>
                <PredicateBuilder context="product" dynamic={dynamic} value={p.rawPredicate} onChange={(v) => up({ rawPredicate: v })} categories={categories} facetValues={facetValues} disabled={disabled} emptyLabel="all products" />
              </div>
            </div>
          )}

          {/* --- stacking & ranking (how this competes with other discounts) --- */}
          {(isCart || isProduct) && (
            <div className="rounded-lg border border-border p-4 grid gap-3">
              <span className={label}>Stacking &amp; ranking</span>
              <div className="grid gap-3 sm:grid-cols-2">
                {isCart && (
                  <div>
                    <span className="mb-1 block text-xs text-muted">Stacking</span>
                    <select className={input} value={stackingMode} disabled={disabled} onChange={(e) => setStackingMode(e.target.value)}>
                      <option value="Stacking">Stacks with other discounts</option>
                      <option value="StopAfterThisDiscount">Stop after this discount</option>
                    </select>
                  </div>
                )}
                <div>
                  <span className="mb-1 block text-xs text-muted">Ranking (priority)</span>
                  {layout ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{rankInfo?.rank || "—"}</span>
                      <span className="text-xs text-muted">{rankInfo?.rank ? `#${rankInfo.rank} of ${rankInfo.total} · “${rankInfo.groupName}”` : "not ordered yet"}</span>
                      <PriorityManager data={layout} highlightKey={canonicalKey} triggerLabel="Manage" />
                    </div>
                  ) : (
                    <p className="pt-1.5 text-xs text-muted">You can set the priority order once this discount is created.</p>
                  )}
                </div>
                {isCart && groupEligible(c) && (
                  <div className="sm:col-span-2">
                    <span className="mb-1 block text-xs text-muted">Discount group</span>
                    <select className={input} value={c.discountGroupKey} disabled={disabled} onChange={(e) => uc({ discountGroupKey: e.target.value })}>
                      <option value="">— none (uses its own priority) —</option>
                      {discountGroups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {isCart && <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={requiresCode} disabled={disabled} onChange={(e) => setRequiresCode(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Requires a discount code</label>}
            </div>
          )}

          {/* --- validity & key --- */}
          {hasSettings && (
            <div className="rounded-lg border border-border p-4 grid gap-3">
              <span className={label}>Validity</span>
              <div className="grid gap-3 sm:grid-cols-2">
                {!isCreate && (
                  <div>
                    <span className="mb-1 block text-xs text-muted">Key</span>
                    <input className={`${input} font-mono`} value={keyVal} disabled={disabled} placeholder="optional-key" onChange={(e) => onKeyInput(e.target.value)} />
                  </div>
                )}
                <div><span className="mb-1 block text-xs text-muted">Valid from</span><input className={input} type="datetime-local" value={validFrom} disabled={disabled} onChange={(e) => setValidFrom(e.target.value)} /></div>
                <div><span className="mb-1 block text-xs text-muted">Valid until</span><input className={input} type="datetime-local" value={validUntil} disabled={disabled} onChange={(e) => setValidUntil(e.target.value)} /></div>
              </div>
            </div>
          )}

          {/* ============================ DISCOUNT CODE ============================ */}
          {isCode && (
            <>
              <div className="rounded-lg border border-border p-4">
                <span className={label}>Cart discounts this code activates</span>
                <p className="mb-3 text-xs text-muted">Entering this code applies the discount(s) below — most codes link just one.</p>
                {(() => {
                  const byKey = new Map(cartRefs.map((r) => [r.key, r]));
                  const selected = code.cartDiscountKeys;
                  const term = codeSearch.trim().toLowerCase();
                  const available = cartRefs.filter(
                    (r) => r.requiresDiscountCode && !selected.includes(r.key) && (!term || r.name.toLowerCase().includes(term) || r.key.toLowerCase().includes(term))
                  );
                  return (
                    <>
                      {/* linked (selected) — shown at the top */}
                      {selected.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted">No cart discount linked yet — search below to add one.</p>
                      ) : (
                        <div className="grid gap-1.5">
                          {selected.map((k) => {
                            const r = byKey.get(k);
                            return (
                              <div key={k} className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/50 px-3 py-2 text-sm">
                                <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                <span className="min-w-0 flex-1 truncate">{r?.name ?? k} <span className="font-mono text-xs text-muted">{k}</span></span>
                                {r && !r.requiresDiscountCode && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">needs “requires code”</span>}
                                {releaseActive && (
                                  <button type="button" onClick={() => uCode({ cartDiscountKeys: selected.filter((x) => x !== k) })} disabled={disabled} className="shrink-0 rounded-md border border-border bg-white px-2 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">
                                    Remove
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* add via search */}
                      {releaseActive && (
                        <div className="mt-3">
                          <input
                            className={input}
                            placeholder={selected.length ? "Link another cart discount…" : "Search cart discounts to link…"}
                            value={codeSearch}
                            disabled={disabled}
                            onChange={(e) => setCodeSearch(e.target.value)}
                          />
                          {codeSearch.trim() && (
                            <div className="mt-1 max-h-56 divide-y divide-border overflow-auto rounded-lg border border-border">
                              {available.length === 0 ? (
                                <p className="p-2.5 text-xs text-muted">No matches. Only cart discounts set to “requires a discount code” can be linked.</p>
                              ) : (
                                available.slice(0, 20).map((r) => (
                                  <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => { uCode({ cartDiscountKeys: [...selected, r.key] }); setCodeSearch(""); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent-soft/50"
                                  >
                                    <span className="min-w-0 flex-1 truncate">{r.name} <span className="font-mono text-xs text-muted">{r.key}</span></span>
                                    <span className="shrink-0 text-xs font-semibold text-accent">+ Add</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="rounded-lg border border-border p-4 grid gap-3">
                <span className={label}>Usage limits</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><span className="mb-1 block text-xs text-muted">Max total uses</span><input className={input} type="number" min="1" value={code.maxApplications} disabled={disabled} placeholder="∞ unlimited" onChange={(e) => uCode({ maxApplications: e.target.value })} /></div>
                  <div><span className="mb-1 block text-xs text-muted">Max uses per customer</span><input className={input} type="number" min="1" value={code.maxApplicationsPerCustomer} disabled={disabled} placeholder="∞ unlimited" onChange={(e) => uCode({ maxApplicationsPerCustomer: e.target.value })} /></div>
                </div>
                <div>
                  <span className="mb-1 block text-xs text-muted">Groups (for shared usage budgets)</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {code.groups.map((g) => (
                      <span key={g} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{g}
                        <button type="button" disabled={disabled} onClick={() => uCode({ groups: code.groups.filter((x) => x !== g) })} className="hover:text-critical disabled:opacity-50">✕</button>
                      </span>
                    ))}
                    <input className={`${input} w-40`} placeholder="add group + Enter" disabled={disabled}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v && !code.groups.includes(v)) uCode({ groups: [...code.groups, v] }); (e.target as HTMLInputElement).value = ""; } }} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <span className={label}>Extra cart condition (optional)</span>
                <p className="mb-2 text-xs text-muted">An additional rule the cart must satisfy for this code to apply, on top of the linked cart discounts.</p>
                <PredicateBuilder context="cart" dynamic={dynamic} value={code.cartPredicate} onChange={(v) => uCode({ cartPredicate: v })} categories={categories} facetValues={facetValues} disabled={disabled} />
              </div>
            </>
          )}

          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} disabled={disabled} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Active</label>

          {releaseActive && (
            <div className="flex items-center gap-3">
              {isCreate ? (
                <button onClick={create} disabled={busy || !keyVal.trim() || (isCode && !codeVal.trim())} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">{busy ? "Creating…" : "Create discount"}</button>
              ) : (
                <>
                  <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Save discount"}</button>
                  <button onClick={checkpoint} disabled={!forked || busy} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">Save checkpoint</button>
                  <button onClick={() => setDeletion(true)} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-critical hover:bg-red-50 disabled:opacity-50"><TrashIcon className="size-4" /> Delete discount</button>
                </>
              )}
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
