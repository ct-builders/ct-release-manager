/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useEffect, useState } from "react";
import { aclSaveAction, aclRemoveAction } from "@/lib/actions";
import { ROLES, type AclEntry, type Role } from "@/lib/types";

const ROLE_HELP: Record<Role, string> = {
  author: "Create/edit releases & items, submit for review",
  reviewer: "Approve or send back a release in review",
  publisher: "Ship an approved release to live",
  admin: "Manage these permissions (implies all roles)",
};

export default function PermissionsTable({
  entries,
  me,
  bootstrap,
}: {
  entries: AclEntry[];
  me: string;
  bootstrap: boolean;
}) {
  // local source of truth — edits apply optimistically so nothing reflows/jumps
  const [rows, setRows] = useState<AclEntry[]>(entries);
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  // Prompt the bootstrap admin to give themselves a real entry, so access stops depending on an env var.
  const showBootstrapNotice = bootstrap && !rows.some((r) => r.email.toLowerCase() === me.trim().toLowerCase());

  async function persist(email: string, roles: Role[], prev: AclEntry[]) {
    setBusy(email);
    const res = await aclSaveAction(email, roles);
    setBusy(null);
    if (res.ok) setToast({ ok: true, text: `Saved ${email}` });
    else {
      setRows(prev); // revert
      setToast({ ok: false, text: res.error });
    }
  }

  function toggleRole(entry: AclEntry, role: Role) {
    const nextRoles = entry.roles.includes(role) ? entry.roles.filter((r) => r !== role) : [...entry.roles, role];
    const prev = rows;
    setRows((rs) => rs.map((e) => (e.email === entry.email ? { ...e, roles: nextRoles } : e)));
    persist(entry.email, nextRoles, prev);
  }

  async function remove(email: string) {
    if (!window.confirm(`Remove all permissions for ${email}?`)) return;
    const prev = rows;
    setRows((rs) => rs.filter((e) => e.email !== email));
    setBusy(email);
    const res = await aclRemoveAction(email);
    setBusy(null);
    if (res.ok) setToast({ ok: true, text: `Removed ${email}` });
    else {
      setRows(prev);
      setToast({ ok: false, text: res.error });
    }
  }

  function grantMeAdmin() {
    const prev = rows;
    setRows((rs) =>
      rs.some((e) => e.email === me) ? rs.map((e) => (e.email === me ? { ...e, roles: ["admin"] } : e)) : [...rs, { email: me, roles: ["admin"] }]
    );
    persist(me, ["admin"], prev);
  }

  function addUser() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (rows.some((e) => e.email.toLowerCase() === email)) {
      setToast({ ok: false, text: `${email} already exists` });
      return;
    }
    setNewEmail("");
    const prev = rows;
    setRows((rs) => [...rs, { email, roles: [] }]);
    persist(email, [], prev);
  }

  return (
    <div className="max-w-4xl p-6">
      {showBootstrapNotice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>You are signed in as the bootstrap admin.</strong> Your access comes from an environment
          variable rather than this list. Grant yourself <strong>Admin</strong> to make it permanent, then add
          your teammates.
          <div className="mt-3">
            <button
              disabled={!!busy}
              onClick={grantMeAdmin}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              Grant me Admin
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="border-b border-border px-4 py-2.5 font-semibold">User</th>
              {ROLES.map((r) => (
                <th key={r} title={ROLE_HELP[r]} className="border-b border-border px-4 py-2.5 text-center font-semibold">
                  {r}
                </th>
              ))}
              <th className="border-b border-border px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.email} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-semibold">{e.email}</span>
                  {e.email === me && <span className="text-muted"> (you)</span>}
                </td>
                {ROLES.map((r) => (
                  <td key={r} className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={e.roles.includes(r)}
                      disabled={busy === e.email}
                      onChange={() => toggleRole(e, r)}
                      className="size-4 cursor-pointer accent-[var(--accent)]"
                    />
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right">
                  <button
                    disabled={busy === e.email}
                    onClick={() => remove(e.email)}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-muted" colSpan={ROLES.length + 2}>
                  No users yet — add one below to enable enforcement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
        <input
          type="email"
          placeholder="user@commercetools.com"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addUser();
          }}
          className="w-80 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <button
          disabled={!!busy || !newEmail.trim()}
          onClick={addUser}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          Add user
        </button>
        <span className="text-xs text-muted">Added with no roles — check the boxes to grant access.</span>
      </div>

      <div className="mt-4 space-y-0.5 text-xs text-muted">
        {ROLES.map((r) => (
          <div key={r}>
            <strong className="text-foreground/70">{r}</strong> — {ROLE_HELP[r]}
          </div>
        ))}
      </div>

      {/* fixed toast — never shifts layout */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
            toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-critical"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
