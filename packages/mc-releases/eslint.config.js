/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

const mcApp = require('@commercetools-frontend/eslint-config-mc-app');

module.exports = [
  ...(Array.isArray(mcApp) ? mcApp : [mcApp]),
  {
    ignores: ['public/**', 'node_modules/**', 'dist/**'],
  },
  {
    // The browser smoke test imports `@playwright/test`, which is deliberately
    // not a dependency of this app — it is installed on demand by
    // `npx playwright test test/ui`. So the import genuinely does not resolve
    // from a plain install, and the rule would fail lint on a clean checkout
    // for a file that is working as designed. Formatting rules still apply.
    files: ['test/**'],
    rules: { 'import/no-unresolved': 'off' },
  },
];
