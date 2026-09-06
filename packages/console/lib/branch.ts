/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Display-side mirror of the release-deploy service's branch key encoding
 * (lib/branch.mjs). We NEVER show the technical suffix to the user — lists and
 * detail views strip it back to the canonical key/slug. Nomenclature note: in the
 * UI a "branch" is a release's private *working copy*; the word "branch" never
 * appears. These helpers exist only to hide the encoding.
 */

export const KEY_DELIM = "__b__"; // key / sku / code
export const SLUG_DELIM = "-b-"; // slug values
export const MAIN_BRANCH = "main";

export const isMain = (branchId: string | undefined | null) => !branchId || branchId === MAIN_BRANCH;

/** strip a branch suffix off a key/sku/code → canonical value */
export function canonicalKey(value: string, branchId?: string): string {
  if (isMain(branchId)) return value;
  const suffix = `${KEY_DELIM}${branchId}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

/** strip a branch suffix off a slug value → canonical slug */
export function canonicalSlug(value: string, branchId?: string): string {
  if (isMain(branchId)) return value;
  const suffix = `${SLUG_DELIM}${branchId}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

/** encode a canonical key onto a branch (create side) */
export function encodeKey(canonical: string, branchId?: string): string {
  return isMain(branchId) ? canonical : `${canonical}${KEY_DELIM}${branchId}`;
}
