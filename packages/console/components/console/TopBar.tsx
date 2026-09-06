/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useRouter } from "next/navigation";
import ReleasePicker from "./ReleasePicker";

export default function TopBar({ email, roles }: { email: string; roles: string[] }) {
  const router = useRouter();
  const initial = email.charAt(0).toUpperCase();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <ReleasePicker />
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-xs font-medium leading-tight">{email}</p>
          <p className="text-[10px] leading-tight text-muted">
            {roles.length ? roles.join(", ") : "no role"}
          </p>
        </div>
        <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-fg">
          {initial}
        </span>
        <button
          onClick={logout}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-black/[.04]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
