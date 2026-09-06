/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MemberPicker from "./MemberPicker";
import { createReleaseAction } from "@/lib/actions";
import { slugifyKey } from "@/lib/slug";
import { MEMBER_KINDS, memberCount, type CatalogMembers, type ReleaseMembers } from "@/lib/types";

export default function CreateReleaseForm({ catalog }: { catalog: CatalogMembers | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false); // stop auto-deriving once the user edits the key
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<Partial<ReleaseMembers>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setKind = (kind: keyof ReleaseMembers, keys: string[]) =>
    setMembers((m) => ({ ...m, [kind]: keys }));

  // typing the name auto-fills the key until the user overrides it
  const onTitle = (v: string) => {
    setTitle(v);
    if (!keyEdited) setKey(slugifyKey(v));
  };
  const onKey = (v: string) => {
    setKey(v);
    setKeyEdited(true);
  };

  async function submit() {
    setError(null);
    if (!key.trim()) {
      setError("A release key is required.");
      return;
    }
    setBusy(true);
    const res = await createReleaseAction({
      key: key.trim(),
      title: title.trim() || key.trim(),
      description,
      members,
    });
    if (res.ok && res.data) {
      // navigate to the new release; do NOT call router.refresh() here — refreshing the
      // current route cancels the in-flight push and leaves the button stuck on "Creating…".
      router.push(`/releases/${encodeURIComponent(res.data.key)}`);
    } else {
      setError(res.ok ? "Unknown error" : res.error);
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

  return (
    <div className="max-w-3xl p-6">
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Name *</span>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder="Black Friday 2026"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">
              Key <span className="font-normal text-muted">· auto from name</span>
            </span>
            <input
              className={`${inputCls} font-mono`}
              value={key}
              onChange={(e) => onKey(e.target.value)}
              placeholder="black-friday-2026"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Description</span>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="border-t border-border pt-5">
          <div className="mb-4 flex items-center gap-3">
            <strong className="text-sm">What&apos;s in this release</strong>
            <span className="text-sm text-muted">{memberCount(members)} selected</span>
          </div>
          {!catalog ? (
            <p className="text-sm text-critical">Couldn&apos;t load the catalog.</p>
          ) : (
            <div className="grid gap-5">
              {MEMBER_KINDS.map((kind) => (
                <MemberPicker
                  key={kind.key}
                  label={kind.label}
                  options={catalog[kind.key] || []}
                  selected={members[kind.key] || []}
                  onChange={(keys) => setKind(kind.key, keys)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-critical">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create release"}
        </button>
        <button
          onClick={() => router.push("/releases")}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-black/[.04]"
        >
          Cancel
        </button>
      </div>
      <p className="mt-4 text-xs text-muted">Created as a draft. You can add or change items anytime before shipping.</p>
    </div>
  );
}
