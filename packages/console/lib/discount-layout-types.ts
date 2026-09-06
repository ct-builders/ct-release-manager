/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Client-safe shared types for the discount priority manager. No server-only.

export type OrderableKind = "cart-discount" | "product-discount";

/** A named bucket of discounts. `items` = ordered discount keys (top = highest priority). */
export type DiscountGroup = { id: string; name: string; items: string[] };

export type OrderableDiscount = { key: string; name: string; summary: string; isActive: boolean };

export type LayoutData = {
  kind: OrderableKind;
  groups: DiscountGroup[];
  discounts: OrderableDiscount[];
  updatedAt?: string;
  by?: string;
};
