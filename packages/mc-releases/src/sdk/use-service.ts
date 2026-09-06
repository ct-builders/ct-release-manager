/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useCallback, useMemo } from 'react';
import { useApplicationContext } from '@commercetools-frontend/application-shell-connectors';

/**
 * Client for the release-deploy HTTP service (Cloud Run).
 *
 * The service base URL + optional bearer token come from `additionalEnv` in
 * custom-application-config.mjs (exposed on context.environment). The service's
 * origin must be in the app's CSP `connect-src` or the browser blocks the call.
 */
type Env = {
  deployServiceUrl?: string;
  deployServiceToken?: string;
  stageStorefrontUrl?: string;
};

export const useService = () => {
  const env = useApplicationContext<Env>(
    (context) => context.environment as unknown as Env
  );
  const base = (env?.deployServiceUrl || 'http://localhost:8080').replace(
    /\/$/,
    ''
  );
  const token = env?.deployServiceToken || '';
  const stageStorefrontUrl = env?.stageStorefrontUrl || '';

  const headers = useMemo(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const get = useCallback(
    async <T>(path: string): Promise<T> => {
      const r = await fetch(`${base}${path}`, { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok)
        throw Object.assign(
          new Error((j as { error?: string }).error || `HTTP ${r.status}`),
          { body: j, status: r.status }
        );
      return j as T;
    },
    [base, headers]
  );

  const send = useCallback(
    async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers,
        body: JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok)
        throw Object.assign(
          new Error((j as { error?: string }).error || `HTTP ${r.status}`),
          { body: j, status: r.status }
        );
      return j as T;
    },
    [base, headers]
  );

  const post = useCallback(
    <T>(path: string, body?: unknown) => send<T>('POST', path, body),
    [send]
  );
  const put = useCallback(
    <T>(path: string, body?: unknown) => send<T>('PUT', path, body),
    [send]
  );
  const del = useCallback(<T>(path: string) => send<T>('DELETE', path), [send]);

  return { base, stageStorefrontUrl, get, post, put, del };
};
