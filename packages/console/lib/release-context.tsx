/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Release } from "./types";

type ReleaseContextValue = {
  releases: Release[];
  /** the release currently being worked on (or null = none selected) */
  active: Release | null;
  /** editable (draft) releases the user can author into */
  editable: Release[];
  setActive: (key: string | null) => void;
  pending: boolean;
};

const Ctx = createContext<ReleaseContextValue | null>(null);

export function ReleaseProvider({
  releases,
  activeKey,
  children,
}: {
  releases: Release[];
  activeKey: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticKey, setOptimisticKey] = useState<string | null>(activeKey);

  const active = releases.find((r) => r.key === optimisticKey) ?? null;
  const editable = releases.filter((r) => r.status === "draft");

  const setActive = (key: string | null) => {
    setOptimisticKey(key);
    startTransition(async () => {
      await fetch("/api/active-release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      router.refresh();
    });
  };

  return (
    <Ctx.Provider value={{ releases, active, editable, setActive, pending }}>
      {children}
    </Ctx.Provider>
  );
}

export function useReleases(): ReleaseContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReleases must be used within ReleaseProvider");
  return v;
}
