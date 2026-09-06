/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * util.mjs — shared helpers for the deploy pipeline.
 */

// typeId → REST collection endpoint (for id→key resolution and upserts).
export const ENDPOINT_BY_TYPEID = {
  category: 'categories',
  product: 'products',
  'product-type': 'product-types',
  'customer-group': 'customer-groups',
  channel: 'channels',
  'tax-category': 'tax-categories',
  state: 'states',
  store: 'stores',
  'discount-group': 'discount-groups',
  'cart-discount': 'cart-discounts',
  'product-discount': 'product-discounts',
  zone: 'zones',
  'product-selection': 'product-selections',
  type: 'types',
};

// commercetools UUID shape (ids embedded in predicate strings).
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Fields the platform generates — never carried across projects.
const VOLATILE = ['id', 'version', 'createdAt', 'lastModifiedAt', 'lastModifiedBy', 'createdBy', 'references'];
export function stripVolatile(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of VOLATILE) delete out[k];
  return out;
}

export const LANGS = ['en-US', 'en', 'es-MX', 'pt-BR'];
export function pickName(o) {
  const n = o?.name;
  if (!n) return o?.key || o?.id || 'unnamed';
  if (typeof n === 'string') return n;
  for (const l of LANGS) if (n[l]) return n[l];
  return Object.values(n)[0] || o.key || o.id;
}

export function money(v) {
  if (!v) return '';
  const amt = (v.centAmount ?? 0) / 10 ** (v.fractionDigits ?? 2);
  return `${amt.toFixed(v.fractionDigits ?? 2)} ${v.currencyCode || ''}`.trim();
}

// A price's cross-project-stable identity (scope) — used to reconcile prices
// when a variant's price keys somehow differ. Mirrors the backfill key scheme.
export function priceScopeKey(p, channelKeyById = {}, cgKeyById = {}) {
  const parts = [p.value?.currencyCode];
  if (p.country) parts.push(p.country);
  if (p.customerGroup) parts.push('cg-' + (cgKeyById[p.customerGroup.id] || p.customerGroup.key || p.customerGroup.id));
  if (p.channel) parts.push('ch-' + (channelKeyById[p.channel.id] || p.channel.key || p.channel.id));
  if (p.validFrom) parts.push('vf-' + p.validFrom);
  if (p.validUntil) parts.push('vu-' + p.validUntil);
  return parts.join('|');
}

// stable JSON stringify (sorted keys) for content hashing
export function stableStringify(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((s, k) => ((s[k] = v[k]), s), {});
    }
    return v;
  });
}

// FNV-1a content hash of any JSON-serializable value (stable key order).
// Used for three-way merge detection on canonical asset content.
export function contentHash(obj) {
  const str = stableStringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
