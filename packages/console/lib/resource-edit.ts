/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import "server-only";
import { ct } from "./ct";
import { service } from "./service";
import { ensureReleaseBranch } from "./product-edit";
import { encodeKey } from "./branch";
import type { CtAction } from "./product-editor-types";

/**
 * Release-aware editing for categories and discounts (products have their own
 * richer path in product-edit.ts). Same model: edits go to the active release's
 * working copy (fork-on-first-edit onto the release branch), never to live.
 */

export type ResourceType = "category" | "cart-discount" | "product-discount" | "discount-code";

const ENDPOINT: Record<ResourceType, string> = {
  category: "categories",
  "cart-discount": "cart-discounts",
  "product-discount": "product-discounts",
  "discount-code": "discount-codes",
};
const MEMBER_FIELD: Record<ResourceType, string> = {
  category: "categories",
  "cart-discount": "cartDiscounts",
  "product-discount": "productDiscounts",
  "discount-code": "discountCodes",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function endpointFor(rt: ResourceType) {
  return ENDPOINT[rt];
}

async function forkResource(releaseKey: string, canonicalKey: string, rt: ResourceType) {
  const branchId = await ensureReleaseBranch(releaseKey);
  await service.fork(branchId, canonicalKey, rt);
  return { branchId, headKey: encodeKey(canonicalKey, branchId) };
}

async function autoAdd(releaseKey: string, canonicalKey: string, rt: ResourceType) {
  const field = MEMBER_FIELD[rt];
  const rel = (await service.getRelease(releaseKey)).release;
  const cur = (rel.members as Record<string, string[]> | undefined)?.[field] ?? [];
  const set = new Set(cur);
  if (!set.has(canonicalKey)) {
    set.add(canonicalKey);
    await service.setMembers(releaseKey, { ...rel.members, [field]: [...set] });
  }
}

/** Apply update actions to a category/discount working copy (fork-on-edit, retry on conflict). */
export async function applyResourceActions(releaseKey: string, canonicalKey: string, rt: ResourceType, actions: CtAction[]) {
  if (!actions.length) return;
  const { headKey } = await forkResource(releaseKey, canonicalKey, rt);
  const ep = ENDPOINT[rt];
  for (let attempt = 0; ; attempt++) {
    const r = await ct.get<{ version: number }>(`/${ep}/key=${ct.enc(headKey)}`);
    try {
      await ct.post(`/${ep}/key=${ct.enc(headKey)}`, { version: r.version, actions });
      break;
    } catch (e) {
      if ((e as { status?: number }).status === 409 && attempt < 3) {
        await sleep(400);
        continue;
      }
      throw e;
    }
  }
  await autoAdd(releaseKey, canonicalKey, rt);
}

/** Create a new category/discount on stage and enroll it in the active release. */
export async function createResource(releaseKey: string, rt: ResourceType, draft: Record<string, unknown>) {
  const ep = ENDPOINT[rt];
  const created = await ct.post<{ id: string; key?: string }>(`/${ep}`, draft);
  const key = created.key ?? (draft.key as string | undefined);
  if (key) await autoAdd(releaseKey, key, rt);
  return { id: created.id, key };
}

/** Fetch a category/discount by key (the display/working-copy key). */
export async function getResource<T = Record<string, unknown>>(displayKey: string, rt: ResourceType): Promise<T | null> {
  try {
    return await ct.get<T>(`/${ENDPOINT[rt]}/key=${ct.enc(displayKey)}`);
  } catch {
    return null;
  }
}
