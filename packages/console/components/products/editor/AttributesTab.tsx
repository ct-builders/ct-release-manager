/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useMemo, useState } from "react";
import type { AttrDef, CtAction, EditVariant } from "@/lib/product-editor-types";
import { amountField2 } from "@/lib/money";
import { CURRENCY } from "@/lib/config";

type Vals = Record<string, unknown>;

export default function AttributesTab({
  attrDefs,
  variant,
  variantId,
  apply,
  disabled,
  busy,
  releaseActive,
}: {
  attrDefs: AttrDef[];
  /** the variant whose attribute values are being edited */
  variant: EditVariant;
  variantId: number;
  apply: (actions: CtAction[]) => Promise<boolean>;
  disabled: boolean;
  busy: boolean;
  releaseActive: boolean;
}) {
  const initial = useMemo<Vals>(() => Object.fromEntries((variant?.attributes ?? []).map((a) => [a.name, a.value])), [variant]);
  const [vals, setVals] = useState<Vals>(initial);

  const set = (name: string, v: unknown) => setVals((s) => ({ ...s, [name]: v }));
  const changed = attrDefs.filter((d) => d.type !== "reference" && JSON.stringify(vals[d.name] ?? null) !== JSON.stringify(initial[d.name] ?? null));

  function toValue(def: AttrDef, v: unknown): unknown {
    if (v == null || v === "") return undefined; // unset
    switch (def.type) {
      case "number":
        return Number(v);
      case "boolean":
        return !!v;
      case "money": {
        const m = v as { currencyCode?: string; centAmount?: number };
        return { type: "centPrecision", currencyCode: m.currencyCode || CURRENCY, centAmount: Math.round(m.centAmount || 0), fractionDigits: 2 };
      }
      case "set":
        return Array.isArray(v) ? v : [];
      default:
        return def.type === "enum" || def.type === "lenum" || def.type === "date" ? v : String(v);
    }
  }

  async function save() {
    // SameForAll attributes must be set across every variant at once; the rest are per-variant.
    const actions: CtAction[] = changed.map((d) =>
      d.constraint === "SameForAll"
        ? { action: "setAttributeInAllVariants", name: d.name, value: toValue(d, vals[d.name]), staged: false }
        : { action: "setAttribute", variantId, name: d.name, value: toValue(d, vals[d.name]), staged: false }
    );
    const ok = await apply(actions);
    if (ok) setVals((s) => ({ ...s })); // keep; refresh reloads props
  }

  const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02] disabled:text-muted";

  return (
    <div className="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        {attrDefs.map((def) => (
          <div key={def.name} className={def.type === "set" || def.type === "text" ? "sm:col-span-2" : ""}>
            <span className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              {def.label}
              <code className="text-[10px] normal-case text-muted/70">{def.name}</code>
              {def.constraint === "SameForAll" && (
                <span className="rounded bg-black/[.06] px-1 py-px text-[9px] font-medium normal-case tracking-normal text-muted" title="Shared — same value across all variants">
                  shared
                </span>
              )}
            </span>
            <AttrInput def={def} value={vals[def.name]} onChange={(v) => set(def.name, v)} disabled={disabled} inputCls={input} />
          </div>
        ))}
      </div>
      {releaseActive && (
        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={!changed.length || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">
            {busy ? "Saving…" : "Save attributes"}
          </button>
          {changed.length > 0 && <span className="text-xs text-muted">{changed.length} changed</span>}
        </div>
      )}
    </div>
  );
}

function AttrInput({ def, value, onChange, disabled, inputCls }: { def: AttrDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean; inputCls: string }) {
  if (def.type === "reference") {
    const id = (value as { id?: string } | undefined)?.id;
    return <div className="rounded-lg border border-border bg-black/[.02] px-3 py-2 text-sm text-muted">{id ? `→ ${id}` : "—"} <span className="text-[10px]">(reference, read-only)</span></div>;
  }
  if (def.type === "boolean") {
    return <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />;
  }
  if (def.type === "number") {
    return <input type="number" className={inputCls} value={value == null ? "" : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
  }
  if (def.type === "money") {
    const m = (value as { currencyCode?: string; centAmount?: number }) || {};
    return <MoneyInput m={m} onChange={onChange} disabled={disabled} inputCls={inputCls} />;
  }
  if (def.type === "enum" || def.type === "lenum") {
    return (
      <select className={inputCls} value={(value as string) ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {def.values?.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    );
  }
  if (def.type === "set") {
    const arr = Array.isArray(value) ? value : [];
    // enum-set values come back as { key, label } objects; text-set values are plain strings
    const keys = arr.map((el) => (el && typeof el === "object" ? String((el as { key?: string }).key ?? "") : String(el)));
    return <TagsInput def={def} value={keys} onChange={onChange} disabled={disabled} />;
  }
  // text / ltext / date fallback
  const type = def.type === "date" ? "date" : "text";
  return <input type={type} className={inputCls} value={value == null ? "" : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * A money attribute, which needs its own component because it is the one input
 * here whose displayed text differs from the model behind it.
 *
 * The model holds `centAmount`, an integer. Deriving the field's value from it
 * as `centAmount / 100` makes trailing zeros unrepresentable — 5000 renders as
 * "50", never "50.00" — so the text is local state, and every keystroke syncs
 * the parsed `centAmount` up to the parent for save and diff. On blur the text
 * snaps to two decimals; the parent already has the number by then, so this
 * only settles what is on screen.
 */
function MoneyInput({ m, onChange, disabled, inputCls }: {
  m: { currencyCode?: string; centAmount?: number };
  onChange: (v: unknown) => void;
  disabled: boolean;
  inputCls: string;
}) {
  const [text, setText] = useState(m.centAmount != null ? (m.centAmount / 100).toFixed(2) : "");
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="0.01"
        className={inputCls}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onChange({
            currencyCode: m.currencyCode || CURRENCY,
            centAmount: e.target.value === "" ? 0 : Math.round(Number(e.target.value) * 100),
          });
        }}
        onBlur={() => setText((t) => amountField2(t))}
      />
      <span className="text-sm text-muted">{m.currencyCode || CURRENCY}</span>
    </div>
  );
}

function TagsInput({ def, value, onChange, disabled }: { def: AttrDef; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const [t, setT] = useState("");
  const options = def.values; // present for a set of enum/lenum — restrict adds to allowed values
  const labelFor = (key: string) => options?.find((o) => o.key === key)?.label ?? key;
  const add = (raw: string) => {
    const v = raw.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setT("");
  };
  const remaining = options?.filter((o) => !value.includes(o.key)) ?? [];

  const control = "rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  const addBtn = "shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50";

  return (
    <div className="rounded-lg border border-border bg-white p-2">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              {labelFor(v)}
              {!disabled && (
                <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="text-accent/70 hover:text-accent" aria-label={`Remove ${labelFor(v)}`}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled &&
        (options ? (
          // set of enum: pick from the allowed values
          <div className="flex items-center gap-2">
            <select value={t} onChange={(e) => setT(e.target.value)} className={`flex-1 ${control}`} disabled={!remaining.length}>
              <option value="">{remaining.length ? "Add a value…" : "All values added"}</option>
              {remaining.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button type="button" onClick={() => add(t)} disabled={!t} className={addBtn}>Add</button>
          </div>
        ) : (
          // set of text: free entry
          <div className="flex items-center gap-2">
            <input
              value={t}
              onChange={(e) => setT(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  add(t);
                }
              }}
              placeholder="Add a value…"
              className={`flex-1 ${control}`}
            />
            <button type="button" onClick={() => add(t)} disabled={!t.trim()} className={addBtn}>Add</button>
          </div>
        ))}
    </div>
  );
}
