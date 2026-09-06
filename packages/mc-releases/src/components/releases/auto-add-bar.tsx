/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useEffect, useState } from 'react';
import { useService } from '../../sdk/use-service';
import { type Release, type AutoAddConfig } from './types';

/**
 * Compact settings bar for the change-listener auto-add feature. Toggles
 * autoAddEnabled and picks the "current" draft release that changed products /
 * categories / discounts get appended to. Backed by GET/PUT /config.
 */
const wrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
  padding: '10px 14px',
  marginBottom: 16,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#f8f9fb',
};
const sel: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
};

const AutoAddBar = ({
  releases,
  onChanged,
}: {
  releases: Release[];
  onChanged?: () => void;
}) => {
  const { get, put } = useService();
  const [cfg, setCfg] = useState<AutoAddConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    get<{ config: AutoAddConfig }>('/config?project=stage')
      .then((r) => setCfg(r.config))
      .catch((e) => setErr(String((e as Error).message)));
  }, [get]);

  const drafts = releases.filter((r) => r.status === 'draft');

  const save = async (patch: Partial<AutoAddConfig>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    setSaving(true);
    setErr(null);
    try {
      const r = await put<{ config: AutoAddConfig }>('/config', {
        autoAddEnabled: next.autoAddEnabled,
        currentReleaseKey: next.currentReleaseKey,
        by: 'mc-user',
      });
      setCfg(r.config);
      onChanged?.();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  };

  if (err && !cfg) return null; // config endpoint unavailable — hide the bar rather than break the list
  if (!cfg) return null;

  const on = cfg.autoAddEnabled;
  const missingTarget = on && !cfg.currentReleaseKey;

  return (
    <div
      style={{
        ...wrap,
        borderColor: on ? '#c7d2fe' : '#e5e7eb',
        background: on ? '#eef2ff' : '#f8f9fb',
      }}
    >
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          color: '#374151',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={on}
          disabled={saving}
          onChange={(e) => save({ autoAddEnabled: e.target.checked })}
        />
        Auto-add changed products / categories / discounts
      </label>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: '#374151',
        }}
      >
        Current release:
        <select
          style={sel}
          value={cfg.currentReleaseKey || ''}
          disabled={saving}
          onChange={(e) => save({ currentReleaseKey: e.target.value || null })}
        >
          <option value="">— none —</option>
          {drafts.map((r) => (
            <option key={r.key} value={r.key}>
              {r.title} ({r.key})
            </option>
          ))}
        </select>
      </span>

      {saving && (
        <span style={{ fontSize: 12, color: '#6b7280' }}>saving…</span>
      )}
      {missingTarget && (
        <span style={{ fontSize: 12, color: '#b45309' }}>
          ⚠ pick a draft release to receive changes
        </span>
      )}
      {err && <span style={{ fontSize: 12, color: '#a3271f' }}>{err}</span>}
    </div>
  );
};
AutoAddBar.displayName = 'AutoAddBar';

export default AutoAddBar;
