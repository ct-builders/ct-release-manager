/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getActiveReleaseKey, getSession } from "@/lib/auth";
import { service } from "@/lib/service";
import { resolveActor } from "@/lib/acl";
import { encodeKey, isMain } from "@/lib/branch";
import { getEditProduct, workingCopyExists } from "@/lib/product-edit";
import { getCanonicalPublishState } from "@/lib/products";
import { getPriceRefs } from "@/lib/pricing";
import { listCategoryTree } from "@/lib/categories";
import { getColumnPref } from "@/lib/user-prefs";
import { EMPTY_PREF } from "@/lib/columns";
import ProductEditor from "@/components/products/ProductEditor";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ key: string }> }) {
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

  // Resolve the working copy: edit the branch HEAD when this product is forked onto
  // the release's branch, otherwise edit live. The branch registry is a hint, NOT
  // the source of truth — it can be wrong in both directions: its per-fork writes race
  // and can drop an asset entry for a live fork (leaving a HEAD live but unregistered),
  // and it can retain an *orphaned* entry (e.g. version 0) for a fork whose working copy
  // was never created or was removed. So the physical HEAD is the only reliable signal:
  // treat the product as forked iff the encoded working copy actually exists. This both
  // catches unregistered forks (so we never silently edit LIVE) and avoids pointing at a
  // non-existent HEAD (which used to render "not found"). workingCopyExists returns false
  // only on a definitive 404 and stays true on any transient error, so a flaky CT call
  // never drops us onto the live product.
  let forked = false;
  let displayKey = canonicalKey;
  let versions: { version: number; at: string }[] = [];
  if (releaseKey && branchId && !isMain(branchId)) {
    const encoded = encodeKey(canonicalKey, branchId);
    forked = await workingCopyExists(encoded);
    if (forked) {
      displayKey = encoded;
      try {
        versions = (await service.listVersions(branchId, canonicalKey)).versions ?? [];
      } catch {
        /* version history is best-effort */
      }
    }
  }

  // Admin availability control operates on the CANONICAL product (stage + live), so read
  // its published state by canonical key — not the working-copy `displayKey`. Gated to admins.
  const session = await getSession();
  const [product, priceRefs, categoryNodes, actor, publishState] = await Promise.all([
    getEditProduct(displayKey),
    getPriceRefs(),
    listCategoryTree().catch(() => []),
    resolveActor(session?.email ?? "").catch(() => null),
    getCanonicalPublishState(canonicalKey),
  ]);
  if (!product) {
    return (
      <div className="p-6">
        <Link href="/products" className="mb-3 inline-block text-sm text-accent hover:underline">← All products</Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-critical">Product “{canonicalKey}” not found.</div>
      </div>
    );
  }

  const hero = product.variants[0]?.images[0]?.url;
  const pricesColumnPref = (session?.email ? await getColumnPref(session.email, "price-editor").catch(() => null) : null) ?? EMPTY_PREF;

  return (
    <div className="max-w-[1400px] space-y-4 p-6">
      <Link href="/products" className="inline-block text-sm text-accent hover:underline">← All products</Link>

      <div className="flex items-center gap-4">
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt="" className="size-16 rounded-lg object-contain bg-black/[.03]" />
        ) : (
          <span className="grid size-16 place-items-center rounded-lg bg-black/[.04] text-xs text-muted">—</span>
        )}
        <div>
          <h1 className="text-xl font-semibold">{product.name}</h1>
          <p className="font-mono text-xs text-muted">{canonicalKey}</p>
        </div>
      </div>

      <ProductEditor
        canonicalKey={canonicalKey}
        product={product}
        priceRefs={priceRefs}
        categoryNodes={categoryNodes}
        releaseActive={!!releaseKey}
        releaseTitle={releaseTitle}
        forked={forked}
        versions={versions}
        canAdmin={!!actor?.can.admin}
        publishState={publishState}
        pricesColumnPref={pricesColumnPref}
      />
    </div>
  );
}
