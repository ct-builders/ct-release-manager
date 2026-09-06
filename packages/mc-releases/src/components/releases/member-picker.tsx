/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export type Option = { key: string; name?: string };

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: '#eef2ff',
  color: '#3730a3',
  borderRadius: 6,
  padding: '3px 6px 3px 10px',
  fontSize: 12,
  fontWeight: 600,
  margin: '0 6px 6px 0',
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};

/**
 * Searchable multi-select for release members: type to filter by name/key,
 * click a result to add, remove via the chips. Filters the given option list
 * client-side (the catalog is small and fetched once).
 */
const MemberPicker = ({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (keys: string[]) => void;
  placeholder?: string;
}) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const byKey = useMemo(
    () => Object.fromEntries(options.map((o) => [o.key, o])),
    [options]
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options
      .filter(
        (o) =>
          !selectedSet.has(o.key) &&
          (!s ||
            o.key.toLowerCase().includes(s) ||
            (o.name || '').toLowerCase().includes(s))
      )
      .slice(0, 50);
  }, [q, options, selectedSet]);

  const add = (k: string) => {
    onChange([...selected, k]);
    setQ('');
  };
  const remove = (k: string) => onChange(selected.filter((x) => x !== k));

  return (
    <div ref={boxRef}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 600,
          color: '#374151',
          marginBottom: 6,
        }}
      >
        {label}{' '}
        <span style={{ color: '#9ca3af', fontWeight: 400 }}>
          ({selected.length})
        </span>
      </label>

      {selected.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {selected.map((k) => (
            <span key={k} style={chip}>
              {byKey[k]?.name || k}
              <button
                onClick={() => remove(k)}
                title="Remove"
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#3730a3',
                  cursor: 'pointer',
                  fontSize: 15,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <input
          style={input}
          value={q}
          placeholder={placeholder || `Search ${label.toLowerCase()}…`}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {open && (matches.length > 0 || q) && (
          <div
            style={{
              position: 'absolute',
              zIndex: 20,
              left: 0,
              right: 0,
              top: 'calc(100% + 4px)',
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {matches.length === 0 && (
              <div
                style={{ padding: '10px 12px', color: '#9ca3af', fontSize: 13 }}
              >
                No matches
              </div>
            )}
            {matches.map((o) => (
              <div
                key={o.key}
                onClick={() => add(o.key)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderTop: '1px solid #f3f4f6',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = '#f5f7ff')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = '#fff')
                }
              >
                <span style={{ fontSize: 14, color: '#111827' }}>
                  {o.name || o.key}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: '#9ca3af',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {o.key}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
MemberPicker.displayName = 'MemberPicker';

export default MemberPicker;
