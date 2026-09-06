/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import PageHeader from "@/components/console/PageHeader";
import ProductFiltersBar, { FACET_PARAM } from "@/components/products/ProductFiltersBar";
import ProductImportExport from "@/components/products/ProductImportExport";
import CreateProductWizard from "@/components/products/CreateProductWizard";
import { listProducts, getCategoryOptions, getFacetOptions, getReleaseOverlay, type ProductRow } from "@/lib/products";
import { listCategoryTree } from "@/lib/categories";
import { SORTS, type SortKey } from "@/lib/product-constants";
import { getActiveReleaseKey, getSession } from "@/lib/auth";
import { getColumnPref } from "@/lib/user-prefs";
import { EMPTY_PREF } from "@/lib/columns";
import ProductsTable from "@/components/products/ProductsTable";
import { service } from "@/lib/service";

export const dynamic = "force-dynamic";
const PAGE = 24;

export default async function ProductsPage({
  searchParams,
}: {
  // the featured-attribute filter arrives under its own attribute name (FACET_PARAM), so this is open-keyed
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "name-asc") as SortKey;
  const category = sp.category ?? "";
  const facet = sp[FACET_PARAM] ?? "";
  const published = sp.published === "true" || sp.published === "false" ? sp.published : undefined;
  const inrelease = sp.inrelease === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE;

  // active release → membership badges + "in this release" key restriction
  let memberSet = new Set<string>();
  let branchId: string | undefined;
  const rk = await getActiveReleaseKey();
  if (rk) {
    try {
      const rel = (await service.getRelease(rk)).release;
      memberSet = new Set(rel.members?.products ?? []);
      branchId = rel.branchId;
    } catch {
      /* ignore */
    }
  }
  const keys = inrelease && rk ? [...memberSet] : undefined;

  const [{ results: rawResults, total }, categories, categoryNodes, facetValues] = await Promise.all([
    listProducts({ q, sort, category, facet, published, keys, limit: PAGE, offset }).catch(() => ({ results: [], total: 0 })),
    getCategoryOptions().catch(() => []),
    listCategoryTree().catch(() => []),
    getFacetOptions().catch(() => []),
  ]);

  // in-release version takes precedence: overlay the release working-copy data onto member rows
  const memberRowKeys = rawResults.map((p) => p.key).filter((k): k is string => !!k && memberSet.has(k));
  const overlay: Record<string, ProductRow> = memberRowKeys.length ? await getReleaseOverlay(memberRowKeys, branchId).catch(() => ({})) : {};
  const results = rawResults.map((p) => (p.key && overlay[p.key]) || p);

  const session = await getSession();
  const columnPref = (session?.email ? await getColumnPref(session.email, "products-list").catch(() => null) : null) ?? EMPTY_PREF;

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageQs = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort !== "name-asc") params.set("sort", sort);
    if (category) params.set("category", category);
    if (facet) params.set(FACET_PARAM, facet);
    if (published) params.set("published", published);
    if (inrelease) params.set("inrelease", "1");
    params.set("page", String(p));
    return `/products?${params.toString()}`;
  };

  return (
    <>
      <PageHeader title="Products" description="Browse the catalog and edit products in the release you're working on." />
      <div className="p-6">
        <ProductFiltersBar
          current={{ q, sort, category, facet, published, inrelease }}
          categories={categories}
          facetValues={facetValues}
          hasActiveRelease={!!rk}
        />

        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {total.toLocaleString()} product{total === 1 ? "" : "s"}
            {q ? ` matching “${q}”` : ""}
          </p>
          <div className="flex items-center gap-2">
            <ProductImportExport
              exportHref={`/api/products/export?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort !== "name-asc" ? { sort } : {}), ...(category ? { category } : {}), ...(facet ? { [FACET_PARAM]: facet } : {}) }).toString()}`}
              releaseActive={!!rk}
            />
            <CreateProductWizard categoryNodes={categoryNodes} />
          </div>
        </div>

        <ProductsTable rows={results} memberKeys={[...memberSet]} initialPref={columnPref} />

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link href={pageQs(page - 1)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-black/[.04]">← Prev</Link>}
              {page < pages && <Link href={pageQs(page + 1)} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-black/[.04]">Next →</Link>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
