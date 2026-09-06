/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/auth";
import { authenticateCustomer } from "@/lib/auth-ct";
import { hasConsoleAccess } from "@/lib/acl";

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  // 1. Who are you? A commercetools Customer sign-in against the authoring project.
  const { ok, email: verified } = await authenticateCustomer(String(email ?? ""), String(password ?? ""));
  if (!ok || !verified) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  // 2. May you be here? The same project holds storefront shoppers, so a valid password
  //    is not admission — an access-list entry is. Distinct message on purpose: a real
  //    user with a mistyped access-list email needs to know which half failed.
  if (!(await hasConsoleAccess(verified))) {
    return NextResponse.json(
      { error: "This account has no access to the console. Ask an administrator to grant you a role." },
      { status: 403 }
    );
  }
  const token = await signSession(verified);
  const res = NextResponse.json({ ok: true, email: verified });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
