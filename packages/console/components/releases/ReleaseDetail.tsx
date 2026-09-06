/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/console/StatusBadge";
import MemberPicker from "./MemberPicker";
import {
  previewAction,
  transitionAction,
  stagePublishAction,
  deployAction,
  immediateDeployAction,
  undeployAction,
  saveMembersAction,
  mergePreviewAction,
  mergeReleaseAction,
} from "@/lib/actions";
import {
  MEMBER_KINDS,
  type Actor,
  type CatalogMembers,
  type Release,
  type ReleaseMembers,
  type ValidateResult,
  type DiffResult,
  type MergeResult,
  type MergeResolutions,
} from "@/lib/types";
import { LOCALE, STOREFRONTS } from "@/lib/config";

type Msg = { ok: boolean; text: string } | null;
type Preview = { validate: ValidateResult; diff: DiffResult } | null;

const btnPrimary =
  "rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50";
const btnSecondary =
  "rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition hover:bg-black/[.04] disabled:opacity-50";
const card = "mb-4 rounded-xl border border-border bg-surface p-5";

/** Render a merge field value for humans: localized → the configured locale, else compact JSON. */
function displayVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v || "(empty)";
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o[LOCALE] === "string") return (o[LOCALE] as string) || "(empty)";
  }
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}
const MERGE_STATE_LABEL: Record<string, string> = {
  mergeable: "ready to merge",
  add: "new — will be added",
  conflict: "conflict",
  merged: "merged",
  unchanged: "no change",
};

/** Staging storefronts configured for previewing a release, in display order. */
const STAGE_SITES = (["b2c", "b2b"] as const).filter((s) => !!STOREFRONTS[s === "b2c" ? "stagingB2C" : "stagingB2B"]);
const stageStoreUrl = (s: "b2c" | "b2b") => STOREFRONTS[s === "b2c" ? "stagingB2C" : "stagingB2B"];

export default function ReleaseDetail({
  release,
  actor,
  catalog,
  merge: initialMerge = null,
  productDisplay = {},
}: {
  release: Release;
  actor: Actor | null;
  catalog: CatalogMembers | null;
  merge?: MergeResult | null;
  productDisplay?: Record<string, { name?: string; image?: string; pdp?: string }>;
}) {
  const router = useRouter();
  // which storefront to preview the release in (B2C or B2B — both read the same staging project)
  const [site, setSite] = useState<"b2c" | "b2b">(STAGE_SITES[0] ?? "b2c");
  const storeBase = stageStoreUrl(site);
  const can = actor?.can ?? { edit: true, approve: true, publish: true, admin: true };

  // key → display name, per member kind, from the catalog
  const catNames = useMemo(() => {
    const map: Partial<Record<(typeof MEMBER_KINDS)[number]["key"], Record<string, string>>> = {};
    if (catalog) {
      for (const kind of MEMBER_KINDS) {
        map[kind.key] = Object.fromEntries((catalog[kind.key] || []).map((o) => [o.key, o.name || o.key]));
      }
    }
    return map;
  }, [catalog]);

  const nameOf = (kind: (typeof MEMBER_KINDS)[number]["key"], key: string) =>
    (kind === "products" && productDisplay[key]?.name) || catNames[kind]?.[key] || key;

  const [preview, setPreview] = useState<Preview>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [editingMembers, setEditingMembers] = useState(false);
  const [draftMembers, setDraftMembers] = useState<Partial<ReleaseMembers>>({});

  const refresh = () => router.refresh();

  // ---- merge to main (field-level three-way) ----
  const [merge, setMerge] = useState<MergeResult | null>(initialMerge);
  const [resolutions, setResolutions] = useState<MergeResolutions>({});
  const hasBranch = !!release.branchId && release.branchId !== "main";
  const mergeAssets = merge?.assets ?? [];
  // assets that still carry unmerged working-copy edits (must be folded before ship)
  const pendingMerge = mergeAssets.filter((a) => a.state === "mergeable" || a.state === "add" || a.state === "conflict");
  const mergeConflicts = merge?.conflicts ?? [];
  const needsMerge = pendingMerge.length > 0;
  const resKey = (c: { canonicalKey: string; field: string }) => `${c.canonicalKey}:${c.field}`;
  const allConflictsResolved = mergeConflicts.every((c) => !!resolutions[resKey(c)]);

  async function refreshMerge() {
    const res = await mergePreviewAction(release.key);
    if (res.ok && res.data) setMerge(res.data);
  }

  async function doMerge() {
    setBusy("merge");
    setMsg(null);
    const res = await mergeReleaseAction(release.key, resolutions);
    if (res.ok) {
      setResolutions({});
      await refreshMerge(); // re-preview so the ship gate reflects the now-merged trunk
      const failed = (res.data.merged || []).filter((m) => m.action === "error");
      const n = (res.data.merged || []).filter((m) => m.action === "merged" || m.action === "added").length;
      if (failed.length) {
        // The service call itself succeeded, but one or more assets failed to write
        // onto the trunk — surface that as an error, not a false "folded onto the
        // trunk" success (the ship gate stays closed since refreshMerge() will still
        // show these assets as pending).
        setMsg({ ok: false, text: `Merge failed for ${failed.length} asset(s): ${failed.map((m) => m.error).join("; ")}` });
      } else {
        setMsg({ ok: true, text: `Merged to main — ${n} asset(s) folded onto the trunk. Ready to ship.` });
      }
      refresh();
    } else if (res.conflicts) {
      setMerge(res.conflicts);
      setMsg({ ok: false, text: `Merge conflict — pick a value for each field below, then merge.` });
    } else {
      setMsg({ ok: false, text: res.error });
    }
    setBusy(null);
  }

  async function runPreview() {
    setBusy("preview");
    setMsg(null);
    const res = await previewAction(release.key);
    setBusy(null);
    if (res.ok && res.data) setPreview(res.data);
    else setMsg({ ok: false, text: res.ok ? "error" : res.error });
  }

  async function doTransition(to: string, note?: string) {
    setBusy(to);
    setMsg(null);
    const res = await transitionAction(release.key, to, note);
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: note ? "Sent back to draft" : `Moved to ${to.replace(/-/g, " ")}` });
      refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  function doReject() {
    const note = window.prompt("Reason for sending this release back (required):");
    if (note === null) return;
    if (!note.trim()) {
      setMsg({ ok: false, text: "A note is required to send back." });
      return;
    }
    doTransition("draft", note.trim());
  }

  async function doStagePublish() {
    setBusy("stage-publish");
    setMsg(null);
    const res = await stagePublishAction(release.key);
    setBusy(null);
    if (res.ok && res.data) {
      const s = res.data;
      setMsg({
        ok: (s.error ?? 0) === 0,
        text: `Published to staging (${s.total ?? 0} products): ${s.published ?? 0} published, ${s.alreadyPublished ?? 0} already live on staging.`,
      });
      refresh();
    } else setMsg({ ok: false, text: res.ok ? "error" : res.error });
  }

  async function doDeploy() {
    if (!window.confirm(`Ship release "${release.key}" to PRODUCTION (live)? This writes to the live project.`)) return;
    setBusy("deploy");
    setMsg(null);
    const res = await deployAction(release.key, true);
    setBusy(null);
    if (res.ok && res.data) {
      const s = res.data;
      setMsg({
        ok: s.error === 0,
        text: `Shipped to production: ${s.create} created, ${s.update} updated, ${s.noop} unchanged, ${s.error} errors.`,
      });
      refresh();
      runPreview();
    } else setMsg({ ok: false, text: res.ok ? "error" : res.error });
  }

  async function doUndeploy() {
    if (
      !window.confirm(
        `Roll back release "${release.key}" on PRODUCTION (live)? This restores whatever live looked like ` +
          `just before this release's most recent ship — deleting what it created and reverting what it updated.`
      )
    )
      return;
    setBusy("undeploy");
    setMsg(null);
    const res = await undeployAction(release.key);
    setBusy(null);
    if (res.ok && res.data) {
      const s = res.data;
      setMsg({
        ok: s.error === 0,
        text: `Rolled back on production: ${s.create} created, ${s.update} updated, ${s.noop} unchanged, ${s.error} errors.`,
      });
      refresh();
      runPreview();
    } else setMsg({ ok: false, text: res.ok ? "error" : res.error });
  }

  async function doImmediateDeploy() {
    if (
      !window.confirm(
        `INSTANT DEPLOY (admin): ship release "${release.key}" straight to PRODUCTION now?\n\n` +
          `This skips review and approval and writes to the live project immediately, marking the release published.`
      )
    )
      return;
    setBusy("immediate");
    setMsg(null);
    const res = await immediateDeployAction(release.key);
    setBusy(null);
    if (res.ok && res.data) {
      const s = res.data;
      setMsg({
        ok: s.error === 0,
        text: `Instant deploy → production: ${s.create} created, ${s.update} updated, ${s.noop} unchanged, ${s.error} errors.`,
      });
      refresh();
      runPreview();
    } else setMsg({ ok: false, text: res.ok ? "error" : res.error });
  }

  function startEditMembers() {
    setDraftMembers({ ...(release.members || {}) });
    setEditingMembers(true);
  }
  async function saveMembers() {
    setBusy("members");
    setMsg(null);
    const res = await saveMembersAction(release.key, draftMembers);
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: "Items updated" });
      setEditingMembers(false);
      setPreview(null);
      refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  const disabled = busy !== null;
  const hint = (text: string) => <span className="text-sm text-muted">{text}</span>;

  const actions: React.ReactNode = (() => {
    switch (release.status) {
      case "draft":
        return can.edit ? (
          <button className={btnPrimary} disabled={disabled} onClick={doStagePublish}>
            {busy === "stage-publish" ? "Publishing to staging…" : "Publish to staging for review"}
          </button>
        ) : (
          hint("You need the author role to send this for review.")
        );
      case "ready-for-review":
        return (
          <>
            {can.approve ? (
              <>
                <button className={btnPrimary} disabled={disabled} onClick={() => doTransition("approved")}>
                  Approve
                </button>
                <button className={btnSecondary} disabled={disabled} onClick={doReject}>
                  Send back
                </button>
              </>
            ) : (
              hint("You need the reviewer role to approve or send back.")
            )}
            {can.edit && (
              <button className={btnSecondary} disabled={disabled} onClick={doStagePublish}>
                Re-publish to staging
              </button>
            )}
          </>
        );
      case "approved":
        return (
          <>
            {can.publish ? (
              <button
                className={btnPrimary}
                disabled={disabled || needsMerge}
                onClick={doDeploy}
                title={needsMerge ? "Merge this release to main before shipping" : ""}
              >
                {busy === "deploy" ? "Shipping to production…" : "Ship to production"}
              </button>
            ) : (
              hint("You need the publisher role to ship to production.")
            )}
            {needsMerge && can.publish && <span className="text-sm font-medium text-warning">↓ Merge to main first</span>}
            {can.edit && (
              <button className={btnSecondary} disabled={disabled} onClick={() => doTransition("draft")}>
                Send back to draft
              </button>
            )}
          </>
        );
      case "published":
        return (
          <>
            {can.publish && (
              <button
                className={btnPrimary}
                disabled={disabled || needsMerge}
                onClick={doDeploy}
                title={needsMerge ? "Merge this release to main before shipping" : ""}
              >
                Re-ship to production
              </button>
            )}
            {needsMerge && can.publish && <span className="text-sm font-medium text-warning">↓ Merge to main first</span>}
            {can.publish && (
              <button
                className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-50"
                disabled={disabled}
                onClick={doUndeploy}
                title="Restore production to how it looked just before this release's most recent ship"
              >
                {busy === "undeploy" ? "Rolling back…" : "↺ Roll back last deploy"}
              </button>
            )}
            {can.edit && (
              <button className={btnSecondary} disabled={disabled} onClick={() => doTransition("draft")}>
                Start revisions
              </button>
            )}
          </>
        );
      case "rolled-back":
        return (
          <>
            {can.publish ? (
              <button
                className={btnPrimary}
                disabled={disabled || needsMerge}
                onClick={doDeploy}
                title={needsMerge ? "Merge this release to main before shipping" : ""}
              >
                Re-ship to production
              </button>
            ) : (
              hint("You need the publisher role to ship to production.")
            )}
            {needsMerge && can.publish && <span className="text-sm font-medium text-warning">↓ Merge to main first</span>}
            {can.edit && (
              <button className={btnSecondary} disabled={disabled} onClick={() => doTransition("draft")}>
                Start revisions
              </button>
            )}
          </>
        );
      default:
        return null;
    }
  })();

  const driftChip =
    preview?.diff.drift === "drifted"
      ? "bg-red-100 text-red-700"
      : preview?.diff.drift === "in-sync"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-black/5 text-muted";
  const driftLabel =
    preview?.diff.drift === "drifted"
      ? "staging changed since last ship"
      : preview?.diff.drift === "in-sync"
        ? "in sync with live"
        : "never shipped";

  const hasMembers = MEMBER_KINDS.some((k) => (release.members?.[k.key] || []).length);
  const hasDeletions = MEMBER_KINDS.some((k) => (release.deletions?.[k.key] || []).length);

  return (
    <div className="max-w-4xl p-6">
      <button onClick={() => router.push("/releases")} className="mb-3 text-sm text-accent hover:underline">
        ← All releases
      </button>

      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{release.title || release.key}</h1>
        <StatusBadge status={release.status} />
        {preview && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${driftChip}`}>{driftLabel}</span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        {release.key} · author {release.author} · approver {release.approver || "—"}
      </p>

      {/* lifecycle actions */}
      <div className={`${card} flex flex-wrap items-center gap-3`}>
        {actions}
        <button className={btnSecondary} disabled={disabled} onClick={runPreview}>
          {busy === "preview" ? "Checking…" : "Preview changes vs. live"}
        </button>
        {can.admin && release.status !== "published" && (
          <button
            className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
            disabled={disabled}
            onClick={doImmediateDeploy}
            title="Admin fast-path: deploy straight to production, skipping review & approval"
          >
            {busy === "immediate" ? "Instant deploying…" : "⚡ Instant deploy (admin)"}
          </button>
        )}
        {STAGE_SITES.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {STAGE_SITES.length > 1 && (
              <>
                <span className="text-xs text-muted">Preview in</span>
                <div className="inline-flex items-center rounded-lg border border-border bg-white p-0.5">
                  {STAGE_SITES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSite(s)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase transition ${site === s ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            <a href={storeBase} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent hover:underline">
              Open staging store ↗
            </a>
          </div>
        )}
      </div>

      {msg && (
        <div
          className={`${card} ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"}`}
        >
          {msg.text}
        </div>
      )}

      {/* merge to main — fold the release's working-copy edits onto the trunk, with
          field-level three-way conflict resolution, before shipping to production. */}
      {hasBranch && merge && mergeAssets.length > 0 && (
        <div className={card} data-testid="merge-panel">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-base font-semibold">Merge to main</h3>
            {pendingMerge.length === 0 ? (
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">merged</span>
            ) : mergeConflicts.length ? (
              <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                {mergeConflicts.length} conflict{mergeConflicts.length > 1 ? "s" : ""}
              </span>
            ) : (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {pendingMerge.length} to merge
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            This release&apos;s edits live on a working copy. Fold them onto the shared main line before shipping —
            any field another release already changed on main is flagged as a conflict for you to resolve.
          </p>

          {pendingMerge.length === 0 ? (
            <p className="text-sm text-positive">✓ Working copy is merged to main — ready to ship to production.</p>
          ) : (
            <>
              <div className="mb-3 space-y-1.5">
                {pendingMerge.map((a) => (
                  <div key={a.canonicalKey} className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${a.state === "conflict" ? "bg-red-100 text-red-700" : a.state === "add" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
                    >
                      {MERGE_STATE_LABEL[a.state] || a.state}
                    </span>
                    <span className="font-medium">{nameOf("products", a.canonicalKey)}</span>
                    <span className="text-xs text-muted">
                      {a.fields.filter((f) => f.state !== "unchanged").map((f) => f.label).join(", ")}
                    </span>
                  </div>
                ))}
              </div>

              {mergeConflicts.length > 0 && (
                <div className="mb-3 space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-3">
                  <p className="text-sm font-semibold text-critical">
                    Resolve {mergeConflicts.length} conflict{mergeConflicts.length > 1 ? "s" : ""} — pick which value wins on main
                  </p>
                  {mergeConflicts.map((c) => {
                    const rk = resKey(c);
                    const chosen = resolutions[rk];
                    return (
                      <div key={rk} className="rounded-lg border border-border bg-white p-3">
                        <div className="mb-2 text-xs text-muted">
                          <span className="font-semibold text-foreground">{nameOf("products", c.canonicalKey)}</span> · field{" "}
                          <code className="font-mono">{c.label}</code>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(["ours", "theirs"] as const).map((side) => (
                            <label
                              key={side}
                              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition ${chosen === side ? "border-accent bg-accent-soft/40 ring-1 ring-accent" : "border-border hover:bg-black/[.02]"}`}
                            >
                              <input
                                type="radio"
                                name={rk}
                                className="mt-0.5"
                                checked={chosen === side}
                                onChange={() => setResolutions((r) => ({ ...r, [rk]: side }))}
                              />
                              <span>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                                  {side === "ours" ? "This release" : "Current main"}
                                </span>
                                <span className="block break-words">{displayVal(side === "ours" ? c.ours : c.theirs)}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {can.publish ? (
                <button
                  className={btnPrimary}
                  disabled={disabled || (mergeConflicts.length > 0 && !allConflictsResolved)}
                  onClick={doMerge}
                >
                  {busy === "merge" ? "Merging…" : mergeConflicts.length > 0 ? "Resolve & merge to main" : "Merge to main"}
                </button>
              ) : (
                hint("You need the publisher role to merge to main.")
              )}
            </>
          )}
        </div>
      )}

      {/* members */}
      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">What&apos;s in this release</h3>
          {!editingMembers
            ? can.edit && (
                <button className={btnSecondary} disabled={disabled} onClick={startEditMembers}>
                  Edit items
                </button>
              )
            : (
                <span className="flex gap-2">
                  <button className={btnPrimary} disabled={disabled} onClick={saveMembers}>
                    {busy === "members" ? "Saving…" : "Save"}
                  </button>
                  <button className={btnSecondary} disabled={busy === "members"} onClick={() => setEditingMembers(false)}>
                    Cancel
                  </button>
                </span>
              )}
        </div>

        {!editingMembers &&
          (hasMembers ? (
            MEMBER_KINDS.map((kind) => {
              const items = release.members?.[kind.key] || [];
              if (!items.length) return null;
              const isProducts = kind.key === "products";
              return (
                <div key={kind.key} className="mb-3">
                  <span className="text-xs uppercase tracking-wide text-muted">{kind.label}</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {items.map((k) =>
                      isProducts ? (
                        (() => {
                          const pdp = productDisplay[k]?.pdp;
                          const href = pdp && storeBase ? `${storeBase}/${pdp}` : undefined;
                          const inner = (
                            <>
                              {productDisplay[k]?.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={productDisplay[k]!.image} alt="" className="size-6 rounded object-contain bg-black/[.03]" />
                              ) : (
                                <span className="grid size-6 place-items-center rounded bg-black/[.04] text-[10px] text-muted">—</span>
                              )}
                              <span className="font-medium">{nameOf("products", k)}</span>
                              {href && <span className="text-muted">↗</span>}
                            </>
                          );
                          return href ? (
                            <a
                              key={k}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              title={`View “${nameOf("products", k)}” in staging`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white py-1 pl-1 pr-2.5 text-xs transition hover:border-accent hover:bg-accent-soft/40"
                            >
                              {inner}
                            </a>
                          ) : (
                            <span key={k} title={k} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white py-1 pl-1 pr-2.5 text-xs">
                              {inner}
                            </span>
                          );
                        })()
                      ) : (
                        <span
                          key={k}
                          title={k}
                          className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
                        >
                          {nameOf(kind.key, k)}
                        </span>
                      )
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted">No items yet — click &ldquo;Edit items&rdquo; to add products &amp; promotions.</p>
          ))}

        {editingMembers &&
          (!catalog ? (
            <p className="text-sm text-muted">Loading catalog…</p>
          ) : (
            <div className="grid gap-5">
              {MEMBER_KINDS.map((kind) => (
                <MemberPicker
                  key={kind.key}
                  label={kind.label}
                  options={catalog[kind.key] || []}
                  selected={draftMembers[kind.key] || []}
                  onChange={(keys) => setDraftMembers((m) => ({ ...m, [kind.key]: keys }))}
                />
              ))}
            </div>
          ))}
      </div>

      {/* marked for removal */}
      {hasDeletions && (
        <div className={`${card} border-red-200`}>
          <h3 className="text-base font-semibold text-critical">Marked for removal</h3>
          <p className="mb-3 mt-0.5 text-xs text-muted">These are deleted from production when this release ships.</p>
          {MEMBER_KINDS.map((kind) => {
            const items = release.deletions?.[kind.key] || [];
            if (!items.length) return null;
            return (
              <div key={kind.key} className="mb-3 last:mb-0">
                <span className="text-xs uppercase tracking-wide text-muted">{kind.label}</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {items.map((k) => (
                    <span key={k} title={k} className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-critical line-through">{nameOf(kind.key, k)}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* preview */}
      {preview && (
        <div className={card}>
          <h3 className="mb-3 text-base font-semibold">
            Ship preview <span className="font-normal text-muted">(staging → live · {preview.diff.hash})</span>
          </h3>
          {!preview.validate.deployable ? (
            <div className="mb-3 text-sm text-critical">
              ✗ Not ready — {preview.validate.missing.length} missing reference(s).
              {preview.validate.missing.slice(0, 8).map((m, i) => (
                <div key={i} className="text-xs text-muted">
                  {m.resource} {m.key} · {m.field}
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-3 text-sm text-positive">✓ All references present in live — ready to ship.</div>
          )}
          <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-700">create {preview.diff.summary.create}</span>
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-800">update {preview.diff.summary.update}</span>
            <span className="rounded-md bg-black/5 px-2 py-0.5 text-muted">unchanged {preview.diff.summary.noop}</span>
            {preview.diff.summary.error > 0 && (
              <span className="rounded-md bg-red-100 px-2 py-0.5 text-red-700">error {preview.diff.summary.error}</span>
            )}
          </div>
          {preview.diff.diff.filter((d) => d.action !== "noop").length === 0 ? (
            <p className="text-sm text-muted">Everything is already in sync with live.</p>
          ) : (
            preview.diff.diff
              .filter((d) => d.action !== "noop")
              .map((d, i) => (
                <div key={i} className="border-t border-border/60 py-1 text-sm first:border-0">
                  <strong
                    className={
                      d.action === "create" ? "text-positive" : d.action === "error" ? "text-critical" : "text-warning"
                    }
                  >
                    {d.action.toUpperCase()}
                  </strong>{" "}
                  {d.type} <code className="font-mono text-xs">{d.key}</code>
                </div>
              ))
          )}
        </div>
      )}

      {/* history */}
      {!!release.deployments?.length && (
        <div className={card}>
          <h3 className="mb-3 text-base font-semibold">Ship history</h3>
          {(release.deployments as { at: string; kind?: string; apply?: boolean; ok?: boolean; target?: string; by?: string; summary?: { create: number; update: number } }[])
            .slice(0, 10)
            .map((d, i) => (
              <div key={i} className="flex gap-3 border-t border-border/60 py-1.5 text-sm first:border-0">
                <span className="min-w-40 text-muted">{new Date(d.at).toLocaleString()}</span>
                <span>
                  {!d.apply ? "dry-run" : d.kind === "undeploy" ? <strong>ROLLBACK</strong> : <strong>SHIP</strong>} → {d.target}
                </span>
                <span className={d.ok ? "text-positive" : "text-critical"}>{d.ok ? "✓" : "✗"}</span>
                {d.summary && (
                  <span className="text-muted">
                    create {d.summary.create}, update {d.summary.update}
                  </span>
                )}
                <span className="ml-auto text-muted">{d.by}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
