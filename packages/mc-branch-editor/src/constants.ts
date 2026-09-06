/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

// Import the helper from the `ssr` entry point.
import { entryPointUriPathToPermissionKeys } from '@commercetools-frontend/application-shell/ssr';

export const entryPointUriPath = 'branch-editor';

export const PERMISSIONS = entryPointUriPathToPermissionKeys(entryPointUriPath);

/** localStorage key for the active branch selection. */
export const ACTIVE_BRANCH_STORAGE_KEY = 'release-branch-editor:active-branch';
/** trunk/main is implicit and never suffixed. */
export const MAIN_BRANCH = 'main';
