/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import type { LocalizedString } from "./types";
import { LOCALE } from "./config";

const loc = (l?: LocalizedString) => (l ? l[LOCALE] ?? l["en"] ?? Object.values(l)[0] ?? "" : "");

type RawGroup = {
  id: string;
  version?: number;
  key: string;
  name?: LocalizedString;
  description?: LocalizedString;
  sortOrder?: string;
  isActive?: boolean;
};

export type DiscountGroupRow = {
  key: string;
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
  memberCount: number; // cart discounts assigned to this group
};

export type DiscountGroupOption = { key: string; name: string };

/** All discount groups, with how many cart discounts belong to each. */
export async function listDiscountGroups(): Promise<DiscountGroupRow[]> {
  const [groupsPage, cdPage] = await Promise.all([
    ct.get<Paged<RawGroup>>(`/discount-groups?limit=200`).catch(() => ({ results: [] as RawGroup[] } as Paged<RawGroup>)),
    ct
      .get<Paged<{ discountGroup?: { id: string } }>>(`/cart-discounts?limit=500`)
      .catch(() => ({ results: [] as { discountGroup?: { id: string } }[] } as Paged<{ discountGroup?: { id: string } }>)),
  ]);
  const countById = new Map<string, number>();
  for (const cd of cdPage.results) if (cd.discountGroup?.id) countById.set(cd.discountGroup.id, (countById.get(cd.discountGroup.id) ?? 0) + 1);
  return groupsPage.results
    .map((g) => ({
      key: g.key,
      name: loc(g.name) || g.key,
      description: loc(g.description),
      sortOrder: g.sortOrder ?? "",
      isActive: !!g.isActive,
      memberCount: countById.get(g.id) ?? 0,
    }))
    .sort((a, b) => (b.sortOrder || "").localeCompare(a.sortOrder || ""));
}

/** Keyed discount groups for the cart-discount assignment picker. */
export async function listDiscountGroupOptions(): Promise<DiscountGroupOption[]> {
  const r = await ct.get<Paged<RawGroup>>(`/discount-groups?limit=200`).catch(() => ({ results: [] as RawGroup[] } as Paged<RawGroup>));
  return r.results.map((g) => ({ key: g.key, name: loc(g.name) || g.key })).sort((a, b) => a.name.localeCompare(b.name));
}
