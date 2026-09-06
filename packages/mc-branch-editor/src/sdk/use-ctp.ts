/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useCallback } from 'react';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';
import { MC_API_PROXY_TARGETS } from '@commercetools-frontend/constants';
import { actions, useAsyncDispatch } from '@commercetools-frontend/sdk';
import type { TSdkAction } from '@commercetools-frontend/sdk';

const target = MC_API_PROXY_TARGETS.COMMERCETOOLS_PLATFORM;

/**
 * Low-level commercetools REST client for the Custom Application.
 *
 * Requests are forwarded through the Merchant Center API gateway, which
 * authenticates as the logged-in Merchant Center user and enforces that user's
 * permissions. The app never holds commercetools client credentials.
 *
 * Used for the deep product reads/writes (name, slug, description, attributes)
 * on a branch HEAD; branch/version orchestration goes through useService.
 */
export const useCtp = () => {
  const dispatch = useAsyncDispatch<TSdkAction, unknown>();
  const projectKey = useApplicationContext<string>(
    (context) => context.project?.key ?? ''
  );

  const get = useCallback(
    <T>(path: string): Promise<T> =>
      dispatch(
        actions.get({ mcApiProxyTarget: target, uri: `/${projectKey}${path}` })
      ) as Promise<T>,
    [dispatch, projectKey]
  );

  const post = useCallback(
    <T>(path: string, payload: unknown): Promise<T> =>
      dispatch(
        actions.post({
          mcApiProxyTarget: target,
          uri: `/${projectKey}${path}`,
          payload,
        })
      ) as Promise<T>,
    [dispatch, projectKey]
  );

  return { get, post, projectKey };
};

/** URL-encode a commercetools key/value for use in a query string path. */
export const enc = (value: string) => encodeURIComponent(value);
