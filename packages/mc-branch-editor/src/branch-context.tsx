/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { ACTIVE_BRANCH_STORAGE_KEY, MAIN_BRANCH } from './constants';

type BranchContextValue = {
  branchId: string;
  setBranchId: (id: string) => void;
};

const BranchContext = createContext<BranchContextValue>({
  branchId: MAIN_BRANCH,
  setBranchId: () => {},
});

const readInitial = (): string => {
  try {
    return (
      window.localStorage.getItem(ACTIVE_BRANCH_STORAGE_KEY) || MAIN_BRANCH
    );
  } catch {
    return MAIN_BRANCH;
  }
};

/** Holds the active branch for the whole app; persists the choice to localStorage. */
export const BranchProvider = ({ children }: { children: ReactNode }) => {
  const [branchId, setBranchIdState] = useState<string>(readInitial);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    try {
      window.localStorage.setItem(ACTIVE_BRANCH_STORAGE_KEY, id);
    } catch {
      /* ignore persistence errors */
    }
  }, []);

  return (
    <BranchContext.Provider value={{ branchId, setBranchId }}>
      {children}
    </BranchContext.Provider>
  );
};

export const useBranch = () => useContext(BranchContext);
