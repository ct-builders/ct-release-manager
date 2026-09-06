/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { useCallback, useEffect, useState } from 'react';

type TAsyncData<T> = {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  refetch: () => void;
};

/** Runs an async fetcher, tracks loading/error/data, exposes refetch. */
export const useAsyncData = <T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true
): TAsyncData<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<unknown>(undefined);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    fetcher()
      .then((result) => active && setData(result))
      .catch((e) => active && setError(e))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);

  return { data, loading, error, refetch };
};
