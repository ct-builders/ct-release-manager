/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useState } from 'react';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';
import { ROLES, type AclEntry, type Role } from '../releases/types';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 18,
  marginBottom: 16,
};
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
  padding: '10px 14px',
  borderBottom: '1px solid #f0f0f2',
  fontSize: 14,
  verticalAlign: 'middle',
};

const ROLE_HELP: Record<Role, string> = {
  author: 'Create/edit releases & members, submit for review',
  reviewer: 'Approve or reject a release in review',
  publisher: 'Deploy an approved release to live',
  admin: 'Manage these permissions (implies all roles)',
};

const Permissions = () => {
  const { get, post, del } = useService();
  const by = useApplicationContext<string>(
    (ctx) => ctx.user?.email ?? 'mc-user'
  );
  const { data, loading, error, refetch } = useAsyncData<{ acl: AclEntry[] }>(
    () => get(`/acl?actor=${encodeURIComponent(by)}`),
    [by]
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newEmail, setNewEmail] = useState('');

  const entries = data?.acl ?? [];
  const open = !loading && !error && entries.length === 0;

  const saveRoles = async (email: string, roles: Role[]) => {
    setBusy(email);
    setMsg(null);
    try {
      await post('/acl', { email, roles, by });
      setMsg({ ok: true, text: `Saved ${email}` });
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const toggleRole = (entry: AclEntry, role: Role) => {
    const has = entry.roles.includes(role);
    const next = has
      ? entry.roles.filter((r) => r !== role)
      : [...entry.roles, role];
    saveRoles(entry.email, next);
  };

  const remove = async (email: string) => {
    if (!window.confirm(`Remove all permissions for ${email}?`)) return;
    setBusy(email);
    setMsg(null);
    try {
      await del(
        `/acl/${encodeURIComponent(email)}?actor=${encodeURIComponent(by)}`
      );
      setMsg({ ok: true, text: `Removed ${email}` });
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const addUser = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (entries.some((e) => e.email.toLowerCase() === email)) {
      setMsg({ ok: false, text: `${email} already exists` });
      return;
    }
    setNewEmail('');
    saveRoles(email, []);
  };

  if (loading) return <LoadingSpinner scale="l" />;
  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div
        style={{
          ...card,
          borderColor: '#f3c7c3',
          background: '#fdf4f3',
          color: '#a3271f',
        }}
      >
        {status === 403
          ? 'You need the “admin” role to manage permissions.'
          : `Failed to load permissions: ${String((error as Error).message)}`}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Permissions</h2>
        <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
          Who can author, review, and publish releases. Changes save
          immediately.
        </p>
      </div>

      {open && (
        <div
          style={{
            ...card,
            borderColor: '#fde68a',
            background: '#fffbeb',
            color: '#8a6100',
          }}
        >
          <strong>Open mode — the workflow is currently unrestricted.</strong>{' '}
          With no users configured, everyone can do everything. Add users below
          to turn enforcement on. Grant yourself <strong>Admin</strong> first so
          you don’t lose access.
          <div style={{ marginTop: 10 }}>
            <PrimaryButton
              label="Grant me Admin"
              isDisabled={!!busy}
              onClick={() => saveRoles(by, ['admin'])}
            />
          </div>
        </div>
      )}

      {msg && (
        <div
          style={{
            ...card,
            borderColor: msg.ok ? '#b7ebc9' : '#f3c7c3',
            background: msg.ok ? '#f2fbf5' : '#fdf4f3',
            color: msg.ok ? '#0f7a44' : '#a3271f',
          }}
        >
          {msg.text}
        </div>
      )}

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
              <th style={th}>User</th>
              {ROLES.map((r) => (
                <th
                  key={r}
                  style={{ ...th, textAlign: 'center' }}
                  title={ROLE_HELP[r]}
                >
                  {r}
                </th>
              ))}
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.email}>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: '#374151' }}>
                    {e.email}
                    {e.email === by && (
                      <span style={{ color: '#9ca3af', fontWeight: 400 }}>
                        {' '}
                        (you)
                      </span>
                    )}
                  </div>
                </td>
                {ROLES.map((r) => (
                  <td key={r} style={{ ...td, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={e.roles.includes(r)}
                      disabled={busy === e.email}
                      onChange={() => toggleRole(e, r)}
                      style={{ cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </td>
                ))}
                <td style={{ ...td, textAlign: 'right' }}>
                  <SecondaryButton
                    label="Remove"
                    isDisabled={busy === e.email}
                    onClick={() => remove(e.email)}
                  />
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td
                  style={{ ...td, color: '#9ca3af' }}
                  colSpan={ROLES.length + 2}
                >
                  No users yet — add one below to enable enforcement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          ...card,
          marginTop: 16,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input
          type="email"
          placeholder="user@commercetools.com"
          value={newEmail}
          onChange={(ev) => setNewEmail(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') addUser();
          }}
          style={{
            flex: '0 0 320px',
            padding: '8px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <PrimaryButton
          label="Add user"
          isDisabled={!!busy || !newEmail.trim()}
          onClick={addUser}
        />
        <span style={{ color: '#9ca3af', fontSize: 12 }}>
          Added with no roles — check the boxes to grant access.
        </span>
      </div>

      <div style={{ marginTop: 12, color: '#9ca3af', fontSize: 12 }}>
        {ROLES.map((r) => (
          <div key={r}>
            <strong style={{ color: '#6b7280' }}>{r}</strong> — {ROLE_HELP[r]}
          </div>
        ))}
      </div>
    </div>
  );
};
Permissions.displayName = 'Permissions';

export default Permissions;
