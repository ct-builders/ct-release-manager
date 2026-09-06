/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getActiveReleaseKey } from "@/lib/auth";
import { service } from "@/lib/service";
import { listFacetValues, listCartDiscountRefs, DISCOUNT_TABS, type DiscountKind, type DiscountEdit, type CartDiscountRef } from "@/lib/discounts";
import { listCategoryOptions } from "@/lib/categories";
import { loadDynamicCatalog } from "@/lib/predicate/catalog.server";
import { listDiscountGroupOptions, type DiscountGroupOption } from "@/lib/discount-groups";
import { emptyCartModel, emptyCodeDetail, emptyProductModel } from "@/lib/discount-model";
import DiscountEditor from "@/components/discounts/DiscountEditor";

export const dynamic = "force-dynamic";

export default async function NewDiscountPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const kind = (DISCOUNT_TABS.some((t) => t.key === type) ? type : "cart-discount") as DiscountKind;
  const isCodeKind = kind === "discount-code";

  const releaseKey = await getActiveReleaseKey();
  let releaseTitle: string | undefined;
  if (releaseKey) {
    try {
      const rel = (await service.getRelease(releaseKey)).release;
      releaseTitle = rel.title || rel.key;
    } catch {
      /* ignore */
    }
  }

  const [categories, facetValues, dynamic, cartRefs, discountGroups] = await Promise.all([
    listCategoryOptions(),
    listFacetValues(),
    loadDynamicCatalog(),
    isCodeKind ? listCartDiscountRefs() : Promise.resolve([] as CartDiscountRef[]),
    kind === "cart-discount" ? listDiscountGroupOptions() : Promise.resolve([] as DiscountGroupOption[]),
  ]);

  const emptyDiscount: DiscountEdit = {
    kind,
    version: 0,
    key: "",
    code: "",
    name: "",
    description: "",
    isActive: true,
    sortOrder: "",
    validFrom: "",
    validUntil: "",
    stackingMode: "Stacking",
    requiresDiscountCode: false,
    cart: kind === "cart-discount" ? emptyCartModel() : undefined,
    product: kind === "product-discount" ? emptyProductModel() : undefined,
    codeDetail: isCodeKind ? emptyCodeDetail() : undefined,
  };

  const label = (DISCOUNT_TABS.find((t) => t.key === kind)?.label ?? "Discount").replace(/s$/, "");

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <Link href={`/discounts?type=${kind}`} className="inline-block text-sm text-accent hover:underline">← All discounts</Link>
      <h1 className="text-xl font-semibold">New {label.toLowerCase()}</h1>
      <DiscountEditor
        canonicalKey=""
        discount={emptyDiscount}
        categories={categories}
        facetValues={facetValues}
        dynamic={dynamic}
        cartRefs={cartRefs}
        discountGroups={discountGroups}
        releaseActive={!!releaseKey}
        releaseTitle={releaseTitle}
        forked={false}
        versions={[]}
        markedForDeletion={false}
        mode="create"
      />
    </div>
  );
}
