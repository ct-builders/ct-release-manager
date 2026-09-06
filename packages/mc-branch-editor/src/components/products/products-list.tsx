/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import SelectInput from '@commercetools-uikit/select-input';
import PrimaryButton from '@commercetools-uikit/primary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import Tag from '@commercetools-uikit/tag';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';
import { useBranch } from '../../branch-context';
import { MAIN_BRANCH } from '../../constants';
import type { Branch, CatalogProduct } from '../../types';

type CatalogResponse = { products: CatalogProduct[] };

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e6e6e6',
  fontSize: 12,
  color: '#666',
};
const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f0f0f0',
};

/** Lists the active branch's forked HEAD products (or, on main, the canonical catalog). */
const ProductsList = ({ base }: { base: string }) => {
  const service = useService();
  const { branchId } = useBranch();
  const onMain = branchId === MAIN_BRANCH;

  const branchData = useAsyncData<{ branch: Branch }>(
    () => service.get(`/branches/${encodeURIComponent(branchId)}`),
    [branchId],
    !onMain
  );
  const catalog = useAsyncData<CatalogResponse>(
    () => service.get('/catalog/members?project=stage'),
    []
  );

  const [forkKey, setForkKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const assets = branchData.data?.branch?.assets ?? {};
  const forkedKeys = new Set(Object.keys(assets));
  const catalogProducts = catalog.data?.products ?? [];
  const forkable = catalogProducts.filter((p) => !forkedKeys.has(p.key));

  const fork = async () => {
    if (!forkKey) return;
    setBusy(true);
    setMsg(null);
    try {
      await service.post(`/branches/${encodeURIComponent(branchId)}/fork`, {
        canonicalKey: forkKey,
      });
      setForkKey('');
      branchData.refetch();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (onMain) {
    return (
      <Spacings.Stack scale="m">
        <Text.Headline as="h2">Products · main (trunk)</Text.Headline>
        <Text.Body tone="secondary">
          Trunk mirrors production. Select or create a branch above to fork
          products and edit them in isolation. Showing the canonical catalog
          read-only.
        </Text.Body>
        {catalog.loading ? (
          <LoadingSpinner scale="s" />
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Product</th>
                <th style={th}>Key</th>
              </tr>
            </thead>
            <tbody>
              {catalogProducts.map((p) => (
                <tr key={p.key}>
                  <td style={td}>{p.name || <em>(unnamed)</em>}</td>
                  <td style={td}>
                    <code>{p.key}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Spacings.Stack>
    );
  }

  return (
    <Spacings.Stack scale="m">
      <Text.Headline as="h2">Products · branch {branchId}</Text.Headline>

      <div
        style={{
          background: '#f7f9ff',
          border: '1px solid #dde6ff',
          borderRadius: 6,
          padding: 12,
        }}
      >
        <Spacings.Inline alignItems="flexEnd" scale="s">
          <div style={{ minWidth: 320 }}>
            <Text.Detail tone="secondary">
              Fork a product onto this branch
            </Text.Detail>
            <SelectInput
              name="fork-product"
              value={forkKey}
              placeholder={
                catalog.loading ? 'Loading catalog…' : 'Pick a product…'
              }
              options={forkable.map((p) => ({
                value: p.key,
                label: `${p.name || p.key} (${p.key})`,
              }))}
              onChange={(event) =>
                setForkKey(String((event.target as { value: string }).value))
              }
            />
          </div>
          <PrimaryButton
            label="Fork onto branch"
            onClick={fork}
            isDisabled={busy || !forkKey}
          />
        </Spacings.Inline>
        {msg && (
          <div style={{ marginTop: 8 }}>
            <Text.Detail tone="critical">{msg}</Text.Detail>
          </div>
        )}
      </div>

      {branchData.loading ? (
        <LoadingSpinner scale="s" />
      ) : Object.keys(assets).length === 0 ? (
        <Text.Body tone="secondary">
          No products forked onto this branch yet — fork one above to start
          editing.
        </Text.Body>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Product (canonical key)</th>
              <th style={th}>Branch HEAD key</th>
              <th style={th}>Version</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(assets).map(([canonicalKey, a]) => (
              <tr key={canonicalKey}>
                <td style={td}>
                  <Link
                    to={`${base}/products/${encodeURIComponent(canonicalKey)}`}
                    style={{ fontWeight: 600 }}
                  >
                    {canonicalKey}
                  </Link>
                </td>
                <td style={td}>
                  <code style={{ fontSize: 12, color: '#666' }}>
                    {a.headKey}
                  </code>
                </td>
                <td style={td}>
                  <Tag type="normal">v{a.version}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Spacings.Stack>
  );
};
ProductsList.displayName = 'ProductsList';

export default ProductsList;
