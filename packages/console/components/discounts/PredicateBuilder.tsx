/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryOption } from "@/lib/categories";
import { FACET_ATTRIBUTE } from "@/lib/config";
import {
  buildFields,
  groupFields,
  CURRENCIES,
  COUNTRIES,
  fieldById,
  type DynamicCatalog,
  serializePredicate,
  describeGroup,
  parsePredicate,
  operatorsFor,
  OP_LABELS,
  NO_VALUE_OPS,
  LIST_OPS,
  newCond,
  newGroup,
  type Cmp,
  type Cond,
  type FieldDef,
  type Group,
  type Node,
  type PredContext,
  type Resolve,
} from "@/lib/predicate";

const inp =
  "rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02] disabled:text-muted";

// ---- immutable tree helpers ----
function findParentAndIndex(g: Group, id: string): { parent: Group; index: number } | null {
  for (let i = 0; i < g.children.length; i++) {
    const ch = g.children[i];
    if (ch.id === id) return { parent: g, index: i };
    if (ch.kind === "group") {
      const r = findParentAndIndex(ch, id);
      if (r) return r;
    }
  }
  return null;
}
function findNode(g: Group, id: string): Node | null {
  if (g.id === id) return g;
  for (const ch of g.children) {
    if (ch.id === id) return ch;
    if (ch.kind === "group") {
      const r = findNode(ch, id);
      if (r) return r;
    }
  }
  return null;
}

export default function PredicateBuilder({
  context,
  dynamic,
  value,
  onChange,
  categories,
  facetValues,
  disabled,
  emptyLabel = "any cart",
}: {
  context: PredContext;
  dynamic: DynamicCatalog;
  value: string;
  onChange: (predicate: string) => void;
  categories: CategoryOption[];
  facetValues: string[];
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const fields = useMemo(() => buildFields(context, dynamic), [context, dynamic]);
  const subFields = useMemo(() => buildFields("lineItem", dynamic), [dynamic]);
  const resolve = useMemo<Resolve>(
    () => (id) => fieldById(fields, id) ?? fieldById(subFields, id),
    [fields, subFields]
  );
  const catName = useMemo(() => {
    const m = new Map(categories.map((o) => [o.key, o.name]));
    return (k: string) => m.get(k) || k;
  }, [categories]);

  const parsed = useMemo(() => parsePredicate(value, fields, subFields), [value, fields, subFields]);
  const [mode, setMode] = useState<"visual" | "raw">(parsed.raw ? "raw" : "visual");
  const [root, setRoot] = useState<Group>(parsed.root ?? newGroup("and"));
  const [rawText, setRawText] = useState(value);
  const [note, setNote] = useState<string | null>(null);

  // Re-sync when the incoming value changes from outside (e.g. preset applied).
  const lastEmit = useRef(value);
  useEffect(() => {
    if (value === lastEmit.current) return; // our own change echoed back
    const p = parsePredicate(value, fields, subFields);
    if (p.raw) {
      setMode("raw");
      setRawText(value);
    } else {
      setRoot(p.root);
      setRawText(value);
    }
    lastEmit.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(next: Group) {
    setRoot(next);
    const s = serializePredicate(next, resolve);
    lastEmit.current = s;
    onChange(s);
  }
  function mutate(fn: (draft: Group) => void) {
    const draft: Group = structuredClone(root);
    fn(draft);
    emit(draft);
  }

  // ---- edit ops ----
  const setGroupMode = (id: string, m: "all" | "any" | "none") =>
    mutate((d) => {
      const g = findNode(d, id);
      if (g && g.kind === "group") {
        g.join = m === "all" ? "and" : "or";
        g.negate = m === "none";
      }
    });
  const addCondition = (groupId: string) =>
    mutate((d) => {
      const g = findNode(d, groupId);
      if (g && g.kind === "group") g.children.push(newCond(fields[0].id, operatorsFor(fields[0])[0] ?? "="));
    });
  const addGroup = (groupId: string) =>
    mutate((d) => {
      const g = findNode(d, groupId);
      if (g && g.kind === "group") g.children.push(newGroup("and"));
    });
  const removeNode = (id: string) =>
    mutate((d) => {
      const r = findParentAndIndex(d, id);
      if (r) r.parent.children.splice(r.index, 1);
    });
  const patchCond = (id: string, patch: Partial<Cond>) =>
    mutate((d) => {
      const c = findNode(d, id);
      if (c && c.kind === "cond") Object.assign(c, patch);
    });

  // ---- raw mode ----
  function toRaw() {
    setRawText(serializePredicate(root, resolve));
    setMode("raw");
  }
  function tryVisual() {
    const p = parsePredicate(rawText, fields, subFields);
    if (p.raw) {
      setNote("This rule is too complex for the visual builder — keep editing it as text.");
      setTimeout(() => setNote(null), 3500);
      return;
    }
    setRoot(p.root);
    setMode("visual");
    lastEmit.current = rawText;
    onChange(rawText);
  }
  function onRaw(v: string) {
    setRawText(v);
    lastEmit.current = v;
    onChange(v);
  }

  const summary = describeGroup(root, resolve, { catName });

  // Merchant-Center-style toggle between the visual rule builder and the raw predicate text.
  const seg = (active: boolean) =>
    `flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${active ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"}`;
  const viewToggle = (
    <div className="inline-flex items-center rounded-lg border border-border bg-white p-0.5" role="group" aria-label="Rule view">
      <button type="button" title="Rule builder" aria-pressed={mode === "visual"} disabled={disabled} onClick={() => mode !== "visual" && tryVisual()} className={seg(mode === "visual")}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2.5 4.5h6M2.5 8h11M2.5 11.5h4" strokeLinecap="round" /><circle cx="11" cy="4.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="8" cy="11.5" r="1.5" fill="currentColor" stroke="none" /></svg>
        Rules
      </button>
      <button type="button" title="Predicate (text)" aria-pressed={mode === "raw"} disabled={disabled} onClick={() => mode !== "raw" && toRaw()} className={seg(mode === "raw")}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Predicate
      </button>
    </div>
  );

  // ---------- render ----------
  if (mode === "raw") {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Predicate</span>
          {viewToggle}
        </div>
        <textarea className={`${inp} h-20 w-full resize-y font-mono text-xs`} value={rawText} disabled={disabled} onChange={(e) => onRaw(e.target.value)} spellCheck={false} />
        {note && <p className="text-xs text-amber-700">{note}</p>}
        <p className="text-[11px] text-muted">Uses the commercetools predicate syntax, e.g. <code className="rounded bg-black/5 px-1">totalPrice &gt;= &quot;50.00 USD&quot;</code>.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Rule</span>
        {viewToggle}
      </div>

      <GroupBlock
        group={root}
        isRoot
        fields={fields}
        subFields={subFields}
        categories={categories}
        facetValues={facetValues}
        disabled={disabled}
        onSetMode={setGroupMode}
        onAddCondition={addCondition}
        onAddGroup={addGroup}
        onRemove={removeNode}
        onPatchCond={patchCond}
      />

      <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm">
        <div className="text-[13px]">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-accent">Matches</span>
          {root.children.length ? summary : emptyLabel}
        </div>
      </div>
    </div>
  );
}

// ---- group ----
function GroupBlock(props: {
  group: Group;
  isRoot?: boolean;
  fields: FieldDef[];
  subFields: FieldDef[];
  categories: CategoryOption[];
  facetValues: string[];
  disabled?: boolean;
  onSetMode: (id: string, m: "all" | "any" | "none") => void;
  onAddCondition: (groupId: string) => void;
  onAddGroup: (groupId: string) => void;
  onRemove: (id: string) => void;
  onPatchCond: (id: string, patch: Partial<Cond>) => void;
}) {
  const { group, isRoot, disabled } = props;
  const modeVal = group.negate ? "none" : group.join === "or" ? "any" : "all";
  return (
    <div className={`rounded-lg border p-3 ${isRoot ? "border-border bg-black/[.015]" : "border-accent/30 bg-white"}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted">Match</span>
        <select className={`${inp} py-1`} value={modeVal} disabled={disabled} onChange={(e) => props.onSetMode(group.id, e.target.value as "all" | "any" | "none")}>
          <option value="all">ALL of</option>
          <option value="any">ANY of</option>
          <option value="none">NONE of</option>
        </select>
        <span className="text-xs text-muted">the following</span>
        {!isRoot && (
          <button type="button" onClick={() => props.onRemove(group.id)} disabled={disabled} className="ml-auto rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-critical hover:bg-red-50 disabled:opacity-50">
            Remove group
          </button>
        )}
      </div>

      <div className="grid gap-2 pl-2">
        {group.children.length === 0 && <p className="text-xs text-muted">No conditions yet — add one below.</p>}
        {group.children.map((ch) =>
          ch.kind === "group" ? (
            <GroupBlock key={ch.id} {...props} group={ch} isRoot={false} />
          ) : (
            <ConditionRow key={ch.id} cond={ch} fields={props.fields} subFields={props.subFields} categories={props.categories} facetValues={props.facetValues} disabled={disabled} onPatch={props.onPatchCond} onRemove={props.onRemove} />
          )
        )}
      </div>

      <div className="mt-2 flex gap-2 pl-2">
        <button type="button" onClick={() => props.onAddCondition(group.id)} disabled={disabled} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">
          + Condition
        </button>
        <button type="button" onClick={() => props.onAddGroup(group.id)} disabled={disabled} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">
          + Group
        </button>
      </div>
    </div>
  );
}

// ---- condition ----
function ConditionRow(props: {
  cond: Cond;
  fields: FieldDef[];
  subFields: FieldDef[];
  categories: CategoryOption[];
  facetValues: string[];
  disabled?: boolean;
  onPatch: (id: string, patch: Partial<Cond>) => void;
  onRemove: (id: string) => void;
}) {
  const { cond, fields, subFields, disabled } = props;
  const f = fieldById(fields, cond.field);
  const ops = operatorsFor(f);
  const sections = useMemo(() => groupFields(fields), [fields]);

  function changeField(id: string) {
    const nf = fieldById(fields, id);
    const nextOps = operatorsFor(nf);
    const patch: Partial<Cond> = { field: id, op: nextOps[0] ?? "=", text: "", list: [], bool: true, sub: null };
    if (nf?.fn) patch.sub = newCond(subFields[0].id, operatorsFor(subFields[0])[0] ?? "=");
    props.onPatch(cond.id, patch);
  }

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-white p-2">
      <select className={`${inp} min-w-52`} value={cond.field} disabled={disabled} onChange={(e) => changeField(e.target.value)}>
        {sections.map((s) => (
          <optgroup key={s.group} label={s.group}>
            {s.fields.map((fd) => (
              <option key={fd.id} value={fd.id}>
                {fd.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {f?.fn ? (
        <FnEditor cond={cond} field={f} subFields={subFields} categories={props.categories} facetValues={props.facetValues} disabled={disabled} onPatch={props.onPatch} />
      ) : (
        <>
          {ops.length > 0 && (
            <select className={`${inp} min-w-28`} value={cond.op} disabled={disabled} onChange={(e) => props.onPatch(cond.id, { op: e.target.value as Cmp })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {OP_LABELS[o]}
                </option>
              ))}
            </select>
          )}
          <ValueInput field={f} cond={cond} categories={props.categories} facetValues={props.facetValues} disabled={disabled} onPatch={(patch) => props.onPatch(cond.id, patch)} />
        </>
      )}

      <button type="button" onClick={() => props.onRemove(cond.id)} disabled={disabled} className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-black/[.04] hover:text-critical disabled:opacity-50" title="Remove condition">
        ✕
      </button>
    </div>
  );
}

// cart function editor: nested single line-item sub-condition + comparator/value
function FnEditor(props: {
  cond: Cond;
  field: FieldDef;
  subFields: FieldDef[];
  categories: CategoryOption[];
  facetValues: string[];
  disabled?: boolean;
  onPatch: (id: string, patch: Partial<Cond>) => void;
}) {
  const { cond, field, subFields, disabled } = props;
  const sub = cond.sub ?? newCond(subFields[0].id);
  const ops = operatorsFor(field);
  const patchSub = (patch: Partial<Cond>) => props.onPatch(cond.id, { sub: { ...sub, ...patch } });
  const subF = fieldById(subFields, sub.field);

  function changeSubField(id: string) {
    const nf = fieldById(subFields, id);
    const nextOps = operatorsFor(nf);
    patchSub({ field: id, op: nextOps[0] ?? "=", text: "", list: [], bool: true });
  }

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-black/[.02] p-2">
      <span className="text-xs text-muted">where item</span>
      <select className={`${inp} min-w-44`} value={sub.field} disabled={disabled} onChange={(e) => changeSubField(e.target.value)}>
        {groupFields(subFields).map((s) => (
          <optgroup key={s.group} label={s.group}>
            {s.fields.map((fd) => (
              <option key={fd.id} value={fd.id}>
                {fd.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {operatorsFor(subF).length > 0 && (
        <select className={`${inp} min-w-24`} value={sub.op} disabled={disabled} onChange={(e) => patchSub({ op: e.target.value as Cmp })}>
          {operatorsFor(subF).map((o) => (
            <option key={o} value={o}>
              {OP_LABELS[o]}
            </option>
          ))}
        </select>
      )}
      <ValueInput field={subF} cond={sub} categories={props.categories} facetValues={props.facetValues} disabled={disabled} onPatch={patchSub} />
      {field.fn !== "exists" && (
        <>
          <span className="text-xs text-muted">{field.fn === "count" ? ", count" : ", total"}</span>
          <select className={`${inp} min-w-20`} value={cond.op} disabled={disabled} onChange={(e) => props.onPatch(cond.id, { op: e.target.value as Cmp })}>
            {ops.map((o) => (
              <option key={o} value={o}>
                {OP_LABELS[o]}
              </option>
            ))}
          </select>
          <ValueInput field={field} cond={cond} categories={props.categories} facetValues={props.facetValues} disabled={disabled} onPatch={(patch) => props.onPatch(cond.id, patch)} />
        </>
      )}
    </div>
  );
}

// ---- typed value input ----
function ValueInput(props: {
  field: FieldDef | undefined;
  cond: Cond;
  categories: CategoryOption[];
  facetValues: string[];
  disabled?: boolean;
  onPatch: (patch: Partial<Cond>) => void;
}) {
  const { field, cond, disabled } = props;
  if (!field) return null;
  if (NO_VALUE_OPS.includes(cond.op)) return null;
  const isList = LIST_OPS.includes(cond.op);

  if (isList) return <ChipsInput {...props} field={field} />;

  switch (field.value) {
    case "money":
      return (
        <span className="flex items-center gap-1">
          <input className={`${inp} w-24`} type="number" step="0.01" value={cond.text} disabled={disabled} onChange={(e) => props.onPatch({ text: e.target.value })} placeholder="0.00" />
          <select className={`${inp} w-20`} value={cond.currency} disabled={disabled} onChange={(e) => props.onPatch({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </span>
      );
    case "number":
      return <input className={`${inp} w-24`} type="number" value={cond.text} disabled={disabled} onChange={(e) => props.onPatch({ text: e.target.value })} placeholder="0" />;
    case "boolean":
      return (
        <select className={`${inp} w-24`} value={cond.bool ? "true" : "false"} disabled={disabled} onChange={(e) => props.onPatch({ bool: e.target.value === "true" })}>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      );
    case "date":
      return <input className={`${inp} w-40`} type="date" value={cond.text} disabled={disabled} onChange={(e) => props.onPatch({ text: e.target.value })} />;
    case "datetime":
      return <input className={`${inp} w-52`} type="datetime-local" value={cond.text} disabled={disabled} onChange={(e) => props.onPatch({ text: e.target.value })} />;
    default:
      return <ScalarStringInput {...props} field={field} />;
  }
}

function ScalarStringInput(props: { field: FieldDef; cond: Cond; categories: CategoryOption[]; facetValues: string[]; disabled?: boolean; onPatch: (patch: Partial<Cond>) => void }) {
  const { field, cond, disabled } = props;
  const set = (text: string) => props.onPatch({ text });
  if (field.input === "category")
    return (
      <select className={`${inp} min-w-52`} value={cond.text} disabled={disabled} onChange={(e) => set(e.target.value)}>
        <option value="">— choose a category —</option>
        {props.categories.map((o) => (
          <option key={o.key} value={o.key}>
            {o.path}
          </option>
        ))}
      </select>
    );
  if (field.input === "enum" && field.enumValues)
    return (
      <select className={`${inp} min-w-40`} value={cond.text} disabled={disabled} onChange={(e) => set(e.target.value)}>
        <option value="">— choose —</option>
        {field.enumValues.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
    );
  if (field.input === "currency")
    return (
      <select className={`${inp} w-24`} value={cond.text} disabled={disabled} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    );
  if (field.input === "country")
    return (
      <select className={`${inp} w-24`} value={cond.text} disabled={disabled} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {COUNTRIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    );
  if (field.input === "facet")
    return (
      <>
        <input className={`${inp} min-w-40`} list="rm-pred-facet" value={cond.text} disabled={disabled} onChange={(e) => set(e.target.value)} placeholder={FACET_ATTRIBUTE.label.toLowerCase()} />
        <datalist id="rm-pred-facet">
          {props.facetValues.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </>
    );
  return <input className={`${inp} min-w-40`} value={cond.text} disabled={disabled} onChange={(e) => set(e.target.value)} placeholder="value" />;
}

function ChipsInput(props: { field: FieldDef; cond: Cond; categories: CategoryOption[]; facetValues: string[]; disabled?: boolean; onPatch: (patch: Partial<Cond>) => void }) {
  const { field, cond, disabled } = props;
  const [draft, setDraft] = useState("");
  const add = (v: string) => {
    const t = v.trim();
    if (!t || cond.list.includes(t)) return;
    props.onPatch({ list: [...cond.list, t] });
    setDraft("");
  };
  const remove = (v: string) => props.onPatch({ list: cond.list.filter((x) => x !== v) });
  const label = (v: string) => {
    if (field.input === "category") return props.categories.find((c) => c.key === v)?.name ?? v;
    if (field.enumValues) return field.enumValues.find((e) => e.value === v)?.label ?? v;
    return v;
  };

  return (
    <span className="flex flex-wrap items-center gap-1">
      {cond.list.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
          {label(v)}
          <button type="button" onClick={() => remove(v)} disabled={disabled} className="hover:text-critical disabled:opacity-50">
            ✕
          </button>
        </span>
      ))}
      {field.input === "category" ? (
        <select
          className={`${inp} min-w-44`}
          value=""
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">+ add category</option>
          {props.categories.map((o) => (
            <option key={o.key} value={o.key}>
              {o.path}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            className={`${inp} w-32`}
            list={field.input === "facet" ? "rm-pred-facet" : undefined}
            value={draft}
            disabled={disabled}
            placeholder="add value…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              }
            }}
          />
          {field.input === "facet" && (
            <datalist id="rm-pred-facet">
              {props.facetValues.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          )}
          <button type="button" onClick={() => add(draft)} disabled={disabled} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-black/[.04] disabled:opacity-50">
            add
          </button>
        </>
      )}
    </span>
  );
}
