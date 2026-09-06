/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, getActiveReleaseKey } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/acl";
import { applyProductActions } from "@/lib/product-edit";
import type { CtAction } from "@/lib/product-editor-types";
import { LOCALE, FACET_ATTRIBUTE, CODE_ATTRIBUTE, hasFacetAttribute, hasCodeAttribute } from "@/lib/config";

// minimal CSV parser (handles quoted cells with commas / escaped quotes)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    await assertCan(session.email, "edit");
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
  const releaseKey = await getActiveReleaseKey();
  if (!releaseKey) return NextResponse.json({ error: "Pick a release to work in before importing." }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No CSV provided." }, { status: 400 });
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return NextResponse.json({ error: "CSV has no data rows." }, { status: 400 });

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iKey = col("key");
  if (iKey < 0) return NextResponse.json({ error: 'CSV must have a "key" column.' }, { status: 400 });
  const iName = col("name");
  // the two featured attributes are matched by their configured commercetools names
  const iFacet = hasFacetAttribute ? col(FACET_ATTRIBUTE.name.toLowerCase()) : -1;
  const iCode = hasCodeAttribute ? col(CODE_ATTRIBUTE.name.toLowerCase()) : -1;

  const L = (v: string) => ({ [LOCALE]: v });
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const r of rows.slice(1)) {
    const key = (r[iKey] ?? "").trim();
    if (!key) continue;
    const actions: CtAction[] = [];
    if (iName >= 0 && r[iName]?.trim()) actions.push({ action: "changeName", name: L(r[iName].trim()), staged: false });
    if (iFacet >= 0 && r[iFacet] != null)
      actions.push({ action: "setAttributeInAllVariants", name: FACET_ATTRIBUTE.name, value: r[iFacet].trim() || undefined, staged: false });
    if (iCode >= 0 && r[iCode] != null)
      actions.push({ action: "setAttributeInAllVariants", name: CODE_ATTRIBUTE.name, value: r[iCode].trim() || undefined, staged: false });
    if (!actions.length) continue;
    try {
      await applyProductActions(releaseKey, key, actions);
      imported++;
    } catch (e) {
      failed++;
      if (errors.length < 10) errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return NextResponse.json({ ok: true, imported, failed, errors });
}
