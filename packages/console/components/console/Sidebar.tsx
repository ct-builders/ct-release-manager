/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import Nav from "./Nav";
import { APP_NAME } from "@/lib/config";

/** commercetools cube, drawn as a simple monochrome outline (Merchant Center style). */
function CubeMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 5 L25.53 10.5 L25.53 21.5 L16 27 L6.47 21.5 L6.47 10.5 Z" />
      <path d="M16 16 L6.47 10.5 M16 16 L25.53 10.5 M16 16 L16 27" />
    </svg>
  );
}

export default function Sidebar({ initialCollapsed = false }: { initialCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      // persist across reloads; read back server-side so there's no flash on load
      document.cookie = `rm-nav-collapsed=${next ? "1" : "0"};path=/;max-age=31536000;samesite=lax`;
      return next;
    });
  }

  return (
    <aside
      className={`flex ${collapsed ? "w-16" : "w-60"} shrink-0 flex-col bg-[#191741] text-white transition-[width] duration-200`}
    >
      {/* Brand: outline cube + name */}
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? "justify-center px-0" : "gap-2.5 px-4"}`}>
        <CubeMark className={`${collapsed ? "size-7" : "size-8"} shrink-0`} />
        {!collapsed && (
          <span className="whitespace-nowrap text-lg font-semibold leading-tight tracking-tight">{APP_NAME}</span>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <Nav collapsed={collapsed} />
      </div>

      {/* Collapse toggle (bottom) */}
      <div className="shrink-0 border-t border-white/10 p-2">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={`flex w-full items-center rounded-lg py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white ${
            collapsed ? "justify-center px-0" : "gap-2.5 px-3"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`size-5 shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
