/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { getSession } from "@/lib/auth";
import { listAcl, resolveActor } from "@/lib/acl";
import PageHeader from "@/components/console/PageHeader";
import PermissionsTable from "@/components/acl/PermissionsTable";
import type { AclEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const session = await getSession();
  const email = session?.email ?? "";
  const actor = await resolveActor(email);

  return (
    <>
      <PageHeader title="Permissions" description="Who may use this console, and what each person can do." />
      {!actor.can.admin ? (
        <div className="p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-critical">
            You need the admin role to manage permissions.
          </div>
        </div>
      ) : (
        <PermissionsTable entries={await safeList()} me={email} bootstrap={actor.bootstrap} />
      )}
    </>
  );
}

async function safeList(): Promise<AclEntry[]> {
  try {
    return await listAcl();
  } catch {
    return [];
  }
}
