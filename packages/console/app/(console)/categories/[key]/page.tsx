/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getActiveReleaseKey } from "@/lib/auth";
import { service } from "@/lib/service";
import { encodeKey, isMain } from "@/lib/branch";
import { getCategoryEdit, listCategories } from "@/lib/categories";
import { listCategoryProducts, getFacetOptions } from "@/lib/products";
import { listStores } from "@/lib/stores";
import CategoryEditor from "@/components/categories/CategoryEditor";
import CategoryProductsPanel from "@/components/categories/CategoryProductsPanel";

export const dynamic = "force-dynamic";

export default async function CategoryDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const canonicalKey = decodeURIComponent(key);

  const releaseKey = await getActiveReleaseKey();
  let releaseTitle: string | undefined;
  let branchId: string | undefined;
  if (releaseKey) {
    try {
      const rel = (await service.getRelease(releaseKey)).release;
      releaseTitle = rel.title || rel.key;
      branchId = rel.branchId;
    } catch {
      /* ignore */
    }
  }

  let forked = false;
  let displayKey = canonicalKey;
  let versions: { version: number; at: string }[] = [];
  if (releaseKey && branchId && !isMain(branchId)) {
    try {
      const branch = (await service.getBranch(branchId)).branch;
      if (branch.assets?.[canonicalKey]) {
        forked = true;
        displayKey = encodeKey(canonicalKey, branchId);
        versions = (await service.listVersions(branchId, canonicalKey)).versions ?? [];
      }
    } catch {
      /* ignore */
    }
  }

  const [category, { options }] = await Promise.all([getCategoryEdit(displayKey), listCategories()]);
  const [products, stores, facetValues] = category
    ? await Promise.all([
        listCategoryProducts(category.id, branchId).catch(() => ({ results: [], total: 0 })),
        listStores().catch(() => []),
        getFacetOptions().catch(() => []),
      ])
    : [{ results: [], total: 0 }, [], []];
  if (!category) {
    return (
      <div className="p-6">
        <Link href="/categories" className="mb-3 inline-block text-sm text-accent hover:underline">← All categories</Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-critical">Category “{canonicalKey}” not found.</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <Link href="/categories" className="inline-block text-sm text-accent hover:underline">← All categories</Link>
      <div>
        <h1 className="text-xl font-semibold">{category.name}</h1>
        <p className="font-mono text-xs text-muted">{canonicalKey}</p>
      </div>
      <CategoryEditor
        canonicalKey={canonicalKey}
        category={category}
        options={options}
        releaseActive={!!releaseKey}
        releaseTitle={releaseTitle}
        forked={forked}
        versions={versions}
      />
      <CategoryProductsPanel
        products={products.results}
        total={products.total}
        stores={stores}
        categoryId={category.id}
        categoryName={category.name}
        facetValues={facetValues}
        releaseActive={!!releaseKey}
      />
    </div>
  );
}
