/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";

/**
 * Server-only environment access via lazy getters, so importing this module
 * during `next build` never throws — a missing var only errors when actually
 * used at request time (and Netlify supplies them at build+runtime anyway).
 * Never import this from a client component.
 */
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
const trim = (s: string) => s.replace(/\/$/, "");

export const env = {
  // commercetools — AUTHORING project: the catalog and release data this console edits
  get CTP_PROJECT_KEY() {
    return need("CTP_PROJECT_KEY");
  },
  get CTP_CLIENT_ID() {
    return need("CTP_CLIENT_ID");
  },
  get CTP_CLIENT_SECRET() {
    return need("CTP_CLIENT_SECRET");
  },
  get CTP_AUTH_URL() {
    return trim(need("CTP_AUTH_URL"));
  },
  get CTP_API_URL() {
    return trim(need("CTP_API_URL"));
  },
  get CTP_SCOPES() {
    return process.env.CTP_SCOPES ?? "";
  },
  // commercetools PRODUCTION project — read-only, source of the dashboard's sales analytics
  get PROD_CTP_PROJECT_KEY() {
    return need("PROD_CTP_PROJECT_KEY");
  },
  get PROD_CTP_CLIENT_ID() {
    return need("PROD_CTP_CLIENT_ID");
  },
  get PROD_CTP_CLIENT_SECRET() {
    return need("PROD_CTP_CLIENT_SECRET");
  },
  get PROD_CTP_AUTH_URL() {
    return trim(need("PROD_CTP_AUTH_URL"));
  },
  get PROD_CTP_API_URL() {
    return trim(need("PROD_CTP_API_URL"));
  },
  get PROD_CTP_SCOPES() {
    return process.env.PROD_CTP_SCOPES ?? "";
  },
  // release-deploy service
  get RELEASE_SERVICE_URL() {
    return trim(need("RELEASE_SERVICE_URL"));
  },
  get RELEASE_SERVICE_TOKEN() {
    return process.env.RELEASE_SERVICE_TOKEN ?? "";
  },
  /** The service's own alias for the authoring project, sent as `?project=`. */
  get RELEASE_SERVICE_PROJECT() {
    return process.env.RELEASE_SERVICE_PROJECT?.trim() || "stage";
  },
  /**
   * Product type the create-product wizard assigns to new products. Blank means
   * "whichever product type the project defines first", which is right for a
   * single-product-type catalog and wrong for a catalog with several — set it
   * explicitly there.
   */
  get NEW_PRODUCT_TYPE_KEY() {
    return process.env.NEW_PRODUCT_TYPE_KEY?.trim() ?? "";
  },
  // auth session signing
  get SESSION_SECRET() {
    return need("SESSION_SECRET");
  },
  /**
   * The one account that holds admin before anyone appears in the access list, so a
   * fresh install has exactly one named way in. Sign-in is refused for everyone else
   * until an entry exists for them. Server-side on purpose: it must not be readable
   * from the browser.
   */
  get BOOTSTRAP_ADMIN_EMAIL() {
    return (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  },
};
