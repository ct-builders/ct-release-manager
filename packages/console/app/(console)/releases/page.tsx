/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import Link from "next/link";
import { getSession } from "@/lib/auth";
import { service } from "@/lib/service";
import { resolveActor } from "@/lib/acl";
import PageHeader from "@/components/console/PageHeader";
import AutoAddBar from "@/components/releases/AutoAddBar";
import ReleasesTable from "@/components/releases/ReleasesTable";
import type { Release, AutoAddConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  const session = await getSession();
  const email = session?.email ?? "";

  let releases: Release[] = [];
  let config: AutoAddConfig | null = null;
  let canEdit = true;
  try {
    releases = (await service.listReleases()).releases ?? [];
  } catch {
    /* service unreachable */
  }
  try {
    config = (await service.getConfig()).config;
  } catch {
    /* config endpoint unavailable → bar hidden */
  }
  try {
    canEdit = (await resolveActor(email)).can.edit;
  } catch {
    /* fall open */
  }

  return (
    <>
      <PageHeader
        title="Releases"
        description="Bundle changes and ship them to live."
        actions={
          canEdit ? (
            <Link
              href="/releases/new"
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:opacity-90"
            >
              New release
            </Link>
          ) : null
        }
      />
      <div className="p-6">
        <AutoAddBar releases={releases} initialConfig={config} />
        <ReleasesTable releases={releases} />
      </div>
    </>
  );
}
