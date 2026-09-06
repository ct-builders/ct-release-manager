/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// commercetools predicate string → visual model, with a strict round-trip
// guard. A predicate is only surfaced in the builder when re-serializing the
// parsed model reproduces the original (whitespace-insensitive); otherwise the
// caller falls back to a raw text editor so nothing is ever silently mangled.
import {
  type Cmp,
  type Cond,
  type FieldDef,
  type Group,
  type Node,
  emptyRoot,
  newCond,
  newGroup,
  FN_NAME,
} from "./model";
import { serializePredicate, type Resolve } from "./serialize";

// ---------------- tokenizer ----------------
type Tok =
  | { k: "str"; v: string }
  | { k: "num"; v: string }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "comma" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(") {
      toks.push({ k: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      toks.push({ k: "rp" });
      i++;
      continue;
    }
    if (ch === ",") {
      toks.push({ k: "comma" });
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          i++;
          s += src[i];
        } else s += src[i];
        i++;
      }
      if (i >= n) throw new Error("unterminated string");
      i++; // closing quote
      toks.push({ k: "str", v: s });
      continue;
    }
    if (ch === ">" || ch === "<" || ch === "=" || ch === "!") {
      // multi-char operators: >= <= <> !=
      const two = src.slice(i, i + 2);
      if (two === ">=" || two === "<=" || two === "<>" || two === "!=") {
        toks.push({ k: "op", v: two });
        i += 2;
        continue;
      }
      if (ch === "=" || ch === ">" || ch === "<") {
        toks.push({ k: "op", v: ch });
        i++;
        continue;
      }
      throw new Error(`unexpected char ${ch}`);
    }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let s = ch;
      i++;
      while (i < n && /[0-9.]/.test(src[i])) {
        s += src[i];
        i++;
      }
      toks.push({ k: "num", v: s });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let s = ch;
      i++;
      while (i < n && /[A-Za-z0-9_.]/.test(src[i])) {
        s += src[i];
        i++;
      }
      toks.push({ k: "id", v: s });
      continue;
    }
    throw new Error(`unexpected char ${ch}`);
  }
  return toks;
}

// ---------------- generic AST ----------------
type Lhs = { kind: "path"; path: string } | { kind: "call"; name: string; inner: Ast };
type Val = { raw: string; str: boolean };
type Ast =
  | { t: "group"; join: "and" | "or"; negate: boolean; items: Ast[] }
  | { t: "cmp"; lhs: Lhs; op: string; values: Val[] };

// ---------------- parser ----------------
class Parser {
  toks: Tok[];
  pos = 0;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(o = 0): Tok | undefined {
    return this.toks[this.pos + o];
  }
  next(): Tok | undefined {
    return this.toks[this.pos++];
  }
  isId(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.k === "id" && t.v.toLowerCase() === v;
  }
  expect(k: Tok["k"]): Tok {
    const t = this.next();
    if (!t || t.k !== k) throw new Error(`expected ${k}`);
    return t;
  }

  parse(): Ast {
    const e = this.parseOr();
    if (this.pos !== this.toks.length) throw new Error("trailing tokens");
    return e;
  }
  parseOr(): Ast {
    const items = [this.parseAnd()];
    while (this.isId("or")) {
      this.next();
      items.push(this.parseAnd());
    }
    return items.length === 1 ? items[0] : { t: "group", join: "or", negate: false, items };
  }
  parseAnd(): Ast {
    const items = [this.parseNot()];
    while (this.isId("and")) {
      this.next();
      items.push(this.parseNot());
    }
    return items.length === 1 ? items[0] : { t: "group", join: "and", negate: false, items };
  }
  parseNot(): Ast {
    if (this.isId("not") && !this.isId("in", 1)) {
      // 'not' as a logical prefix (but not the 'not in' operator, handled in comparison)
      this.next();
      const inner = this.parseNot();
      return { t: "group", join: "and", negate: true, items: [inner] };
    }
    return this.parsePrimary();
  }
  parsePrimary(): Ast {
    const t = this.peek();
    if (t && t.k === "lp") {
      this.next();
      const e = this.parseOr();
      this.expect("rp");
      return e;
    }
    return this.parseComparison();
  }

  parseLhs(): Lhs {
    const t = this.expect("id") as { k: "id"; v: string };
    if (this.peek() && this.peek()!.k === "lp") {
      this.next();
      const inner = this.parseOr();
      this.expect("rp");
      return { kind: "call", name: t.v, inner };
    }
    return { kind: "path", path: t.v };
  }

  parseValue(): Val {
    const t = this.next();
    if (!t) throw new Error("expected value");
    if (t.k === "str") return { raw: t.v, str: true };
    if (t.k === "num") return { raw: t.v, str: false };
    if (t.k === "id" && (t.v.toLowerCase() === "true" || t.v.toLowerCase() === "false")) return { raw: t.v.toLowerCase(), str: false };
    throw new Error("expected value literal");
  }
  parseList(): Val[] {
    this.expect("lp");
    const out = [this.parseValue()];
    while (this.peek() && this.peek()!.k === "comma") {
      this.next();
      out.push(this.parseValue());
    }
    this.expect("rp");
    return out;
  }

  parseComparison(): Ast {
    const lhs = this.parseLhs();
    // lineItemExists(...) with no operator
    if (lhs.kind === "call" && lhs.name.toLowerCase() === FN_NAME.exists.toLowerCase()) {
      const t = this.peek();
      const atEnd = !t || t.k === "rp" || this.isId("and") || this.isId("or");
      if (atEnd) return { t: "cmp", lhs, op: "exists", values: [] };
    }
    const t = this.peek();
    if (!t) throw new Error("expected operator");
    if (t.k === "op") {
      this.next();
      return { t: "cmp", lhs, op: t.v === "!=" ? "<>" : t.v, values: [this.parseValue()] };
    }
    if (t.k === "id") {
      const w = t.v.toLowerCase();
      if (w === "is") {
        this.next();
        if (this.isId("not")) {
          this.next();
          if (this.isId("defined")) {
            this.next();
            return { t: "cmp", lhs, op: "is not defined", values: [] };
          }
          if (this.isId("empty")) {
            this.next();
            return { t: "cmp", lhs, op: "is not empty", values: [] };
          }
          throw new Error("bad is-not operator");
        }
        if (this.isId("defined")) {
          this.next();
          return { t: "cmp", lhs, op: "is defined", values: [] };
        }
        if (this.isId("empty")) {
          this.next();
          return { t: "cmp", lhs, op: "is empty", values: [] };
        }
        throw new Error("bad is operator");
      }
      if (w === "contains") {
        this.next();
        if (this.isId("all")) {
          this.next();
          return { t: "cmp", lhs, op: "contains all", values: this.parseList() };
        }
        if (this.isId("any")) {
          this.next();
          return { t: "cmp", lhs, op: "contains any", values: this.parseList() };
        }
        return { t: "cmp", lhs, op: "contains", values: [this.parseValue()] };
      }
      if (w === "in") {
        this.next();
        return { t: "cmp", lhs, op: "in", values: this.parseList() };
      }
      if (w === "not") {
        this.next();
        if (this.isId("in")) {
          this.next();
          return { t: "cmp", lhs, op: "not in", values: this.parseList() };
        }
        throw new Error("bad not operator");
      }
    }
    throw new Error("expected operator");
  }
}

// ---------------- AST → model ----------------
const MONEY_RE = /^(-?\d+(?:\.\d+)?)\s+([A-Z]{3})$/;

function byPath(fields: FieldDef[]): Map<string, FieldDef> {
  const m = new Map<string, FieldDef>();
  for (const f of fields) if (f.path) m.set(f.path, f);
  return m;
}
function fnField(fields: FieldDef[], fn: "count" | "total" | "exists"): FieldDef | undefined {
  return fields.find((f) => f.fn === fn);
}

function buildCond(f: FieldDef, op: string, values: Val[], subFields: FieldDef[], resolveCall?: (name: string, inner: Ast) => Cond): Cond {
  const c = newCond(f.id, op as Cmp);
  const single = values[0];
  if (op === "is defined" || op === "is not defined" || op === "is empty" || op === "is not empty") return c;
  if (op === "in" || op === "not in" || op === "contains all" || op === "contains any") {
    c.list = values.map((v) => v.raw);
    return c;
  }
  // single-value ops
  if (!single) throw new Error("missing value");
  switch (f.value) {
    case "money": {
      if (!single.str) throw new Error("money must be string");
      const m = single.raw.match(MONEY_RE);
      if (!m) throw new Error("bad money");
      c.text = m[1];
      c.currency = m[2];
      break;
    }
    case "number":
      if (single.str) throw new Error("number must be numeric");
      c.text = single.raw;
      break;
    case "boolean":
      c.bool = single.raw === "true";
      break;
    default:
      if (!single.str) throw new Error("string value expected");
      c.text = single.raw;
  }
  return c;
}

function cmpToCond(node: Extract<Ast, { t: "cmp" }>, fields: FieldDef[], subFields: FieldDef[]): Cond {
  const { lhs, op, values } = node;
  if (lhs.kind === "call") {
    const name = lhs.name.toLowerCase();
    const fn = name === FN_NAME.count.toLowerCase() ? "count" : name === FN_NAME.total.toLowerCase() ? "total" : name === FN_NAME.exists.toLowerCase() ? "exists" : null;
    if (!fn) throw new Error(`unknown function ${lhs.name}`);
    const f = fnField(fields, fn);
    if (!f) throw new Error(`function ${fn} not available here`);
    // inner must be a single sub-condition
    const innerRoot = astToGroup(lhs.inner, subFields, subFields);
    const flat = flattenSingle(innerRoot);
    if (!flat) throw new Error("function sub-condition must be a single condition");
    if (fn === "exists") {
      const c = newCond(f.id, "is defined");
      c.sub = flat;
      return c;
    }
    const c = buildCond(f, op, values, subFields);
    c.sub = flat;
    return c;
  }
  const f = byPath(fields).get(lhs.path);
  if (!f) throw new Error(`unknown field ${lhs.path}`);
  return buildCond(f, op, values, subFields);
}

/** Return the single Cond of a group that holds exactly one leaf condition. */
function flattenSingle(g: Group): Cond | null {
  if (g.negate) return null;
  if (g.children.length !== 1) return null;
  const only = g.children[0];
  if (only.kind === "cond") return only;
  return flattenSingle(only);
}

function astToNode(a: Ast, fields: FieldDef[], subFields: FieldDef[]): Node {
  if (a.t === "cmp") return cmpToCond(a, fields, subFields);
  const g = newGroup(a.join);
  g.negate = a.negate;
  g.children = a.items.map((it) => astToNode(it, fields, subFields));
  return g;
}

function astToGroup(a: Ast, fields: FieldDef[], subFields: FieldDef[]): Group {
  const node = astToNode(a, fields, subFields);
  if (node.kind === "group") return node;
  const g = newGroup("and");
  g.children = [node];
  return g;
}

const normalize = (s: string) =>
  s
    .replace(/!=/g, "<>")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

export type ParseResult = { root: Group; raw: false } | { root: null; raw: true };

/**
 * Parse a predicate for the visual builder. Returns a model root only when it
 * round-trips exactly; otherwise signals raw mode.
 */
export function parsePredicate(input: string, fields: FieldDef[], subFields: FieldDef[]): ParseResult {
  const src = (input ?? "").trim();
  if (src === "" || src === "1 = 1" || src === "1=1") return { root: emptyRoot(), raw: false };
  try {
    const ast = new Parser(tokenize(src)).parse();
    const root = astToGroup(ast, fields, subFields);
    const resolve: Resolve = (id) => fields.find((f) => f.id === id) ?? subFields.find((f) => f.id === id);
    const out = serializePredicate(root, resolve);
    if (normalize(out) === normalize(src)) return { root, raw: false };
    return { root: null, raw: true };
  } catch {
    return { root: null, raw: true };
  }
}
