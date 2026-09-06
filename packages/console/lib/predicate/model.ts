/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Client-safe predicate model. Translates between the commercetools cart /
// product / line-item predicate DSL and a visual query-builder tree. No
// server-only imports — used by both the server (initial parse) and the client
// editor (edit + serialize). Round-trip safety is enforced in parse.ts: a raw
// predicate is only shown in the visual builder when re-serializing it matches
// the original, otherwise the editor falls back to a raw text field.

import { CURRENCY } from "../config";

export type PredContext = "cart" | "lineItem" | "product" | "customLineItem";

// Value shapes a field's right-hand side can take.
export type ValueKind = "money" | "number" | "string" | "boolean" | "date" | "datetime";

// How to render the value input.
// "facet" renders a suggestion list of the configured FACET_ATTRIBUTE's values.
export type InputHint = "plain" | "category" | "facet" | "currency" | "country" | "enum";

// commercetools predicate comparison / membership operators.
export type Cmp =
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "contains"
  | "contains all"
  | "contains any"
  | "in"
  | "not in"
  | "is defined"
  | "is not defined"
  | "is empty"
  | "is not empty";

export const OP_LABELS: Record<Cmp, string> = {
  "=": "is",
  "<>": "is not",
  "<": "less than",
  "<=": "at most",
  ">": "more than",
  ">=": "at least",
  contains: "contains",
  "contains all": "contains all of",
  "contains any": "contains any of",
  in: "is any of",
  "not in": "is none of",
  "is defined": "is set",
  "is not defined": "is not set",
  "is empty": "is empty",
  "is not empty": "is not empty",
};

// Operators that take no value.
export const NO_VALUE_OPS: Cmp[] = ["is defined", "is not defined", "is empty", "is not empty"];
// Operators whose value is a list.
export const LIST_OPS: Cmp[] = ["contains all", "contains any", "in", "not in"];

export type CartFn = "count" | "total" | "exists";
export const FN_NAME: Record<CartFn, string> = {
  count: "lineItemCount",
  total: "lineItemTotal",
  exists: "lineItemExists",
};

export type FieldDef = {
  id: string; // stable id (used in the field picker + condition.field)
  path: string; // predicate expression on the left-hand side, e.g. "categories.key"
  label: string;
  group: string; // section heading in the field picker
  value: ValueKind;
  collection?: boolean; // set / collection field (enables contains / is empty)
  input?: InputHint;
  enumValues?: { value: string; label: string }[];
  fn?: CartFn; // cart-only: wraps a nested line-item sub-condition
  hint?: string;
};

// A single leaf condition.
export type Cond = {
  kind: "cond";
  id: string;
  field: string; // FieldDef.id
  op: Cmp;
  text: string; // string / number / money amount / date value
  currency: string; // money currency
  list: string[]; // in / contains all|any values (chips)
  bool: boolean; // boolean value
  sub: Cond | null; // nested line-item condition for cart functions (count/total/exists)
};

// A boolean group of conditions / sub-groups.
export type Group = {
  kind: "group";
  id: string;
  join: "and" | "or";
  negate: boolean; // wrap in not( … )
  children: Node[];
};

export type Node = Cond | Group;

let _seq = 0;
export const uid = () => `p${++_seq}`;

export function newCond(field: string, op: Cmp = "="): Cond {
  return { kind: "cond", id: uid(), field, op, text: "", currency: CURRENCY, list: [], bool: true, sub: null };
}

export function newGroup(join: "and" | "or" = "and"): Group {
  return { kind: "group", id: uid(), join, negate: false, children: [] };
}

export function emptyRoot(): Group {
  return newGroup("and");
}

/** Operators valid for a field, given its kind / cardinality / function. */
export function operatorsFor(f: FieldDef | undefined): Cmp[] {
  if (!f) return ["="];
  if (f.fn === "exists") return []; // existence is implied by the sub-condition
  if (f.fn === "count") return ["=", "<>", "<", "<=", ">", ">="];
  if (f.fn === "total") return ["=", "<>", "<", "<=", ">", ">="];
  if (f.collection) return ["contains", "contains any", "contains all", "is empty", "is not empty", "is defined", "is not defined"];
  switch (f.value) {
    case "money":
    case "number":
    case "date":
    case "datetime":
      return ["=", "<>", "<", "<=", ">", ">=", "is defined", "is not defined"];
    case "boolean":
      return ["="];
    case "string":
    default:
      return ["=", "<>", "in", "not in", "is defined", "is not defined"];
  }
}
