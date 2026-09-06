/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "../ct";
import type { LocalizedString } from "../types";
import type { FieldDef, ValueKind } from "./model";
import type { DynamicCatalog } from "./catalog";
import { EMPTY_DYNAMIC } from "./catalog";
import { FACET_ATTRIBUTE } from "../config";
import { LOCALE } from "../config";

const loc = (l?: LocalizedString | string): string =>
  typeof l === "string" ? l : l ? l[LOCALE] ?? l["en"] ?? Object.values(l)[0] ?? "" : "";

// ---- commercetools type shapes (only the bits we read) ----
type CtType = {
  name: string;
  values?: { key: string; label: LocalizedString | string }[];
  elementType?: CtType;
  referenceTypeId?: string;
};
type AttrDef = { name: string; label?: LocalizedString; type: CtType };
type RawProductType = { key?: string; name?: string; attributes?: AttrDef[] };
type FieldDefinition = { name: string; label?: LocalizedString; required?: boolean; type: CtType };
type RawCustomType = { key?: string; resourceTypeIds?: string[]; fieldDefinitions?: FieldDefinition[] };

// Map a commercetools field/attribute type to our predicate value model.
function mapType(t: CtType | undefined): { value: ValueKind; collection: boolean; enumValues?: FieldDef["enumValues"]; refIdPath: boolean } {
  const name = t?.name;
  if (name === "Set" || name === "set") {
    const inner = mapType(t?.elementType);
    return { value: inner.value, collection: true, enumValues: inner.enumValues, refIdPath: inner.refIdPath };
  }
  switch (name) {
    case "Number":
    case "number":
      return { value: "number", collection: false, refIdPath: false };
    case "Money":
    case "money":
      return { value: "money", collection: false, refIdPath: false };
    case "Boolean":
    case "boolean":
      return { value: "boolean", collection: false, refIdPath: false };
    case "Date":
    case "date":
      return { value: "date", collection: false, refIdPath: false };
    case "DateTime":
    case "datetime":
      return { value: "datetime", collection: false, refIdPath: false };
    case "Enum":
    case "enum":
    case "LocalizedEnum":
    case "lenum": {
      const enumValues = (t?.values ?? []).map((v) => ({ value: v.key, label: `${loc(v.label) || v.key}` }));
      return { value: "string", collection: false, enumValues: enumValues.length ? enumValues : undefined, refIdPath: false };
    }
    case "Reference":
    case "reference":
      return { value: "string", collection: false, refIdPath: true };
    default:
      // text, ltext, time, and anything unknown → string
      return { value: "string", collection: false, refIdPath: false };
  }
}

/** Product-attribute fields (attributes.*), unioned across all product types. */
async function loadProductAttributes(): Promise<FieldDef[]> {
  const r = await ct
    .get<Paged<RawProductType>>(`/product-types?limit=200`)
    .catch(() => ({ results: [] as RawProductType[] } as Paged<RawProductType>));
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const pt of r.results) {
    for (const a of pt.attributes ?? []) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      const m = mapType(a.type);
      const label = loc(a.label) || a.name;
      out.push({
        id: `attributes.${a.name}`,
        path: m.refIdPath ? `attributes.${a.name}.id` : `attributes.${a.name}`,
        label,
        group: "Product attributes",
        value: m.value,
        collection: m.collection || undefined,
        input: a.name === FACET_ATTRIBUTE.name ? "facet" : m.enumValues ? "enum" : "plain",
        enumValues: m.enumValues,
        hint: m.refIdPath ? "reference — matched by id" : undefined,
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** custom.* fields for a given resourceTypeId, unioned across matching types. */
function customFieldsFor(types: RawCustomType[], resourceTypeId: string, groupLabel: string): FieldDef[] {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const t of types) {
    if (!(t.resourceTypeIds ?? []).includes(resourceTypeId)) continue;
    for (const f of t.fieldDefinitions ?? []) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      const m = mapType(f.type);
      const label = loc(f.label) || f.name;
      out.push({
        id: `custom.${f.name}`,
        path: m.refIdPath ? `custom.${f.name}.id` : `custom.${f.name}`,
        label,
        group: groupLabel,
        value: m.value,
        collection: m.collection || undefined,
        input: m.enumValues ? "enum" : "plain",
        enumValues: m.enumValues,
        hint: m.refIdPath ? "reference — matched by id" : undefined,
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

type RawCustomerGroup = { key?: string; name?: string };

/** Keyed customer groups (value = key, label = name) for the Business-unit group picker. */
async function loadCustomerGroups(): Promise<{ value: string; label: string }[]> {
  const r = await ct
    .get<Paged<RawCustomerGroup>>(`/customer-groups?limit=200`)
    .catch(() => ({ results: [] as RawCustomerGroup[] } as Paged<RawCustomerGroup>));
  return r.results
    .filter((g): g is RawCustomerGroup & { key: string } => !!g.key) // predicate matches by key
    .map((g) => ({ value: g.key, label: g.name || g.key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Live predicate catalog for the authoring project: product-type attributes, custom-field
 * definitions for carts (resourceTypeId "order"), line items, and custom line items,
 * plus keyed customer groups. Falls back to empty (base fields only) on any error.
 */
export async function loadDynamicCatalog(): Promise<DynamicCatalog> {
  try {
    const [productAttributes, typesPage, customerGroups] = await Promise.all([
      loadProductAttributes(),
      ct
        .get<Paged<RawCustomType>>(`/types?limit=200`)
        .catch(() => ({ results: [] as RawCustomType[] } as Paged<RawCustomType>)),
      loadCustomerGroups(),
    ]);
    const types = typesPage.results;
    return {
      productAttributes,
      cartCustom: customFieldsFor(types, "order", "Cart custom fields"),
      lineItemCustom: customFieldsFor(types, "line-item", "Line-item custom fields"),
      customLineItemCustom: customFieldsFor(types, "custom-line-item", "Custom-line-item custom fields"),
      customerGroups,
    };
  } catch {
    return EMPTY_DYNAMIC;
  }
}
