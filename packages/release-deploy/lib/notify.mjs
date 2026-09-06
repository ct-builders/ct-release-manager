/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * notify.mjs — best-effort email notifications for release lifecycle transitions.
 *
 * Who gets emailed, and when:
 *   submitted  (draft → ready-for-review)  → every REVIEWER   (approve capability)
 *   approved   (→ approved)                → every PUBLISHER   (publish capability)
 *   published  (approved → published)      → the release AUTHOR
 *   rejected   (ready-for-review → draft)  → the release AUTHOR
 *
 * Recipients for the role-based events (submitted/approved) are resolved from the
 * `release-acl` ACL on the STAGE project (see acl.mjs) — an author submitting notifies
 * everyone who can approve; a reviewer approving notifies everyone who can publish.
 * Author events (published/rejected) go to `release.author`, which is an email in
 * this system. The acting user (`by`) is never emailed about their own action.
 *
 * Sending is BEST-EFFORT and NON-BLOCKING: notifyTransition() never throws and is
 * bounded by a timeout, so a mail failure (bad key, provider down, missing config)
 * can never break a lifecycle transition — hence callers may `await` it safely.
 * With no provider configured it falls back to the `log` transport, which just
 * prints the intended message to the service log (handy on Cloud Run, and lets the
 * workflow run without wiring a real email account).
 *
 * Configured entirely by env — see readConfig() and .env.example:
 *   EMAIL_ENABLED           master switch ("false" disables; default on)
 *   EMAIL_PROVIDER          resend | sendgrid | postmark | log (auto-detected from
 *                           whichever *_API_KEY is set, else "log")
 *   EMAIL_FROM              sender, e.g. `Release Service <releases@example.com>`
 *   EMAIL_REPLY_TO          optional reply-to address
 *   EMAIL_TIMEOUT_MS        provider HTTP timeout (default 5000)
 *   EMAIL_RELEASE_LINK_BASE optional; a `${base}/${key}` deep-link into the MC app
 *   RESEND_API_KEY | SENDGRID_API_KEY | POSTMARK_SERVER_TOKEN
 */
import { listAcl, capabilities } from './acl.mjs';

const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const norm = (s) => String(s || '').trim().toLowerCase();

// member field → [singular, plural] for the "3 products, 1 category" summary line
const MEMBER_LABELS = {
  products: ['product', 'products'],
  categories: ['category', 'categories'],
  cartDiscounts: ['cart discount', 'cart discounts'],
  productDiscounts: ['product discount', 'product discounts'],
  discountCodes: ['discount code', 'discount codes'],
  discountGroups: ['discount group', 'discount groups'],
};

export function readConfig(env = process.env) {
  let provider = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (!provider) {
    provider = env.RESEND_API_KEY ? 'resend'
      : env.SENDGRID_API_KEY ? 'sendgrid'
      : env.POSTMARK_SERVER_TOKEN ? 'postmark'
      : 'log';
  }
  const apiKey = provider === 'resend' ? env.RESEND_API_KEY
    : provider === 'sendgrid' ? env.SENDGRID_API_KEY
    : provider === 'postmark' ? env.POSTMARK_SERVER_TOKEN
    : '';
  return {
    enabled: norm(env.EMAIL_ENABLED ?? 'true') !== 'false',
    provider,
    apiKey: apiKey || '',
    from: env.EMAIL_FROM || 'Release Service <releases@example.com>',
    replyTo: env.EMAIL_REPLY_TO || '',
    timeoutMs: Number(env.EMAIL_TIMEOUT_MS) || 5000,
    linkBase: (env.EMAIL_RELEASE_LINK_BASE || '').replace(/\/$/, ''),
  };
}

// list of emails from the ACL that hold a given capability (approve/publish/…)
export async function recipientsForCapability(stage, capability) {
  const acl = await listAcl(stage).catch(() => []);
  return acl
    .filter((u) => u && capabilities(u.roles || [])[capability])
    .map((u) => norm(u.email))
    .filter(isEmail);
}

function memberSummary(members = {}) {
  const parts = [];
  for (const [field, [one, many]] of Object.entries(MEMBER_LABELS)) {
    const n = (members?.[field] || []).length;
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.length ? parts.join(', ') : 'no members';
}

// "Name <addr>" → { name?, email } for providers that want a structured sender
function parseAddr(s) {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(s || '');
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: String(s || '').trim() };
}

// Build subject + text + html for one event. Pure — easy to unit-test.
export function buildMessage(event, release, { by, note, linkBase } = {}) {
  const key = release.key;
  const title = release.title || key;
  const actor = by || 'someone';
  const members = memberSummary(release.members);
  const link = linkBase ? `${linkBase}/${encodeURIComponent(key)}` : '';

  let subject, lead, extra = '';
  switch (event) {
    case 'submitted':
      subject = `Release "${title}" is ready for review`;
      lead = `${actor} submitted release "${key}" for review.`;
      extra = 'Please review and approve or send it back.';
      break;
    case 'approved':
      subject = `Release "${title}" approved — ready to publish`;
      lead = `${actor} approved release "${key}".`;
      extra = 'It is ready to publish to production.';
      break;
    case 'published':
      subject = `Release "${title}" published to production`;
      lead = `Release "${key}" was published to production${by ? ` by ${by}` : ''}.`;
      break;
    case 'rejected':
      subject = `Release "${title}" was sent back`;
      lead = `${actor} sent release "${key}" back for revisions.`;
      extra = note ? `Reason: ${note}` : '';
      break;
    default:
      subject = `Release "${title}" updated`;
      lead = `Release "${key}" changed (${event}).`;
  }

  const textLines = [lead, '', `Contents: ${members}.`];
  if (extra) textLines.push('', extra);
  if (link) textLines.push('', `Open the release: ${link}`);
  textLines.push('', '— the reference deployment Release Deployments');
  const text = textLines.join('\n');

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const button = link
    ? `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#e60012;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">Open release</a></p>`
    : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:10px">
  <p style="margin:0 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#e60012;font-weight:700">the reference deployment Release Deployments</p>
  <h2 style="margin:0 0 12px;font-size:20px">${esc(subject)}</h2>
  <p style="margin:0 0 12px;line-height:1.5">${esc(lead)}</p>
  <p style="margin:0 0 12px;line-height:1.5;color:#555">Contents: ${esc(members)}.</p>
  ${extra ? `<p style="margin:0 0 12px;line-height:1.5">${esc(extra)}</p>` : ''}
  ${button}
</div>`;

  return { subject, text, html };
}

// low-level provider send. May throw (network / abort) — callers guard.
async function send(cfg, { to, subject, text, html }) {
  const needsKey = cfg.provider !== 'log';
  if (!needsKey || !cfg.apiKey) {
    if (needsKey && !cfg.apiKey) console.warn(`[notify] provider "${cfg.provider}" has no API key — logging instead of sending`);
    console.log(`[notify] (log) to=${to.join(', ')} subject="${subject}"`);
    return { ok: true, provider: 'log' };
  }
  const signal = AbortSignal.timeout(cfg.timeoutMs);
  const from = parseAddr(cfg.from);

  if (cfg.provider === 'resend') {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to, subject, text, html, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) }),
    });
    return { ok: r.status < 300, status: r.status, provider: 'resend' };
  }
  if (cfg.provider === 'sendgrid') {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: to.map((email) => ({ email })) }],
        from, subject,
        content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
        ...(cfg.replyTo ? { reply_to: { email: cfg.replyTo } } : {}),
      }),
    });
    return { ok: r.status < 300, status: r.status, provider: 'sendgrid' };
  }
  if (cfg.provider === 'postmark') {
    const r = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST', signal,
      headers: { 'X-Postmark-Server-Token': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ From: cfg.from, To: to.join(','), Subject: subject, TextBody: text, HtmlBody: html, ...(cfg.replyTo ? { ReplyTo: cfg.replyTo } : {}) }),
    });
    return { ok: r.status < 300, status: r.status, provider: 'postmark' };
  }
  console.warn(`[notify] unknown provider "${cfg.provider}" — logging instead`);
  console.log(`[notify] (log) to=${to.join(', ')} subject="${subject}"`);
  return { ok: true, provider: 'log' };
}

/**
 * Fire a notification for one lifecycle event. BEST-EFFORT: never throws; returns
 * a small result object describing what happened (for logs/tests).
 *
 * @param stage    a ct client for the STAGE project (used to resolve ACL recipients)
 * @param release  the release object AFTER the transition (for status/members/author)
 * @param opts     { event: 'submitted'|'approved'|'published'|'rejected', by, note }
 */
export async function notifyTransition(stage, release, { event, by, note } = {}) {
  try {
    if (!release || !event) return { skipped: 'missing release or event' };
    const cfg = readConfig();
    if (!cfg.enabled) return { skipped: 'disabled (EMAIL_ENABLED=false)' };

    let to;
    if (event === 'submitted') to = await recipientsForCapability(stage, 'approve');
    else if (event === 'approved') to = await recipientsForCapability(stage, 'publish');
    else if (event === 'published' || event === 'rejected') to = [norm(release.author)].filter(isEmail);
    else return { skipped: `unknown event "${event}"` };

    const actor = norm(by);
    to = [...new Set(to)].filter((e) => e && e !== actor); // never email the actor about their own action
    if (!to.length) {
      console.log(`[notify] ${event} release=${release.key}: no recipients`);
      return { skipped: 'no recipients', event };
    }

    const msg = buildMessage(event, release, { by, note, linkBase: cfg.linkBase });
    const r = await send(cfg, { to, ...msg });
    console.log(`[notify] ${event} release=${release.key} → ${to.join(', ')} via ${r.provider} (${r.ok ? 'ok' : `failed ${r.status || ''}`})`);
    return { sent: !!r.ok, event, to, provider: r.provider, status: r.status };
  } catch (e) {
    console.error(`[notify] error (${event} ${release?.key}):`, e?.message || e);
    return { error: String(e?.message || e), event };
  }
}

// Send one sample email to `to` via the configured provider — for verifying
// EMAIL_* config end-to-end without driving a whole release cycle. Not guarded:
// the caller (bin/notify-test.mjs) wants to see the real error.
export async function sendTest(to, { event = 'submitted' } = {}) {
  const cfg = readConfig();
  const sample = {
    key: 'sample-release', title: 'Sample Release', author: to,
    members: { products: ['brake-pad', 'oil-filter'], categories: ['brakes'], cartDiscounts: [], productDiscounts: [], discountCodes: [], discountGroups: [] },
  };
  const msg = buildMessage(event, sample, { by: 'notify-test', linkBase: cfg.linkBase });
  return { provider: cfg.provider, ...(await send(cfg, { to: [to], ...msg })) };
}
