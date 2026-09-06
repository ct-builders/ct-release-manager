/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import PageHeader from "@/components/console/PageHeader";
import CreateReleaseForm from "@/components/releases/CreateReleaseForm";
import { service } from "@/lib/service";
import type { CatalogMembers } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewReleasePage() {
  let catalog: CatalogMembers | null = null;
  try {
    catalog = await service.catalogMembers();
  } catch {
    /* catalog unavailable */
  }

  return (
    <>
      <PageHeader
        title="New release"
        description="Name it, then add the products, categories, and promotions to ship together."
      />
      <CreateReleaseForm catalog={catalog} />
    </>
  );
}
