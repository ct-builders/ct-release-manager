/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_LOGO,
  APP_LOGO_ALT,
  DEMO_LOGIN,
  DEMO_USERS,
  DEMO_ADMIN_EMAIL,
  DEMO_PASSWORD,
} from "@/lib/config";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(withEmail: string, withPassword: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: withEmail, password: withPassword }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Sign in failed.");
      }
      router.push("/releases");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-sm ring-1 ring-border">
        <div className="mb-6">
          {APP_LOGO && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={APP_LOGO} alt={APP_LOGO_ALT} className="mb-2.5 block h-auto w-[156px]" />
          )}
          <h1 className="text-[1.2rem] font-bold leading-tight tracking-tight">{APP_NAME}</h1>
          <p className="mt-0.5 text-xs text-muted">{APP_TAGLINE}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(email, password);
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
              autoComplete="current-password"
            />
          </label>

          {error && <p className="text-xs text-critical">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {DEMO_LOGIN && DEMO_ADMIN_EMAIL && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(DEMO_ADMIN_EMAIL, DEMO_PASSWORD)}
            className="mt-3 w-full rounded-lg border border-accent py-2 text-sm font-semibold text-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            Use demo credentials
          </button>
        )}

        {DEMO_LOGIN && DEMO_USERS.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-muted">Or sign in as a demo persona</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(u.email, DEMO_PASSWORD)}
                  className="rounded-lg border border-border bg-white px-2 py-1.5 text-left text-xs transition hover:border-accent hover:bg-accent-soft disabled:opacity-50"
                >
                  <span className="block font-medium">{u.label}</span>
                  <span className="block text-[10px] text-muted">{u.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
