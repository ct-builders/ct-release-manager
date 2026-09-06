/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import type { LocalizedString } from "./types";
import type { PriceRefs } from "./product-editor-types";
import { LOCALE } from "./config";

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0]) : undefined);

/** Option lists for the price-constraint selectors (customer groups + channels). Cached ~10 min. */
let cache: { at: number; refs: PriceRefs } | null = null;
export async function getPriceRefs(): Promise<PriceRefs> {
  if (cache && Date.now() - cache.at < 600_000) return cache.refs;
  const [groups, channels] = await Promise.all([
    ct.get<Paged<{ id: string; name: string; key?: string }>>(`/customer-groups?limit=200`).catch(() => ({ results: [] as { id: string; name: string; key?: string }[] })),
    ct.get<Paged<{ id: string; name?: LocalizedString; key?: string }>>(`/channels?limit=200`).catch(() => ({ results: [] as { id: string; name?: LocalizedString; key?: string }[] })),
  ]);
  const refs: PriceRefs = {
    customerGroups: groups.results.map((g) => ({ id: g.id, name: g.name || g.key || g.id })),
    channels: channels.results.map((c) => ({ id: c.id, name: loc(c.name) || c.key || c.id })),
  };
  cache = { at: Date.now(), refs };
  return refs;
}
