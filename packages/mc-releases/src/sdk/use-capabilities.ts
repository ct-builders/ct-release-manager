/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { useService } from './use-service';
import { useAsyncData } from './use-async-data';
import type { Actor, Capabilities } from '../components/releases/types';

/**
 * Resolves the current MC user's release-workflow capabilities from the deploy
 * service (`GET /acl/me`). Fails open: if the ACL is empty (open mode) or the
 * call errors (e.g. app deployed before the service), everything is allowed —
 * the service still enforces on write, so this only governs UI affordances.
 */
const OPEN_CAN: Capabilities = {
  edit: true,
  approve: true,
  publish: true,
  admin: true,
};

export const useCapabilities = () => {
  const { get } = useService();
  const email = useApplicationContext<string>((ctx) => ctx.user?.email ?? '');
  const { data, loading, error } = useAsyncData<Actor>(
    () => get(`/acl/me?actor=${encodeURIComponent(email)}`),
    [email]
  );
  // fall open while loading or on error so we never wrongly hide a real action
  const can: Capabilities = data && !error ? data.can : OPEN_CAN;
  return {
    actor: data,
    can,
    roles: data?.roles ?? [],
    open: data?.open ?? true,
    loading,
    email,
  };
};
