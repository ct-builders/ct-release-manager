#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Fill an empty AUTHORING (stage) project from a PRODUCTION (live) one, so a fresh
 * install has a catalog to make releases out of.
 *
 * commercetools only offers a sample dataset at project creation, and only in the
 * Merchant Center. A project created "from scratch" — the form's default — stays
 * empty, and nothing can add a dataset afterwards. This copies your real catalog
 * instead, which is a better staging baseline than sample data anyway.
 *
 *   node tools/provision-stage.mjs --dry-run     # report what it would create
 *   node tools/provision-stage.mjs               # do it
 *   node tools/provision-stage.mjs --verify      # compare every product afterwards
 *   node tools/provision-stage.mjs --only=products,inventory
 *
 * Credentials: two admin files, resolved like every other script here (see
 * tools/ct-admin.mjs). Defaults are this package's `production.admin.env` (source)
 * and `authoring.admin.env` (target); override with --from= and --to=.
 *
 * Safe to re-run. Every stage matches existing target rows by key (or by scope,
 * for inventory) and skips them, so an interrupted run resumes where it stopped.
 *
 * NOT copied, deliberately:
 *   customers — commercetools cannot export a password, so copies would be accounts
 *               nobody can sign into. Use tools/seed-auth-customers.mjs.
 *   orders    — they reference customers, and a staging catalog needs no history.
 *               Use tools/seed-demo-orders.mjs for dashboard data.
 */
import { loadAdminEnv, adminToken } from "./ct-admin.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const DRY = argv.includes("--dry-run");
const VERIFY = argv.includes("--verify");
const ONLY = (flag("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wanted = (stage) => !ONLY.length || ONLY.includes(stage);

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

async function connect(admin) {
  const token = await adminToken(admin);
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const call = async (method, path, body) => {
    const res = await fetch(`${admin.apiUrl}/${admin.projectKey}${path}`, {
      method,
      headers: H,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const b = await res.json().catch(() => ({}));
    return { ok: res.status < 300, status: res.status, body: b };
  };
  const all = async (path, pageSize = 200) => {
    const out = [];
    for (let offset = 0; ; offset += pageSize) {
      const sep = path.includes("?") ? "&" : "?";
      const r = await call("GET", `${path}${sep}limit=${pageSize}&offset=${offset}&withTotal=false`);
      // a resource this project does not support — treat as empty rather than failing
      if (!r.ok) return out;
      out.push(...(r.body.results ?? []));
      if ((r.body.results ?? []).length < pageSize) return out;
    }
  };
  return { pk: admin.projectKey, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), all };
}

const src = await connect(loadAdminEnv(flag("from") ?? "production.admin.env"));
const dst = await connect(loadAdminEnv(flag("to") ?? "authoring.admin.env"));

if (src.pk === dst.pk) {
  console.error(`Source and target are the same project (${src.pk}). Point --from and --to at different projects.`);
  process.exit(1);
}
console.log(`provision  ${src.pk}  ->  ${dst.pk}${DRY ? "   (DRY RUN — nothing is written)" : ""}`);
if (ONLY.length) console.log(`stages: ${ONLY.join(", ")}`);
console.log();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tally = [];
function report(name, { source, created, skipped, failed, errors = [] }) {
  tally.push({ name, created, skipped, failed });
  console.log(
    `${name.padEnd(20)} src ${String(source).padStart(4)}  created ${String(created).padStart(4)}` +
      `  skipped ${String(skipped).padStart(4)}  failed ${String(failed).padStart(3)}`
  );
  for (const e of errors.slice(0, 3)) console.log(`    ${e}`);
}

/** id -> key, per resource type, so later stages can point at what earlier ones made. */
const keyOf = {};
const learn = (typeId, rows) => {
  keyOf[typeId] ??= new Map();
  for (const r of rows) if (r.key) keyOf[typeId].set(r.id, r.key);
};
const ref = (typeId, r) => {
  if (!r) return undefined;
  const key = r.key ?? keyOf[typeId]?.get(r.id);
  return key ? { typeId, key } : undefined;
};
const custom = (c) => (c ? { type: ref("type", c.type), fields: c.fields } : undefined);
/** Drop server-managed fields a draft must not carry. */
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (["id", "version", "createdAt", "lastModifiedAt", "createdBy", "lastModifiedBy", "ancestors", "obj"].includes(k)) continue;
      out[k] = strip(val);
    }
    return out;
  }
  return v;
};

/** Copy one keyed resource type, rewriting references to key-based identifiers. */
async function copyKeyed(name, path, build) {
  const rows = await src.all(path);
  if (!wanted(name)) return rows;
  const existing = new Set((await dst.all(path)).map((r) => r.key).filter(Boolean));
  let created = 0, skipped = 0, failed = 0;
  const errors = [];
  for (const row of rows) {
    const draft = build(row);
    if (!draft) { skipped++; continue; }
    if (draft.key && existing.has(draft.key)) { skipped++; continue; }
    if (DRY) { created++; continue; }
    const r = await dst.post(path, draft);
    if (r.ok) created++;
    else {
      failed++;
      errors.push(`${draft.key ?? "(keyless)"}: ${r.status} ${JSON.stringify(r.body.errors ?? r.body).slice(0, 200)}`);
    }
  }
  report(name, { source: rows.length, created, skipped, failed, errors });
  return rows;
}

// ---------------------------------------------------------------------------
// 1. project settings
// ---------------------------------------------------------------------------

if (wanted("settings")) {
  // A LocalizedString key is a locale, and a product's data can carry locales the
  // project no longer lists — so scan the data rather than trusting its settings.
  const locales = new Set(), currencies = new Set(), countries = new Set();
  const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
  const scanLocalized = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(scanLocalized);
    for (const [k, val] of Object.entries(v)) {
      if (LOCALE_RE.test(k) && typeof val === "string") locales.add(k);
      else scanLocalized(val);
    }
  };

  for (const p of await src.all("/products")) {
    const c = p.masterData?.current;
    if (!c) continue;
    for (const f of ["name", "slug", "description", "metaTitle", "metaDescription", "metaKeywords"]) scanLocalized(c[f]);
    for (const v of [c.masterVariant, ...(c.variants ?? [])]) {
      for (const a of v?.attributes ?? []) scanLocalized(a.value);
      for (const pr of v?.prices ?? []) {
        if (pr.value?.currencyCode) currencies.add(pr.value.currencyCode);
        if (pr.country) countries.add(pr.country);
      }
    }
  }
  for (const c of await src.all("/categories")) for (const f of ["name", "slug", "description"]) scanLocalized(c[f]);
  for (const z of await src.all("/zones")) for (const l of z.locations ?? []) if (l.country) countries.add(l.country);
  for (const t of await src.all("/tax-categories")) for (const r of t.rates ?? []) if (r.country) countries.add(r.country);
  for (const m of await src.all("/shipping-methods")) {
    for (const zr of m.zoneRates ?? []) for (const r of zr.shippingRates ?? []) {
      if (r.price?.currencyCode) currencies.add(r.price.currencyCode);
    }
  }

  const srcProj = (await src.get("")).body;
  const dstProj = (await dst.get("")).body;
  const union = (...lists) => [...new Set(lists.flatMap((l) => [...(l ?? [])]))];
  const want = {
    languages: union(dstProj.languages, srcProj.languages, locales),
    currencies: union(dstProj.currencies, srcProj.currencies, currencies),
    countries: union(dstProj.countries, srcProj.countries, countries),
  };

  const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
  const actions = [];
  if (!same(dstProj.languages, want.languages)) actions.push({ action: "changeLanguages", languages: want.languages });
  if (!same(dstProj.currencies, want.currencies)) actions.push({ action: "changeCurrencies", currencies: want.currencies });
  if (!same(dstProj.countries, want.countries)) actions.push({ action: "changeCountries", countries: want.countries });
  // The console calls POST /products/search whenever a query is typed. `mode` is not
  // optional: the default targets the deprecated ProductProjectionsSearch index, which
  // commercetools refuses to activate on projects created after 31 August 2026.
  if (dstProj.searchIndexing?.productsSearch?.status !== "Activated") {
    actions.push({ action: "changeProductSearchIndexingEnabled", enabled: true, mode: "ProductsSearch" });
  }

  console.log("settings");
  console.log(`  languages  ${JSON.stringify(dstProj.languages)} -> ${JSON.stringify(want.languages)}`);
  console.log(`  currencies ${JSON.stringify(dstProj.currencies)} -> ${JSON.stringify(want.currencies)}`);
  console.log(`  countries  ${JSON.stringify(dstProj.countries)} -> ${JSON.stringify(want.countries)}`);
  console.log(`  product search: ${dstProj.searchIndexing?.productsSearch?.status ?? "not activated"}`);
  if (!actions.length) console.log("  already aligned");
  else if (DRY) console.log(`  would apply: ${actions.map((a) => a.action).join(", ")}`);
  else {
    const r = await dst.post("", { version: dstProj.version, actions });
    if (!r.ok) {
      console.error(`  FAILED ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`  applied: ${actions.map((a) => a.action).join(", ")}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// 2. foundation — everything a product or a promotion points at
// ---------------------------------------------------------------------------

learn("type", await copyKeyed("types", "/types", (t) => strip({
  key: t.key, name: t.name, description: t.description,
  resourceTypeIds: t.resourceTypeIds, fieldDefinitions: t.fieldDefinitions,
})));

learn("tax-category", await copyKeyed("tax-categories", "/tax-categories", (t) => ({
  key: t.key, name: t.name, description: t.description,
  // a rate's id is server-assigned; its key is not
  rates: (t.rates ?? []).map((r) => ({
    name: r.name, amount: r.amount, includedInPrice: r.includedInPrice,
    country: r.country, state: r.state, key: r.key,
    subRates: r.subRates?.length ? r.subRates : undefined,
  })),
})));

learn("product-type", await copyKeyed("product-types", "/product-types", (t) => strip({
  key: t.key, name: t.name, description: t.description, attributes: t.attributes,
})));

learn("zone", await copyKeyed("zones", "/zones", (z) => ({
  key: z.key, name: z.name, description: z.description, locations: z.locations,
})));

learn("channel", await copyKeyed("channels", "/channels", (c) => ({
  key: c.key, name: c.name, description: c.description, roles: c.roles,
  geoLocation: c.geoLocation, custom: custom(c.custom),
})));

learn("customer-group", await copyKeyed("customer-groups", "/customer-groups", (g) => ({
  key: g.key, groupName: g.name,
})));

// A subscription product's prices are scoped by recurrencePolicy as well as by
// currency and country, so these must exist before such a product can be created.
learn("recurrence-policy", await copyKeyed("recurrence-policies", "/recurrence-policies", (r) => ({
  key: r.key, name: r.name, description: r.description, schedule: r.schedule,
})));

learn("state", await copyKeyed("states", "/states", (s) => ({
  key: s.key, type: s.type, name: s.name, description: s.description,
  initial: s.initial, roles: s.roles?.length ? s.roles : undefined,
})));

// ---------------------------------------------------------------------------
// 3. categories — a child cannot be created before its parent
// ---------------------------------------------------------------------------

{
  const rows = await src.all("/categories");
  learn("category", rows);
  if (wanted("categories")) {
    const byId = new Map(rows.map((c) => [c.id, c]));
    const depth = (c) => {
      let d = 0, cur = c;
      while (cur?.parent?.id && byId.has(cur.parent.id) && d < 30) { cur = byId.get(cur.parent.id); d++; }
      return d;
    };
    const ordered = [...rows].sort((a, b) => depth(a) - depth(b));
    const existing = new Set((await dst.all("/categories")).map((r) => r.key).filter(Boolean));
    let created = 0, skipped = 0, failed = 0;
    const errors = [];
    for (const c of ordered) {
      if (existing.has(c.key)) { skipped++; continue; }
      if (DRY) { created++; continue; }
      const r = await dst.post("/categories", {
        key: c.key, name: c.name, slug: c.slug, description: c.description,
        parent: c.parent ? { typeId: "category", key: byId.get(c.parent.id)?.key } : undefined,
        orderHint: c.orderHint, externalId: c.externalId,
        metaTitle: c.metaTitle, metaDescription: c.metaDescription, metaKeywords: c.metaKeywords,
        assets: c.assets?.length ? strip(c.assets) : undefined,
        custom: custom(c.custom),
      });
      if (r.ok) created++;
      else { failed++; errors.push(`${c.key}: ${r.status} ${JSON.stringify(r.body.errors ?? r.body).slice(0, 200)}`); }
    }
    report("categories", { source: rows.length, created, skipped, failed, errors });
  }
}

// ---------------------------------------------------------------------------
// 4. shipping, promotions, stores
// ---------------------------------------------------------------------------

await copyKeyed("shipping-methods", "/shipping-methods", (m) => ({
  key: m.key, name: m.name, localizedName: m.localizedName,
  description: m.description, localizedDescription: m.localizedDescription,
  taxCategory: ref("tax-category", m.taxCategory),
  zoneRates: (m.zoneRates ?? []).map((zr) => ({
    zone: ref("zone", zr.zone),
    shippingRates: (zr.shippingRates ?? []).map((r) => ({
      price: { currencyCode: r.price.currencyCode, centAmount: r.price.centAmount },
      freeAbove: r.freeAbove ? { currencyCode: r.freeAbove.currencyCode, centAmount: r.freeAbove.centAmount } : undefined,
      tiers: r.tiers?.length ? r.tiers : undefined,
    })),
  })),
  active: m.active, isDefault: m.isDefault, predicate: m.predicate, carrier: m.carrier,
  custom: custom(m.custom),
}));

learn("cart-discount", await copyKeyed("cart-discounts", "/cart-discounts", (d) => ({
  key: d.key, name: d.name, description: d.description,
  value: strip(d.value), cartPredicate: d.cartPredicate, target: d.target,
  sortOrder: d.sortOrder, isActive: d.isActive, requiresDiscountCode: d.requiresDiscountCode,
  stackingMode: d.stackingMode, validFrom: d.validFrom, validUntil: d.validUntil,
  custom: custom(d.custom),
})));

await copyKeyed("product-discounts", "/product-discounts", (d) => ({
  key: d.key, name: d.name, description: d.description,
  value: strip(d.value), predicate: d.predicate, sortOrder: d.sortOrder,
  isActive: d.isActive, validFrom: d.validFrom, validUntil: d.validUntil,
}));

await copyKeyed("discount-codes", "/discount-codes", (d) => ({
  // a keyless code still needs something to match on, or a re-run duplicates it
  key: d.key ?? d.code,
  code: d.code, name: d.name, description: d.description,
  cartDiscounts: (d.cartDiscounts ?? []).map((r) => ref("cart-discount", r)).filter(Boolean),
  isActive: d.isActive, cartPredicate: d.cartPredicate,
  maxApplications: d.maxApplications, maxApplicationsPerCustomer: d.maxApplicationsPerCustomer,
  validFrom: d.validFrom, validUntil: d.validUntil,
}));

await copyKeyed("stores", "/stores", (s) => ({
  key: s.key, name: s.name,
  languages: s.languages?.length ? s.languages : undefined,
  countries: s.countries?.length ? s.countries : undefined,
  distributionChannels: (s.distributionChannels ?? []).map((c) => ref("channel", c)).filter(Boolean),
  supplyChannels: (s.supplyChannels ?? []).map((c) => ref("channel", c)).filter(Boolean),
  custom: custom(s.custom),
}));

// ---------------------------------------------------------------------------
// 5. products — two passes
// ---------------------------------------------------------------------------

const srcProducts = await src.all("/products");
const productKeyById = new Map(srcProducts.map((p) => [p.id, p.key]));

if (wanted("products")) {
  const srcTypes = await src.all("/product-types");
  const typeKeyById = new Map(srcTypes.map((t) => [t.id, t.key]));
  const taxKeyById = new Map((await src.all("/tax-categories")).map((t) => [t.id, t.key]));
  // `${productTypeId}:${attrName}` -> { name, elementName }
  const attrKind = new Map();
  for (const t of srcTypes) {
    for (const a of t.attributes ?? []) {
      attrKind.set(`${t.id}:${a.name}`, { name: a.type?.name, elementName: a.type?.elementType?.name });
    }
  }

  const deferred = []; // reference attributes, applied in pass 2
  const isEnum = (n) => n === "enum" || n === "lenum";

  const variantDraft = (ptId, v, sink) => {
    const attributes = [];
    for (const a of v.attributes ?? []) {
      const kind = attrKind.get(`${ptId}:${a.name}`);
      // An enum reads back as { key, label }; on write it is the key alone.
      if (kind && isEnum(kind.name)) attributes.push({ name: a.name, value: a.value?.key ?? a.value });
      else if (kind?.name === "set" && isEnum(kind.elementName)) {
        attributes.push({ name: a.name, value: (a.value ?? []).map((x) => x?.key ?? x) });
      } else if (kind && (kind.name === "reference" || (kind.name === "set" && kind.elementName === "reference"))) {
        // cannot resolve until the product it points at exists
        if (a.value != null) sink.push({ name: a.name, value: a.value });
      } else attributes.push({ name: a.name, value: a.value });
    }
    return {
      sku: v.sku,
      key: v.key,
      prices: (v.prices ?? []).map((p) => ({
        key: p.key,
        value: { currencyCode: p.value.currencyCode, centAmount: p.value.centAmount },
        country: p.country,
        channel: ref("channel", p.channel),
        customerGroup: ref("customer-group", p.customerGroup),
        // part of a price's uniqueness scope — dropping it turns a subscription
        // product's per-interval prices into duplicates and the create is rejected
        recurrencePolicy: ref("recurrence-policy", p.recurrencePolicy),
        validFrom: p.validFrom,
        validUntil: p.validUntil,
      })),
      images: (v.images ?? []).map((i) => ({ url: i.url, dimensions: i.dimensions, label: i.label })),
      attributes,
    };
  };

  const existing = new Set((await dst.all("/products")).map((p) => p.key).filter(Boolean));
  let created = 0, skipped = 0, failed = 0;
  const errors = [];
  for (const p of srcProducts) {
    if (p.key && existing.has(p.key)) { skipped++; continue; }
    const c = p.masterData.current;
    const ptId = p.productType.id;
    const sink = [];
    const draft = {
      key: p.key,
      productType: { typeId: "product-type", key: typeKeyById.get(ptId) },
      name: c.name, slug: c.slug, description: c.description,
      metaTitle: c.metaTitle, metaDescription: c.metaDescription, metaKeywords: c.metaKeywords,
      categories: (c.categories ?? []).map((r) => ref("category", r)).filter(Boolean),
      taxCategory: p.taxCategory ? { typeId: "tax-category", key: taxKeyById.get(p.taxCategory.id) } : undefined,
      masterVariant: variantDraft(ptId, c.masterVariant, sink),
      variants: (c.variants ?? []).map((v) => variantDraft(ptId, v, sink)),
      // an empty searchKeywords reads back as [] but must be an object on write
      searchKeywords: Array.isArray(c.searchKeywords) ? undefined : c.searchKeywords,
      publish: true,
    };
    for (const d of sink) deferred.push({ productKey: p.key, ...d });
    if (DRY) { created++; continue; }
    const r = await dst.post("/products", draft);
    if (r.ok) created++;
    else { failed++; errors.push(`${p.key}: ${r.status} ${JSON.stringify(r.body.errors ?? r.body).slice(0, 220)}`); }
    if ((created + failed) && (created + failed) % 50 === 0) console.log(`  ... ${created + failed} products`);
  }
  report("products", { source: srcProducts.length, created, skipped, failed, errors });

  // pass 2 — a reference ATTRIBUTE takes { typeId, id }, not a key, so resolve target ids
  if (deferred.length && !DRY) {
    const targetIdByKey = new Map((await dst.all("/products")).map((p) => [p.key, p.id]));
    const byProduct = new Map();
    for (const d of deferred) {
      if (!byProduct.has(d.productKey)) byProduct.set(d.productKey, []);
      byProduct.get(d.productKey).push(d);
    }
    let set = 0, setFailed = 0;
    const setErrors = [];
    for (const [productKey, items] of byProduct) {
      const target = (await dst.get(`/products/key=${encodeURIComponent(productKey)}`)).body;
      if (!target?.id) { setFailed++; continue; }
      const remap = (r) => {
        const id = targetIdByKey.get(productKeyById.get(r.id));
        return id ? { typeId: r.typeId, id } : null;
      };
      const actions = [];
      for (const it of items) {
        const value = Array.isArray(it.value) ? it.value.map(remap).filter(Boolean) : remap(it.value);
        if (!value || (Array.isArray(value) && !value.length)) continue;
        actions.push({ action: "setAttributeInAllVariants", name: it.name, value, staged: false });
      }
      if (!actions.length) continue;
      const r = await dst.post(`/products/${target.id}`, { version: target.version, actions });
      if (r.ok) set += actions.length;
      else { setFailed++; setErrors.push(`${productKey}: ${r.status} ${JSON.stringify(r.body.errors ?? r.body).slice(0, 200)}`); }
    }
    report("product refs", { source: deferred.length, created: set, skipped: 0, failed: setFailed, errors: setErrors });
  }
}

// ---------------------------------------------------------------------------
// 6. inventory and custom objects
// ---------------------------------------------------------------------------

if (wanted("inventory")) {
  const rows = await src.all("/inventory");
  // unique on (sku, supplyChannel) rather than on key
  const dstChannelKeyById = new Map((await dst.all("/channels")).map((c) => [c.id, c.key]));
  const existing = new Set(
    (await dst.all("/inventory")).map((e) => `${e.sku}|${e.supplyChannel ? dstChannelKeyById.get(e.supplyChannel.id) ?? "-" : "-"}`)
  );
  let created = 0, skipped = 0, failed = 0;
  const errors = [];
  for (const e of rows) {
    const chKey = e.supplyChannel ? keyOf["channel"]?.get(e.supplyChannel.id) : undefined;
    if (existing.has(`${e.sku}|${chKey ?? "-"}`)) { skipped++; continue; }
    if (DRY) { created++; continue; }
    const r = await dst.post("/inventory", {
      key: e.key, sku: e.sku,
      supplyChannel: chKey ? { typeId: "channel", key: chKey } : undefined,
      quantityOnStock: e.quantityOnStock,
      restockableInDays: e.restockableInDays,
      expectedDelivery: e.expectedDelivery,
    });
    if (r.ok) created++;
    else { failed++; errors.push(`${e.sku}: ${r.status} ${JSON.stringify(r.body.errors ?? r.body).slice(0, 180)}`); }
    if ((created + failed) && (created + failed) % 250 === 0) console.log(`  ... ${created + failed} inventory entries`);
  }
  report("inventory", { source: rows.length, created, skipped, failed, errors });
}

if (wanted("custom-objects")) {
  const rows = await src.all("/custom-objects");
  const existing = new Set((await dst.all("/custom-objects")).map((o) => `${o.container}/${o.key}`));
  let created = 0, skipped = 0, failed = 0;
  const errors = [];
  for (const o of rows) {
    if (existing.has(`${o.container}/${o.key}`)) { skipped++; continue; }
    if (DRY) { created++; continue; }
    const r = await dst.post("/custom-objects", { container: o.container, key: o.key, value: o.value });
    if (r.ok) created++;
    else { failed++; errors.push(`${o.container}/${o.key}: ${r.status} ${JSON.stringify(r.body.errors ?? r.body).slice(0, 180)}`); }
  }
  report("custom-objects", { source: rows.length, created, skipped, failed, errors });
}

// ---------------------------------------------------------------------------
// 7. verify
// ---------------------------------------------------------------------------

if (VERIFY && !DRY) {
  console.log("\nverifying every copied product against the source");
  const summarise = (p) => {
    const c = p.masterData.current;
    const vs = [c.masterVariant, ...(c.variants ?? [])];
    return {
      published: p.masterData.published,
      locales: Object.keys(c.name ?? {}).sort(),
      categories: (c.categories ?? []).length,
      variants: vs.length,
      skus: vs.map((v) => v.sku).sort(),
      prices: vs.flatMap((v) => (v.prices ?? []).map((pr) =>
        `${pr.value.currencyCode}${pr.value.centAmount}${pr.country ?? ""}${pr.channel ? "#ch" : ""}${pr.recurrencePolicy ? "#rec" : ""}`)).sort(),
      images: vs.flatMap((v) => (v.images ?? []).map((i) => i.url)).sort(),
      attrs: vs.flatMap((v) => (v.attributes ?? []).map((a) => a.name)).sort(),
    };
  };
  let identical = 0, differ = 0;
  for (const p of srcProducts) {
    if (!p.key) continue;
    const d = (await dst.get(`/products/key=${encodeURIComponent(p.key)}`)).body;
    if (!d?.id) { differ++; console.log(`  MISSING  ${p.key}`); continue; }
    const a = summarise(p), b = summarise(d);
    if (JSON.stringify(a) === JSON.stringify(b)) identical++;
    else {
      differ++;
      console.log(`  DIFFERS  ${p.key}`);
      for (const f of Object.keys(a)) {
        if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) {
          console.log(`      ${f}: src=${JSON.stringify(a[f]).slice(0, 80)} dst=${JSON.stringify(b[f]).slice(0, 80)}`);
        }
      }
    }
  }
  console.log(`  ${identical}/${identical + differ} identical`);
  if (differ) tally.push({ name: "verify", created: identical, skipped: 0, failed: differ });
}

// ---------------------------------------------------------------------------

console.log("\nsummary");
for (const t of tally) {
  console.log(`  ${t.name.padEnd(20)} ${t.created} created, ${t.skipped} skipped, ${t.failed} failed${t.failed ? "   <-- FAILURES" : ""}`);
}
console.log("\nnot copied: customers (a password cannot be exported — run tools/seed-auth-customers.mjs)");
console.log("            orders    (run tools/seed-demo-orders.mjs for dashboard data)");
if (DRY) console.log("\nDRY RUN — nothing was written.");

const anyFailed = tally.some((t) => t.failed);
if (anyFailed) console.log("\nSome rows failed. Re-running is safe: whatever succeeded is skipped.");
process.exit(anyFailed ? 1 : 0);
