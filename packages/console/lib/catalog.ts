/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import { encodeKey, isMain } from "./branch";
import type { LocalizedString } from "./types";
import { LOCALE } from "./config";

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0]) : undefined);

export type ProductDisplay = {
  name?: string;
  image?: string;
  /** staging storefront PDP path segment: `<slug>/p/<sku>` (append to the store base URL) */
  pdp?: string;
};

type ProductRow = {
  key?: string;
  masterData: {
    current: {
      name: LocalizedString;
      slug?: LocalizedString;
      masterVariant: { sku?: string; images?: { url: string }[] };
    };
  };
};

/**
 * Resolve product keys → display name, thumbnail, and a staging PDP path, from the
 * authoring project. When `branchId` is a release branch, the release working copy
 * takes precedence over the live product (so the release's edits show through).
 * Best-effort: unknown keys are simply omitted.
 */
export async function getProductDisplay(keys: string[], branchId?: string): Promise<Record<string, ProductDisplay>> {
  const out: Record<string, ProductDisplay> = {};
  const unique = [...new Set(keys)].filter(Boolean);
  if (!unique.length) return out;

  const useRelease = !isMain(branchId);
  const wanted = useRelease ? [...unique, ...unique.map((k) => encodeKey(k, branchId))] : unique;
  const pred = `key in (${wanted.map((k) => JSON.stringify(k)).join(",")})`;
  try {
    const res = await ct.get<Paged<ProductRow>>(`/products?where=${encodeURIComponent(pred)}&limit=500`);
    const byKey = new Map(res.results.filter((p) => p.key).map((p) => [p.key!, p]));
    for (const canonical of unique) {
      const p = (useRelease ? byKey.get(encodeKey(canonical, branchId)) : undefined) ?? byKey.get(canonical);
      if (!p) continue;
      const cur = p.masterData.current;
      const slug = loc(cur.slug) || "product";
      const sku = cur.masterVariant?.sku;
      out[canonical] = {
        name: loc(cur.name),
        image: cur.masterVariant.images?.[0]?.url,
        pdp: sku ? `${encodeURIComponent(slug)}/p/${encodeURIComponent(sku)}` : undefined,
      };
    }
  } catch {
    /* best-effort — no names/thumbs on failure */
  }
  return out;
}
