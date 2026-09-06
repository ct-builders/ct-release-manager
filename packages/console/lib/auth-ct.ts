/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { env } from "./env";

/**
 * Console sign-in, as a commercetools Customer sign-in against the AUTHORING project.
 * commercetools holds the password; this app never stores or hashes one.
 *
 * Authenticating proves who someone is, not that they may be here: the catalog project
 * also holds storefront shoppers, and a shopper is a Customer like any other. The
 * access list is the roster, and `app/api/auth/login/route.ts` refuses anyone absent
 * from it. Verify both, in that order.
 */

let cached: { value: string; expires: number } | null = null;

async function authToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  const basic = Buffer.from(`${env.CTP_CLIENT_ID}:${env.CTP_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${env.CTP_AUTH_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials", // token carries the client's full scope set
    cache: "no-store",
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!r.ok || !j.access_token) throw new Error(`auth token failed: ${r.status}`);
  cached = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.value;
}

/**
 * Verify an email and password against the project's Customers. Returns the canonical
 * email on success. Never throws for bad credentials — returns `{ ok: false }` — so a
 * caller cannot accidentally surface a stack trace on a failed login.
 */
export async function authenticateCustomer(
  email: string,
  password: string
): Promise<{ ok: boolean; email?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !password) return { ok: false };
  try {
    const t = await authToken();
    const r = await fetch(`${env.CTP_API_URL}/${env.CTP_PROJECT_KEY}/login`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: clean, password }),
      cache: "no-store",
    });
    if (r.status === 200) {
      const j = (await r.json().catch(() => ({}))) as { customer?: { email?: string } };
      return { ok: true, email: j.customer?.email?.toLowerCase() ?? clean };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
