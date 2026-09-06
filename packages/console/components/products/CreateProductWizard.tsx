/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProductAction } from "@/lib/actions";
import { amountField2 } from "@/lib/money";
import CategoryPicker from "@/components/categories/CategoryPicker";
import type { CategoryNode } from "@/lib/categories";
import {
  CURRENCY,
  FACET_ATTRIBUTE,
  CODE_ATTRIBUTE,
  hasFacetAttribute,
  hasCodeAttribute,
  PRODUCT_NAME_PLACEHOLDER,
} from "@/lib/config";

type Fields = {
  name: string;
  /** value for the configured FACET_ATTRIBUTE (`brand` by default) */
  facet: string;
  /** major units in CURRENCY */
  price: string;
  /** value for the configured CODE_ATTRIBUTE (`partNumber` by default) */
  code: string;
  categoryId: string;
  imageUrl: string;
  description: string;
};
const EMPTY: Fields = { name: "", facet: "", price: "", code: "", categoryId: "", imageUrl: "", description: "" };

/** Currency symbol for the price step, falling back to the code itself. */
const CURRENCY_SYMBOL =
  new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? CURRENCY;

const STEPS = ["Basics", "Price", "Extras"] as const;

export default function CreateProductWizard({ categoryNodes }: { categoryNodes: CategoryNode[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Fields>) => setF((s) => ({ ...s, ...patch }));
  const close = () => {
    if (busy) return;
    setOpen(false);
    setStep(0);
    setF(EMPTY);
    setError(null);
  };

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createProductAction({
      name: f.name,
      facet: f.facet,
      price: f.price,
      code: f.code,
      categoryId: f.categoryId,
      imageUrl: f.imageUrl,
      description: f.description,
    });
    if (res.ok && res.data) {
      router.push(`/products/${encodeURIComponent(res.data.key)}`);
    } else {
      setBusy(false);
      setError(res.ok ? "Something went wrong." : res.error);
    }
  }

  const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";
  const label = "mb-1 block text-sm font-medium";
  const hint = "mt-1 text-xs text-muted";
  const canFinish = !!f.name.trim();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
        Create product
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15,15,20,.45)", backdropFilter: "blur(3px)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            {/* header + step dots */}
            <div className="border-b border-border bg-surface px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Add a new product</h2>
                <button onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-black/[.06] hover:text-foreground" aria-label="Close">
                  <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
                </button>
              </div>
              <div className="mt-3 flex gap-1.5">
                {STEPS.map((s, i) => (
                  <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-black/10"}`} title={s} />
                ))}
              </div>
            </div>

            {/* body */}
            <div className="overflow-y-auto px-6 py-5">
              {step === 0 && (
                <div className="grid gap-4">
                  <p className="text-sm text-muted">Let&apos;s start with the essentials.</p>
                  <div>
                    <span className={label}>What&apos;s the product called?</span>
                    <input className={input} autoFocus value={f.name} placeholder={PRODUCT_NAME_PLACEHOLDER} onChange={(e) => set({ name: e.target.value })} />
                    <p className={hint}>This is the name shoppers see.</p>
                  </div>
                  {hasFacetAttribute && (
                    <div>
                      <span className={label}>
                        {FACET_ATTRIBUTE.label} <span className="font-normal text-muted">(optional)</span>
                      </span>
                      <input className={input} value={f.facet} placeholder={FACET_ATTRIBUTE.placeholder} onChange={(e) => set({ facet: e.target.value })} />
                    </div>
                  )}
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-4">
                  <p className="text-sm text-muted">How much does it cost?</p>
                  <div>
                    <span className={label}>Price</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted">{CURRENCY_SYMBOL}</span>
                      <input className={`${input} max-w-40`} type="number" step="0.01" min="0" value={f.price} placeholder="0.00" onChange={(e) => set({ price: e.target.value })} onBlur={(e) => set({ price: amountField2(e.target.value) })} />
                      <span className="text-sm text-muted">{CURRENCY}</span>
                    </div>
                    <p className={hint}>You can add more currencies and regional prices later.</p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-4">
                  <p className="text-sm text-muted">A few optional details — skip any you don&apos;t need.</p>
                  {hasCodeAttribute && (
                    <div>
                      <span className={label}>{CODE_ATTRIBUTE.label}</span>
                      <input className={input} value={f.code} placeholder={CODE_ATTRIBUTE.placeholder} onChange={(e) => set({ code: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <span className={label}>Category</span>
                    <CategoryPicker
                      nodes={categoryNodes}
                      value={f.categoryId ? [f.categoryId] : []}
                      onChange={(ids) => set({ categoryId: ids[0] ?? "" })}
                    />
                  </div>
                  <div>
                    <span className={label}>Photo link</span>
                    <input className={input} value={f.imageUrl} placeholder="https://…" onChange={(e) => set({ imageUrl: e.target.value })} />
                  </div>
                  <div>
                    <span className={label}>Short description</span>
                    <textarea className={`${input} h-16 resize-y`} value={f.description} onChange={(e) => set({ description: e.target.value })} />
                  </div>
                </div>
              )}

              {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-critical">{error}</p>}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3">
              <button onClick={step === 0 ? close : () => setStep(step - 1)} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50">
                {step === 0 ? "Cancel" : "Back"}
              </button>
              {step < STEPS.length - 1 ? (
                <button onClick={() => setStep(step + 1)} disabled={step === 0 && !f.name.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
                  Next
                </button>
              ) : (
                <button onClick={create} disabled={!canFinish || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
                  {busy ? "Creating…" : "Create product"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
