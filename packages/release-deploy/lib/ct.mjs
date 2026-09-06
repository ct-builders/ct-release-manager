/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * ct.mjs — two-project commercetools admin client factory.
 *
 * ctClient('live') / ctClient('stage') each return a client scoped to one
 * project. Credentials resolve from, in order: the real process environment,
 * this package's own `.env`, then the monorepo root `.env` — the last being
 * where credentials shared with the other packages belong.
 *
 * For each field the PREFIXED var wins (`LIVE_CTP_*` / `STAGE_CTP_*`) and the
 * un-prefixed `CTP_*` is the fallback. So a config that sets only `CTP_*`
 * resolves BOTH projects to the same one, which is the live→live self-test:
 * serialize a bundle out and deploy it straight back, and every resource should
 * come back a no-op. It is also the trap to know about — a half-configured
 * deployment does not fail, it aims every write at one project.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
let loaded = false;
function ensureEnv() {
  if (loaded) return;
  loadDotenv(path.join(HERE, '..', '.env'));                     // packages/release-deploy/.env
  loadDotenv(path.join(HERE, '..', '..', '..', '.env'));          // monorepo root .env (shared)
  loaded = true;
}
// load the repo's .env into process.env (idempotent) — for tools that read config
// (e.g. EMAIL_*) without needing a ct client.
export function loadEnv() { ensureEnv(); }

function creds(which) {
  ensureEnv();
  const P = which.toUpperCase(); // LIVE / STAGE
  const pick = (name) => process.env[`${P}_${name}`] ?? process.env[name];
  const out = {
    pk: pick('CTP_PROJECT_KEY'),
    id: pick('CTP_CLIENT_ID'),
    secret: pick('CTP_CLIENT_SECRET'),
    auth: (pick('CTP_AUTH_URL') || '').replace(/\/$/, ''),
    api: (pick('CTP_API_URL') || '').replace(/\/$/, ''),
  };
  const missing = Object.entries(out).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`[${which}] missing creds: ${missing.join(', ')} (set ${P}_CTP_* or CTP_* — see .env.example)`);
  return out;
}

export async function ctClient(which = 'live') {
  const { pk, id, secret, auth, api } = creds(which);
  const res = await fetch(`${auth}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: `grant_type=client_credentials&scope=manage_project:${pk}`,
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error(`[${which}] auth failed: ` + JSON.stringify(tok));
  const H = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };

  const get = async (p) => (await fetch(`${api}/${pk}${p}`, { headers: H })).json();
  const post = async (p, body) => {
    const r = await fetch(`${api}/${pk}${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status < 300, status: r.status, body: b };
  };
  const del = async (p) => {
    const r = await fetch(`${api}/${pk}${p}`, { method: 'DELETE', headers: H });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status < 300, status: r.status, body: b };
  };
  const byKey = async (resource, key) => {
    const r = await fetch(`${api}/${pk}/${resource}/key=${encodeURIComponent(key)}`, { headers: H });
    return r.status === 200 ? r.json() : null;
  };
  // page through a query endpoint (offset-based; capped at offset 10000 by CT)
  const all = async (path, pageSize = 200) => {
    const out = [];
    let offset = 0;
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const body = await get(`${path}${sep}limit=${pageSize}&offset=${offset}&withTotal=false`);
      if (!body || !Array.isArray(body.results)) throw new Error(`bad response for ${path}: ${JSON.stringify(body).slice(0, 200)}`);
      out.push(...body.results);
      if (body.results.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  };
  // cursor pagination (sort=id asc + where id > lastId) — no 10000-offset ceiling
  const allByCursor = async (path, pageSize = 500) => {
    const out = [];
    let lastId = null;
    for (;;) {
      const params = [`limit=${pageSize}`, 'withTotal=false', `sort=${encodeURIComponent('id asc')}`];
      if (lastId) params.push(`where=${encodeURIComponent(`id > "${lastId}"`)}`);
      const sep = path.includes('?') ? '&' : '?';
      const body = await get(`${path}${sep}${params.join('&')}`);
      if (!body || !Array.isArray(body.results)) throw new Error(`bad response for ${path}: ${JSON.stringify(body).slice(0, 200)}`);
      out.push(...body.results);
      if (body.results.length < pageSize) break;
      lastId = body.results[body.results.length - 1].id;
    }
    return out;
  };
  return { which, pk, api, get, post, del, byKey, all, allByCursor, __refKeyCache: new Map() };
}
