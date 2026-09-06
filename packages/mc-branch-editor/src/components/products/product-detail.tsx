/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import TextInput from '@commercetools-uikit/text-input';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import Card from '@commercetools-uikit/card';
import Tag from '@commercetools-uikit/tag';
import { useService } from '../../sdk/use-service';
import { useCtp, enc } from '../../sdk/use-ctp';
import { useAsyncData } from '../../sdk/use-async-data';
import { useBranch } from '../../branch-context';
import type {
  Branch,
  AssetVersion,
  CtProduct,
  LocalizedString,
} from '../../types';

const LOCALE = 'en-US';
const loc = (l: LocalizedString | undefined) =>
  l ? l[LOCALE] ?? Object.values(l)[0] ?? '' : '';

/** Branch-scoped product editor: edit HEAD content + save/restore versions. */
const ProductDetail = ({ base }: { base: string }) => {
  const { canonicalKey = '' } = useParams<{ canonicalKey: string }>();
  const { branchId } = useBranch();
  const service = useService();
  const ctp = useCtp();

  // resolve the branch HEAD key for this canonical product
  const branchData = useAsyncData<{ branch: Branch }>(
    () => service.get(`/branches/${encodeURIComponent(branchId)}`),
    [branchId]
  );
  const asset = branchData.data?.branch?.assets?.[canonicalKey];
  const headKey = asset?.headKey;

  // load the HEAD product via the MC gateway
  const product = useAsyncData<CtProduct>(
    () => ctp.get(`/products/key=${enc(headKey as string)}`),
    [headKey],
    Boolean(headKey)
  );

  const versions = useAsyncData<{ versions: AssetVersion[] }>(
    () =>
      service.get(
        `/branches/${encodeURIComponent(branchId)}/assets/${encodeURIComponent(
          canonicalKey
        )}/versions`
      ),
    [branchId, canonicalKey]
  );

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{
    tone: 'positive' | 'critical';
    text: string;
  } | null>(null);

  const current = product.data?.masterData?.current;
  useEffect(() => {
    if (current) {
      setName(loc(current.name));
      setSlug(loc(current.slug));
      setDescription(loc(current.description));
    }
  }, [current]);

  const notify = (tone: 'positive' | 'critical', text: string) =>
    setMsg({ tone, text });

  const save = async () => {
    if (!product.data || !headKey) return;
    setBusy('save');
    setMsg(null);
    try {
      const actions = [
        {
          action: 'changeName',
          name: { ...current?.name, [LOCALE]: name },
          staged: false,
        },
        {
          action: 'changeSlug',
          slug: { ...current?.slug, [LOCALE]: slug },
          staged: false,
        },
        {
          action: 'setDescription',
          description: { ...current?.description, [LOCALE]: description },
          staged: false,
        },
        { action: 'publish' },
      ];
      await ctp.post(`/products/key=${enc(headKey)}`, {
        version: product.data.version,
        actions,
      });
      await product.refetch();
      notify('positive', 'Saved to branch HEAD.');
    } catch (e) {
      notify('critical', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveVersion = async () => {
    setBusy('version');
    setMsg(null);
    try {
      const r = await service.post<{ result: { version: number } }>(
        `/branches/${encodeURIComponent(branchId)}/assets/${encodeURIComponent(
          canonicalKey
        )}/save`
      );
      versions.refetch();
      notify('positive', `Saved as v${r.result.version}.`);
    } catch (e) {
      notify('critical', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (version: number) => {
    setBusy(`restore-${version}`);
    setMsg(null);
    try {
      await service.post(
        `/branches/${encodeURIComponent(branchId)}/assets/${encodeURIComponent(
          canonicalKey
        )}/restore`,
        { version }
      );
      await product.refetch();
      versions.refetch();
      notify('positive', `Restored v${version} onto HEAD.`);
    } catch (e) {
      notify('critical', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (branchData.loading) return <LoadingSpinner scale="s" />;
  if (!asset) {
    return (
      <Spacings.Stack scale="s">
        <Link to={base}>← Back to products</Link>
        <Text.Body tone="secondary">
          "{canonicalKey}" is not forked on branch {branchId}. Fork it from the
          products list first.
        </Text.Body>
      </Spacings.Stack>
    );
  }

  const attrs = current?.masterVariant?.attributes ?? [];

  return (
    <Spacings.Stack scale="l">
      <div>
        <Link to={base}>← Back to products</Link>
      </div>
      <Spacings.Inline alignItems="center" scale="s">
        <Text.Headline as="h2">{canonicalKey}</Text.Headline>
        <Tag type="normal">branch {branchId}</Tag>
        <Tag type="normal">v{asset.version}</Tag>
      </Spacings.Inline>

      {msg && (
        <Text.Detail tone={msg.tone === 'critical' ? 'critical' : 'positive'}>
          {msg.text}
        </Text.Detail>
      )}

      {product.loading ? (
        <LoadingSpinner scale="s" />
      ) : product.error ? (
        <Text.Detail tone="critical">
          {String((product.error as Error).message)}
        </Text.Detail>
      ) : (
        <Card>
          <Spacings.Stack scale="m">
            <div>
              <Text.Detail tone="secondary">Name ({LOCALE})</Text.Detail>
              <TextInput
                name="name"
                value={name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setName(e.target.value)
                }
              />
            </div>
            <div>
              <Text.Detail tone="secondary">Slug ({LOCALE})</Text.Detail>
              <TextInput
                name="slug"
                value={slug}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSlug(e.target.value)
                }
              />
            </div>
            <div>
              <Text.Detail tone="secondary">Description ({LOCALE})</Text.Detail>
              <TextInput
                name="description"
                value={description}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setDescription(e.target.value)
                }
              />
            </div>
            <Spacings.Inline scale="s">
              <PrimaryButton
                label="Save to HEAD"
                onClick={save}
                isDisabled={busy !== null}
              />
              <SecondaryButton
                label="Save version"
                onClick={saveVersion}
                isDisabled={busy !== null}
              />
            </Spacings.Inline>
          </Spacings.Stack>
        </Card>
      )}

      {attrs.length > 0 && (
        <Card>
          <Spacings.Stack scale="s">
            <Text.Subheadline as="h4">
              Master-variant attributes (read-only in this slice)
            </Text.Subheadline>
            {attrs.map((a) => (
              <Text.Detail key={a.name} tone="secondary">
                <strong>{a.name}</strong>: {JSON.stringify(a.value)}
              </Text.Detail>
            ))}
          </Spacings.Stack>
        </Card>
      )}

      <Card>
        <Spacings.Stack scale="s">
          <Text.Subheadline as="h4">Version history</Text.Subheadline>
          {versions.loading ? (
            <LoadingSpinner scale="s" />
          ) : (versions.data?.versions ?? []).length === 0 ? (
            <Text.Detail tone="secondary">No saved versions yet.</Text.Detail>
          ) : (
            (versions.data?.versions ?? []).map((v) => (
              <Spacings.Inline key={v.version} alignItems="center" scale="s">
                <Tag type="normal">v{v.version}</Tag>
                <Text.Detail tone="secondary">{v.at}</Text.Detail>
                <SecondaryButton
                  label="Restore"
                  onClick={() => restore(v.version)}
                  isDisabled={busy !== null}
                />
              </Spacings.Inline>
            ))
          )}
        </Spacings.Stack>
      </Card>
    </Spacings.Stack>
  );
};
ProductDetail.displayName = 'ProductDetail';

export default ProductDetail;
