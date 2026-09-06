/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STOREFRONT_LINKS } from "@/lib/config";

type Item = { href: string; label: string; icon: string; external?: boolean };
type Group = { heading: string; items: Item[] };

// simple inline-SVG path set (no icon dependency)
const ICONS: Record<string, string> = {
  dashboard: "M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-4H4z",
  releases: "M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z",
  products: "M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4m-18 5l9 4 9-4",
  categories: "M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z",
  discounts: "M7 7h.01M17 17h.01M6 18L18 6M4 8V5a1 1 0 011-1h3l8 8-4 4-8-8z",
  audit: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  permissions: "M12 11c1.66 0 3-1.34 3-3S13.66 5 12 5 9 6.34 9 8s1.34 3 3 3zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  site: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18",
};

const GROUPS: Group[] = [
  {
    heading: "Author",
    items: [
      { href: "/products", label: "Products", icon: "products" },
      { href: "/categories", label: "Categories", icon: "categories" },
      { href: "/discounts", label: "Discounts", icon: "discounts" },
    ],
  },
  {
    heading: "Ship",
    items: [
      { href: "/releases", label: "Releases", icon: "releases" },
      { href: "/audit", label: "Key Audit", icon: "audit" },
    ],
  },
  // Only rendered when at least one storefront URL is configured (lib/config.ts).
  ...(STOREFRONT_LINKS.length
    ? [
        {
          heading: "Sites",
          items: STOREFRONT_LINKS.map((l) => ({ href: l.url, label: l.label, icon: "site", external: true })),
        } satisfies Group,
      ]
    : []),
  {
    heading: "Admin",
    items: [{ href: "/settings/permissions", label: "Permissions", icon: "permissions" }],
  },
];

const linkCls = (active: boolean, collapsed: boolean) =>
  `flex items-center rounded-lg text-sm font-medium transition ${
    collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"
  } ${active ? "bg-accent text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`;

function ItemIcon({ icon }: { icon: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[icon]} />
    </svg>
  );
}

export default function Nav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={`flex flex-col ${collapsed ? "gap-2" : "gap-5"}`}>
      <ul>
        <li>
          <Link href="/" title={collapsed ? "Dashboard" : undefined} className={linkCls(pathname === "/", collapsed)}>
            <ItemIcon icon="dashboard" />
            {!collapsed && "Dashboard"}
          </Link>
        </li>
      </ul>
      {GROUPS.map((g) => (
        <div key={g.heading}>
          {collapsed ? (
            <div className="mx-2 mb-2 border-t border-white/10" />
          ) : (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">{g.heading}</p>
          )}
          <ul className="space-y-0.5">
            {g.items.map((it) =>
              it.external ? (
                <li key={it.href}>
                  <a href={it.href} target="_blank" rel="noreferrer" title={collapsed ? it.label : undefined} className={linkCls(false, collapsed)}>
                    <ItemIcon icon={it.icon} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{it.label}</span>
                        <span className="shrink-0 text-white/40">↗</span>
                      </>
                    )}
                  </a>
                </li>
              ) : (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    title={collapsed ? it.label : undefined}
                    className={linkCls(pathname === it.href || pathname.startsWith(it.href + "/"), collapsed)}
                  >
                    <ItemIcon icon={it.icon} />
                    {!collapsed && it.label}
                  </Link>
                </li>
              )
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}
