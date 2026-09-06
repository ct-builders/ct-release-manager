/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { SESSION_COOKIE, ACTIVE_RELEASE_COOKIE } from "./auth-constants";

// re-export client-safe constants so server code can keep importing from "@/lib/auth"
export * from "./auth-constants";

export type Session = { email: string };

const secret = () => new TextEncoder().encode(env.SESSION_SECRET);

export async function signSession(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.email === "string") return { email: payload.email };
    return null;
  } catch {
    return null;
  }
}

/** Read + verify the current session from the request cookies (or null). */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Read the active release key from cookies (or null). */
export async function getActiveReleaseKey(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACTIVE_RELEASE_COOKIE)?.value ?? null;
}
