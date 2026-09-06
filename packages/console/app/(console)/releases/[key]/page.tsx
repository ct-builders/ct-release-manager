/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { getSession } from "@/lib/auth";
import { service } from "@/lib/service";
import { resolveActor } from "@/lib/acl";
import { getProductDisplay, type ProductDisplay } from "@/lib/catalog";
import ReleaseDetail from "@/components/releases/ReleaseDetail";
import type { Release, Actor, CatalogMembers, MergeResult } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReleaseDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const session = await getSession();

  let release: Release | null = null;
  let actor: Actor | null = null;
  let catalog: CatalogMembers | null = null;
  try {
    release = (await service.getRelease(decoded)).release;
  } catch {
    /* not found */
  }
  try {
    actor = await resolveActor(session?.email ?? "");
  } catch {
    /* fall open */
  }
  try {
    catalog = await service.catalogMembers();
  } catch {
    /* editing members disabled */
  }

  let productDisplay: Record<string, ProductDisplay> = {};
  if (release) {
    productDisplay = await getProductDisplay(release.members?.products ?? [], release.branchId);
  }

  // Merge-to-main preview: the per-field three-way report of the release's working-copy
  // edits vs the trunk. Only meaningful once the release has its own branch; powers the
  // merge panel + the "merge before ship" gate. Falls open (null) if the service errors.
  let mergePreview: MergeResult | null = null;
  if (release && release.branchId && release.branchId !== "main") {
    try {
      mergePreview = await service.mergePreview(decoded);
    } catch {
      /* merge preview unavailable — ship gate falls open */
    }
  }

  if (!release) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-critical">
          Release &ldquo;{decoded}&rdquo; not found.
        </div>
      </div>
    );
  }

  return (
    <ReleaseDetail
      release={release}
      actor={actor}
      catalog={catalog}
      merge={mergePreview}
      productDisplay={productDisplay}
    />
  );
}
