/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import PageHeader from "@/components/console/PageHeader";
import CategoryTree from "@/components/categories/CategoryTree";
import CreateCategoryWizard from "@/components/categories/CreateCategoryWizard";
import { listCategoryTree } from "@/lib/categories";
import { getActiveReleaseKey } from "@/lib/auth";
import { service } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const nodes = await listCategoryTree();

  let memberKeys: string[] = [];
  const rk = await getActiveReleaseKey();
  if (rk) {
    try {
      memberKeys = (await service.getRelease(rk)).release.members?.categories ?? [];
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <PageHeader title="Categories" description="Browse the catalog structure and open a category to edit it in the release you're working on." />
      <div className="p-6">
        <div className="mb-3 flex justify-end">
          <CreateCategoryWizard nodes={nodes} hasActiveRelease={!!rk} />
        </div>
        <CategoryTree nodes={nodes} memberKeys={memberKeys} />
      </div>
    </>
  );
}
