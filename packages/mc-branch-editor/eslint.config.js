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
];
