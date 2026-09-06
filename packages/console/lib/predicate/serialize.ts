/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Model → commercetools predicate string, plus a plain-English summary.
import { CURRENCY } from "../config";
import {
  type Cmp,
  type Cond,
  type FieldDef,
  type Group,
  FN_NAME,
  LIST_OPS,
  NO_VALUE_OPS,
  OP_LABELS,
} from "./model";

export type Resolve = (id: string) => FieldDef | undefined;

const q = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function rhsScalar(f: FieldDef, c: Cond): string {
  switch (f.value) {
    case "money":
      return `"${(c.text || "0").trim()} ${c.currency || CURRENCY}"`;
    case "number":
      return `${(c.text || "0").trim()}`;
    case "boolean":
      return c.bool ? "true" : "false";
    default:
      return q(c.text);
  }
}

function listLits(f: FieldDef, c: Cond): string {
  const lit = (v: string) => (f.value === "number" ? v.trim() : f.value === "money" ? `"${v.trim()} ${c.currency || CURRENCY}"` : q(v));
  return c.list.map(lit).join(", ");
}

export function serializeCond(c: Cond, resolve: Resolve): string {
  const f = resolve(c.field);
  if (!f) return "";
  if (f.fn) {
    const sub = c.sub ? serializeCond(c.sub, resolve) : "";
    if (!sub) return "";
    const lhs = `${FN_NAME[f.fn]}(${sub})`;
    if (f.fn === "exists") return lhs;
    return `${lhs} ${c.op} ${rhsScalar(f, c)}`;
  }
  const lhs = f.path;
  if (NO_VALUE_OPS.includes(c.op)) return `${lhs} ${c.op}`;
  if (LIST_OPS.includes(c.op)) {
    if (!c.list.length) return "";
    return `${lhs} ${c.op} (${listLits(f, c)})`;
  }
  return `${lhs} ${c.op} ${rhsScalar(f, c)}`;
}

export function serializeGroup(g: Group, isRoot: boolean, resolve: Resolve): string {
  const parts = g.children
    .map((n) => (n.kind === "group" ? serializeGroup(n, false, resolve) : serializeCond(n, resolve)))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return isRoot ? "1 = 1" : "";
  const body = parts.join(` ${g.join} `);
  if (g.negate) return `not (${body})`;
  if (isRoot) return body;
  return parts.length > 1 ? `(${body})` : body;
}

/** Root model → predicate string ("1 = 1" when empty). */
export function serializePredicate(root: Group, resolve: Resolve): string {
  return serializeGroup(root, true, resolve);
}

// ---- human-readable summary (best-effort) ----

export type Labelers = { catName?: (key: string) => string };

function valueText(f: FieldDef, c: Cond, lab: Labelers): string {
  const label = (v: string) => {
    if (f.input === "category" && lab.catName) return lab.catName(v);
    if (f.enumValues) return f.enumValues.find((e) => e.value === v)?.label ?? v;
    return v;
  };
  if (NO_VALUE_OPS.includes(c.op)) return "";
  if (LIST_OPS.includes(c.op)) return c.list.map(label).join(", ") || "…";
  if (f.value === "money") return `${c.text || "0"} ${c.currency}`;
  if (f.value === "boolean") return c.bool ? "yes" : "no";
  return label(c.text) || "…";
}

function describeCond(c: Cond, resolve: Resolve, lab: Labelers): string {
  const f = resolve(c.field);
  if (!f) return "…";
  if (f.fn) {
    const sub = c.sub ? describeCond(c.sub, resolve, lab) : "any item";
    if (f.fn === "exists") return `cart has an item where ${sub}`;
    const noun = f.fn === "count" ? "count of items" : "total of items";
    return `${noun} where ${sub} ${OP_LABELS[c.op]} ${valueText(f, c, lab)}`;
  }
  const v = valueText(f, c, lab);
  return `${f.label} ${OP_LABELS[c.op]}${v ? " " + v : ""}`;
}

export function describeGroup(g: Group, resolve: Resolve, lab: Labelers = {}): string {
  const parts = g.children
    .map((n) => (n.kind === "group" ? `(${describeGroup(n, resolve, lab)})` : describeCond(n, resolve, lab)))
    .filter(Boolean);
  if (!parts.length) return "any cart";
  const joined = parts.join(g.join === "and" ? " and " : " or ");
  return g.negate ? `not (${joined})` : joined;
}
