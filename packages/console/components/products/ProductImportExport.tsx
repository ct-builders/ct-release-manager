/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProductImportExport({ exportHref, releaseActive }: { exportHref: string; releaseActive: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setToast(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/products/import", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      setToast({ ok: (j.failed ?? 0) === 0, text: `Imported ${j.imported}${j.failed ? `, ${j.failed} failed` : ""} into the release.` });
      router.refresh();
    } else setToast({ ok: false, text: j.error || "Import failed." });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-2">
      <a href={exportHref} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/[.04]">
        Export CSV
      </a>
      {releaseActive && (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import CSV"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </>
      )}
      {toast && (
        <span className={`text-xs font-medium ${toast.ok ? "text-positive" : "text-critical"}`}>{toast.text}</span>
      )}
    </div>
  );
}
