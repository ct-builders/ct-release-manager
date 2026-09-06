/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDiscountGroupAction, updateDiscountGroupAction, deleteDiscountGroupAction } from "@/lib/actions";
import type { DiscountGroupRow } from "@/lib/discount-groups";

const input =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-black/[.02] disabled:text-muted";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

export default function DiscountGroupsManager({ groups, releaseActive }: { groups: DiscountGroupRow[]; releaseActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [nk, setNk] = useState("");
  const [nn, setNn] = useState("");
  const [nd, setNd] = useState("");
  const [nso, setNso] = useState("");
  const [na, setNa] = useState(true);
  const disabled = !releaseActive || busy;

  function flash(ok: boolean, text: string) {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 2600);
  }

  async function create() {
    if (!nk.trim()) return flash(false, "Enter a key.");
    setBusy(true);
    const res = await createDiscountGroupAction({ key: nk.trim(), name: nn, description: nd, sortOrder: nso, isActive: na });
    setBusy(false);
    if (res.ok) {
      flash(true, "Group created");
      setNk(""); setNn(""); setNd(""); setNso("");
      router.refresh();
    } else flash(false, res.error);
  }

  return (
    <div className="grid gap-4">
      {!releaseActive && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Pick a release in the top bar to manage discount groups.</div>}

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold">What is a discount group?</h2>
        <p className="text-sm text-muted">A discount group contains several cart discounts and applies only the one giving the customer the best deal. The group&apos;s order (below) is used instead of each member&apos;s own priority. Assign a cart discount to a group from its editor.</p>
      </div>

      {/* create */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">New discount group</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><span className={label}>Key <span className="text-critical">*</span></span><input className={`${input} w-full font-mono`} value={nk} disabled={disabled} placeholder="best-deal-group" onChange={(e) => setNk(e.target.value)} /></div>
          <div><span className={label}>Name</span><input className={`${input} w-full`} value={nn} disabled={disabled} placeholder="Best deal group" onChange={(e) => setNn(e.target.value)} /></div>
          <div><span className={label}>Order (0–1, optional)</span><input className={`${input} w-full font-mono`} value={nso} disabled={disabled} placeholder="auto" onChange={(e) => setNso(e.target.value)} /></div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={na} disabled={disabled} onChange={(e) => setNa(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Active</label>
          <div className="sm:col-span-2"><span className={label}>Description</span><input className={`${input} w-full`} value={nd} disabled={disabled} onChange={(e) => setNd(e.target.value)} /></div>
        </div>
        <button onClick={create} disabled={disabled || !nk.trim()} className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">{busy ? "Working…" : "Create group"}</button>
      </div>

      {/* list */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="border-b border-border px-4 py-2.5 font-semibold">Group</th>
              <th className="border-b border-border px-4 py-2.5 font-semibold">Order</th>
              <th className="border-b border-border px-4 py-2.5 font-semibold">Members</th>
              <th className="border-b border-border px-4 py-2.5 font-semibold">Status</th>
              <th className="border-b border-border px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRow key={g.key} g={g} disabled={disabled} busy={busy} setBusy={setBusy} flash={flash} refresh={() => router.refresh()} />
            ))}
            {groups.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No discount groups yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {toast && <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"}`}>{toast.text}</div>}
    </div>
  );
}

function GroupRow({ g, disabled, busy, setBusy, flash, refresh }: {
  g: DiscountGroupRow;
  disabled: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (ok: boolean, text: string) => void;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(g.name);
  const [sortOrder, setSortOrder] = useState(g.sortOrder);
  const [active, setActive] = useState(g.isActive);
  const [desc, setDesc] = useState(g.description);

  async function save() {
    setBusy(true);
    const res = await updateDiscountGroupAction(g.key, { name, description: desc, sortOrder, isActive: active });
    setBusy(false);
    if (res.ok) { flash(true, "Saved"); setEditing(false); refresh(); }
    else flash(false, res.error);
  }
  async function del() {
    if (g.memberCount > 0) return flash(false, "Remove its cart discounts first.");
    if (!window.confirm(`Delete discount group “${g.name}”?`)) return;
    setBusy(true);
    const res = await deleteDiscountGroupAction(g.key);
    setBusy(false);
    if (res.ok) { flash(true, "Deleted"); refresh(); }
    else flash(false, res.error);
  }

  if (editing)
    return (
      <tr className="border-b border-border/60 bg-accent-soft/20 last:border-0">
        <td className="px-4 py-2.5"><input className={`${input} w-full`} value={name} onChange={(e) => setName(e.target.value)} /><span className="mt-1 block font-mono text-xs text-muted">{g.key}</span></td>
        <td className="px-4 py-2.5"><input className={`${input} w-24 font-mono`} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></td>
        <td className="px-4 py-2.5 text-muted">{g.memberCount}</td>
        <td className="px-4 py-2.5"><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Active</label></td>
        <td className="px-4 py-2.5 text-right">
          <button onClick={save} disabled={busy} className="mr-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">Save</button>
          <button onClick={() => setEditing(false)} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">Cancel</button>
        </td>
      </tr>
    );

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-accent-soft/40">
      <td className="px-4 py-2.5"><span className="font-medium">{g.name}</span><span className="ml-2 font-mono text-xs text-muted">{g.key}</span>{g.description && <span className="block text-xs text-muted">{g.description}</span>}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-muted">{g.sortOrder || "—"}</td>
      <td className="px-4 py-2.5 text-muted">{g.memberCount}</td>
      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.isActive ? "bg-emerald-50 text-emerald-700" : "bg-black/5 text-muted"}`}>{g.isActive ? "Active" : "Inactive"}</span></td>
      <td className="px-4 py-2.5 text-right">
        <button onClick={() => setEditing(true)} disabled={disabled} className="mr-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50">Edit</button>
        <button onClick={del} disabled={disabled || g.memberCount > 0} title={g.memberCount > 0 ? "Remove its cart discounts first" : "Delete"} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-critical hover:bg-red-50 disabled:opacity-40">Delete</button>
      </td>
    </tr>
  );
}
