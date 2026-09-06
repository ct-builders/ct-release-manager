/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, getActiveReleaseKey } from "@/lib/auth";
import { service } from "@/lib/service";
import { resolveActor } from "@/lib/acl";
import { ReleaseProvider } from "@/lib/release-context";
import Sidebar from "@/components/console/Sidebar";
import TopBar from "@/components/console/TopBar";
import type { Release, Actor } from "@/lib/types";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const activeKey = await getActiveReleaseKey();
  const navCollapsed = (await cookies()).get("rm-nav-collapsed")?.value === "1";

  let releases: Release[] = [];
  let actor: Actor | null = null;
  try {
    releases = (await service.listReleases()).releases ?? [];
  } catch {
    /* service unreachable → empty picker, still renders */
  }
  try {
    actor = await resolveActor(session.email);
  } catch {
    /* ignore */
  }

  return (
    <ReleaseProvider releases={releases} activeKey={activeKey}>
      <div className="flex h-full">
        <Sidebar initialCollapsed={navCollapsed} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar email={session.email} roles={actor?.roles ?? []} />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </ReleaseProvider>
  );
}
