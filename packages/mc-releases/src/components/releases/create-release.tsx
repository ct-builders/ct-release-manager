/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';
import MemberPicker, { type Option } from './member-picker';
import { MEMBER_KINDS, type Members, type Release, memberCount } from './types';

type Catalog = Record<string, Option[]>;
const label: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 4,
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};

const CreateRelease = ({ base }: { base: string }) => {
  const history = useHistory();
  const { get, post } = useService();
  const author = useApplicationContext<string>(
    (ctx) => ctx.user?.email ?? 'unknown'
  );
  const {
    data: catalog,
    loading: catalogLoading,
    error: catalogError,
  } = useAsyncData<Catalog>(() => get('/catalog/members?project=stage'), []);

  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Members>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setKind = (kind: keyof Members, keys: string[]) =>
    setMembers((m) => ({ ...m, [kind]: keys }));

  const submit = async () => {
    setError(null);
    if (!key.trim()) {
      setError('A release key is required.');
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ release: Release }>('/releases', {
        project: 'stage',
        key: key.trim(),
        title: title.trim() || key.trim(),
        description,
        author,
        members,
      });
      history.push(`${base}/releases/${encodeURIComponent(res.release.key)}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>New release</h2>
      <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>
        Name the release, then search and add the products &amp; promotions to
        group into it.
      </p>

      <div style={{ display: 'grid', gap: 18 }}>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}
        >
          <div>
            <label style={label}>Release key *</label>
            <input
              style={input}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="black-friday-2026"
            />
          </div>
          <div>
            <label style={label}>Title</label>
            <input
              style={input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Black Friday 2026"
            />
          </div>
        </div>
        <div>
          <label style={label}>Description</label>
          <input
            style={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div style={{ borderTop: '1px solid #eef0f3', paddingTop: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <strong style={{ fontSize: 14 }}>Members</strong>
            <span style={{ color: '#9ca3af', fontSize: 13 }}>
              {memberCount(members)} selected
            </span>
            {catalogLoading && <LoadingSpinner scale="s" />}
          </div>
          {!!catalogError && (
            <div style={{ color: '#a3271f', fontSize: 13 }}>
              Couldn&apos;t load the stage catalog:{' '}
              {String((catalogError as Error).message)}
            </div>
          )}
          {catalog && (
            <div style={{ display: 'grid', gap: 18 }}>
              {MEMBER_KINDS.map((kind) => (
                <MemberPicker
                  key={kind.key}
                  label={kind.label}
                  options={catalog[kind.key] || []}
                  selected={members[kind.key] || []}
                  onChange={(keys) => setKind(kind.key, keys)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ color: '#a3271f', marginTop: 14 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <PrimaryButton
          label={busy ? 'Creating…' : 'Create release'}
          onClick={submit}
          isDisabled={busy}
        />
        <SecondaryButton
          label="Cancel"
          onClick={() => history.push(`${base}/releases`)}
        />
      </div>
      <p style={{ marginTop: 16, color: '#9ca3af', fontSize: 12 }}>
        Created as <strong>draft</strong>, authored by {author}. Members are
        read from the stage project.
      </p>
    </div>
  );
};
CreateRelease.displayName = 'CreateRelease';

export default CreateRelease;
