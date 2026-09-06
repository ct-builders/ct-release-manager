/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

export default function Placeholder({ note }: { note: string }) {
  return (
    <div className="p-6">
      <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center">
        <p className="text-sm text-muted">{note}</p>
      </div>
    </div>
  );
}
