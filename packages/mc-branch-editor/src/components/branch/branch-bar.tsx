/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useState, type ChangeEvent } from 'react';
import Spacings from '@commercetools-uikit/spacings';
import Text from '@commercetools-uikit/text';
import SelectInput from '@commercetools-uikit/select-input';
import TextInput from '@commercetools-uikit/text-input';
import PrimaryButton from '@commercetools-uikit/primary-button';
import SecondaryButton from '@commercetools-uikit/secondary-button';
import LoadingSpinner from '@commercetools-uikit/loading-spinner';
import Tag from '@commercetools-uikit/tag';
import { useService } from '../../sdk/use-service';
import { useAsyncData } from '../../sdk/use-async-data';
import { useBranch } from '../../branch-context';
import { MAIN_BRANCH } from '../../constants';
import type { Branch } from '../../types';

/** Active-branch switcher + inline "create branch". Sits above every view. */
const BranchBar = () => {
  const service = useService();
  const { branchId, setBranchId } = useBranch();
  const { data, loading, error, refetch } = useAsyncData<{
    branches: Branch[];
  }>(() => service.get('/branches?project=stage'), []);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const branches = data?.branches ?? [];
  const options = [
    { value: MAIN_BRANCH, label: 'main (trunk)' },
    ...branches.map((b) => ({
      value: b.branchId,
      label: `${b.title} (${b.branchId})`,
    })),
  ];
  const active = branches.find((b) => b.branchId === branchId);

  const createBranch = async () => {
    if (!newId.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await service.post('/branches', {
        branchId: newId.trim(),
        title: newTitle.trim() || newId.trim(),
      });
      setBranchId(newId.trim());
      setNewId('');
      setNewTitle('');
      setCreating(false);
      refetch();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: '12px 24px',
        borderBottom: '1px solid #e6e6e6',
        background: '#fafafa',
      }}
    >
      <Spacings.Inline alignItems="center" scale="m">
        <Text.Body isBold>Branch</Text.Body>
        {loading ? (
          <LoadingSpinner scale="s" />
        ) : (
          <div style={{ minWidth: 280 }}>
            <SelectInput
              name="active-branch"
              value={branchId}
              options={options}
              onChange={(event) =>
                setBranchId(String((event.target as { value: string }).value))
              }
            />
          </div>
        )}
        {active && <Tag>{active.status}</Tag>}
        {branchId === MAIN_BRANCH && <Tag type="normal">read-only trunk</Tag>}
        <SecondaryButton
          label={creating ? 'Cancel' : 'New branch'}
          onClick={() => setCreating((c) => !c)}
        />
      </Spacings.Inline>

      {creating && (
        <div style={{ marginTop: 12 }}>
          <Spacings.Inline alignItems="flexEnd" scale="s">
            <div style={{ width: 220 }}>
              <TextInput
                name="new-branch-id"
                placeholder="branch id (e.g. winter-promo)"
                value={newId}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setNewId(e.target.value)
                }
              />
            </div>
            <div style={{ width: 260 }}>
              <TextInput
                name="new-branch-title"
                placeholder="title (optional)"
                value={newTitle}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setNewTitle(e.target.value)
                }
              />
            </div>
            <PrimaryButton
              label="Create"
              onClick={createBranch}
              isDisabled={busy || !newId.trim()}
            />
          </Spacings.Inline>
        </div>
      )}
      {(error != null || msg) && (
        <div style={{ marginTop: 8 }}>
          <Text.Detail tone="critical">
            {msg || String((error as Error)?.message || error)}
          </Text.Detail>
        </div>
      )}
    </div>
  );
};
BranchBar.displayName = 'BranchBar';

export default BranchBar;
