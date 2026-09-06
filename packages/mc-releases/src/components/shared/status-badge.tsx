/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/** Colored pill for a release lifecycle status. */
const COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#eef1f5', fg: '#4b5563' },
  'ready-for-review': { bg: '#fff4d6', fg: '#8a6100' },
  approved: { bg: '#e0e7ff', fg: '#3730a3' },
  published: { bg: '#d7f5e3', fg: '#0f7a44' },
  'rolled-back': { bg: '#fde2e1', fg: '#a3271f' },
};

const StatusBadge = ({ status }: { status: string }) => {
  const c = COLORS[status] || COLORS.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 700,
        textTransform: 'capitalize',
        letterSpacing: 0.2,
      }}
    >
      {status.replace(/-/g, ' ')}
    </span>
  );
};
StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
