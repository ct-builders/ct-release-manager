/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { setAutoAddAction } from "@/lib/actions";
import type { AutoAddConfig, Release } from "@/lib/types";

/**
 * Compact settings bar for the auto-add feature: toggle it and pick the "current"
 * draft release that changed products/categories/discounts get appended to.
 */
export default function AutoAddBar({
  releases,
  initialConfig,
}: {
  releases: Release[];
  initialConfig: AutoAddConfig | null;
}) {
  const [cfg, setCfg] = useState<AutoAddConfig | null>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!cfg) return null;
  const drafts = releases.filter((r) => r.status === "draft");
  const on = cfg.autoAddEnabled;
  const missingTarget = on && !cfg.currentReleaseKey;

  async function save(patch: Partial<AutoAddConfig>) {
    const next = { ...cfg!, ...patch };
    setCfg(next);
    setSaving(true);
    setErr(null);
    const res = await setAutoAddAction({
      autoAddEnabled: next.autoAddEnabled,
      currentReleaseKey: next.currentReleaseKey,
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      setCfg(cfg); // revert
    }
  }

  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-4 rounded-xl border px-4 py-2.5 ${
        on ? "border-accent/30 bg-accent-soft" : "border-border bg-black/[.02]"
      }`}
    >
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={on}
          disabled={saving}
          onChange={(e) => save({ autoAddEnabled: e.target.checked })}
          className="size-4 accent-[var(--accent)]"
        />
        Auto-add changed items to a release
      </label>

      <span className="inline-flex items-center gap-2 text-sm">
        Current release:
        <select
          value={cfg.currentReleaseKey || ""}
          disabled={saving}
          onChange={(e) => save({ currentReleaseKey: e.target.value || null })}
          className="rounded-lg border border-border bg-white px-2 py-1 text-sm outline-none focus:border-accent"
        >
          <option value="">— none —</option>
          {drafts.map((r) => (
            <option key={r.key} value={r.key}>
              {r.title || r.key}
            </option>
          ))}
        </select>
      </span>

      {saving && <span className="text-xs text-muted">saving…</span>}
      {missingTarget && <span className="text-xs text-warning">⚠ pick a draft release to receive changes</span>}
      {err && <span className="text-xs text-critical">{err}</span>}
    </div>
  );
}
