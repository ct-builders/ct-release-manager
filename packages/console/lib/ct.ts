/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { env } from "./env";

/**
 * Minimal server-side commercetools REST clients. Raw fetch + cached
 * client-credentials token per project — no browser exposure, no heavy SDK.
 *
 * Two projects, each with its own credentials (see lib/env.ts):
 *   ct     → AUTHORING   — catalog, releases, sign-in accounts, roles, UI preferences
 *   prodCt → PRODUCTION  — read-only, the dashboard's sales analytics
 */

export class CtError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `CT HTTP ${status}`
    );
    this.status = status;
    this.body = body;
  }
}

/** commercetools envelope for a paged query. */
export type Paged<T> = { limit: number; offset: number; count: number; total: number; results: T[] };

type CtConfig = {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  apiUrl: string;
  scopes: string;
};

export type CtClient = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  /** binary upload (e.g. product image) — sends raw bytes with the given content type */
  upload: <T>(path: string, body: ArrayBuffer | Uint8Array, contentType: string) => Promise<T>;
  enc: (v: string) => string;
  projectKey: string;
};

function makeCt(cfg: () => CtConfig): CtClient {
  let cached: { value: string; expires: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
    const c = cfg();
    const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
    const r = await fetch(`${c.authUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(c.scopes)}`,
      cache: "no-store",
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) throw new Error(`ct token failed (${c.projectKey}): ${r.status} ${JSON.stringify(j)}`);
    cached = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return cached.value;
  }

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const c = cfg();
    const t = await token();
    const r = await fetch(`${c.apiUrl}/${c.projectKey}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${t}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) throw new CtError(r.status, j);
    return j as T;
  }

  async function upload<T>(path: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<T> {
    const c = cfg();
    const t = await token();
    const r = await fetch(`${c.apiUrl}/${c.projectKey}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": contentType },
      body: body as BodyInit,
      cache: "no-store",
    });
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) throw new CtError(r.status, j);
    return j as T;
  }

  return {
    get: <T>(path: string) => req<T>("GET", path),
    post: <T>(path: string, body: unknown) => req<T>("POST", path, body),
    del: <T>(path: string) => req<T>("DELETE", path),
    upload,
    enc: (v: string) => encodeURIComponent(v),
    // A getter, not `cfg().projectKey`. Reading it eagerly here would call cfg()
    // at module-import time, and cfg() goes through lib/env.ts's throwing
    // getters — so importing this module would demand credentials, which is
    // exactly what those lazy getters exist to avoid. `next build` collects
    // route configuration by importing every module, so an eager read fails the
    // production build on any checkout without a .env.local, credentials being
    // needed at request time and not to compile.
    get projectKey() {
      return cfg().projectKey;
    },
  };
}

/**
 * AUTHORING project — everything this console edits: catalog, releases, and the
 * Customers, roles and preferences that make up its own user accounts.
 */
export const ct = makeCt(() => ({
  projectKey: env.CTP_PROJECT_KEY,
  clientId: env.CTP_CLIENT_ID,
  clientSecret: env.CTP_CLIENT_SECRET,
  authUrl: env.CTP_AUTH_URL,
  apiUrl: env.CTP_API_URL,
  scopes: env.CTP_SCOPES,
}));

/** PRODUCTION project — read-only. Source of the dashboard's sales analytics. */
export const prodCt = makeCt(() => ({
  projectKey: env.PROD_CTP_PROJECT_KEY,
  clientId: env.PROD_CTP_CLIENT_ID,
  clientSecret: env.PROD_CTP_CLIENT_SECRET,
  authUrl: env.PROD_CTP_AUTH_URL,
  apiUrl: env.PROD_CTP_API_URL,
  scopes: env.PROD_CTP_SCOPES,
}));
