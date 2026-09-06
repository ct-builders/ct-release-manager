/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_RELEASE_COOKIE, getSession } from "@/lib/auth";

/** Set (or clear) the "Working on" release for this session. */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const res = NextResponse.json({ ok: true, key: key ?? null });
  if (key) {
    res.cookies.set(ACTIVE_RELEASE_COOKIE, key, {
      httpOnly: false, // readable by client context for display
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    res.cookies.set(ACTIVE_RELEASE_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
