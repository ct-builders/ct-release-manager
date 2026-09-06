/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useState, Fragment } from 'react';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';

type ResourceRow = {
  type: string;
  group: string;
  total: number;
  withKey: number;
  missingKey: number;
  required?: boolean;
  unavailable?: boolean;
  note?: string;
};
type Report = {
  project: string;
  resources: ResourceRow[];
  embeddedPrices?: {
    productsScanned: number;
    variantsScanned: number;
    totalPrices: number;
    pricesMissingKey: number;
    productsWithGaps: number;
  };
  summary: { totalMissing: number; typesWithGaps: string[]; clean: boolean };
};

const GROUPS: { key: string; label: string }[] = [
  { key: 'promotion', label: 'Promotion layer' },
  { key: 'product', label: 'Product layer' },
  { key: 'reference', label: 'Reference layer' },
];
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 14px',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#6b7280',
};
const td: React.CSSProperties = {
  padding: '9px 14px',
  borderTop: '1px solid #f0f0f2',
  fontSize: 14,
};

const KeyAudit = () => {
  const { get } = useService();
  const [project, setProject] = useState<'live' | 'stage'>('live');
  const { data, loading, error } = useAsyncData<Report>(
    () => get(`/resources/key-audit?project=${project}`),
    [project]
  );

  const statusCell = (r: ResourceRow) => {
    if (r.unavailable)
      return <span style={{ color: '#9ca3af' }}>unavailable</span>;
    if (r.total === 0) return <span style={{ color: '#9ca3af' }}>empty</span>;
    if (r.missingKey === 0)
      return (
        <span style={{ color: '#0f7a44', fontWeight: 600 }}>✓ all keyed</span>
      );
    return (
      <span
        style={{ color: r.required ? '#a3271f' : '#8a6100', fontWeight: 700 }}
      >
        {r.missingKey} missing{r.required ? ' (required!)' : ''}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Key audit</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Resources without a <code>key</code> can&apos;t be deployed across
            projects. Fix gaps before releasing.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['live', 'stage'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProject(p)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: project === p ? '#3c41c9' : '#fff',
                color: project === p ? '#fff' : '#374151',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingSpinner scale="l" />}
      {!!error && (
        <div style={{ color: '#a3271f' }}>
          Failed to load audit: {String((error as Error).message)}
        </div>
      )}

      {data && (
        <Fragment>
          <div
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              borderRadius: 8,
              background: data.summary.clean ? '#f2fbf5' : '#fdf9ef',
              border: `1px solid ${data.summary.clean ? '#b7ebc9' : '#f0e0bd'}`,
              color: data.summary.clean ? '#0f7a44' : '#8a6100',
              fontWeight: 600,
            }}
          >
            {data.summary.clean
              ? `✓ ${data.project} is clean — every resource has a key. Ready for cross-project deploys.`
              : `⚠ ${
                  data.summary.totalMissing
                } resource(s) missing a key across: ${data.summary.typesWithGaps.join(
                  ', '
                )}`}
          </div>

          {GROUPS.map((g) => {
            const rows = data.resources.filter((r) => r.group === g.key);
            if (!rows.length) return null;
            return (
              <div
                key={g.key}
                style={{
                  marginBottom: 18,
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    background: '#f8f9fb',
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: '#6b7280',
                  }}
                >
                  {g.label}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Resource</th>
                      <th style={th}>Total</th>
                      <th style={th}>Keyed</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.type}>
                        <td style={td}>{r.type}</td>
                        <td style={td}>{r.total}</td>
                        <td style={td}>{r.withKey}</td>
                        <td style={td}>{statusCell(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {data.embeddedPrices && (
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '12px 16px',
                fontSize: 14,
              }}
            >
              <strong>Embedded prices</strong> —{' '}
              {data.embeddedPrices.totalPrices} prices across{' '}
              {data.embeddedPrices.productsScanned} products ·{' '}
              <span
                style={{
                  color: data.embeddedPrices.pricesMissingKey
                    ? '#8a6100'
                    : '#0f7a44',
                  fontWeight: 600,
                }}
              >
                {data.embeddedPrices.pricesMissingKey} missing key
              </span>
            </div>
          )}
        </Fragment>
      )}
    </div>
  );
};
KeyAudit.displayName = 'KeyAudit';

export default KeyAudit;
