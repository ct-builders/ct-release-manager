/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listProducts } from "@/lib/products";
import type { SortKey } from "@/lib/product-constants";
import { FACET_ATTRIBUTE, CODE_ATTRIBUTE, hasFacetAttribute, hasCodeAttribute } from "@/lib/config";

/** Column names mirror the configured attributes, so an export round-trips through the importer. */
const FACET_COL = FACET_ATTRIBUTE.name;
const CODE_COL = CODE_ATTRIBUTE.name;

const csvCell = (v: string | undefined) => {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const { results } = await listProducts({
    q: sp.get("q") ?? undefined,
    sort: (sp.get("sort") as SortKey) ?? undefined,
    category: sp.get("category") ?? undefined,
    facet: sp.get(FACET_COL) ?? undefined,
    limit: 500,
    offset: 0,
  }).catch(() => ({ results: [], total: 0 }));

  const header = [
    "key",
    "name",
    ...(hasFacetAttribute ? [FACET_COL] : []),
    ...(hasCodeAttribute ? [CODE_COL] : []),
    "price",
  ];
  const lines = [header.join(",")];
  for (const p of results) {
    const cells = [
      p.key,
      p.name,
      ...(hasFacetAttribute ? [p.facet] : []),
      ...(hasCodeAttribute ? [p.code] : []),
      p.priceLabel,
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  const csv = lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-export.csv"`,
    },
  });
}
