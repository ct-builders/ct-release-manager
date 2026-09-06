/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getActiveReleaseKey } from "@/lib/auth";
import { service } from "@/lib/service";
import { encodeKey, isMain } from "@/lib/branch";
import { getDiscountEdit, discountWorkingCopyExists, listFacetValues, listCartDiscountRefs, DISCOUNT_TABS, type DiscountKind, type CartDiscountRef } from "@/lib/discounts";
import { listCategoryOptions } from "@/lib/categories";
import { loadLayoutData } from "@/lib/discount-layout";
import type { OrderableKind } from "@/lib/discount-layout-types";
import { loadDynamicCatalog } from "@/lib/predicate/catalog.server";
import { listDiscountGroupOptions, type DiscountGroupOption } from "@/lib/discount-groups";
import DiscountEditor from "@/components/discounts/DiscountEditor";

export const dynamic = "force-dynamic";

export default async function DiscountDetailPage({ params }: { params: Promise<{ type: string; key: string }> }) {
  const { type, key } = await params;
  const kind = (DISCOUNT_TABS.some((t) => t.key === type) ? type : "cart-discount") as DiscountKind;
  const canonicalKey = decodeURIComponent(key);

  const DEL_FIELD = { "cart-discount": "cartDiscounts", "product-discount": "productDiscounts", "discount-code": "discountCodes" } as const;
  const releaseKey = await getActiveReleaseKey();
  let releaseTitle: string | undefined;
  let branchId: string | undefined;
  let markedForDeletion = false;
  if (releaseKey) {
    try {
      const rel = (await service.getRelease(releaseKey)).release;
      releaseTitle = rel.title || rel.key;
      branchId = rel.branchId;
      markedForDeletion = (rel.deletions?.[DEL_FIELD[kind]] ?? []).includes(canonicalKey);
    } catch {
      /* ignore */
    }
  }

  // Resolve the working copy: edit the branch HEAD when this discount is forked onto the
  // release's branch, otherwise edit live. The branch registry is a hint, NOT the source
  // of truth — it can retain an *orphaned* asset entry (e.g. version 0) for a fork whose
  // working copy was never actually created (fork registration succeeded but the working-copy
  // resource creation failed/rolled back). So the physical HEAD is the only reliable signal:
  // treat the discount as forked iff the encoded working copy actually exists. This avoids
  // pointing getDiscountEdit at a non-existent HEAD (which used to render "not found") while
  // never silently dropping onto the LIVE discount — discountWorkingCopyExists returns false
  // only on a definitive 404 and stays true on any transient error.
  let forked = false;
  let displayKey = canonicalKey;
  let versions: { version: number; at: string }[] = [];
  if (releaseKey && branchId && !isMain(branchId)) {
    const encoded = encodeKey(canonicalKey, branchId);
    forked = await discountWorkingCopyExists(encoded, kind);
    if (forked) {
      displayKey = encoded;
      try {
        versions = (await service.listVersions(branchId, canonicalKey)).versions ?? [];
      } catch {
        /* version history is best-effort */
      }
    }
  }

  const isCodeKind = kind === "discount-code";
  const isCartKind = kind === "cart-discount";
  const [discount, categories, facetValues, layout, dynamic, cartRefs, discountGroups] = await Promise.all([
    getDiscountEdit(displayKey, kind),
    listCategoryOptions(),
    listFacetValues(),
    isCodeKind ? Promise.resolve(null) : loadLayoutData(kind as OrderableKind),
    loadDynamicCatalog(),
    isCodeKind ? listCartDiscountRefs() : Promise.resolve([] as CartDiscountRef[]),
    isCartKind ? listDiscountGroupOptions() : Promise.resolve([] as DiscountGroupOption[]),
  ]);

  // this discount's current priority (global rank within the flattened group order)
  let rank = 0, total = 0, groupName = "";
  if (layout) {
    total = layout.discounts.length;
    let i = 0;
    for (const g of layout.groups) for (const k of g.items) { i++; if (k === canonicalKey) { rank = i; groupName = g.name; } }
  }
  if (!discount) {
    return (
      <div className="p-6">
        <Link href={`/discounts?type=${kind}`} className="mb-3 inline-block text-sm text-accent hover:underline">← All discounts</Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-critical">Discount “{canonicalKey}” not found.</div>
      </div>
    );
  }

  // ranking control shown inside the editor's "Stacking & ranking" group (cart/product only)
  // Pass plain data only; the client editor renders <PriorityManager> itself. Passing a
  // client-component element across the server→client boundary as a prop makes React warn
  // about unkeyed children.
  const showRanking = !!layout && !markedForDeletion;
  const rankInfo = showRanking ? { rank, total, groupName } : undefined;

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <Link href={`/discounts?type=${kind}`} className="inline-block text-sm text-accent hover:underline">← All discounts</Link>
      <div>
        <h1 className="text-xl font-semibold">{discount.name || discount.code}</h1>
        <p className="font-mono text-xs text-muted">{canonicalKey}</p>
      </div>

      <DiscountEditor
        canonicalKey={canonicalKey}
        discount={discount}
        categories={categories}
        facetValues={facetValues}
        dynamic={dynamic}
        cartRefs={cartRefs}
        discountGroups={discountGroups}
        releaseActive={!!releaseKey}
        releaseTitle={releaseTitle}
        forked={forked}
        versions={versions}
        markedForDeletion={markedForDeletion}
        rankInfo={rankInfo}
        layout={showRanking ? layout! : undefined}
      />
    </div>
  );
}
