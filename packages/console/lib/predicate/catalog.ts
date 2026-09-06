/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Client-safe field catalogs for the predicate builder. Static base fields are
// defined here; the product-attribute and custom-field fields are loaded LIVE
// from the authoring project (see catalog.server.ts) and merged in via a
// DynamicCatalog passed down from the server component.

import type { FieldDef, PredContext } from "./model";
import { CURRENCIES as CONFIGURED_CURRENCIES, COUNTRIES as CONFIGURED_COUNTRIES } from "../config";

// Product-attribute + custom-field definitions fetched live from the project.
// Plain data so it can cross the server → client boundary.
export type DynamicCatalog = {
  productAttributes: FieldDef[]; // attributes.* (union across product types)
  cartCustom: FieldDef[]; // custom.* for carts (resourceTypeId "order")
  lineItemCustom: FieldDef[]; // custom.* for line items
  customLineItemCustom: FieldDef[]; // custom.* for custom line items
  customerGroups: { value: string; label: string }[]; // keyed customer groups (for the Business-unit group picker)
};

export const EMPTY_DYNAMIC: DynamicCatalog = {
  productAttributes: [],
  cartCustom: [],
  lineItemCustom: [],
  customLineItemCustom: [],
  customerGroups: [],
};

export const CURRENCIES = CONFIGURED_CURRENCIES;
export const COUNTRIES = CONFIGURED_COUNTRIES;

// ---- static base fields per context ----

const CART_BASE: FieldDef[] = [
  { id: "totalPrice", path: "totalPrice", label: "Cart total", group: "Cart", value: "money" },
  { id: "currency", path: "currency", label: "Currency", group: "Cart", value: "string", input: "currency" },
  { id: "country", path: "country", label: "Country", group: "Cart", value: "string", input: "country" },
  { id: "customerGroup", path: "customer.customerGroup.key", label: "Customer group (key)", group: "Customer", value: "string" },
  { id: "customerId", path: "customer.id", label: "Customer ID", group: "Customer", value: "string" },
  { id: "lineItemCount", path: "", label: "Count of matching line items", group: "Line items", value: "number", fn: "count", hint: "Number of line items matching a rule" },
  { id: "lineItemTotal", path: "", label: "Total of matching line items", group: "Line items", value: "money", fn: "total", hint: "Summed price of line items matching a rule" },
  { id: "lineItemExists", path: "", label: "Cart contains a line item matching…", group: "Line items", value: "string", fn: "exists" },
];

const LINE_ITEM_BASE: FieldDef[] = [
  { id: "categories.key", path: "categories.key", label: "Category (direct)", group: "Category", value: "string", collection: true, input: "category" },
  { id: "categoriesWithAncestors.key", path: "categoriesWithAncestors.key", label: "Category (incl. subcategories)", group: "Category", value: "string", collection: true, input: "category" },
  { id: "sku", path: "sku", label: "SKU", group: "Product", value: "string" },
  { id: "product.key", path: "product.key", label: "Product (key)", group: "Product", value: "string" },
  { id: "productType.key", path: "productType.key", label: "Product type (key)", group: "Product", value: "string" },
  { id: "quantity", path: "quantity", label: "Quantity", group: "Line item", value: "number" },
];

const PRODUCT_BASE: FieldDef[] = [
  { id: "categories.key", path: "categories.key", label: "Category (direct)", group: "Category", value: "string", collection: true, input: "category" },
  { id: "categoriesWithAncestors.key", path: "categoriesWithAncestors.key", label: "Category (incl. subcategories)", group: "Category", value: "string", collection: true, input: "category" },
  { id: "productType.key", path: "productType.key", label: "Product type (key)", group: "Product", value: "string" },
];

const CUSTOM_LINE_ITEM_BASE: FieldDef[] = [
  { id: "slug", path: "slug", label: "Slug", group: "Custom line item", value: "string" },
  { id: "money", path: "money", label: "Unit price", group: "Custom line item", value: "money" },
  { id: "quantity", path: "quantity", label: "Quantity", group: "Custom line item", value: "number" },
];

/**
 * Buyer's Business Unit customer-group assignments — e.g. fleet accounts.
 * A collection field (`contains`) so it round-trips predicates like
 * `businessUnit.customerGroupAssignments.customerGroup.key contains "fleet"`.
 * Rendered as a dropdown of real customer groups when they're loaded live.
 */
function businessUnitGroupField(dyn: DynamicCatalog): FieldDef {
  const groups = dyn.customerGroups ?? [];
  const hasGroups = groups.length > 0;
  return {
    id: "businessUnitCustomerGroup",
    path: "businessUnit.customerGroupAssignments.customerGroup.key",
    label: "Business unit customer group",
    group: "Business unit",
    value: "string",
    collection: true,
    input: hasGroups ? "enum" : undefined,
    enumValues: hasGroups ? groups : undefined,
    hint: "The buyer's Business Unit is assigned this customer group (e.g. fleet accounts)",
  };
}

/** All fields for a context, static base + live dynamic fields merged. */
export function buildFields(context: PredContext, dyn: DynamicCatalog = EMPTY_DYNAMIC): FieldDef[] {
  switch (context) {
    case "cart":
      return [...CART_BASE, businessUnitGroupField(dyn), ...dyn.cartCustom];
    case "lineItem":
      return [...LINE_ITEM_BASE, ...dyn.productAttributes, ...dyn.lineItemCustom];
    case "product":
      return [...PRODUCT_BASE, ...dyn.productAttributes];
    case "customLineItem":
      return [...CUSTOM_LINE_ITEM_BASE, ...dyn.customLineItemCustom];
    default:
      return [];
  }
}

/** The context a cart-function's nested sub-condition is authored in. */
export const SUB_CONTEXT: PredContext = "lineItem";

export function fieldById(fields: FieldDef[], id: string): FieldDef | undefined {
  return fields.find((f) => f.id === id);
}

/** Group fields by their `group` for a sectioned picker, preserving order. */
export function groupFields(fields: FieldDef[]): { group: string; fields: FieldDef[] }[] {
  const out: { group: string; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    let g = out.find((x) => x.group === f.group);
    if (!g) {
      g = { group: f.group, fields: [] };
      out.push(g);
    }
    g.fields.push(f);
  }
  return out;
}
