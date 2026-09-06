/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use server";

import { getSession, getActiveReleaseKey } from "./auth";
import { ct } from "./ct";
import { service, ServiceError } from "./service";
import { assertCan, setAcl, removeAcl, capabilityForStatus } from "./acl";
import { applyProductActions, ensureReleaseBranch, setProductPublishedOnRelease } from "./product-edit";
import { applyResourceActions, createResource, type ResourceType } from "./resource-edit";
import { saveDiscountLayout } from "./discount-layout";
import { storeAvailability, type StoreAvailability } from "./stores";
import { listProducts, type ProductRow } from "./products";
import { slugifyKey } from "./slug";
import { env } from "./env";
import { LOCALE, CURRENCY, FACET_ATTRIBUTE, CODE_ATTRIBUTE, hasFacetAttribute, hasCodeAttribute } from "./config";
import type { DiscountGroup, OrderableKind } from "./discount-layout-types";
import type { ReleaseMembers, ValidateResult, DiffResult, Role, ProductPublishResult, MergeResult, MergeResolutions } from "./types";
import type { CtAction } from "./product-editor-types";

// Whitelisted update actions per category/discount resource type.
const ALLOWED_RESOURCE_ACTIONS: Record<ResourceType, Set<string>> = {
  category: new Set(["changeName", "changeSlug", "setDescription", "setKey", "changeParent", "changeOrderHint", "setExternalId", "setMetaTitle", "setMetaDescription", "setMetaKeywords"]),
  "cart-discount": new Set(["changeName", "setDescription", "changeValue", "changeCartPredicate", "changeTarget", "changeIsActive", "changeStackingMode", "changeSortOrder", "setValidFromAndUntil", "changeRequiresDiscountCode", "setKey", "setDiscountGroup"]),
  "product-discount": new Set(["changeName", "setDescription", "changeValue", "changePredicate", "changeIsActive", "changeSortOrder", "setValidFromAndUntil", "setKey"]),
  "discount-code": new Set(["setName", "setDescription", "changeIsActive", "setMaxApplications", "setMaxApplicationsPerCustomer", "changeCartDiscounts", "setCartPredicate", "changeGroups", "setValidFromAndUntil", "setKey"]),
};

// Whitelisted product update actions the editor is allowed to send.
const ALLOWED_PRODUCT_ACTIONS = new Set([
  // NOTE: `setKey` is intentionally excluded — the product key is the canonical
  // identity (and carries the release working-copy suffix); renaming it would break
  // the compound-key contract the deploy service relies on. The key is read-only in the UI.
  "changeName", "changeSlug", "setDescription",
  "setMetaTitle", "setMetaDescription", "setMetaKeywords",
  "setAttribute", "setAttributeInAllVariants",
  "addPrice", "changePrice", "removePrice",
  "addExternalImage", "removeImage", "moveImageToPosition", "changeImageLabel",
  "addVariant", "removeVariant", "setSku", "setProductVariantKey",
  "addToCategory", "removeFromCategory",
]);

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function actorEmail(): Promise<string> {
  const s = await getSession();
  if (!s) throw new Error("Not signed in.");
  return s.email;
}

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

// ---- releases (RBAC enforced against release-manager ACL) ----
export async function createReleaseAction(input: {
  key: string;
  title: string;
  description?: string;
  members?: Partial<ReleaseMembers>;
}): Promise<ActionResult<{ key: string }>> {
  try {
    const author = await actorEmail();
    await assertCan(author, "edit");
    const res = await service.createRelease({ ...input, author, members: input.members });
    // provision a dedicated working-copy branch so the release is editable
    await ensureReleaseBranch(res.release.key).catch(() => {});
    return { ok: true, data: { key: res.release.key } };
  } catch (e) {
    return fail(e);
  }
}

export async function transitionAction(key: string, to: string, note?: string): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, capabilityForStatus(to));
    await service.transition(key, to, by, note);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function stagePublishAction(key: string): Promise<ActionResult<Record<string, number>>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const res = await service.stagePublish(key, by);
    return { ok: true, data: res.publish.summary };
  } catch (e) {
    return fail(e);
  }
}

export async function deployAction(
  key: string,
  apply: boolean
): Promise<ActionResult<{ create: number; update: number; noop: number; error: number }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "publish");
    const res = await service.deploy(key, by, apply);
    return { ok: true, data: res.summary };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Admin fast-path: deploy a release straight to production, skipping the review/approval
 * workflow, and advance it to "published" from any status. Admin-only (mirrors the
 * service's own `immediate` gate).
 */
export async function immediateDeployAction(
  key: string
): Promise<ActionResult<{ create: number; update: number; noop: number; error: number }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "admin");
    const res = await service.immediateDeploy(key, by);
    return { ok: true, data: res.summary };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Roll back this release's most recently applied deploy — restores production to
 * how it looked just before that deploy ran. Same capability as shipping (`publish`).
 */
export async function undeployAction(
  key: string
): Promise<ActionResult<{ create: number; update: number; noop: number; error: number }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "publish");
    const res = await service.undeploy(key, by, true);
    return { ok: true, data: res.summary };
  } catch (e) {
    return fail(e);
  }
}

/** Read-only merge-to-main preview (any signed-in user) — powers the merge panel + ship gate. */
export async function mergePreviewAction(key: string): Promise<ActionResult<MergeResult>> {
  try {
    await actorEmail();
    const res = await service.mergePreview(key);
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

/** Outcome of a merge-to-main apply: success, a plain failure, or an unresolved-conflict report. */
export type MergeActionResult =
  | { ok: true; data: MergeResult }
  | { ok: false; error: string; conflicts?: MergeResult };

/**
 * Merge a release's branch working-copy edits onto the canonical trunk. `resolutions`
 * decides each conflicting field. On an unresolved conflict the service replies 409 —
 * surfaced here as `{ ok:false, conflicts }` so the UI can render the resolution panel.
 */
export async function mergeReleaseAction(key: string, resolutions: MergeResolutions = {}): Promise<MergeActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "publish");
    const res = await service.merge(key, by, resolutions);
    return { ok: true, data: res };
  } catch (e) {
    if (e instanceof ServiceError && e.status === 409) {
      return { ok: false, error: "merge-conflicts", conflicts: e.body as MergeResult };
    }
    return fail(e);
  }
}

export async function saveMembersAction(key: string, members: Partial<ReleaseMembers>): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    await service.setMembers(key, members);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function previewAction(key: string): Promise<ActionResult<{ validate: ValidateResult; diff: DiffResult }>> {
  try {
    await actorEmail(); // any signed-in user may preview (read-only)
    const validate = await service.validate(key);
    const diff = await service.diff(key);
    return { ok: true, data: { validate, diff } };
  } catch (e) {
    return fail(e);
  }
}

// ---- auto-add config ----
export async function setAutoAddAction(patch: {
  autoAddEnabled: boolean;
  currentReleaseKey: string | null;
}): Promise<ActionResult<{ autoAddEnabled: boolean; currentReleaseKey: string | null }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const res = await service.setConfig({ ...patch, by });
    return { ok: true, data: { autoAddEnabled: res.config.autoAddEnabled, currentReleaseKey: res.config.currentReleaseKey } };
  } catch (e) {
    return fail(e);
  }
}

// ---- product editing (release-aware) ----
export async function applyProductActionsAction(canonicalKey: string, actions: CtAction[]): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before editing." };
    const clean = (actions ?? []).filter((a) => a && typeof a.action === "string" && ALLOWED_PRODUCT_ACTIONS.has(a.action));
    if (!clean.length) return { ok: false, error: "No editable changes." };
    await applyProductActions(releaseKey, canonicalKey, clean);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Take a product online/offline WITHIN the active release (release-scoped). Edits the
 * release working copy; production is untouched until the release deploys. Needs the
 * `edit` capability (any release author) — distinct from the admin-only immediate path
 * (`publishProductAction`), which writes straight to production.
 */
export async function setProductPublishedAction(canonicalKey: string, published: boolean): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before changing availability." };
    await setProductPublishedOnRelease(releaseKey, canonicalKey, published);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Product type for products created by the wizard: the configured one, else the
 * project's first. Resolving it from the project keeps the wizard working on a
 * fresh install with no configuration.
 */
async function newProductTypeId(): Promise<string> {
  const configured = env.NEW_PRODUCT_TYPE_KEY;
  if (configured) {
    const pt = await ct.get<{ id: string }>(`/product-types/key=${ct.enc(configured)}`);
    return pt.id;
  }
  const list = await ct.get<{ results: { id: string }[] }>("/product-types?limit=1");
  const first = list.results?.[0]?.id;
  if (!first) throw new Error("This project has no product types — create one before adding products.");
  return first;
}

/** Create a new product (published) in the authoring project. Simple wizard input. */
export async function createProductAction(input: {
  name: string;
  /** value for the configured FACET_ATTRIBUTE */
  facet?: string;
  /** value for the configured CODE_ATTRIBUTE */
  code?: string;
  /** major units in CURRENCY, e.g. "19.99" */
  price?: string;
  categoryId?: string;
  imageUrl?: string;
  description?: string;
}): Promise<ActionResult<{ key: string }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Give the product a name." };
    const base = slugifyKey(name);
    if (!base) return { ok: false, error: "That name can't be turned into a key — add some letters or numbers." };
    // ensure a unique key/slug — append a short suffix on collision
    let key = base;
    for (let n = 2; n <= 20; n++) {
      const exists = await ct.get(`/products/key=${ct.enc(key)}`).then(() => true).catch(() => false);
      if (!exists) break;
      key = `${base}-${n}`;
    }
    const productTypeId = await newProductTypeId();
    const L = (v: string) => ({ [LOCALE]: v });
    const attributes: { name: string; value: unknown }[] = [];
    if (hasFacetAttribute && input.facet?.trim()) attributes.push({ name: FACET_ATTRIBUTE.name, value: input.facet.trim() });
    if (hasCodeAttribute && input.code?.trim()) attributes.push({ name: CODE_ATTRIBUTE.name, value: input.code.trim() });
    const cents = input.price?.trim() ? Math.round(Number(input.price) * 100) : NaN;
    const prices = Number.isFinite(cents) && cents >= 0 ? [{ value: { currencyCode: CURRENCY, centAmount: cents } }] : [];
    const images = input.imageUrl?.trim() ? [{ url: input.imageUrl.trim(), dimensions: { w: 0, h: 0 } }] : [];
    const draft = {
      key,
      productType: { typeId: "product-type", id: productTypeId },
      name: L(name),
      slug: L(key),
      ...(input.description?.trim() ? { description: L(input.description.trim()) } : {}),
      ...(input.categoryId ? { categories: [{ typeId: "category", id: input.categoryId }] } : {}),
      masterVariant: { sku: key.toUpperCase(), prices, images, attributes },
      publish: true,
    };
    const created = await ct.post<{ key?: string }>("/products", draft);
    return { ok: true, data: { key: created.key ?? key } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Take a product online/offline in BOTH stage and live at once (admin fast-path,
 * independent of any release). Matched by canonical key; applies by default.
 */
export async function publishProductAction(
  canonicalKey: string,
  published: boolean,
  apply: boolean = true
): Promise<ActionResult<ProductPublishResult>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "admin");
    const res = await service.publishProduct(canonicalKey, published, by, apply);
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

/** Create a new category in the active release, optionally under a parent. */
export async function createCategoryAction(input: { name: string; parentId?: string }): Promise<ActionResult<{ key: string }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before adding a category." };
    const name = (input.name ?? "").trim();
    if (!name) return { ok: false, error: "Give the category a name." };
    const base = slugifyKey(name);
    if (!base) return { ok: false, error: "That name can't be turned into a key — add some letters or numbers." };
    let key = base;
    for (let n = 2; n <= 20; n++) {
      const exists = await ct.get(`/categories/key=${ct.enc(key)}`).then(() => true).catch(() => false);
      if (!exists) break;
      key = `${base}-${n}`;
    }
    const L = (v: string) => ({ [LOCALE]: v });
    const draft: Record<string, unknown> = {
      key,
      name: L(name),
      slug: L(key),
      ...(input.parentId ? { parent: { typeId: "category", id: input.parentId } } : {}),
    };
    const created = await createResource(releaseKey, "category", draft);
    return { ok: true, data: { key: created.key ?? key } };
  } catch (e) {
    return fail(e);
  }
}

/** Product search for the "add products to category" picker (wraps the catalog list). Read-only. */
export async function searchProductsForPickerAction(input: { q?: string; facet?: string; offset?: number }): Promise<ActionResult<{ results: ProductRow[]; total: number }>> {
  try {
    await actorEmail();
    const data = await listProducts({ q: input.q, facet: input.facet, sort: "name-asc", limit: 20, offset: input.offset ?? 0 });
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

/** Add products to a category (release-aware — forks each product into the active release). */
export async function addProductsToCategoryAction(categoryId: string, keys: string[]): Promise<ActionResult<{ added: number }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before adding products." };
    if (!categoryId || !keys?.length) return { ok: false, error: "Select at least one product." };
    let added = 0;
    for (const key of keys.slice(0, 100)) {
      try {
        await applyProductActions(releaseKey, key, [{ action: "addToCategory", category: { typeId: "category", id: categoryId }, staged: false }]);
        added++;
      } catch {
        /* skip products that fail (e.g. already in the category) */
      }
    }
    if (!added) return { ok: false, error: "Couldn't add those products (they may already be in this category)." };
    return { ok: true, data: { added } };
  } catch (e) {
    return fail(e);
  }
}

/** Which products a store carries (via its product selections). Read-only. */
export async function storeAvailabilityAction(storeKey: string): Promise<ActionResult<StoreAvailability>> {
  try {
    await actorEmail();
    const data = await storeAvailability(storeKey);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

// ---- category / discount editing (release-aware) ----
export async function applyResourceActionsAction(rt: ResourceType, canonicalKey: string, actions: CtAction[]): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before editing." };
    const allow = ALLOWED_RESOURCE_ACTIONS[rt];
    const clean = (actions ?? []).filter((a) => a && typeof a.action === "string" && allow.has(a.action));
    if (!clean.length) return { ok: false, error: "No editable changes." };
    await applyResourceActions(releaseKey, canonicalKey, rt, clean);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Draft fields the create flow may set, per discount type.
const ALLOWED_DRAFT_FIELDS: Record<string, Set<string>> = {
  "cart-discount": new Set(["key", "name", "description", "value", "target", "cartPredicate", "sortOrder", "isActive", "stackingMode", "requiresDiscountCode", "validFrom", "validUntil"]),
  "product-discount": new Set(["key", "name", "description", "value", "predicate", "sortOrder", "isActive", "validFrom", "validUntil"]),
  "discount-code": new Set(["key", "name", "description", "code", "cartDiscounts", "cartPredicate", "isActive", "maxApplications", "maxApplicationsPerCustomer", "groups", "validFrom", "validUntil"]),
  category: new Set(["key", "name", "slug", "description", "parent", "orderHint"]),
};

// A unique sortOrder in (0,1); cart & product discounts require one.
function freshSortOrder(): string {
  const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");
  return "0." + digits;
}

export async function createDiscountAction(
  rt: "cart-discount" | "product-discount" | "discount-code",
  draft: Record<string, unknown>
): Promise<ActionResult<{ key: string }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before creating a discount." };
    const allow = ALLOWED_DRAFT_FIELDS[rt];
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft ?? {})) if (allow.has(k) && v !== undefined && v !== "") clean[k] = v;
    if (!clean.key || typeof clean.key !== "string") return { ok: false, error: "A key is required." };
    if (rt === "discount-code" && !clean.code) return { ok: false, error: "A code is required." };
    if (rt !== "discount-code" && !clean.sortOrder) clean.sortOrder = freshSortOrder();
    const created = await createResource(releaseKey, rt, clean);
    return { ok: true, data: { key: created.key ?? (clean.key as string) } };
  } catch (e) {
    return fail(e);
  }
}

// ---- native discount groups (best-deal container for cart discounts) ----
async function enrollDiscountGroup(releaseKey: string, key: string) {
  const rel = (await service.getRelease(releaseKey)).release;
  const cur = (rel.members as Record<string, string[]> | undefined)?.discountGroups ?? [];
  if (!cur.includes(key)) await service.setMembers(releaseKey, { ...rel.members, discountGroups: [...cur, key] });
}

const L = (v: string) => ({ [LOCALE]: v });

export async function createDiscountGroupAction(input: {
  key: string;
  name: string;
  description?: string;
  sortOrder?: string;
  isActive: boolean;
}): Promise<ActionResult<{ key: string }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before creating a discount group." };
    if (!input.key?.trim()) return { ok: false, error: "A key is required." };
    const draft: Record<string, unknown> = {
      key: input.key.trim(),
      name: L(input.name || input.key.trim()),
      isActive: input.isActive,
      sortOrder: input.sortOrder?.trim() || freshSortOrder(),
    };
    if (input.description?.trim()) draft.description = L(input.description);
    await ct.post(`/discount-groups`, draft);
    await enrollDiscountGroup(releaseKey, input.key.trim());
    return { ok: true, data: { key: input.key.trim() } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateDiscountGroupAction(
  key: string,
  patch: { name?: string; description?: string; sortOrder?: string; isActive?: boolean }
): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before editing a discount group." };
    const cur = await ct.get<{ version: number }>(`/discount-groups/key=${ct.enc(key)}`);
    const actions: CtAction[] = [];
    if (patch.name !== undefined) actions.push({ action: "setName", name: L(patch.name) });
    if (patch.description !== undefined) actions.push({ action: "setDescription", description: patch.description.trim() ? L(patch.description) : undefined });
    if (patch.sortOrder !== undefined && patch.sortOrder.trim()) actions.push({ action: "setSortOrder", sortOrder: patch.sortOrder.trim() });
    if (patch.isActive !== undefined) actions.push({ action: "setIsActive", isActive: patch.isActive });
    if (!actions.length) return { ok: true };
    await ct.post(`/discount-groups/key=${ct.enc(key)}`, { version: cur.version, actions });
    await enrollDiscountGroup(releaseKey, key);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDiscountGroupAction(key: string): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const cur = await ct.get<{ version: number }>(`/discount-groups/key=${ct.enc(key)}`);
    await ct.del(`/discount-groups/key=${ct.enc(key)}?version=${cur.version}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function checkpointProductAction(canonicalKey: string): Promise<ActionResult<{ version: number }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in." };
    const branchId = await ensureReleaseBranch(releaseKey);
    const r = await service.saveVersion(branchId, canonicalKey);
    return { ok: true, data: { version: r.version } };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreProductVersionAction(canonicalKey: string, version: number): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in." };
    const branchId = await ensureReleaseBranch(releaseKey);
    await service.restoreVersion(branchId, canonicalKey, version);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---- discount priority layout (groups + sortOrder; layout stored in release-manager) ----
export async function saveDiscountLayoutAction(kind: OrderableKind, groups: DiscountGroup[]): Promise<ActionResult<{ groups: number; reordered: number }>> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const data = await saveDiscountLayout(kind, groups, by);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

// ---- discount deletion (staged in the active release; removed from prod on deploy) ----
const DISCOUNT_MEMBER_FIELD = {
  "cart-discount": "cartDiscounts",
  "product-discount": "productDiscounts",
  "discount-code": "discountCodes",
} as const;
const EMPTY_MEMBERS: ReleaseMembers = { products: [], categories: [], cartDiscounts: [], productDiscounts: [], discountCodes: [], discountGroups: [] };

export async function setDiscountDeletionAction(
  kind: keyof typeof DISCOUNT_MEMBER_FIELD,
  canonicalKey: string,
  remove: boolean
): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "edit");
    const releaseKey = await getActiveReleaseKey();
    if (!releaseKey) return { ok: false, error: "Pick a release to work in before deleting a discount." };
    const rel = (await service.getRelease(releaseKey)).release;
    const field = DISCOUNT_MEMBER_FIELD[kind];
    const members: ReleaseMembers = { ...EMPTY_MEMBERS, ...(rel.members || {}) };
    const deletions: ReleaseMembers = { ...EMPTY_MEMBERS, ...(rel.deletions || {}) };
    const del = new Set(deletions[field] || []);
    if (remove) {
      del.add(canonicalKey);
      members[field] = (members[field] || []).filter((k) => k !== canonicalKey);
    } else {
      del.delete(canonicalKey);
    }
    deletions[field] = [...del];
    await service.setMembers(releaseKey, members, deletions);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---- ACL (stored in release-manager; admin-only) ----
export async function aclSaveAction(email: string, roles: Role[]): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "admin");
    await setAcl(email, roles, by);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function aclRemoveAction(email: string): Promise<ActionResult> {
  try {
    const by = await actorEmail();
    await assertCan(by, "admin");
    await removeAcl(email);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
