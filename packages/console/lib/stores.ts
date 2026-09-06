/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import type { LocalizedString } from "./types";
import { LOCALE } from "./config";

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0]) : undefined);

export type StoreOption = { key: string; name: string };

type RawStore = {
  key: string;
  name?: LocalizedString;
  productSelections?: { active?: boolean; productSelection: { id: string } }[];
};

export async function listStores(): Promise<StoreOption[]> {
  try {
    const r = await ct.get<Paged<RawStore>>(`/stores?limit=100`);
    return r.results
      .filter((s) => s.key)
      .map((s) => ({ key: s.key, name: loc(s.name) || s.key }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Which products are available in a store, per its product selections.
 * - No active product selections → the store carries the whole catalog (`all: true`).
 * - Otherwise a product is available if it belongs to one of the active selections.
 * Returns available product KEYS (best-effort).
 */
export type StoreAvailability = { all: boolean; keys: string[] };

export async function storeAvailability(storeKey: string): Promise<StoreAvailability> {
  const store = await ct.get<RawStore>(`/stores/key=${ct.enc(storeKey)}`);
  const active = (store.productSelections ?? []).filter((ps) => ps.active !== false);
  if (!active.length) return { all: true, keys: [] };
  const keys = new Set<string>();
  for (const ps of active) {
    const id = ps.productSelection.id;
    let offset = 0;
    // "assignments" of products to this selection; product refs expanded for the key
    while (true) {
      const r = await ct.get<Paged<{ product: { id: string; obj?: { key?: string } } }>>(
        `/product-selections/${id}/products?limit=100&offset=${offset}&expand=product`
      );
      for (const a of r.results) {
        const k = a.product?.obj?.key;
        if (k) keys.add(k);
      }
      offset += 100;
      if (offset >= r.total || !r.results.length) break;
    }
  }
  return { all: false, keys: [...keys] };
}
