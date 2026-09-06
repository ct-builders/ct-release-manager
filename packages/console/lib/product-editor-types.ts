/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Client-safe shared types for the rich product editor. */

export type AttrDef = {
  name: string;
  label: string;
  /** commercetools attribute type name: text, ltext, number, boolean, enum, lenum, money, reference, date, set */
  type: string;
  /** for set attributes, the element type name */
  elementType?: string;
  isRequired: boolean;
  /** commercetools attribute constraint: None | Unique | CombinationUnique | SameForAll */
  constraint?: string;
  /** enum/lenum options */
  values?: { key: string; label: string }[];
};

export type EditPrice = {
  id?: string;
  currencyCode: string;
  centAmount: number;
  /** price constraints — when this price applies */
  country?: string;
  customerGroupId?: string;
  channelId?: string;
  validFrom?: string; // ISO
  validUntil?: string; // ISO
};
/** option lists for price-constraint selectors */
export type PriceRefs = { customerGroups: { id: string; name: string }[]; channels: { id: string; name: string }[] };
export type EditImage = { url: string; label?: string; w?: number; h?: number };
export type EditVariant = {
  id: number;
  sku?: string;
  key?: string;
  prices: EditPrice[];
  images: EditImage[];
  attributes: { name: string; value: unknown }[];
};

export type EditProduct = {
  version: number;
  name: string;
  slug: string;
  description: string;
  key?: string;
  masterVariantId: number;
  variants: EditVariant[]; // includes the master variant first
  attrDefs: AttrDef[];
  /** ids of the categories this product belongs to */
  categories: string[];
  /** working-copy live/offline state (native published) — what this release will deploy */
  published: boolean;
};

/** commercetools product update action (loosely typed; server whitelists the action name). */
export type CtAction = { action: string; [k: string]: unknown };
