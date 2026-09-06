/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct, type Paged } from "./ct";
import type { LocalizedString } from "./types";
import { LOCALE } from "./config";

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0] ?? "") : "");

type RawCategory = {
  id: string;
  key?: string;
  version?: number;
  name: LocalizedString;
  slug?: LocalizedString;
  description?: LocalizedString;
  metaTitle?: LocalizedString;
  metaDescription?: LocalizedString;
  metaKeywords?: LocalizedString;
  orderHint?: string;
  parent?: { id: string };
  ancestors?: { id: string }[];
};

export type CategoryRow = { id: string; key?: string; name: string; parentName?: string; childless: boolean };
/** A node for the client-side category tree. */
export type CategoryNode = { id: string; key?: string; name: string; parentId: string; orderHint: string; hasChildren: boolean };
/** A key'd category, for pickers (discount targets reference categories by key). */
export type CategoryOption = { key: string; name: string; path: string };
export type CategoryEdit = {
  version: number;
  id: string;
  key?: string;
  name: string;
  slug: string;
  description: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  orderHint: string;
  parentId: string;
};

async function fetchAll(): Promise<RawCategory[]> {
  const r = await ct
    .get<Paged<RawCategory>>(`/categories?limit=400&sort=${encodeURIComponent("orderHint asc")}`)
    .catch(() => ({ results: [] as RawCategory[] } as Paged<RawCategory>));
  return r.results;
}

export async function listCategories(q?: string): Promise<{ rows: CategoryRow[]; options: { id: string; name: string }[] }> {
  const results = await fetchAll();
  const nameById = Object.fromEntries(results.map((c) => [c.id, loc(c.name)]));
  const hasChildren = new Set(results.map((c) => c.parent?.id).filter(Boolean) as string[]);
  let rows: CategoryRow[] = results.map((c) => ({
    id: c.id,
    key: c.key,
    name: loc(c.name),
    parentName: c.parent ? nameById[c.parent.id] : undefined,
    childless: !hasChildren.has(c.id),
  }));
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter((c) => c.name.toLowerCase().includes(s) || (c.key ?? "").toLowerCase().includes(s));
  }
  const options = results.map((c) => ({ id: c.id, name: loc(c.name) })).sort((a, b) => a.name.localeCompare(b.name));
  return { rows, options };
}

/** Full category set as flat nodes; the client assembles the tree. */
export async function listCategoryTree(): Promise<CategoryNode[]> {
  const results = await fetchAll();
  const hasChildren = new Set(results.map((c) => c.parent?.id).filter(Boolean) as string[]);
  return results.map((c) => ({
    id: c.id,
    key: c.key,
    name: loc(c.name),
    parentId: c.parent?.id ?? "",
    orderHint: c.orderHint ?? "",
    hasChildren: hasChildren.has(c.id),
  }));
}

/** Key'd categories with a human "Parent › Child" path, for the discount target picker. */
export async function listCategoryOptions(): Promise<CategoryOption[]> {
  const results = await fetchAll();
  const nameById = Object.fromEntries(results.map((c) => [c.id, loc(c.name)]));
  const parentById = Object.fromEntries(results.map((c) => [c.id, c.parent?.id]));
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      parts.unshift(nameById[cur] ?? cur);
      cur = parentById[cur];
    }
    return parts.join(" › ");
  };
  return results
    .filter((c) => c.key)
    .map((c) => ({ key: c.key as string, name: loc(c.name), path: pathOf(c.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function getCategoryEdit(displayKey: string): Promise<CategoryEdit | null> {
  try {
    const c = await ct.get<RawCategory>(`/categories/key=${ct.enc(displayKey)}`);
    return {
      version: c.version ?? 0,
      id: c.id,
      key: c.key,
      name: loc(c.name),
      slug: loc(c.slug),
      description: loc(c.description),
      metaTitle: loc(c.metaTitle),
      metaDescription: loc(c.metaDescription),
      metaKeywords: loc(c.metaKeywords),
      orderHint: c.orderHint ?? "",
      parentId: c.parent?.id ?? "",
    };
  } catch {
    return null;
  }
}
