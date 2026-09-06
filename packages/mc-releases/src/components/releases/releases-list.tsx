/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useHistory } from 'react-router-dom';
import PrimaryButton from '@commercetools-uikit/primary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';
import { useCapabilities } from '../../sdk/use-capabilities';
import StatusBadge from '../shared/status-badge';
import AutoAddBar from './auto-add-bar';
import { type Release, memberCount } from './types';

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
};
const td: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid #f0f0f2',
  fontSize: 14,
};

const ReleasesList = ({ base }: { base: string }) => {
  const history = useHistory();
  const { get } = useService();
  const { can } = useCapabilities();
  const { data, loading, error } = useAsyncData<{ releases: Release[] }>(
    () => get('/releases?project=stage'),
    []
  );

  const releases = data?.releases || [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Releases</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Groups of products &amp; promotions authored on stage, deployed to
            live.
          </p>
        </div>
        {can.edit && (
          <PrimaryButton
            label="New release"
            onClick={() => history.push(`${base}/releases/new`)}
          />
        )}
      </div>

      {!loading && !error && <AutoAddBar releases={releases} />}

      {loading && <LoadingSpinner scale="l" />}
      {!!error && (
        <div style={{ color: '#a3271f' }}>
          Failed to load releases: {String((error as Error).message)}
        </div>
      )}

      {!loading && !error && releases.length === 0 && (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#6b7280',
            border: '1px dashed #d1d5db',
            borderRadius: 8,
          }}
        >
          No releases yet. Create one to group products &amp; promotions for
          deployment.
        </div>
      )}

      {releases.length > 0 && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Release</th>
                <th style={th}>Status</th>
                <th style={th}>Members</th>
                <th style={th}>Author → Approver</th>
                <th style={th}>Last deploy</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => {
                const last = r.deployments?.[0];
                return (
                  <tr
                    key={r.key}
                    onClick={() =>
                      history.push(
                        `${base}/releases/${encodeURIComponent(r.key)}`
                      )
                    }
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = '#f8f9fb')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#3c41c9' }}>
                        {r.title}
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: 12 }}>
                        {r.key}
                      </div>
                    </td>
                    <td style={td}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={td}>{memberCount(r.members)}</td>
                    <td style={td}>
                      <span style={{ color: '#374151' }}>{r.author}</span>
                      <span style={{ color: '#9ca3af' }}>
                        {' '}
                        → {r.approver || '—'}
                      </span>
                    </td>
                    <td style={td}>
                      {last ? (
                        <span title={last.at}>
                          {last.apply ? 'Deployed' : 'Dry-run'}{' '}
                          {last.ok ? '✓' : '✗'}{' '}
                          <span style={{ color: '#9ca3af', fontSize: 12 }}>
                            {new Date(last.at).toLocaleString()}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>never</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
ReleasesList.displayName = 'ReleasesList';

export default ReleasesList;
