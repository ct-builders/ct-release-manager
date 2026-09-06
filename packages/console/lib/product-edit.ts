/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct } from "./ct";
import { service } from "./service";
import { encodeKey, isMain } from "./branch";
import type { LocalizedString } from "./types";
import type { AttrDef, EditProduct, EditVariant, CtAction } from "./product-editor-types";
import { LOCALE } from "./config";
import { RELEASE_CONTAINER } from "./containers";

/**
 * Release-aware product editing. All edits go to the ACTIVE RELEASE's private
 * working copy (a branch in the authoring project), never to live. First edit provisions
 * a per-release branch, forks the product onto it (copy-on-first-edit), and
 * auto-adds it to the release members.
 */

const loc = (l?: LocalizedString) => (l ? (l[LOCALE] ?? l["en"] ?? Object.values(l)[0]) : "");
const setLoc = (l: LocalizedString | undefined, v: string): LocalizedString => ({ ...(l || {}), [LOCALE]: v });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Provision + bind a dedicated branch to a release if it's still on the trunk. */
export async function ensureReleaseBranch(releaseKey: string): Promise<string> {
  const rel = (await service.getRelease(releaseKey)).release;
  if (rel.branchId && !isMain(rel.branchId)) return rel.branchId;
  const branchId = ("r-" + releaseKey.toLowerCase().replace(/[^a-z0-9_-]/g, "-")).slice(0, 60);
  try {
    await service.createBranch({ branchId, title: rel.title || releaseKey });
  } catch {
    /* exists */
  }
  await ct.post("/custom-objects", { container: RELEASE_CONTAINER, key: releaseKey, value: { ...rel, branchId } });
  return branchId;
}

async function autoAddProduct(releaseKey: string, canonicalKey: string) {
  const rel = (await service.getRelease(releaseKey)).release;
  const products = new Set(rel.members?.products ?? []);
  if (!products.has(canonicalKey)) {
    products.add(canonicalKey);
    await service.setMembers(releaseKey, { ...rel.members, products: [...products] });
  }
}

/** Ensure the product is forked onto the release's branch; returns the HEAD key. */
export async function forkProduct(releaseKey: string, canonicalKey: string): Promise<{ branchId: string; headKey: string }> {
  const branchId = await ensureReleaseBranch(releaseKey);
  await service.fork(branchId, canonicalKey); // copy-on-first-edit, idempotent
  return { branchId, headKey: encodeKey(canonicalKey, branchId) };
}

/**
 * Does the encoded working-copy HEAD physically exist on a branch?
 *
 * The branch registry is NOT a reliable source of truth for "is this forked": the
 * release service records each fork in the branch CustomObject with a read-modify-write
 * that carries no optimistic-concurrency guard, so two forks onto the same branch can
 * race and drop one asset entry — leaving the HEAD resource live but unregistered
 * (and the service's fork is a no-op once the HEAD exists, so it never self-heals).
 * The physical HEAD is the truth. We probe it whenever the registry is silent so the
 * editor never silently writes to the LIVE product for an existing-but-unregistered
 * working copy. A non-404 (transient) error resolves to `true` on purpose: editing the
 * (missing) HEAD then surfaces as a visible "not found", which is safe, whereas a false
 * negative would silently corrupt live data.
 */
export async function workingCopyExists(headKey: string): Promise<boolean> {
  try {
    await ct.get(`/products/key=${ct.enc(headKey)}`);
    return true;
  } catch (e) {
    return (e as { status?: number }).status !== 404;
  }
}

/** Apply commercetools update actions to the working copy (retry on the fork's version bump). */
export async function applyProductActions(releaseKey: string, canonicalKey: string, actions: CtAction[]) {
  if (!actions.length) return;
  const { headKey } = await forkProduct(releaseKey, canonicalKey);
  for (let attempt = 0; ; attempt++) {
    const prod = await ct.get<{ version: number }>(`/products/key=${ct.enc(headKey)}`);
    try {
      await ct.post(`/products/key=${ct.enc(headKey)}`, { version: prod.version, actions: [...actions, { action: "publish" }] });
      break;
    } catch (e) {
      if ((e as { status?: number }).status === 409 && attempt < 3) {
        await sleep(400);
        continue;
      }
      throw e;
    }
  }
  await autoAddProduct(releaseKey, canonicalKey);
}

/**
 * Take a product online/offline WITHIN a release (release-scoped). Forks the product
 * onto the release's working copy and publishes/unpublishes that copy — production is
 * untouched until the release deploys (the deploy pipeline propagates the state).
 * Unlike applyProductActions this must NOT force a trailing publish (we may unpublish).
 */
export async function setProductPublishedOnRelease(releaseKey: string, canonicalKey: string, published: boolean) {
  const { headKey } = await forkProduct(releaseKey, canonicalKey);
  for (let attempt = 0; ; attempt++) {
    const prod = await ct.get<{ version: number; masterData?: { published?: boolean } }>(`/products/key=${ct.enc(headKey)}`);
    if (!!prod.masterData?.published === published) break; // already in the desired state
    try {
      await ct.post(`/products/key=${ct.enc(headKey)}`, { version: prod.version, actions: [{ action: published ? "publish" : "unpublish" }] });
      break;
    } catch (e) {
      if ((e as { status?: number }).status === 409 && attempt < 3) {
        await sleep(400);
        continue;
      }
      throw e;
    }
  }
  await autoAddProduct(releaseKey, canonicalKey);
}

/** Upload an image (binary) to a variant of the working copy. */
export async function uploadProductImage(
  releaseKey: string,
  canonicalKey: string,
  variantId: number,
  filename: string,
  bytes: Uint8Array,
  contentType: string
) {
  const { headKey } = await forkProduct(releaseKey, canonicalKey);
  await ct.upload(
    `/products/key=${ct.enc(headKey)}/images?variant=${variantId}&filename=${encodeURIComponent(filename)}&staged=false`,
    bytes,
    contentType
  );
  // publish so the current projection reflects the new image
  const prod = await ct.get<{ version: number }>(`/products/key=${ct.enc(headKey)}`);
  await ct.post(`/products/key=${ct.enc(headKey)}`, { version: prod.version, actions: [{ action: "publish" }] });
  await autoAddProduct(releaseKey, canonicalKey);
}

// ---- read the working copy for the editor ----
type RawVariant = {
  id: number;
  sku?: string;
  key?: string;
  prices?: {
    id?: string;
    value: { currencyCode: string; centAmount: number };
    country?: string;
    customerGroup?: { id: string };
    channel?: { id: string };
    validFrom?: string;
    validUntil?: string;
  }[];
  images?: { url: string; label?: string; dimensions?: { w: number; h: number } }[];
  attributes?: { name: string; value: unknown }[];
};
type RawProductData = { name: LocalizedString; slug: LocalizedString; description?: LocalizedString; categories?: { id: string }[]; masterVariant: RawVariant; variants: RawVariant[] };
type RawProduct = { version: number; key?: string; productType: { id: string }; masterData: { current?: RawProductData; staged?: RawProductData; published?: boolean } };
type RawProductType = { attributes: { name: string; label: LocalizedString; isRequired: boolean; attributeConstraint?: string; type: { name: string; elementType?: { name: string; values?: { key: string; label: unknown }[] }; values?: { key: string; label: unknown }[] } }[] };

const enumLabel = (l: unknown) => (typeof l === "string" ? l : loc(l as LocalizedString));

async function attrDefsFor(productTypeId: string): Promise<AttrDef[]> {
  try {
    const pt = await ct.get<RawProductType>(`/product-types/${productTypeId}`);
    return pt.attributes.map((a) => {
      const values = a.type.values ?? a.type.elementType?.values;
      return {
        name: a.name,
        label: loc(a.label) || a.name,
        type: a.type.name,
        elementType: a.type.name === "set" ? a.type.elementType?.name : undefined,
        isRequired: a.isRequired,
        constraint: a.attributeConstraint,
        values: values?.map((v) => ({ key: v.key, label: enumLabel(v.label) })),
      };
    });
  } catch {
    return [];
  }
}

const mapVariant = (v: RawVariant): EditVariant => ({
  id: v.id,
  sku: v.sku,
  key: v.key,
  prices: (v.prices ?? []).map((p) => ({
    id: p.id,
    currencyCode: p.value.currencyCode,
    centAmount: p.value.centAmount,
    country: p.country,
    customerGroupId: p.customerGroup?.id,
    channelId: p.channel?.id,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
  })),
  images: (v.images ?? []).map((i) => ({ url: i.url, label: i.label, w: i.dimensions?.w, h: i.dimensions?.h })),
  attributes: (v.attributes ?? []).map((a) => ({ name: a.name, value: a.value })),
});

/** Fetch the raw working-copy product (by the display key) shaped for the editor. */
export async function getEditProduct(displayKey: string): Promise<EditProduct | null> {
  try {
    const p = await ct.get<RawProduct>(`/products/key=${ct.enc(displayKey)}`);
    const data = p.masterData.current ?? p.masterData.staged;
    if (!data) return null;
    const attrDefs = await attrDefsFor(p.productType.id);
    return {
      version: p.version,
      name: loc(data.name),
      slug: loc(data.slug),
      description: loc(data.description),
      key: p.key,
      masterVariantId: data.masterVariant.id,
      variants: [mapVariant(data.masterVariant), ...(data.variants ?? []).map(mapVariant)],
      attrDefs,
      categories: (data.categories ?? []).map((c) => c.id),
      published: !!p.masterData.published,
    };
  } catch {
    return null;
  }
}
