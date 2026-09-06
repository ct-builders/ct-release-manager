/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, getActiveReleaseKey } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/acl";
import { uploadProductImage } from "@/lib/product-edit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    await assertCan(session.email, "edit");
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
  const releaseKey = await getActiveReleaseKey();
  if (!releaseKey) return NextResponse.json({ error: "Pick a release to work in before editing." }, { status: 400 });

  const { key } = await ctx.params;
  const canonicalKey = decodeURIComponent(key);

  const form = await req.formData();
  const file = form.get("file");
  const variantId = Number(form.get("variantId") ?? 1) || 1;
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Image too large (max 10MB)." }, { status: 400 });

  const contentType = file.type || "image/jpeg";
  const filename = (file instanceof File && file.name) || "upload.jpg";
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    await uploadProductImage(releaseKey, canonicalKey, variantId, filename, bytes, contentType);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 500 });
  }
}
