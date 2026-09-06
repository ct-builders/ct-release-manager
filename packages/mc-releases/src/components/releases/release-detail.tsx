/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useState, useCallback, Fragment } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';
import { useCapabilities } from '../../sdk/use-capabilities';
import StatusBadge from '../shared/status-badge';
import MemberPicker, { type Option } from './member-picker';
import {
  MEMBER_KINDS,
  type Members,
  type Release,
  type ReleaseStatus,
} from './types';

type DiffRow = {
  type: string;
  key: string;
  action: string;
  actions?: string[];
  error?: string;
};
type Preview = {
  validate: {
    unresolved: unknown[];
    missing: { resource: string; key: string; field: string }[];
    deployable: boolean;
  };
  diff: {
    summary: { create: number; update: number; noop: number; error: number };
    diff: DiffRow[];
    hash: string;
    drift: string | null;
  };
};

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 18,
  marginBottom: 16,
};
const h3: React.CSSProperties = { margin: '0 0 12px', fontSize: 15 };
const chip = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block',
  background: bg,
  color: fg,
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 12,
  fontWeight: 700,
  marginLeft: 8,
});

const ReleaseDetail = ({ base }: { base: string }) => {
  const { key } = useParams<{ key: string }>();
  const history = useHistory();
  const { get, post, stageStorefrontUrl } = useService();
  const by = useApplicationContext<string>(
    (ctx) => ctx.user?.email ?? 'mc-user'
  );
  const { can } = useCapabilities();

  const { data, loading, error, refetch } = useAsyncData<{ release: Release }>(
    () => get(`/releases/${encodeURIComponent(key)}?project=stage`),
    [key]
  );
  const rel = data?.release;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // After the reviewer approves, if they ALSO hold publish rights we nudge them
  // to publish it themselves (rather than hand off to a separate publisher).
  const [showPublishPrompt, setShowPublishPrompt] = useState(false);
  const [editingMembers, setEditingMembers] = useState(false);
  const [draftMembers, setDraftMembers] = useState<Members>({});
  const { data: catalog } = useAsyncData<Record<string, Option[]>>(
    () => get('/catalog/members?project=stage'),
    [],
    editingMembers
  );

  const runPreview = useCallback(async () => {
    setBusy('preview');
    setMsg(null);
    try {
      const validate = await post<Preview['validate']>(
        `/releases/${encodeURIComponent(key)}/validate`,
        { from: 'stage', to: 'live' }
      );
      const diff = await post<Preview['diff']>(
        `/releases/${encodeURIComponent(key)}/diff`,
        { from: 'stage', to: 'live' }
      );
      setPreview({ validate, diff });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  }, [key, post]);

  const doStatus = async (to: ReleaseStatus, note?: string) => {
    setBusy(to);
    setMsg(null);
    try {
      await post(`/releases/${encodeURIComponent(key)}/status`, {
        to,
        by,
        note,
      });
      setMsg({
        ok: true,
        text: note
          ? `Rejected → back to draft`
          : `Status → ${to.replace(/-/g, ' ')}`,
      });
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const doReject = () => {
    const note = window.prompt(
      'Reason for rejecting this release (it will go back to draft):'
    );
    if (note === null) return; // cancelled
    if (!note.trim()) {
      setMsg({ ok: false, text: 'A reject requires a note.' });
      return;
    }
    doStatus('draft', note.trim());
  };

  // Approve, then decide who publishes. A reviewer who ALSO has publish rights is
  // prompted to publish it themselves (they just approved it); a reviewer without
  // publish rights is told a publisher must take it to production.
  const doApprove = async () => {
    setBusy('approved');
    setMsg(null);
    try {
      await post(`/releases/${encodeURIComponent(key)}/status`, {
        to: 'approved',
        by,
      });
      refetch();
      if (can.publish) setShowPublishPrompt(true);
      else
        setMsg({
          ok: true,
          text: 'Approved. A publisher needs to publish this release to production.',
        });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  // publish the release's products on stage (modified → published) so they're
  // testable on the staging storefront, then advance to ready-for-review.
  const doStagePublish = async () => {
    setBusy('stage-publish');
    setMsg(null);
    try {
      const res = await post<{
        publish: {
          summary: {
            total: number;
            published: number;
            alreadyPublished: number;
            notFound: number;
            error: number;
          };
        };
      }>(`/releases/${encodeURIComponent(key)}/stage-publish`, { by });
      const s = res.publish.summary;
      const parts = [
        `published ${s.published}`,
        `already-published ${s.alreadyPublished}`,
      ];
      if (s.notFound) parts.push(`not-found ${s.notFound}`);
      if (s.error) parts.push(`error ${s.error}`);
      setMsg({
        ok: s.error === 0,
        text: `Published to stage (${s.total} products): ${parts.join(
          ', '
        )}. Test on the staging storefront →`,
      });
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const doDeploy = async (apply: boolean, skipConfirm = false) => {
    if (
      apply &&
      !skipConfirm &&
      !window.confirm(
        `Publish release "${key}" to PRODUCTION (live / your-live-project)? This writes to the live project.`
      )
    )
      return;
    setBusy(apply ? 'deploy' : 'dry');
    setMsg(null);
    try {
      const res = await post<{
        applied: boolean;
        summary: DiffRow['action'] extends never
          ? never
          : { create: number; update: number; noop: number; error: number };
      }>(`/releases/${encodeURIComponent(key)}/deploy`, {
        from: 'stage',
        to: 'live',
        apply,
        by,
      });
      const s = (
        res as {
          summary: {
            create: number;
            update: number;
            noop: number;
            error: number;
          };
        }
      ).summary;
      setMsg({
        ok: s.error === 0,
        text: `${apply ? 'Published to production' : 'Dry-run'}: create ${
          s.create
        }, update ${s.update}, noop ${s.noop}, error ${s.error}`,
      });
      refetch();
      runPreview();
    } catch (e) {
      const err = e as {
        message: string;
        body?: { missing?: unknown[]; unresolved?: unknown[] };
      };
      setMsg({
        ok: false,
        text:
          err.message +
          (err.body?.missing
            ? ` (${err.body.missing.length} missing refs)`
            : ''),
      });
    } finally {
      setBusy(null);
    }
  };

  // Roll a published release back OFF production, restoring the pre-deploy baselines:
  // assets this release CREATED are deleted, assets it UPDATED are reverted.
  const doUndeploy = async () => {
    if (
      !window.confirm(
        `Undeploy release "${key}" from PRODUCTION (live / your-live-project)?\n\nThis restores the pre-deploy state: assets this release created are DELETED, and updated/deleted assets are reverted to their prior content.`
      )
    )
      return;
    setBusy('undeploy');
    setMsg(null);
    try {
      const res = await post<{
        summary: {
          create: number;
          update: number;
          noop: number;
          delete: number;
          error: number;
        };
      }>(`/releases/${encodeURIComponent(key)}/undeploy`, {
        to: 'live',
        apply: true,
        by,
      });
      const s = res.summary;
      setMsg({
        ok: s.error === 0,
        text: `Rolled back from production: reverted ${
          s.create + s.update
        }, deleted ${s.delete}, error ${s.error}`,
      });
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const startEditMembers = () => {
    setDraftMembers({ ...(rel?.members || {}) });
    setEditingMembers(true);
  };
  const setDraftKind = (kind: keyof Members, keys: string[]) =>
    setDraftMembers((m) => ({ ...m, [kind]: keys }));
  const saveMembers = async () => {
    setBusy('members');
    setMsg(null);
    try {
      await post(`/releases/${encodeURIComponent(key)}/members`, {
        project: 'stage',
        members: draftMembers,
      });
      setMsg({ ok: true, text: 'Members updated' });
      setEditingMembers(false);
      setPreview(null);
      refetch();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingSpinner scale="l" />;
  if (error || !rel)
    return (
      <div style={{ color: '#a3271f' }}>
        Release not found: {String((error as Error)?.message || key)}
      </div>
    );

  const hint = (text: string) => (
    <span style={{ color: '#9ca3af', fontSize: 13 }}>{text}</span>
  );

  const actionsFor: Record<ReleaseStatus, React.ReactNode> = {
    draft: can.edit ? (
      <PrimaryButton
        label={
          busy === 'stage-publish' ? 'Publishing to stage…' : 'Publish to stage'
        }
        isDisabled={!!busy}
        onClick={doStagePublish}
      />
    ) : (
      hint(
        'You need the “author” role to publish this release to stage for review.'
      )
    ),
    'ready-for-review': (
      <Fragment>
        {can.approve ? (
          <Fragment>
            <PrimaryButton
              label={busy === 'approved' ? 'Approving…' : 'Approve'}
              isDisabled={!!busy}
              onClick={doApprove}
            />
            <SecondaryButton
              label="Reject"
              isDisabled={!!busy}
              onClick={doReject}
            />
          </Fragment>
        ) : (
          hint(
            'You need the “reviewer” role to approve or reject this release.'
          )
        )}
        {can.edit && (
          <SecondaryButton
            label={
              busy === 'stage-publish'
                ? 'Re-publishing…'
                : 'Re-publish to stage'
            }
            isDisabled={!!busy}
            onClick={doStagePublish}
          />
        )}
      </Fragment>
    ),
    approved: (
      <Fragment>
        {can.publish ? (
          <PrimaryButton
            label={
              busy === 'deploy'
                ? 'Publishing to production…'
                : 'Publish to production'
            }
            isDisabled={!!busy}
            onClick={() => doDeploy(true)}
          />
        ) : (
          hint('You need the “publisher” role to publish to production.')
        )}
        {can.edit && (
          <SecondaryButton
            label="Send back to draft"
            isDisabled={!!busy}
            onClick={() => doStatus('draft')}
          />
        )}
      </Fragment>
    ),
    published: (
      <Fragment>
        {can.publish && (
          <PrimaryButton
            label={
              busy === 'deploy' ? 'Re-publishing…' : 'Re-publish to production'
            }
            isDisabled={!!busy}
            onClick={() => doDeploy(true)}
          />
        )}
        {can.publish && (
          <SecondaryButton
            label={
              busy === 'undeploy' ? 'Rolling back…' : 'Undeploy / roll back'
            }
            isDisabled={!!busy}
            onClick={doUndeploy}
          />
        )}
        {can.edit && (
          <SecondaryButton
            label="Start revisions"
            isDisabled={!!busy}
            onClick={() => doStatus('draft')}
          />
        )}
        {!can.publish &&
          !can.edit &&
          hint(
            'This release is published — you need the “publisher” or “author” role to act on it.'
          )}
      </Fragment>
    ),
    'rolled-back': (
      <Fragment>
        {can.publish && (
          <PrimaryButton
            label={
              busy === 'deploy' ? 'Re-deploying…' : 'Re-deploy to production'
            }
            isDisabled={!!busy}
            onClick={() => doDeploy(true)}
          />
        )}
        {can.edit && (
          <SecondaryButton
            label="Start revisions"
            isDisabled={!!busy}
            onClick={() => doStatus('draft')}
          />
        )}
        {!can.publish &&
          !can.edit &&
          hint(
            'This release was rolled back — you need the “publisher” or “author” role to act on it.'
          )}
      </Fragment>
    ),
  };

  const driftColor =
    preview?.diff.drift === 'drifted'
      ? chip('#fde2e1', '#a3271f')
      : preview?.diff.drift === 'in-sync'
      ? chip('#d7f5e3', '#0f7a44')
      : chip('#eef1f5', '#4b5563');

  return (
    <div style={{ maxWidth: 960 }}>
      <button
        onClick={() => history.push(`${base}/releases`)}
        style={{
          background: 'none',
          border: 'none',
          color: '#3c41c9',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 10,
          fontSize: 13,
        }}
      >
        ← All releases
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 22 }}>{rel.title}</h2>
        <StatusBadge status={rel.status} />
        {preview && (
          <span style={driftColor}>
            {preview.diff.drift === 'drifted'
              ? 'stage drifted from live'
              : preview.diff.drift === 'in-sync'
              ? 'in sync with live'
              : 'never deployed'}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: 13 }}>
        {rel.key} · author {rel.author} · approver {rel.approver || '—'}
      </p>

      {/* lifecycle actions — next to the status they act on */}
      <div
        style={{
          ...card,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {actionsFor[rel.status]}
        <SecondaryButton
          label={busy === 'preview' ? 'Checking…' : 'Validate & preview diff'}
          isDisabled={!!busy}
          onClick={runPreview}
        />
        {stageStorefrontUrl && (
          <a
            href={stageStorefrontUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              marginLeft: 'auto',
              color: '#3c41c9',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Test on stage ↗
          </a>
        )}
      </div>

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

      {/* members */}
      <div style={card}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h3 style={{ ...h3, margin: 0 }}>Members</h3>
          {!editingMembers ? (
            can.edit && (
              <SecondaryButton
                label="Edit members"
                isDisabled={!!busy}
                onClick={startEditMembers}
              />
            )
          ) : (
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <PrimaryButton
                label={busy === 'members' ? 'Saving…' : 'Save'}
                isDisabled={!!busy}
                onClick={saveMembers}
              />
              <SecondaryButton
                label="Cancel"
                isDisabled={busy === 'members'}
                onClick={() => setEditingMembers(false)}
              />
            </span>
          )}
        </div>
        {!editingMembers &&
          (MEMBER_KINDS.some((k) => (rel.members?.[k.key] || []).length) ? (
            MEMBER_KINDS.map((kind) => {
              const items = rel.members?.[kind.key] || [];
              if (!items.length) return null;
              return (
                <div key={kind.key} style={{ marginBottom: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                    }}
                  >
                    {kind.label}
                  </span>
                  <div>
                    {items.map((k) => (
                      <span key={k} style={chip('#eef2ff', '#3730a3')}>
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>
              No members yet — click “Edit members” to search and add products
              &amp; promotions.
            </div>
          ))}
        {editingMembers &&
          (!catalog ? (
            <LoadingSpinner scale="s" />
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {MEMBER_KINDS.map((kind) => (
                <MemberPicker
                  key={kind.key}
                  label={kind.label}
                  options={catalog[kind.key] || []}
                  selected={draftMembers[kind.key] || []}
                  onChange={(keys) => setDraftKind(kind.key, keys)}
                />
              ))}
            </div>
          ))}
      </div>

      {/* preview: validation + diff */}
      {preview && (
        <div style={card}>
          <h3 style={h3}>
            Deploy preview{' '}
            <span style={{ color: '#9ca3af', fontWeight: 400 }}>
              (stage → live, hash {preview.diff.hash})
            </span>
          </h3>
          {!preview.validate.deployable ? (
            <div style={{ color: '#a3271f', marginBottom: 10 }}>
              ✗ Not deployable — {preview.validate.missing.length} missing
              reference(s), {preview.validate.unresolved.length} unresolved.
              {preview.validate.missing.slice(0, 8).map((m, i) => (
                <div key={i} style={{ fontSize: 12, color: '#9ca3af' }}>
                  {m.resource} {m.key} · {m.field}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#0f7a44', marginBottom: 10 }}>
              ✓ All references present in live — deployable.
            </div>
          )}
          <div style={{ marginBottom: 10, fontSize: 13 }}>
            <span style={chip('#d7f5e3', '#0f7a44')}>
              create {preview.diff.summary.create}
            </span>
            <span style={chip('#fff4d6', '#8a6100')}>
              update {preview.diff.summary.update}
            </span>
            <span style={chip('#eef1f5', '#4b5563')}>
              noop {preview.diff.summary.noop}
            </span>
            {preview.diff.summary.error > 0 && (
              <span style={chip('#fde2e1', '#a3271f')}>
                error {preview.diff.summary.error}
              </span>
            )}
          </div>
          {preview.diff.diff
            .filter((d) => d.action !== 'noop')
            .map((d, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  padding: '3px 0',
                  borderTop: i ? '1px solid #f0f0f2' : 'none',
                }}
              >
                <strong
                  style={{
                    color:
                      d.action === 'create'
                        ? '#0f7a44'
                        : d.action === 'error'
                        ? '#a3271f'
                        : '#8a6100',
                  }}
                >
                  {d.action.toUpperCase()}
                </strong>{' '}
                {d.type} <code>{d.key}</code>
                {d.actions ? (
                  <span style={{ color: '#9ca3af' }}>
                    {' '}
                    [{d.actions.join(', ')}]
                  </span>
                ) : null}
              </div>
            ))}
          {preview.diff.diff.every((d) => d.action === 'noop') && (
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              All members already in sync with live.
            </div>
          )}
        </div>
      )}

      {/* audit trail */}
      {!!rel.deployments?.length && (
        <div style={card}>
          <h3 style={h3}>Deployment history</h3>
          {rel.deployments.slice(0, 10).map((d, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                padding: '5px 0',
                borderTop: i ? '1px solid #f0f0f2' : 'none',
                display: 'flex',
                gap: 10,
              }}
            >
              <span style={{ color: '#9ca3af', minWidth: 160 }}>
                {new Date(d.at).toLocaleString()}
              </span>
              <span
                style={{
                  minWidth: 88,
                  color: d.kind === 'undeploy' ? '#a3271f' : '#111827',
                }}
              >
                {d.kind === 'undeploy'
                  ? 'ROLLBACK'
                  : d.apply
                  ? 'APPLY'
                  : 'dry-run'}{' '}
                → {d.target}
              </span>
              <span style={{ color: d.ok ? '#0f7a44' : '#a3271f' }}>
                {d.ok ? '✓' : '✗'}
              </span>
              <span style={{ color: '#6b7280' }}>
                create {d.summary.create}, update {d.summary.update}
                {d.summary.delete ? `, delete ${d.summary.delete}` : ''}
              </span>
              <span style={{ color: '#9ca3af', marginLeft: 'auto' }}>
                {d.by}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* post-approval nudge: the approver also has publish rights → offer to publish now */}
      {showPublishPrompt && (
        <div
          data-testid="publish-prompt-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Publish to production?"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,24,39,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 24,
              maxWidth: 460,
              width: '100%',
              boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>
              Publish to production now?
            </h3>
            <p
              style={{
                margin: '0 0 18px',
                color: '#4b5563',
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              You just approved <strong>{rel.title}</strong>, and you also have
              publish rights. Would you like to publish it to production (live /
              your-live-project) now? Otherwise it will wait in{' '}
              <em>approved</em> for a publisher.
            </p>
            <div
              style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}
            >
              <SecondaryButton
                label="Not now"
                isDisabled={!!busy}
                onClick={() => {
                  setShowPublishPrompt(false);
                  setMsg({
                    ok: true,
                    text: 'Approved. Publish to production when you’re ready.',
                  });
                }}
              />
              <PrimaryButton
                label={
                  busy === 'deploy' ? 'Publishing…' : 'Publish to production'
                }
                isDisabled={!!busy}
                onClick={() => {
                  setShowPublishPrompt(false);
                  doDeploy(true, true);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
ReleaseDetail.displayName = 'ReleaseDetail';

export default ReleaseDetail;
