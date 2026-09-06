/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getActiveReleaseKey } from "@/lib/auth";
import { listDiscountGroups } from "@/lib/discount-groups";
import DiscountGroupsManager from "@/components/discounts/DiscountGroupsManager";

export const dynamic = "force-dynamic";

export default async function DiscountGroupsPage() {
  const [groups, releaseKey] = await Promise.all([listDiscountGroups(), getActiveReleaseKey()]);
  return (
    <div className="max-w-4xl space-y-4 p-6">
      <Link href="/discounts?type=cart-discount" className="inline-block text-sm text-accent hover:underline">← All discounts</Link>
      <h1 className="text-xl font-semibold">Discount groups</h1>
      <DiscountGroupsManager groups={groups} releaseActive={!!releaseKey} />
    </div>
  );
}
